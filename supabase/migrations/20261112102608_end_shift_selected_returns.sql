begin;
alter table public.shifts add column selected_return_close jsonb;
create or replace function public.build_shift_close_preview(p_shift public.shifts)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenders jsonb := public.shift_payment_totals(p_shift.id);
  v_expected_cash numeric(12,2);
  v_products jsonb := '[]'::jsonb;
  v_base record;
  v_agg record;
  v_requires_count boolean;
  v_cutoff timestamptz := coalesce(p_shift.sales_cutoff_at, p_shift.ended_at, now());
begin
  select coalesce(sum(s.total_amount), 0)::numeric(12,2) into v_expected_cash
  from public.sales s
  where s.shift_id = p_shift.id and s.status = 'completed';

  for v_base in
    select b.*, (p.inventory_mode = 'piece_stock' and not p.is_non_returnable) as returnable, coalesce(i.quantity_awaiting_return,0)::bigint as held
    from public.shift_product_close_baselines b
    join public.products p on p.id=b.product_id
    left join public.branch_inventory i on i.product_id=b.product_id and i.branch_id=p_shift.branch_id
    where b.shift_id = p_shift.id
    order by b.product_name_snapshot, b.product_id
  loop
    select * into v_agg
    from public.aggregate_shift_product_movements(p_shift, v_base.product_id, v_base.opening_quantity);

    v_requires_count := v_base.opening_quantity <> 0
      or v_agg.system_balance_before_waste <> 0
      or exists (
        select 1 from public.inventory_movements m
        where m.branch_id = p_shift.branch_id and m.product_id = v_base.product_id
          and m.created_at >= p_shift.started_at and m.created_at <= v_cutoff
      )
      or exists (
        select 1 from public.branch_inventory bi
        where bi.branch_id = p_shift.branch_id and bi.product_id = v_base.product_id
          and bi.quantity_on_hand <> 0
      );

    v_products := v_products || jsonb_build_array(jsonb_build_object(
      'product_id', v_base.product_id,
      'product_name_snapshot', v_base.product_name_snapshot,
      'sku_snapshot', v_base.sku_snapshot,
      'closing_stock_behavior', v_base.closing_stock_behavior,
      'opening_quantity', v_base.opening_quantity,
      'received_quantity', v_agg.received_quantity,
      'outgoing_quantity', v_agg.outgoing_quantity,
      'sold_quantity', v_agg.sold_quantity,
      'adjustment_quantity', v_agg.adjustment_quantity,
      'system_balance_before_waste', v_agg.system_balance_before_waste,
      'returnable', v_base.returnable, 'previously_held', v_base.held,
      'requires_count', v_requires_count
    ));
  end loop;

  return jsonb_build_object(
    'shift_id', p_shift.id, 'branch_id', p_shift.branch_id,
    'started_at', p_shift.started_at, 'ended_at', p_shift.ended_at,
    'sales_cutoff_at', p_shift.sales_cutoff_at,
    'inventory_reconciliation_required', p_shift.inventory_reconciliation_required,
    'reconciliation_required', p_shift.reconciliation_required,
    'mode', case when p_shift.inventory_reconciliation_required
      or exists (select 1 from public.shift_product_close_baselines b where b.shift_id = p_shift.id)
      then 'pcs_inventory_cash' else 'legacy_cash_only' end,
    'supports_selected_returns', true,
    'expected_cash', case when (v_tenders->>'unrecorded_count')::int=0 then (v_tenders->>'cash')::numeric else v_expected_cash end,
    'expected_gcash', case when (v_tenders->>'unrecorded_count')::int=0 then (v_tenders->>'gcash')::numeric end,
    'unrecorded_count', (v_tenders->>'unrecorded_count')::int, 'products', v_products, 'status', 'pending'
  );
end;
$$;

