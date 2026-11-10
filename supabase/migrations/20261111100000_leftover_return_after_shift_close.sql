-- Leftover return after End Shift.
-- Forward-only. End Shift still records unsold_quantity for returnable products, but it no longer
-- removes those pieces from branch stock. The pieces stay reserved (not sellable) until the cashier
-- submits the existing manual return, which is the only deduction. Carryover (keep_at_branch) and
-- waste, cash, and sales reconciliation are unchanged. 9 PM auto-close is unchanged.

begin;

alter table public.branch_inventory
  add column if not exists quantity_awaiting_return numeric(14,3) not null default 0
  check (quantity_awaiting_return >= 0);

alter table public.branch_inventory
  drop constraint if exists branch_inventory_awaiting_return_within_on_hand;

alter table public.branch_inventory
  add constraint branch_inventory_awaiting_return_within_on_hand
  check (quantity_awaiting_return <= quantity_on_hand);

comment on column public.branch_inventory.quantity_awaiting_return is
  'Pieces counted as unsold at End Shift and held for the cashier leftover return. Included in quantity_on_hand, excluded from what a later shift can sell. Reduced only when the return is submitted.';

create or replace function public.assert_no_pending_inventory_reconciliation(p_branch_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.shifts s
    where s.branch_id = p_branch_id
      and s.inventory_reconciliation_required
  ) then
    raise exception 'Branch inventory is frozen until pending reconciliation completes.'
      using errcode = '55000';
  end if;
end;
$$;

revoke all on function public.assert_no_pending_inventory_reconciliation(uuid) from public, anon, authenticated;


