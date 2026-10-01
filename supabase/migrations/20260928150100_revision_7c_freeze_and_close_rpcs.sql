begin;

-- Revision 7C part 2: begin/finalize/pending/auto-close + start_cashier_shift guard.
-- Selling mutators inherit freeze via updated lock_branch_inventory_gate (7C part 1).

-- ---------------------------------------------------------------------------
-- Movement aggregation helper (internal)
-- ---------------------------------------------------------------------------
create or replace function public.aggregate_shift_product_movements(
  p_shift public.shifts,
  p_product_id uuid,
  p_opening bigint
)
returns table (
  received_quantity bigint,
  outgoing_quantity bigint,
  sold_quantity bigint,
  adjustment_quantity bigint,
  system_balance_before_waste bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_received bigint := 0;
  v_outgoing bigint := 0;
  v_sold bigint := 0;
  v_adjustment bigint := 0;
  v_row record;
  v_cutoff timestamptz := coalesce(p_shift.sales_cutoff_at, p_shift.ended_at, now());
begin
  for v_row in
    select m.movement_type, m.quantity
    from public.inventory_movements m
    where m.branch_id = p_shift.branch_id
      and m.product_id = p_product_id
      and m.created_at >= p_shift.started_at
      and m.created_at <= v_cutoff
  loop
    if v_row.movement_type = 'transfer_in' or v_row.movement_type = 'return_in' then
      v_received := v_received + v_row.quantity::bigint;
    elsif v_row.movement_type in ('transfer_out', 'return_out') then
      v_outgoing := v_outgoing + abs(v_row.quantity)::bigint;
    elsif v_row.movement_type = 'sale' then
      v_sold := v_sold + abs(v_row.quantity)::bigint;
    elsif v_row.movement_type = 'adjustment' then
      v_adjustment := v_adjustment + v_row.quantity::bigint;
    elsif v_row.movement_type = 'opening_stock' then
      -- Opening is taken from shift_product_opening_stock / baseline; ignore ledger opening rows.
      null;
    elsif v_row.movement_type in ('waste', 'unsold') then
      raise exception 'Unexpected closing movement already present for product during aggregation.'
        using errcode = '55000';
    else
      raise exception 'Unknown inventory movement type during shift close: %', v_row.movement_type
        using errcode = '55000';
    end if;
  end loop;

  received_quantity := v_received;
  outgoing_quantity := v_outgoing;
  sold_quantity := v_sold;
  adjustment_quantity := v_adjustment;
  system_balance_before_waste := p_opening + v_received - v_outgoing - v_sold + v_adjustment;
  return next;
end;
$$;

revoke all on function public.aggregate_shift_product_movements(public.shifts, uuid, bigint)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Build close preview JSON for a shift (internal)
-- ---------------------------------------------------------------------------
create or replace function public.build_shift_close_preview(p_shift public.shifts)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_expected_cash numeric(12,2);
  v_products jsonb := '[]'::jsonb;
  v_base record;
  v_agg record;
begin
  select coalesce(sum(s.total_amount), 0)::numeric(12,2) into v_expected_cash
  from public.sales s
  where s.shift_id = p_shift.id and s.status = 'completed';

  for v_base in
    select *
    from public.shift_product_close_baselines b
    where b.shift_id = p_shift.id
    order by b.product_name_snapshot, b.product_id
  loop
    select * into v_agg
    from public.aggregate_shift_product_movements(p_shift, v_base.product_id, v_base.opening_quantity);

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
      'system_balance_before_waste', v_agg.system_balance_before_waste
    ));
  end loop;

  return jsonb_build_object(
    'shift_id', p_shift.id,
    'branch_id', p_shift.branch_id,
    'started_at', p_shift.started_at,
    'ended_at', p_shift.ended_at,
    'sales_cutoff_at', p_shift.sales_cutoff_at,
    'inventory_reconciliation_required', p_shift.inventory_reconciliation_required,
    'reconciliation_required', p_shift.reconciliation_required,
    'mode', case when p_shift.inventory_reconciliation_required
                 or exists (select 1 from public.shift_product_close_baselines b where b.shift_id = p_shift.id)
              then 'pcs_inventory_cash' else 'legacy_cash_only' end,
    'expected_cash', v_expected_cash,
    'products', v_products,
    'status', 'pending'
  );