create or replace function public.apply_shift_reconciliation(
  p_shift_id uuid,
  p_actual_cash text,
  p_products jsonb,
  p_actual_gcash text,
  p_return_ids uuid[],
  p_marker jsonb
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
  v_tenders jsonb;
  v_actual_gcash numeric(12,2);
  v_expected_gcash numeric(12,2);
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

  v_tenders := public.shift_payment_totals(v_shift.id);
  if (v_tenders->>'unrecorded_count')::int=0 and (p_actual_gcash is not null or (v_tenders->>'recorded_count')::int>0) then
    if p_actual_gcash is null then raise exception 'Enter actual GCash received using the updated app.' using errcode='22023'; end if;
    v_expected := (v_tenders->>'cash')::numeric;
    v_expected_gcash := (v_tenders->>'gcash')::numeric;
    v_actual_gcash := public.parse_actual_cash(p_actual_gcash);
  elsif p_actual_gcash is not null then
    raise exception 'This historical shift requires a combined collection count.' using errcode='22023';
  end if;

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
    if v_existing_cash.actual_cash is distinct from v_actual or v_existing_cash.actual_gcash is distinct from v_actual_gcash then
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
      'expected_gcash', v_existing_cash.expected_gcash, 'actual_gcash', v_existing_cash.actual_gcash,
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

      -- Use the cashier's dispatch decision for this close only.
      -- Older callers keep the product policy captured in their original baseline.
      if p_return_ids is not null then
        if v_base.product_id = any(p_return_ids) then
          v_base.closing_stock_behavior := 'record_as_unsold';
        else
          v_base.closing_stock_behavior := 'keep_at_branch';
        end if;
      end if;
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
    shift_id, branch_id, expected_cash, actual_cash, difference, result, recorded_by, expected_gcash, actual_gcash
  ) values (
    v_shift.id, v_shift.branch_id, v_expected, v_actual, v_cash_diff, v_cash_result, v_user.id, v_expected_gcash, v_actual_gcash
  );

  update public.shifts
  set selected_return_close = p_marker, reconciliation_required = false,
      inventory_reconciliation_required = false
  where id = v_shift.id;

  return jsonb_build_object(
    'shift_id', v_shift.id,
    'shift_status', 'closed',
    'expected_cash', v_expected,
    'actual_cash', v_actual,
    'expected_gcash', v_expected_gcash, 'actual_gcash', v_actual_gcash,
    'difference', v_cash_diff,
    'result', v_cash_result,
    'products', v_product_summaries,
    'status', 'reconciled',
    'idempotent', false
  );
end;
$$;

revoke all on function public.apply_shift_reconciliation(uuid,text,jsonb,text,uuid[],jsonb) from public, anon, authenticated;
create or replace function public.finalize_cashier_shift_reconciliation(p_shift_id uuid,p_actual_cash text,p_products jsonb,p_actual_gcash text)
returns jsonb language sql security definer set search_path='' as $$
  select public.apply_shift_reconciliation(p_shift_id,p_actual_cash,p_products,p_actual_gcash,null,null)
$$;