create or replace function public.finalize_cashier_shift_reconciliation(
  p_shift_id uuid,
  p_actual_cash text,
  p_products jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user public.profiles%rowtype;
  v_shift public.shifts%rowtype;
  v_branch_id uuid;
  v_actual numeric(12,2);
  v_expected numeric(12,2);
  v_cash_diff numeric(12,2);
  v_cash_result public.cash_reconciliation_result;
  v_existing_cash public.shift_reconciliations%rowtype;
  v_needs_inventory boolean;
  v_products jsonb;
  v_item record;
  v_base public.shift_product_close_baselines%rowtype;
  v_agg record;
  v_waste bigint;
  v_actual_rem bigint;
  v_expected_rem bigint;
  v_discrepancy bigint;
  v_result public.shift_product_recon_result;
  v_unsold bigint;
  v_carried bigint;
  v_recon_id uuid;
  v_adjust_ref uuid := gen_random_uuid();
  v_adjust_qty bigint;
  v_live numeric(14,3);
  v_reserved numeric(14,3);
  v_norm_products jsonb := '[]'::jsonb;
  v_existing_products jsonb;
  v_product_summaries jsonb := '[]'::jsonb;
  v_note text;
  v_mode public.inventory_mode;
begin
  select * into v_user
  from public.profiles
  where id = auth.uid() and is_active and role = 'cashier'
  for update;
  if not found then
    raise exception 'Unauthorized: active cashier access required.' using errcode = '42501';
  end if;

  select branch_id into v_branch_id
  from public.shifts
  where id = p_shift_id
    and cashier_id = v_user.id
    and branch_id is not distinct from v_user.branch_id;
  if v_branch_id is null then
    raise exception 'Unable to access this shift.' using errcode = '42501';
  end if;

  -- Branch → exact target shift (no inventory yet; may be read-only idempotent)
  perform public.lock_shift_inventory_gate(v_branch_id, p_shift_id, false, false);

  select * into v_shift from public.shifts where id = p_shift_id;
  if v_shift.status <> 'closed' then
    raise exception 'Only a closed shift can be reconciled.' using errcode = '42501';
  end if;
  if not v_shift.reconciliation_required
     and not v_shift.inventory_reconciliation_required
     and exists (select 1 from public.shift_reconciliations r where r.shift_id = v_shift.id) then
    null;
  elsif not v_shift.reconciliation_required and not v_shift.inventory_reconciliation_required then
    raise exception 'This historical shift does not require reconciliation.' using errcode = '22023';
  end if;

  v_needs_inventory := v_shift.inventory_reconciliation_required
    or exists (select 1 from public.shift_product_close_baselines b where b.shift_id = v_shift.id);

  v_actual := public.parse_actual_cash(p_actual_cash);
  select coalesce(sum(s.total_amount), 0)::numeric(12,2) into v_expected
  from public.sales s
  where s.shift_id = v_shift.id and s.status = 'completed';

  if p_products is null or jsonb_typeof(p_products) = 'null' then
    v_products := '[]'::jsonb;
  elsif jsonb_typeof(p_products) <> 'array' then
    raise exception 'Product reconciliation list is invalid.' using errcode = '22023';
  else
    v_products := p_products;
  end if;

  if (select count(*) from jsonb_array_elements(v_products)) <>
     (select count(distinct value->>'product_id') from jsonb_array_elements(v_products)) then
    raise exception 'Each product may appear only once.' using errcode = '22023';
  end if;

  if v_needs_inventory and exists (
    select 1 from public.shift_product_close_baselines b where b.shift_id = v_shift.id
  ) then
    if exists (
      select 1 from public.shift_product_close_baselines b
      where b.shift_id = v_shift.id
        and not exists (
          select 1 from jsonb_array_elements(v_products) x
          where (x.value->>'product_id')::uuid = b.product_id
        )
    ) then
      raise exception 'Actual remaining is required for every close product.' using errcode = '22023';
    end if;
    if exists (
      select 1 from jsonb_array_elements(v_products) x
      where not exists (
        select 1 from public.shift_product_close_baselines b
        where b.shift_id = v_shift.id and b.product_id = (x.value->>'product_id')::uuid
      )
    ) then
      raise exception 'Unknown product in reconciliation payload.' using errcode = '22023';
    end if;
  elsif v_needs_inventory = false and jsonb_array_length(v_products) > 0 then
    raise exception 'This legacy shift does not accept product inventory counts.' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(norm.obj order by norm.product_id), '[]'::jsonb)
  into v_norm_products
  from (
    select
      (value->>'product_id')::uuid as product_id,
      jsonb_build_object(
        'product_id', (value->>'product_id')::uuid,
        'actual_remaining', public.parse_inventory_quantity(value->>'actual_remaining', 'piece_stock', true)::bigint,
        'waste_quantity', public.parse_inventory_quantity(
          coalesce(nullif(btrim(value->>'waste_quantity'), ''), '0'),
          'piece_stock',
          true
        )::bigint,
        'discrepancy_note', nullif(btrim(coalesce(value->>'discrepancy_note', '')), '')
      ) as obj
    from jsonb_array_elements(v_products)
  ) norm;

  -- Idempotent retry (branch+exact shift already locked; no inventory mutation)
  select * into v_existing_cash from public.shift_reconciliations where shift_id = v_shift.id;
  if found then
    if v_existing_cash.actual_cash is distinct from v_actual then
      raise exception 'This shift has already been reconciled with a different cash amount.'
        using errcode = '22023';
    end if;
    if v_needs_inventory then
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'product_id', r.product_id,
          'actual_remaining', r.actual_remaining,
          'waste_quantity', r.waste_quantity,
          'discrepancy_note', r.discrepancy_note
        )
        order by r.product_id
      ), '[]'::jsonb)
      into v_existing_products
      from public.shift_product_reconciliations r
      where r.shift_id = v_shift.id;
      if v_existing_products is distinct from v_norm_products then
        raise exception 'This shift has already been reconciled with a different inventory payload.'
          using errcode = '22023';
      end if;
    end if;
    -- Heal stuck pending flags after a prior successful remittance (no inventory rewrite).
    update public.shifts
    set reconciliation_required = false,
        inventory_reconciliation_required = false
    where id = v_shift.id
      and (reconciliation_required or inventory_reconciliation_required);
    return jsonb_build_object(
      'shift_id', v_shift.id,
      'shift_status', 'closed',
      'expected_cash', v_existing_cash.expected_cash,
      'actual_cash', v_existing_cash.actual_cash,
      'difference', v_existing_cash.difference,
      'result', v_existing_cash.result,
      'products', public.shift_close_product_summaries(v_shift.id),
      'status', 'reconciled',
      'idempotent', true
    );
  end if;

  -- Mutating path: lock inventory rows now (branch+shift already held)
  perform 1
  from public.branch_inventory bi
  where bi.branch_id = v_branch_id
  order by bi.product_id
  for update;

  if v_needs_inventory and exists (
    select 1 from public.shift_product_close_baselines b where b.shift_id = v_shift.id
  ) then
    for v_item in
      select *
      from jsonb_to_recordset(v_norm_products)
        as x(product_id uuid, actual_remaining bigint, waste_quantity bigint, discrepancy_note text)
      order by product_id
    loop
      select * into v_base
      from public.shift_product_close_baselines
      where shift_id = v_shift.id and product_id = v_item.product_id;

      v_actual_rem := v_item.actual_remaining;
      v_waste := v_item.waste_quantity;
      v_note := nullif(btrim(coalesce(v_item.discrepancy_note, '')), '');
      if v_actual_rem is null or v_actual_rem < 0 or v_waste is null or v_waste < 0 then
        raise exception 'Actual remaining and waste must be whole PCS quantities >= 0.'
          using errcode = '22023';
      end if;
      if length(coalesce(v_note, '')) > 500 then
        raise exception 'Discrepancy note is too long (maximum 500 characters).'
          using errcode = '22023';
      end if;

      select p.inventory_mode into v_mode
      from public.products p
      where p.id = v_base.product_id;
      if v_mode = 'kg_meal' and (v_actual_rem <> 0 or v_waste <> 0) then
        raise exception
          'KG (%) is Main-tracked only. Booth close does not count KG stock — enter 0 remaining and 0 waste.',
          v_base.product_name_snapshot
          using errcode = '22023';
      end if;

      select * into v_agg
      from public.aggregate_shift_product_movements(v_shift, v_base.product_id, v_base.opening_quantity);

      select quantity_on_hand into v_live
      from public.branch_inventory
      where branch_id = v_shift.branch_id and product_id = v_base.product_id;
      if coalesce(v_live, 0) <> v_agg.system_balance_before_waste then
        raise exception 'System stock for % changed unexpectedly during close (live %, expected %).',
          v_base.product_name_snapshot, coalesce(v_live, 0), v_agg.system_balance_before_waste
          using errcode = '55000';
      end if;

      v_expected_rem := v_agg.system_balance_before_waste - v_waste;
      v_discrepancy := v_actual_rem - v_expected_rem;
      v_result := case
        when v_discrepancy = 0 then 'exact'::public.shift_product_recon_result
        when v_discrepancy < 0 then 'shortage'::public.shift_product_recon_result
        else 'excess'::public.shift_product_recon_result
      end;

      if v_discrepancy <> 0 and v_mode = 'kg_meal' and v_note is null then
        raise exception 'KG discrepancy note is required for %.', v_base.product_name_snapshot
          using errcode = '22023';
      end if;

      if v_base.closing_stock_behavior = 'keep_at_branch' then
        v_carried := v_actual_rem;
        v_unsold := 0;
      else
        v_carried := 0;
        v_unsold := v_actual_rem;
      end if;

      insert into public.shift_product_reconciliations (
        shift_id, branch_id, product_id,
        product_name_snapshot, sku_snapshot, closing_stock_behavior,
        opening_quantity, received_quantity, outgoing_quantity, sold_quantity,
        waste_quantity, adjustment_quantity, net_other_movement_quantity,
        expected_remaining, actual_remaining, discrepancy,
        unsold_quantity, carried_quantity, result, discrepancy_note, recorded_by
      ) values (
        v_shift.id, v_shift.branch_id, v_base.product_id,
        v_base.product_name_snapshot, v_base.sku_snapshot, v_base.closing_stock_behavior,
        v_base.opening_quantity, v_agg.received_quantity, v_agg.outgoing_quantity, v_agg.sold_quantity,
        v_waste, v_agg.adjustment_quantity, 0,
        v_expected_rem, v_actual_rem, v_discrepancy,
        v_unsold, v_carried, v_result, v_note, v_user.id
      )
      returning id into v_recon_id;

      -- Release any earlier reservation before waste/adjustment move the balance.
      update public.branch_inventory
      set quantity_awaiting_return = 0
      where branch_id = v_shift.branch_id and product_id = v_base.product_id;

      v_adjust_qty := (v_actual_rem + v_waste) - v_agg.system_balance_before_waste;
      if v_adjust_qty <> 0 then
        update public.branch_inventory
        set quantity_on_hand = quantity_on_hand + v_adjust_qty
        where branch_id = v_shift.branch_id and product_id = v_base.product_id;
        if not found then
          insert into public.branch_inventory(branch_id, product_id, quantity_on_hand)
          values (v_shift.branch_id, v_base.product_id, greatest(v_adjust_qty, 0));
          if v_adjust_qty < 0 then
            raise exception 'Insufficient stock during close adjustment for %.', v_base.product_name_snapshot
              using errcode = '22023';
          end if;
        end if;
        insert into public.inventory_movements(
          branch_id, product_id, movement_type, quantity,
          reference_type, reference_id, created_by, notes
        ) values (
          v_shift.branch_id, v_base.product_id, 'adjustment', v_adjust_qty,
          'adjustment', v_adjust_ref, v_user.id, 'Shift close inventory reconciliation'
        );
      end if;

      if v_waste > 0 then
        update public.branch_inventory
        set quantity_on_hand = quantity_on_hand - v_waste
        where branch_id = v_shift.branch_id
          and product_id = v_base.product_id
          and quantity_on_hand >= v_waste;
        if not found then
          raise exception 'Insufficient stock during waste write for %.', v_base.product_name_snapshot
            using errcode = '22023';
        end if;
        insert into public.inventory_movements(
          branch_id, product_id, movement_type, quantity,
          reference_type, reference_id, created_by
        ) values (
          v_shift.branch_id, v_base.product_id, 'waste', -v_waste,
          'shift_product_reconciliation', v_recon_id, v_user.id
        );
        insert into public.shift_waste_occurrences(
          shift_id, branch_id, product_id, recorded_by, quantity
        ) values (
          v_shift.id, v_shift.branch_id, v_base.product_id, v_user.id, v_waste
        );
      end if;

      -- Record the unsold count on the reconciliation row, but leave the pieces
      -- on hand. The cashier returns them afterwards; that submission is the only deduction.
      update public.branch_inventory
      set quantity_awaiting_return = case
        when v_base.closing_stock_behavior = 'record_as_unsold' then v_actual_rem
        else 0
      end
      where branch_id = v_shift.branch_id
        and product_id = v_base.product_id
        and (
          v_base.closing_stock_behavior = 'keep_at_branch'
          or quantity_on_hand = v_actual_rem
        );

      select quantity_on_hand, quantity_awaiting_return
      into v_live, v_reserved
      from public.branch_inventory
      where branch_id = v_shift.branch_id and product_id = v_base.product_id;
      if coalesce(v_live, 0) <> v_actual_rem then
        raise exception 'Close left unexpected usable stock for %.', v_base.product_name_snapshot
          using errcode = '55000';
      end if;
      if v_base.closing_stock_behavior = 'keep_at_branch' then
        if coalesce(v_reserved, 0) <> 0 then
          raise exception 'Carryover close reserved stock for %.', v_base.product_name_snapshot
            using errcode = '55000';
        end if;
      elsif coalesce(v_reserved, 0) <> v_actual_rem then
        raise exception 'Unsold close did not reserve the counted leftover for %.', v_base.product_name_snapshot
          using errcode = '55000';
      end if;

      v_product_summaries := v_product_summaries || jsonb_build_array(jsonb_build_object(
        'product_id', v_base.product_id,
        'expected_remaining', v_expected_rem,
        'actual_remaining', v_actual_rem,
        'waste_quantity', v_waste,
        'discrepancy', v_discrepancy,
        'result', v_result,
        'unsold_quantity', v_unsold,
        'carried_quantity', v_carried
      ));
    end loop;
  end if;

  v_cash_diff := v_expected - v_actual;
  v_cash_result := case
    when v_cash_diff = 0 then 'exact'::public.cash_reconciliation_result
    when v_cash_diff > 0 then 'shortage'::public.cash_reconciliation_result
    else 'excess'::public.cash_reconciliation_result
  end;

  insert into public.shift_reconciliations(
    shift_id, branch_id, expected_cash, actual_cash, difference, result, recorded_by
  ) values (
    v_shift.id, v_shift.branch_id, v_expected, v_actual, v_cash_diff, v_cash_result, v_user.id
  );

  update public.shifts
  set reconciliation_required = false,
      inventory_reconciliation_required = false
  where id = v_shift.id;

  return jsonb_build_object(
    'shift_id', v_shift.id,
    'shift_status', 'closed',
    'expected_cash', v_expected,
    'actual_cash', v_actual,
    'difference', v_cash_diff,
    'result', v_cash_result,
    'products', v_product_summaries,
    'status', 'reconciled',
    'idempotent', false
  );