end;
$$;

revoke all on function public.build_shift_close_preview(public.shifts)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Populate baselines at cutoff (internal)
-- ---------------------------------------------------------------------------
create or replace function public.populate_shift_close_baselines(p_shift public.shifts)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cutoff timestamptz := coalesce(p_shift.sales_cutoff_at, now());
begin
  insert into public.shift_product_close_baselines (
    shift_id, branch_id, product_id,
    product_name_snapshot, sku_snapshot, closing_stock_behavior,
    opening_quantity, captured_at
  )
  select
    p_shift.id,
    p_shift.branch_id,
    p.id,
    p.name,
    p.sku,
    p.closing_stock_behavior,
    coalesce(os.opening_quantity, 0),
    v_cutoff
  from public.products p
  left join public.shift_product_opening_stock os
    on os.shift_id = p_shift.id and os.product_id = p.id
  where p.id in (
      select os2.product_id from public.shift_product_opening_stock os2 where os2.shift_id = p_shift.id
      union
      select m.product_id
      from public.inventory_movements m
      where m.branch_id = p_shift.branch_id
        and m.created_at >= p_shift.started_at
        and m.created_at <= v_cutoff
      union
      select bi.product_id
      from public.branch_inventory bi
      where bi.branch_id = p_shift.branch_id
        and bi.quantity_on_hand > 0
    )
  on conflict (shift_id, product_id) do nothing;
end;
$$;