create function public.close_shift_with_returns(p_shift_id uuid,p_actual_cash text,p_actual_gcash text,p_return_ids uuid[],p_waste jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor public.profiles%rowtype;
  target public.shifts%rowtype;
  ids uuid[];
  request jsonb;
  preview jsonb;
  counts jsonb := '[]';
  dispatch jsonb := '[]';
  retained_holds jsonb := '{}';
  row_data record;
  wasted bigint;
  remaining bigint;
  result jsonb;
  return_id uuid;
  return_number text;
  return_key text := 'shift-close-'||gen_random_uuid()::text;
begin
  select * into actor from public.profiles where id=auth.uid() and is_active and role='cashier' for update;
  if not found or actor.branch_id is null then raise exception 'Active cashier required.' using errcode='42501'; end if;
  if not exists(select 1 from public.shifts where id=p_shift_id and cashier_id=actor.id and branch_id=actor.branch_id) then
    raise exception 'Shift unavailable.' using errcode='42501';
  end if;
  perform public.lock_shift_inventory_gate(actor.branch_id,p_shift_id,false,false);
  select * into strict target from public.shifts where id=p_shift_id;
  if target.status <> 'closed' then raise exception 'Begin End Shift first.'; end if;
  if p_return_ids is null or cardinality(p_return_ids)>200 or array_position(p_return_ids,null) is not null
    or jsonb_typeof(p_waste) is distinct from 'object' then raise exception 'Invalid return selection or waste.'; end if;
  select coalesce(array_agg(distinct id order by id),'{}') into ids from unnest(p_return_ids) u(id);
  if cardinality(ids)<>cardinality(p_return_ids) then raise exception 'A product was selected twice.'; end if;
  request := jsonb_build_object('cash',public.parse_actual_cash(p_actual_cash),'gcash',
    case when p_actual_gcash is not null then public.parse_actual_cash(p_actual_gcash) end,'ids',ids,'waste',p_waste);
  if target.selected_return_close is not null then
    if request is distinct from target.selected_return_close->'request' then raise exception 'Already closed with different details.'; end if;
    select r.id,r.return_number into return_id,return_number from public.stock_returns r
      where r.created_by=actor.id and r.idempotency_key=target.selected_return_close->>'return_key';
    select jsonb_build_object('shift_id',target.id,'expected_cash',r.expected_cash,'actual_cash',r.actual_cash,
      'expected_gcash',r.expected_gcash,'actual_gcash',r.actual_gcash,'difference',r.difference,'result',r.result,
      'status','reconciled','shift_status','closed','selected_return_close',true,'return_id',return_id,
      'return_number',return_number,'idempotent',true) into strict result
      from public.shift_reconciliations r where r.shift_id=target.id;
    return result;
  end if;
  if not target.reconciliation_required or exists(select 1 from public.shift_reconciliations where shift_id=target.id) then
    raise exception 'Shift already finalized.';
  end if;
  preview := public.build_shift_close_preview(target);
  if preview->>'mode' <> 'pcs_inventory_cash' then raise exception 'This shift requires cash-only reconciliation.'; end if;
  for row_data in select * from jsonb_to_recordset(preview->'products')
    as x(product_id uuid,system_balance_before_waste bigint,returnable boolean,previously_held bigint) loop
    if p_waste ? row_data.product_id::text and (jsonb_typeof(p_waste->row_data.product_id::text) <> 'number'
      or (p_waste->>row_data.product_id::text) !~ '^[1-9][0-9]{0,5}$') then raise exception 'Invalid waste quantity.'; end if;
    wasted := coalesce((p_waste->>row_data.product_id::text)::bigint,0);
    p_waste := p_waste - row_data.product_id::text;
    remaining := row_data.system_balance_before_waste - wasted;
    if remaining < row_data.previously_held then raise exception 'Waste exceeds available stock.'; end if;
    counts := counts || jsonb_build_array(jsonb_build_object('product_id',row_data.product_id,
      'actual_remaining',remaining::text,'waste_quantity',wasted::text));
    if row_data.product_id=any(ids) then
      if not row_data.returnable or remaining<=0 then raise exception 'Selected stock cannot be returned.'; end if;
      dispatch := dispatch || jsonb_build_array(jsonb_build_object('product_id',row_data.product_id,'quantity_returned',remaining));
    elsif row_data.previously_held>0 then
      retained_holds := retained_holds || jsonb_build_object(row_data.product_id::text,row_data.previously_held);
    end if;
  end loop;
  if jsonb_array_length(dispatch)<>cardinality(ids) or p_waste <> '{}' then raise exception 'Product outside this shift.'; end if;
  result := public.apply_shift_reconciliation(target.id,p_actual_cash,counts,p_actual_gcash,ids, jsonb_build_object('request',request,'return_key',return_key));
  -- Preserve holds from older closes when the cashier leaves that item at the branch.
  update public.branch_inventory i set quantity_awaiting_return=h.value::bigint
    from jsonb_each_text(retained_holds) h where i.branch_id=actor.branch_id and i.product_id=h.key::uuid;
  if cardinality(ids)>0 then
    return_id := public.create_stock_return(dispatch,'End shift return',return_key);
    select r.return_number into strict return_number from public.stock_returns r where r.id=return_id;
  end if;
  result := (result - 'products') || jsonb_build_object('selected_return_close',true,'return_id',return_id,'return_number',return_number);
  return result;
end;
$$;
revoke all on function public.close_shift_with_returns(uuid,text,text,uuid[],jsonb) from public,anon;
grant execute on function public.close_shift_with_returns(uuid,text,text,uuid[],jsonb) to authenticated;
create or replace function public.get_shift_remittance_detail(p_shift_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if p_shift_id is null then
    raise exception 'Shift id is required.' using errcode = '22023';
  end if;
  if not (public.is_owner() or public.is_main_branch_manager()) then
    raise exception 'Unauthorized: Owner or Main Branch Manager access is required.'
      using errcode = '42501';
  end if;

  select jsonb_build_object(
    'shift_id', s.id,
    'branch_id', s.branch_id,
    'branch_name', b.name,
    'selected_return_close', s.selected_return_close is not null,
    'return_number', dispatch.return_number,
    'cashier_id', s.cashier_id,
    'cashier_name', cashier.full_name,
    'started_at', s.started_at,
    'ended_at', s.ended_at,
    'sales_cutoff_at', s.sales_cutoff_at,
    'inventory_reconciliation_required', s.inventory_reconciliation_required,
    'reconciliation_required', s.reconciliation_required,
    'cash_status', case when r.id is null then 'pending' else 'reconciled' end,
    'expected_cash', coalesce(r.expected_cash, case when (t.totals->>'unrecorded_count')::int=0 then (t.totals->>'cash')::numeric end, (
      select coalesce(sum(sales.total_amount), 0)::numeric(12,2)
      from public.sales
      where sales.shift_id = s.id and sales.status = 'completed'
    )),
    'actual_cash', r.actual_cash,
    'actual_gcash', r.actual_gcash,
    'expected_gcash', case when r.id is not null then r.expected_gcash when (t.totals->>'unrecorded_count')::int=0 then (t.totals->>'gcash')::numeric end,
    'difference', r.difference,
    'cash_result', r.result,
    'reconciled_at', r.reconciled_at,
    'products', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', pr.id,
          'shift_id', pr.shift_id,
          'product_id', pr.product_id,
          'product_name_snapshot', pr.product_name_snapshot,
          'sku_snapshot', pr.sku_snapshot,
          'closing_stock_behavior', pr.closing_stock_behavior,
          'opening_quantity', pr.opening_quantity,
          'received_quantity', pr.received_quantity,
          'outgoing_quantity', pr.outgoing_quantity,
          'sold_quantity', pr.sold_quantity,
          'waste_quantity', pr.waste_quantity,
          'adjustment_quantity', pr.adjustment_quantity,
          'expected_remaining', pr.expected_remaining,
          'actual_remaining', pr.actual_remaining,
          'discrepancy', pr.discrepancy,
          'unsold_quantity', pr.unsold_quantity,
          'carried_quantity', pr.carried_quantity,
          'result', pr.result,
          'discrepancy_note', pr.discrepancy_note,
          'reconciled_at', pr.reconciled_at
        )
        order by pr.product_name_snapshot
      )
      from public.shift_product_reconciliations pr
      where pr.shift_id = s.id
    ), '[]'::jsonb)
  )
  into v_result
  from public.shifts s
  cross join lateral (select public.shift_payment_totals(s.id) as totals) t
  join public.branches b on b.id = s.branch_id
  join public.profiles cashier on cashier.id = s.cashier_id
  left join public.shift_reconciliations r on r.shift_id = s.id
  left join public.stock_returns dispatch on dispatch.created_by=s.cashier_id
    and dispatch.idempotency_key=s.selected_return_close->>'return_key'
  where s.id = p_shift_id
    and s.status = 'closed'
    and not b.is_main_branch
    and (r.id is not null or s.reconciliation_required);

  if v_result is null then
    raise exception 'Shift remittance not found.' using errcode = '22023';
  end if;
  return v_result;
end;
$$;
commit;