end;
$$;



revoke all on function public.finalize_cashier_shift_reconciliation(uuid, text, jsonb)
  from public, anon;
grant execute on function public.finalize_cashier_shift_reconciliation(uuid, text, jsonb)
  to authenticated;

create or replace function public.apply_leftover_return(
  p_cashier_id      uuid,
  p_notes           text,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user     public.profiles%rowtype;
  v_source   public.branches%rowtype;
  v_main     public.branches%rowtype;
  v_existing public.stock_returns%rowtype;
  v_items    jsonb;
  v_item     record;
  v_product  public.products%rowtype;
  v_stock    bigint;
  v_id       uuid;
  v_number   text;
begin
  if p_cashier_id is null then return null; end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 16 and 100
    or length(coalesce(p_notes, '')) > 2000 then
    raise exception 'Invalid confirmation key or notes.' using errcode = '22023';
  end if;

  select * into v_user from public.profiles where id = p_cashier_id and role = 'cashier' for update;
  if not found or v_user.branch_id is null then return null; end if;

  -- Pending reconciliation still blocks a return. A finished same-day close does not:
  -- the cashier submits the leftover return after End Shift.
  perform public.lock_branch_inventory_gate(v_user.branch_id, false);
  perform public.assert_no_pending_inventory_reconciliation(v_user.branch_id);

  select * into v_source from public.branches where id = v_user.branch_id and not is_main_branch;
  if not found then return null; end if;
  select * into v_main from public.branches where is_main_branch and is_active for share;
  if not found then return null; end if;

  select * into v_existing
  from public.stock_returns
  where created_by = v_user.id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.notes is distinct from p_notes then
      raise exception 'This confirmation key belongs to a different return.' using errcode = '22023';
    end if;
    return v_existing.id;
  end if;

  -- Only physically returnable PCS; exclude non-returnable (carryover/drinks/snacks).
  select jsonb_agg(
           jsonb_build_object('product_id', q.product_id, 'quantity_returned', q.quantity_returned)
           order by q.product_id
         )
    into v_items
  from (
    select i.product_id, trunc(i.quantity_on_hand)::bigint as quantity_returned
    from public.branch_inventory i
    join public.products p on p.id = i.product_id
    where i.branch_id = v_source.id
      and i.quantity_on_hand > 0
      and i.quantity_on_hand = trunc(i.quantity_on_hand)
      and not p.is_non_returnable
      and p.inventory_mode = 'piece_stock'
  ) q;

  if v_items is null or jsonb_array_length(v_items) = 0 then
    return null;
  end if;
  if jsonb_array_length(v_items) > 200 then
    raise exception 'Too many leftover products to return at once.' using errcode = '22023';
  end if;

  for v_item in
    select * from jsonb_to_recordset(v_items) as x(product_id uuid, quantity_returned bigint)
    order by product_id
  loop
    select * into v_product from public.products where id = v_item.product_id for share;
    if not found then raise exception 'Product unavailable.' using errcode = '22023'; end if;
    if v_product.is_non_returnable then
      raise exception '% is non-returnable and must stay at the branch.', v_product.name
        using errcode = '22023';
    end if;
    select quantity_on_hand::bigint into v_stock
    from public.branch_inventory
    where branch_id = v_source.id and product_id = v_item.product_id
    for update;
    if coalesce(v_stock, 0) < v_item.quantity_returned then
      raise exception 'Insufficient stock. % — Available: %, Requested: %',
        v_product.name, coalesce(v_stock, 0), v_item.quantity_returned using errcode = '22023';
    end if;
  end loop;

  v_number := nextval('public.return_number_seq')::text;
  insert into public.stock_returns(
    return_number, from_branch_id, to_branch_id, created_by, returned_by,
    from_branch_name, to_branch_name, returned_by_name, notes, idempotency_key, request_items
  ) values (
    'RET-' || lpad(v_number, greatest(6, length(v_number)), '0'),
    v_source.id, v_main.id, v_user.id, v_user.id,
    v_source.name, v_main.name, v_user.full_name, p_notes, p_idempotency_key, v_items
  ) returning id into v_id;

  for v_item in
    select * from jsonb_to_recordset(v_items) as x(product_id uuid, quantity_returned bigint)
    order by product_id
  loop
    select * into v_product from public.products where id = v_item.product_id;
    insert into public.stock_return_items(stock_return_id, product_id, quantity_returned, product_name, product_sku)
    values (v_id, v_item.product_id, v_item.quantity_returned, v_product.name, v_product.sku);
    update public.branch_inventory
    set quantity_on_hand = quantity_on_hand - v_item.quantity_returned,
        quantity_awaiting_return = greatest(0, quantity_awaiting_return - v_item.quantity_returned)
    where branch_id = v_source.id and product_id = v_item.product_id
      and quantity_on_hand >= v_item.quantity_returned;
    if not found then
      raise exception 'Insufficient stock during leftover return processing.' using errcode = '22023';
    end if;
    insert into public.inventory_movements(
      branch_id, product_id, movement_type, quantity, reference_type, reference_id, created_by, notes
    ) values (
      v_source.id, v_item.product_id, 'return_out', -v_item.quantity_returned,
      'stock_return', v_id, v_user.id, p_notes
    );
  end loop;

  return v_id;
end;
$$;

revoke all on function public.apply_leftover_return(uuid, text, text) from public, anon, authenticated;

create or replace function public.create_stock_return(
  p_items           jsonb,
  p_notes           text,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user     public.profiles%rowtype;
  v_source   public.branches%rowtype;
  v_main     public.branches%rowtype;
  v_existing public.stock_returns%rowtype;
  v_items    jsonb;
  v_item     record;
  v_product  public.products%rowtype;
  v_stock    bigint;
  v_id       uuid;
  v_number   text;
begin
  select * into v_user
  from public.profiles
  where id = auth.uid() and is_active and role in ('manager', 'cashier')
  for update;
  if not found then
    raise exception 'An active Cashier or Manager account is required.' using errcode = '42501';
  end if;
  if v_user.role = 'manager' then
    raise exception 'Returns from selling branches are created by cashiers.' using errcode = '42501';
  end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 16 and 100
    or length(coalesce(p_notes, '')) > 2000 then
    raise exception 'Invalid confirmation key or notes.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'Select products to return.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) not between 1 and 200 then
    raise exception 'Select 1 to 200 products.' using errcode = '22023';
  end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item.value) is distinct from 'object'
      or coalesce(v_item.value->>'quantity_returned', '') !~ '^[1-9][0-9]{0,5}$'
      or coalesce(v_item.value->>'product_id', '') !~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Return quantities must be positive whole numbers (maximum 999999).'
        using errcode = '22023';
    end if;
  end loop;
  select jsonb_agg(jsonb_build_object('product_id', product_id, 'quantity_returned', quantity_returned) order by product_id)
    into v_items
  from (
    select (value->>'product_id')::uuid product_id,
           sum((value->>'quantity_returned')::bigint) quantity_returned
    from jsonb_array_elements(p_items)
    group by 1
  ) q;
  select * into v_existing
  from public.stock_returns
  where created_by = v_user.id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_items <> v_items or v_existing.notes is distinct from p_notes then
      raise exception 'This confirmation key belongs to a different return.' using errcode = '22023';
    end if;
    return v_existing.id;
  end if;

  if v_user.branch_id is null then
    raise exception 'Your assigned branch is unavailable.' using errcode = '42501';
  end if;

  -- Pending reconciliation still blocks a return. A finished same-day close does not:
  -- the cashier submits the leftover return after End Shift.
  perform public.lock_branch_inventory_gate(v_user.branch_id, false);
  perform public.assert_no_pending_inventory_reconciliation(v_user.branch_id);

  select * into v_source from public.branches where id = v_user.branch_id and not is_main_branch;
  if not found then
    raise exception 'Your assigned branch is unavailable.' using errcode = '42501';
  end if;
  select * into v_main from public.branches where is_main_branch and is_active for share;
  if not found then
    raise exception 'No active Main Branch is configured.' using errcode = '22023';
  end if;

  for v_item in
    select * from jsonb_to_recordset(v_items) as x(product_id uuid, quantity_returned bigint)
    order by product_id
  loop
    select * into v_product from public.products where id = v_item.product_id for share;
    if not found then
      raise exception 'Product unavailable.' using errcode = '22023';
    end if;
    if v_product.is_non_returnable then
      raise exception '% is non-returnable and must stay at the branch.', v_product.name
        using errcode = '22023';
    end if;
    if v_product.inventory_mode is distinct from 'piece_stock' then
      raise exception
        'KG (%) is Main-tracked only. Booth returns cannot move KG stock.',
        v_product.name
        using errcode = '22023';
    end if;
    select quantity_on_hand::bigint into v_stock
    from public.branch_inventory
    where branch_id = v_source.id and product_id = v_item.product_id
    for update;
    if coalesce(v_stock, 0) < v_item.quantity_returned then
      raise exception 'Insufficient stock. % — Available: %, Requested: %',
        v_product.name, coalesce(v_stock, 0), v_item.quantity_returned
        using errcode = '22023';
    end if;
  end loop;

  v_number := nextval('public.return_number_seq')::text;
  insert into public.stock_returns(
    return_number, from_branch_id, to_branch_id, created_by, returned_by,
    from_branch_name, to_branch_name, returned_by_name, notes, idempotency_key, request_items
  ) values (
    'RET-' || lpad(v_number, greatest(6, length(v_number)), '0'),
    v_source.id, v_main.id, v_user.id, v_user.id,
    v_source.name, v_main.name, v_user.full_name, p_notes, p_idempotency_key, v_items
  ) returning id into v_id;

  for v_item in
    select * from jsonb_to_recordset(v_items) as x(product_id uuid, quantity_returned bigint)
    order by product_id
  loop
    select * into v_product from public.products where id = v_item.product_id;
    insert into public.stock_return_items(stock_return_id, product_id, quantity_returned, product_name, product_sku)
    values (v_id, v_item.product_id, v_item.quantity_returned, v_product.name, v_product.sku);
    update public.branch_inventory
    set quantity_on_hand = quantity_on_hand - v_item.quantity_returned,
        quantity_awaiting_return = greatest(0, quantity_awaiting_return - v_item.quantity_returned)
    where branch_id = v_source.id and product_id = v_item.product_id
      and quantity_on_hand >= v_item.quantity_returned;
    if not found then
      raise exception 'Insufficient stock during return processing.' using errcode = '22023';
    end if;
    insert into public.inventory_movements(
      branch_id, product_id, movement_type, quantity, reference_type, reference_id, created_by, notes
    ) values (
      v_source.id, v_item.product_id, 'return_out', -v_item.quantity_returned,
      'stock_return', v_id, v_user.id, p_notes
    );
  end loop;

  return v_id;