revoke all on function public.populate_shift_close_baselines(public.shifts)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Shared begin-close core (manual + auto)
-- ---------------------------------------------------------------------------
create or replace function public.begin_shift_close_core(p_shift_id uuid, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shift public.shifts%rowtype;
  v_cutoff timestamptz := clock_timestamp();
begin
  select * into v_shift from public.shifts where id = p_shift_id for update;
  if not found then
    raise exception 'Unable to access this shift.' using errcode = '42501';
  end if;

  -- Idempotent resume if already begun.
  if v_shift.status = 'closed' and v_shift.sales_cutoff_at is not null then
    return public.build_shift_close_preview(v_shift);
  end if;

  if v_shift.status <> 'open' then
    raise exception 'This shift is already closed.' using errcode = '42501';
  end if;

  -- Skip freeze assert: this path is creating the freeze.
  perform public.lock_branch_inventory_gate(v_shift.branch_id, false);

  update public.shifts
  set sales_cutoff_at = v_cutoff,
      status = 'closed',
      ended_at = v_cutoff,
      reconciliation_required = true,
      inventory_reconciliation_required = true
  where id = p_shift_id
    and status = 'open';
  if not found then
    raise exception 'This shift is already closed.' using errcode = '42501';
  end if;

  select * into v_shift from public.shifts where id = p_shift_id;
  perform public.populate_shift_close_baselines(v_shift);
  return public.build_shift_close_preview(v_shift);
end;
$$;

revoke all on function public.begin_shift_close_core(uuid, uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- begin_cashier_shift_close — irreversible Phase 1
-- ---------------------------------------------------------------------------
create or replace function public.begin_cashier_shift_close(p_shift_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user public.profiles%rowtype;
  v_shift public.shifts%rowtype;
begin
  select * into v_user
  from public.profiles
  where id = auth.uid() and is_active and role = 'cashier'
  for update;
  if not found then
    raise exception 'Unauthorized: active cashier access required.' using errcode = '42501';
  end if;

  select * into v_shift from public.shifts where id = p_shift_id;
  if not found or v_shift.cashier_id <> v_user.id or v_shift.branch_id is distinct from v_user.branch_id then
    raise exception 'Unable to access this shift.' using errcode = '42501';
  end if;

  return public.begin_shift_close_core(p_shift_id, v_user.id);
end;
$$;

revoke all on function public.begin_cashier_shift_close(uuid) from public, anon;
grant execute on function public.begin_cashier_shift_close(uuid) to authenticated;

comment on function public.begin_cashier_shift_close(uuid) is
  'Irreversible End Shift begin: sets sales_cutoff_at, closes shift, freezes inventory, snapshots baselines. No cancel/reopen.';

-- ---------------------------------------------------------------------------
-- Finalize engine (inventory + cash atomic)
-- ---------------------------------------------------------------------------
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
  v_norm_products jsonb := '[]'::jsonb;
  v_existing_products jsonb;
  v_product_summaries jsonb := '[]'::jsonb;
begin
  select * into v_user
  from public.profiles
  where id = auth.uid() and is_active and role = 'cashier'
  for update;
  if not found then
    raise exception 'Unauthorized: active cashier access required.' using errcode = '42501';
  end if;

  select * into v_shift from public.shifts where id = p_shift_id for update;
  if not found or v_shift.cashier_id <> v_user.id or v_shift.branch_id is distinct from v_user.branch_id then
    raise exception 'Unable to access this shift.' using errcode = '42501';
  end if;
  if v_shift.status <> 'closed' then
    raise exception 'Only a closed shift can be reconciled.' using errcode = '42501';
  end if;
  if not v_shift.reconciliation_required
     and not v_shift.inventory_reconciliation_required
     and exists (select 1 from public.shift_reconciliations r where r.shift_id = v_shift.id) then
    -- Fully done — fall through to idempotent compare below.
    null;
  elsif not v_shift.reconciliation_required and not v_shift.inventory_reconciliation_required then
    raise exception 'This historical shift does not require reconciliation.' using errcode = '22023';
  end if;

  -- Skip freeze assert: finalize is the allowed writer while pending.
  perform public.lock_branch_inventory_gate(v_shift.branch_id, false);

  v_needs_inventory := v_shift.inventory_reconciliation_required
    or exists (select 1 from public.shift_product_close_baselines b where b.shift_id = v_shift.id);

  v_actual := public.parse_actual_cash(p_actual_cash);
  select coalesce(sum(s.total_amount), 0)::numeric(12,2) into v_expected
  from public.sales s
  where s.shift_id = v_shift.id and s.status = 'completed';

  -- Normalize products payload
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
    -- Completeness: every baseline product required
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

  -- Normalize product array for idempotency (sorted product_id; omitted waste → 0).
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
        )::bigint
      ) as obj
    from jsonb_array_elements(v_products)
  ) norm;

  -- Idempotent retry
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
          'waste_quantity', r.waste_quantity
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
    return jsonb_build_object(
      'shift_id', v_shift.id,
      'shift_status', 'closed',
      'expected_cash', v_existing_cash.expected_cash,
      'actual_cash', v_existing_cash.actual_cash,
      'difference', v_existing_cash.difference,
      'result', v_existing_cash.result,
      'status', 'reconciled',
      'idempotent', true
    );
  end if;

  -- Inventory finalize
  if v_needs_inventory and exists (
    select 1 from public.shift_product_close_baselines b where b.shift_id = v_shift.id
  ) then
    for v_item in
      select *
      from jsonb_to_recordset(v_norm_products)
        as x(product_id uuid, actual_remaining bigint, waste_quantity bigint)
      order by product_id
    loop
      select * into v_base
      from public.shift_product_close_baselines
      where shift_id = v_shift.id and product_id = v_item.product_id;

      v_actual_rem := v_item.actual_remaining;
      v_waste := v_item.waste_quantity;
      if v_actual_rem is null or v_actual_rem < 0 or v_waste is null or v_waste < 0 then
        raise exception 'Actual remaining and waste must be whole PCS quantities >= 0.'
          using errcode = '22023';
      end if;

      select * into v_agg
      from public.aggregate_shift_product_movements(v_shift, v_base.product_id, v_base.opening_quantity);

      -- Live inventory must match movement-derived B under freeze.
      select quantity_on_hand into v_live
      from public.branch_inventory
      where branch_id = v_shift.branch_id and product_id = v_base.product_id
      for update;
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
        unsold_quantity, carried_quantity, result, recorded_by
      ) values (
        v_shift.id, v_shift.branch_id, v_base.product_id,
        v_base.product_name_snapshot, v_base.sku_snapshot, v_base.closing_stock_behavior,
        v_base.opening_quantity, v_agg.received_quantity, v_agg.outgoing_quantity, v_agg.sold_quantity,
        v_waste, v_agg.adjustment_quantity, 0,
        v_expected_rem, v_actual_rem, v_discrepancy,
        v_unsold, v_carried, v_result, v_user.id
      )
      returning id into v_recon_id;

      -- Safe ledger: adjustment (A+W)-B → waste -W → optional unsold -A
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

      if v_base.closing_stock_behavior = 'record_as_unsold' and v_actual_rem > 0 then
        update public.branch_inventory
        set quantity_on_hand = quantity_on_hand - v_actual_rem
        where branch_id = v_shift.branch_id
          and product_id = v_base.product_id
          and quantity_on_hand >= v_actual_rem;
        if not found then
          raise exception 'Insufficient stock during unsold write for %.', v_base.product_name_snapshot
            using errcode = '22023';
        end if;
        insert into public.inventory_movements(
          branch_id, product_id, movement_type, quantity,
          reference_type, reference_id, created_by
        ) values (
          v_shift.branch_id, v_base.product_id, 'unsold', -v_actual_rem,
          'shift_product_reconciliation', v_recon_id, v_user.id
        );
      end if;

      -- Verify ending usable stock
      select quantity_on_hand into v_live
      from public.branch_inventory
      where branch_id = v_shift.branch_id and product_id = v_base.product_id;
      if v_base.closing_stock_behavior = 'keep_at_branch' then
        if coalesce(v_live, 0) <> v_actual_rem then
          raise exception 'Close left unexpected usable stock for %.', v_base.product_name_snapshot
            using errcode = '55000';
        end if;
      else
        if coalesce(v_live, 0) <> 0 then
          raise exception 'Unsold close left usable stock for %.', v_base.product_name_snapshot
            using errcode = '55000';
        end if;
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

  -- Cash
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

