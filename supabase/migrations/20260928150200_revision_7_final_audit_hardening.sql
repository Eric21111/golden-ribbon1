-- Revision 7 Final Audit Hardening
-- Forward-only. Do not edit 7A/7B/7C migrations.
begin;

-- ---------------------------------------------------------------------------
-- 1) Preflight: refuse if any selling branch already has >1 open shift
-- ---------------------------------------------------------------------------
do $$
declare
  v_msg text;
begin
  select string_agg(
    format('branch %s shifts [%s]', q.branch_id, q.shift_ids),
    '; '
  )
  into v_msg
  from (
    select
      s.branch_id,
      string_agg(s.id::text, ', ' order by s.started_at, s.id) as shift_ids
    from public.shifts s
    join public.branches b on b.id = s.branch_id
    where s.status = 'open'
      and not b.is_main_branch
    group by s.branch_id
    having count(*) > 1
  ) q;

  if v_msg is not null then
    raise exception
      'pcs_final_hardening_blocked_multi_open_shifts: Resolve duplicate open selling sessions before applying. %',
      v_msg
      using errcode = '55000';
  end if;
end;
$$;

-- One open selling session per branch (keep cashier unique index)
create unique index if not exists shifts_one_open_per_branch_idx
  on public.shifts (branch_id)
  where status = 'open';

-- ---------------------------------------------------------------------------
-- 2) Target-aware close lock helper (branch → EXACT shift → inventory)
-- ---------------------------------------------------------------------------
create or replace function public.lock_shift_inventory_gate(
  p_branch_id uuid,
  p_shift_id uuid,
  p_enforce_freeze boolean default true,
  p_lock_inventory boolean default true
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shift_branch uuid;
begin
  if p_branch_id is null or p_shift_id is null then
    raise exception 'Branch and shift are required for close inventory lock.' using errcode = '22023';
  end if;

  perform 1
  from public.branches
  where id = p_branch_id
  for update;
  if not found then
    raise exception 'Branch is missing.' using errcode = '22023';
  end if;

  select branch_id into v_shift_branch
  from public.shifts
  where id = p_shift_id
  for update;
  if not found then
    raise exception 'Unable to access this shift.' using errcode = '42501';
  end if;
  if v_shift_branch is distinct from p_branch_id then
    raise exception 'Shift does not belong to the locked branch.' using errcode = '42501';
  end if;

  if p_enforce_freeze then
    perform public.assert_selling_branch_inventory_not_frozen(p_branch_id);
  end if;

  if p_lock_inventory then
    perform 1
    from public.branch_inventory bi
    where bi.branch_id = p_branch_id
    order by bi.product_id
    for update;
  end if;
end;
$$;

revoke all on function public.lock_shift_inventory_gate(uuid, uuid, boolean, boolean)
  from public, anon, authenticated;

comment on function public.lock_shift_inventory_gate(uuid, uuid, boolean, boolean) is
  'Internal close lock: branch FOR UPDATE → exact shift FOR UPDATE → optional freeze → optional inventory by product_id. Not for client use.';

-- ---------------------------------------------------------------------------
-- 3) Employee change blocked while open OR pending remittance
-- ---------------------------------------------------------------------------
create or replace function public.prevent_employee_change_during_open_shift()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (
    new.branch_id is distinct from old.branch_id
    or new.role is distinct from old.role
    or (old.is_active and not new.is_active)
  ) and exists (
    select 1
    from public.shifts s
    where s.cashier_id = old.id
      and (
        s.status = 'open'
        or (
          s.status = 'closed'
          and (
            s.reconciliation_required
            or s.inventory_reconciliation_required
          )
        )
      )
  ) then
    raise exception
      'Employee has an unfinished shift or remittance. Complete reconciliation before changing branch, role, or active status.'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Helper: persisted product summary for finalize responses
-- ---------------------------------------------------------------------------
create or replace function public.shift_close_product_summaries(p_shift_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'product_id', r.product_id,
        'expected_remaining', r.expected_remaining,
        'actual_remaining', r.actual_remaining,
        'waste_quantity', r.waste_quantity,
        'discrepancy', r.discrepancy,
        'result', r.result,
        'unsold_quantity', r.unsold_quantity,
        'carried_quantity', r.carried_quantity
      )
      order by r.product_id
    ),
    '[]'::jsonb
  )
  from public.shift_product_reconciliations r
  where r.shift_id = p_shift_id;
$$;

