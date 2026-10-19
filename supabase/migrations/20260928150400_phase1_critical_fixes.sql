-- Phase 1 critical fixes: stuck remittance flags, pending eligibility, start-shift guard.
-- Forward-only. Do not edit prior Revision 7 migrations.
begin;

-- Heal closed shifts that already have complete remittance rows but stuck pending flags.
update public.shifts s
set reconciliation_required = false,
    inventory_reconciliation_required = false
where s.status = 'closed'
  and (s.reconciliation_required or s.inventory_reconciliation_required)
  and exists (
    select 1 from public.shift_reconciliations r where r.shift_id = s.id
  )
  and not exists (
    select 1
    from public.shift_product_close_baselines b
    where b.shift_id = s.id
      and not exists (
        select 1
        from public.shift_product_reconciliations pr
        where pr.shift_id = b.shift_id
          and pr.product_id = b.product_id
      )
  );

create or replace function public.assert_branch_may_start_shift(p_branch_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := public.current_manila_business_date();
begin
  -- Incomplete remittance only: ignore stuck flags when cash (+ inventory) rows already exist.
  if exists (
    select 1
    from public.shifts s
    where s.branch_id = p_branch_id
      and s.inventory_reconciliation_required
      and (
        not exists (
          select 1 from public.shift_reconciliations r where r.shift_id = s.id
        )
        or exists (
          select 1
          from public.shift_product_close_baselines b
          where b.shift_id = s.id
            and not exists (
              select 1
              from public.shift_product_reconciliations pr
              where pr.shift_id = b.shift_id
                and pr.product_id = b.product_id
            )
        )
      )
  ) then
    raise exception 'Complete pending inventory reconciliation before starting a new shift.'
      using errcode = '55000';
  end if;

  -- Final close today = cash remittance present and inventory coverage complete.
  -- Do not require cleared flags (stuck flags must not bypass the same-day guard).
  if exists (
    select 1
    from public.shifts s
    where s.branch_id = p_branch_id
      and s.status = 'closed'
      and exists (select 1 from public.shift_reconciliations r where r.shift_id = s.id)
      and public.manila_business_date(coalesce(s.sales_cutoff_at, s.ended_at)) = v_today
      and not exists (
        select 1
        from public.shift_product_close_baselines b
        where b.shift_id = s.id
          and not exists (
            select 1
            from public.shift_product_reconciliations pr
            where pr.shift_id = b.shift_id
              and pr.product_id = b.product_id
          )
      )
  ) then
    raise exception 'A final close already completed for this branch today. Start again next business day.'
      using errcode = '55000';
  end if;
end;
$$;

revoke all on function public.assert_branch_may_start_shift(uuid)
  from public, anon, authenticated;

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
      (
        s.reconciliation_required
        and not exists (
          select 1 from public.shift_reconciliations r where r.shift_id = s.id
        )
      )
      or (
        s.inventory_reconciliation_required
        and (
          not exists (
            select 1 from public.shift_reconciliations r where r.shift_id = s.id
          )
          or exists (
            select 1
            from public.shift_product_close_baselines b
            where b.shift_id = s.id
              and not exists (
                select 1
                from public.shift_product_reconciliations pr
                where pr.shift_id = b.shift_id
                  and pr.product_id = b.product_id
              )
          )
        )
      )
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

commit;