-- ---------------------------------------------------------------------------
-- Replace old close / reconcile entrypoints
-- ---------------------------------------------------------------------------
drop function if exists public.close_cashier_shift(uuid, text, jsonb);

create or replace function public.reconcile_closed_shift(
  p_shift_id uuid,
  p_actual_cash text,
  p_waste jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shift public.shifts%rowtype;
begin
  -- Legacy cash-only wrapper. PCS closes must use finalize with product counts.
  select * into v_shift from public.shifts where id = p_shift_id;
  if not found then
    raise exception 'Unable to access this shift.' using errcode = '42501';
  end if;
  if v_shift.inventory_reconciliation_required
     or exists (select 1 from public.shift_product_close_baselines b where b.shift_id = p_shift_id) then
    raise exception 'Use finalize cashier shift reconciliation for inventory close.'
      using errcode = '22023';
  end if;
  -- Ignore legacy KG waste payload; PCS waste is quantity-based on finalize.
  return public.finalize_cashier_shift_reconciliation(p_shift_id, p_actual_cash, '[]'::jsonb);
end;
$$;

revoke all on function public.reconcile_closed_shift(uuid, text, jsonb) from public, anon;
grant execute on function public.reconcile_closed_shift(uuid, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Pending resume preview
-- ---------------------------------------------------------------------------
create or replace function public.get_my_pending_shift_reconciliation()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user public.profiles%rowtype;
  v_shift public.shifts%rowtype;
begin
  select * into v_user
  from public.profiles
  where id = auth.uid() and is_active and role = 'cashier';
  if not found then
    raise exception 'Unauthorized: active cashier access required.' using errcode = '42501';
  end if;

  select * into v_shift
  from public.shifts s
  where s.cashier_id = v_user.id
    and s.branch_id = v_user.branch_id
    and s.status = 'closed'
    and (
      (s.reconciliation_required and not exists (
        select 1 from public.shift_reconciliations r where r.shift_id = s.id
      ))
      or s.inventory_reconciliation_required
    )
  order by s.ended_at asc nulls last, s.id
  limit 1;
  if not found then
    return null;
  end if;

  return public.build_shift_close_preview(v_shift);
end;
$$;

revoke all on function public.get_my_pending_shift_reconciliation() from public, anon;
grant execute on function public.get_my_pending_shift_reconciliation() to authenticated;

-- ---------------------------------------------------------------------------
-- Auto-close parity (no fabricated counts)
-- ---------------------------------------------------------------------------
create or replace function public.close_overdue_shifts()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now_manila          timestamp;
  v_cutoff_manila_date  date;
  v_cutoff              timestamptz;
  v_shift               public.shifts%rowtype;
  v_closed_count        integer := 0;
begin
  v_now_manila := timezone('Asia/Manila', now());
  if v_now_manila < (v_now_manila::date + time '21:00') then
    v_cutoff_manila_date := v_now_manila::date - 1;
  else
    v_cutoff_manila_date := v_now_manila::date;
  end if;
  v_cutoff := (v_cutoff_manila_date + time '21:00') at time zone 'Asia/Manila';

  for v_shift in
    select *
    from public.shifts
    where status = 'open'
      and started_at < v_cutoff
    order by started_at, id
    for update skip locked
  loop
    begin
      perform public.begin_shift_close_core(v_shift.id, v_shift.cashier_id);
      v_closed_count := v_closed_count + 1;
    exception when others then
      null;
    end;
  end loop;

  return jsonb_build_object(
    'closed_count', v_closed_count,
    'leftover_return_count', 0,
    'cutoff_at', v_cutoff
  );
end;
$$;

revoke all on function public.close_overdue_shifts() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- start_cashier_shift — inventory pending + same-day finalized guard
-- ---------------------------------------------------------------------------
create or replace function public.start_cashier_shift()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cashier_id         uuid := auth.uid();
  v_user               public.profiles%rowtype;
  v_branch_id          uuid;
  v_shift_id           uuid;
  v_existing_branch_id uuid;
  v_captured_at        timestamptz := now();
begin
  select * into v_user
  from public.profiles
  where id = v_cashier_id and role = 'cashier' and is_active
  for update;
  if not found then
    raise exception 'Unauthorized: cashier access is required.' using errcode = '42501';
  end if;

  v_branch_id := v_user.branch_id;
  if v_branch_id is null then
    raise exception 'No branch is assigned to this cashier.' using errcode = '42501';
  end if;

  -- Lock without freeze assert; start-shift has dedicated pending/same-day messages.
  perform public.lock_branch_inventory_gate(v_branch_id, false);
  perform public.assert_branch_may_start_shift(v_branch_id);

  perform 1
  from public.branches
  where id = v_branch_id and is_active and not is_main_branch;
  if not found then
    raise exception 'The assigned branch is inactive or invalid.' using errcode = '22023';
  end if;

  select id, branch_id into v_shift_id, v_existing_branch_id
  from public.shifts
  where cashier_id = v_cashier_id and status = 'open'
  limit 1;

  if v_shift_id is not null then
    if v_existing_branch_id <> v_branch_id then
      raise exception 'The existing shift belongs to another branch.' using errcode = '42501';
    end if;
    return v_shift_id;
  end if;

  insert into public.shifts(
    branch_id, cashier_id, status, started_at,
    reconciliation_required, inventory_reconciliation_required
  )
  values (v_branch_id, v_cashier_id, 'open', v_captured_at, true, false)
  returning id into v_shift_id;

  insert into public.shift_product_opening_stock (
    shift_id, branch_id, product_id, product_name_snapshot, opening_quantity, captured_at
  )
  select
    v_shift_id,
    v_branch_id,
    p.id,
    p.name,
    coalesce(bi.quantity_on_hand, 0)::bigint,
    v_captured_at
  from public.products p
  left join public.branch_inventory bi
    on bi.product_id = p.id and bi.branch_id = v_branch_id
  where exists (
      select 1 from public.branch_products bp
      where bp.branch_id = v_branch_id and bp.product_id = p.id
    )
    or bi.product_id is not null;

  return v_shift_id;
end;
$$;

revoke all on function public.start_cashier_shift() from public, anon;
grant execute on function public.start_cashier_shift() to authenticated;

-- Retire KG waste path in record_shift_reconciliation (legacy internal unused by new finalize)
create or replace function public.record_shift_reconciliation(
  p_shift public.shifts,
  p_actor uuid,
  p_actual_cash text,
  p_waste jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Active KG waste close path removed. Use finalize_cashier_shift_reconciliation.
  raise exception 'Use finalize cashier shift reconciliation.' using errcode = '42501';
end;
$$;

revoke all on function public.record_shift_reconciliation(public.shifts, uuid, text, jsonb)
  from public, anon, authenticated;

commit;