revoke all on function public.shift_close_product_summaries(uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4) begin_shift_close_core — target-aware locks + finalized handling
-- ---------------------------------------------------------------------------
create or replace function public.begin_shift_close_core(p_shift_id uuid, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shift public.shifts%rowtype;
  v_branch_id uuid;
  v_cutoff timestamptz := clock_timestamp();
  v_cash public.shift_reconciliations%rowtype;
begin
  select branch_id into v_branch_id
  from public.shifts
  where id = p_shift_id;
  if v_branch_id is null then
    raise exception 'Unable to access this shift.' using errcode = '42501';
  end if;

  -- Branch → EXACT target shift (inventory only when mutating open → closed)
  perform public.lock_shift_inventory_gate(v_branch_id, p_shift_id, false, false);

  select * into v_shift from public.shifts where id = p_shift_id;
  if not found then
    raise exception 'Unable to access this shift.' using errcode = '42501';
  end if;

  -- Fully finalized: never return status=pending (read-only; no inventory lock)
  if v_shift.status = 'closed'
     and v_shift.sales_cutoff_at is not null
     and not v_shift.reconciliation_required
     and not v_shift.inventory_reconciliation_required
     and exists (select 1 from public.shift_reconciliations r where r.shift_id = v_shift.id)
  then
    select * into v_cash from public.shift_reconciliations where shift_id = v_shift.id;
    return jsonb_build_object(
      'shift_id', v_shift.id,
      'branch_id', v_shift.branch_id,
      'started_at', v_shift.started_at,
      'ended_at', v_shift.ended_at,
      'sales_cutoff_at', v_shift.sales_cutoff_at,
      'inventory_reconciliation_required', false,
      'reconciliation_required', false,
      'mode', case
        when exists (select 1 from public.shift_product_reconciliations r where r.shift_id = v_shift.id)
          then 'pcs_inventory_cash'
        else 'legacy_cash_only'
      end,
      'expected_cash', v_cash.expected_cash,
      'actual_cash', v_cash.actual_cash,
      'difference', v_cash.difference,
      'result', v_cash.result,
      'products', public.shift_close_product_summaries(v_shift.id),
      'status', 'reconciled',
      'message', 'This shift remittance is already complete.'
    );
  end if;

  -- Pending resume after begin/auto-close (read-only preview)
  if v_shift.status = 'closed' and v_shift.sales_cutoff_at is not null then
    return public.build_shift_close_preview(v_shift);
  end if;

  if v_shift.status <> 'open' then
    raise exception 'This shift is already closed.' using errcode = '42501';
  end if;

  -- Mutating path: inventory locks before cutoff / baseline writes
  perform 1
  from public.branch_inventory bi
  where bi.branch_id = v_branch_id
  order by bi.product_id
  for update;

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
-- 5) finalize — target-aware locks + full idempotent product response
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
        )::bigint
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
-- 6) close_overdue_shifts — discover without locks; core owns locking
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
  v_rec                 record;
  v_closed_count        integer := 0;
begin
  v_now_manila := timezone('Asia/Manila', now());
  if v_now_manila < (v_now_manila::date + time '21:00') then
    v_cutoff_manila_date := v_now_manila::date - 1;
  else
    v_cutoff_manila_date := v_now_manila::date;
  end if;
  v_cutoff := (v_cutoff_manila_date + time '21:00') at time zone 'Asia/Manila';

  for v_rec in
    select s.id, s.cashier_id
    from public.shifts s
    where s.status = 'open'
      and s.started_at < v_cutoff
    order by s.started_at, s.id
  loop
    begin
      perform public.begin_shift_close_core(v_rec.id, v_rec.cashier_id);
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
-- 7) start_cashier_shift — one open session per branch
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
  v_open_cashier_id    uuid;
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

  perform public.lock_branch_inventory_gate(v_branch_id, false);
  perform public.assert_branch_may_start_shift(v_branch_id);

  perform 1
  from public.branches
  where id = v_branch_id and is_active and not is_main_branch;
  if not found then
    raise exception 'The assigned branch is inactive or invalid.' using errcode = '22023';
  end if;

  select id, cashier_id into v_shift_id, v_open_cashier_id
  from public.shifts
  where branch_id = v_branch_id and status = 'open'
  order by started_at, id
  limit 1;

  if v_shift_id is not null then
    if v_open_cashier_id = v_cashier_id then
      return v_shift_id;
    end if;
    raise exception 'Another selling session is already active for this branch.'
      using errcode = '55000';
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

commit;