end;
$$;

revoke all on function public.create_stock_return(jsonb, text, text) from public, anon;
grant execute on function public.create_stock_return(jsonb, text, text) to authenticated;


create or replace function public.guard_branch_inventory_awaiting_return()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_name text;
begin
  if tg_op = 'INSERT' then
    if new.quantity_awaiting_return < 0 or new.quantity_awaiting_return > new.quantity_on_hand then
      raise exception 'Awaiting-return quantity cannot exceed stock on hand.' using errcode = '22023';
    end if;
    return new;
  end if;
  if new.quantity_on_hand < new.quantity_awaiting_return then
    select p.name into v_name from public.products p where p.id = new.product_id;
    raise exception 'Insufficient stock. % — Available: %, Requested: %',
      coalesce(v_name, 'Item'),
      greatest(old.quantity_on_hand - old.quantity_awaiting_return, 0),
      old.quantity_on_hand - new.quantity_on_hand
      using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists branch_inventory_guard_awaiting_return on public.branch_inventory;
create trigger branch_inventory_guard_awaiting_return
before insert or update on public.branch_inventory
for each row execute function public.guard_branch_inventory_awaiting_return();

create or replace function public.pos_lines_sellable(p_branch_id uuid, p_lines jsonb)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result numeric;
begin
  if p_lines is null or jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then
    return 0;
  end if;

  -- One line of quantity 1 (every product without a recipe): the stock itself, exactly as the POS always showed.
  if jsonb_array_length(p_lines) = 1 and (p_lines->0->>'quantity')::numeric = 1 then
    select greatest(coalesce(bi.quantity_on_hand, 0) - coalesce(bi.quantity_awaiting_return, 0), 0) into v_result
    from (select 1) one
    left join public.branch_inventory bi
      on bi.branch_id = p_branch_id
     and bi.product_id = (p_lines->0->>'ingredient_product_id')::uuid;
    return greatest(coalesce(v_result, 0), 0);
  end if;

  -- Otherwise the scarcest ingredient decides, in whole units.
  select coalesce(min(floor(greatest(coalesce(bi.quantity_on_hand, 0) - coalesce(bi.quantity_awaiting_return, 0), 0) / (e.value->>'quantity')::numeric)), 0)
  into v_result
  from jsonb_array_elements(p_lines) e
  left join public.branch_inventory bi
    on bi.branch_id = p_branch_id
   and bi.product_id = (e.value->>'ingredient_product_id')::uuid;
  return greatest(coalesce(v_result, 0), 0);
end;
$$;

revoke all on function public.pos_lines_sellable(uuid, jsonb) from public, anon, authenticated;


commit;
