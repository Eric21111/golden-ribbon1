begin;

-- A signed adjustment changes the live balance once and is already included
-- by shift-close movement aggregation. Closing waste remains a separate event.
alter table public.inventory_movements add column branch_stock_action jsonb;
create unique index branch_stock_action_retry on public.inventory_movements
  (created_by, (branch_stock_action->>'key')) where branch_stock_action is not null;

create function public.record_branch_stock_action(p_shift_id uuid, p_product_id uuid, p_action text,
  p_quantity integer, p_expected_available numeric, p_reason text, p_key text)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  staff public.profiles%rowtype;
  stock public.branch_inventory%rowtype;
  prior public.inventory_movements%rowtype;
  request jsonb;
  delta integer;
  receipt uuid := gen_random_uuid();
begin
  select * into staff from public.profiles where id=auth.uid() and is_active and role='cashier' for update;
  if not found then raise exception 'Active cashier required.' using errcode='42501'; end if;
  if p_action is null or p_action not in ('add','waste') or p_quantity is null or p_quantity not between 1 and 999999
    or p_expected_available is null or p_key is null or p_key !~ '^[a-zA-Z0-9_-]{16,100}$' or p_reason is null or length(btrim(p_reason)) not between 1 and 300 then
    raise exception 'Enter a quantity and a reason.' using errcode='22023';
  end if;
  request := jsonb_build_object('shift_id',p_shift_id,'branch_id',staff.branch_id,'product_id',p_product_id,
    'action',p_action,'quantity',p_quantity,'available',p_expected_available,'reason',btrim(p_reason));
  select * into prior from public.inventory_movements where created_by=staff.id and branch_stock_action is not null
    and branch_stock_action->>'key'=p_key::text;
  if found then
    if prior.branch_stock_action->'request' is distinct from request then
      raise exception 'Confirmation details changed.' using errcode='22023';
    end if;
    return prior.reference_id;
  end if;
  perform public.lock_branch_inventory_gate(staff.branch_id);
  perform 1 from public.shifts s join public.branches b on b.id=s.branch_id
    where s.id=p_shift_id and s.branch_id=staff.branch_id and s.cashier_id=staff.id and s.status='open'
      and s.sales_cutoff_at is null and not s.inventory_reconciliation_required and b.is_active and not b.is_main_branch
    for update of s;
  if not found then raise exception 'An open selling shift is required.' using errcode='55000'; end if;
  select i.* into stock from public.branch_inventory i join public.products p on p.id=i.product_id
    where i.branch_id=staff.branch_id and i.product_id=p_product_id and p.is_active and p.inventory_mode='piece_stock' for update of i;
  if not found then raise exception 'Select an active stock item in your branch.' using errcode='42501'; end if;
  if stock.quantity_on_hand-stock.quantity_awaiting_return <> p_expected_available then
    raise exception 'Stock changed. Review the new available quantity.' using errcode='40001';
  end if;
  delta := case when p_action='add' then p_quantity else -p_quantity end;
  if p_expected_available+delta < 0 then raise exception 'Waste exceeds available stock.' using errcode='22023'; end if;
  update public.branch_inventory set quantity_on_hand=quantity_on_hand+delta where id=stock.id;
  insert into public.inventory_movements(branch_id,product_id,movement_type,quantity,reference_type,reference_id,created_by,
    notes,branch_stock_action,stock_count_correction)
  values(staff.branch_id,p_product_id,'adjustment',delta,'adjustment',receipt,staff.id,
    (case when p_action='add' then 'Added stock: ' else 'Recorded waste: ' end)||btrim(p_reason),
    jsonb_build_object('key',p_key,'request',request),
    case when p_action='add' then jsonb_build_object('request',request||jsonb_build_object(
      'before',stock.quantity_on_hand,'after',stock.quantity_on_hand+delta)) end);
  return receipt;
end $$;
revoke all on function public.record_branch_stock_action(uuid,uuid,text,integer,numeric,text,text) from public,anon;
grant execute on function public.record_branch_stock_action(uuid,uuid,text,integer,numeric,text,text) to authenticated;

create or replace function public.report_branch_shift_waste(
  p_branch_id uuid default null,
  p_range_type text default 'all_time',
  p_start_date timestamptz default null,
  p_end_date timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_start timestamptz := null;
  v_end timestamptz := null;
  v_result jsonb;
begin
  if not (public.is_owner() or public.is_main_branch_manager()) then
    raise exception 'Unauthorized: Owner or Main Branch Manager access is required.'
      using errcode = '42501';
  end if;

  if p_range_type = 'today' then
    v_start := (timezone('Asia/Manila', now()))::date::timestamp at time zone 'Asia/Manila';
    v_end := v_start + interval '1 day';
  elsif p_range_type = 'custom' then
    if p_start_date is null or p_end_date is null or p_start_date >= p_end_date then
      raise exception 'Valid start and end dates required for custom range.' using errcode = '22023';
    end if;
    v_start := p_start_date;
    v_end := p_end_date;
  elsif p_range_type = 'all_time' then
    v_start := null;
    v_end := null;
  else
    raise exception 'Invalid range type. Expected today, custom, or all_time.' using errcode = '22023';
  end if;

  with waste_events as (
    select id, shift_id, product_id, recorded_by, created_at, quantity, note from public.shift_waste_occurrences
    union all
    select m.id, (m.branch_stock_action->'request'->>'shift_id')::uuid, m.product_id, m.created_by, m.created_at,
      abs(m.quantity), m.branch_stock_action->'request'->>'reason' from public.inventory_movements m
    where m.branch_stock_action is not null and m.branch_stock_action->'request'->>'action'='waste'
  ), eligible as (
    select
      s.id as shift_id,
      (timezone('Asia/Manila', s.ended_at))::date as business_date,
      s.branch_id,
      b.name as branch_name,
      s.cashier_id,
      cashier.full_name as cashier_name,
      s.started_at,
      s.ended_at,
      case
        when r.id is null then 'pending'
        when exists (
          select 1 from waste_events w where w.shift_id = s.id
        ) then 'waste_recorded'
        else 'no_waste'
      end as waste_status,
      (
        select count(*)::integer
        from waste_events w
        where w.shift_id = s.id
      ) as occurrence_count,
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'product_id', w.product_id,
            'product_name', pr.name,
            'recorded_at', w.created_at,
            'recorded_by', w.recorded_by,
            'note', w.note, 'occurrence_id', w.id, 'quantity', w.quantity
          )
          order by pr.name, w.created_at, w.id
        )
        from waste_events w
        join public.products pr on pr.id = w.product_id
        where w.shift_id = s.id
      ), '[]'::jsonb) as occurrences
    from public.shifts s
    join public.branches b on b.id = s.branch_id
    join public.profiles cashier on cashier.id = s.cashier_id
    left join public.shift_reconciliations r on r.shift_id = s.id
    where s.status = 'closed'
      and not b.is_main_branch
      and (p_branch_id is null or s.branch_id = p_branch_id)
      and (r.id is not null or s.reconciliation_required)
      and (v_start is null or (s.ended_at >= v_start and s.ended_at < v_end))
  )
  select jsonb_build_object(
    'days',
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'business_date', d.business_date,
          'occurrence_count', d.occurrence_count,
          'distinct_product_count', d.distinct_product_count,
          'shifts', d.shifts
        )
        order by d.business_date desc
      ),
      '[]'::jsonb
    )
  )
  into v_result
  from (
    select
      e.business_date,
      coalesce(sum(e.occurrence_count), 0)::integer as occurrence_count,
      coalesce((
        select count(distinct w.product_id)::integer
        from waste_events w
        where w.shift_id in (
          select x.shift_id from eligible x where x.business_date = e.business_date
        )
      ), 0) as distinct_product_count,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'shift_id', e.shift_id,
            'business_date', e.business_date,
            'branch_id', e.branch_id,
            'branch_name', e.branch_name,
            'cashier_id', e.cashier_id,
            'cashier_name', e.cashier_name,
            'started_at', e.started_at,
            'ended_at', e.ended_at,
            'waste_status', e.waste_status,
            'occurrences', e.occurrences
          )
          order by e.ended_at desc, e.shift_id
        ),
        '[]'::jsonb
      ) as shifts
    from eligible e
    group by e.business_date
  ) d;

  return v_result;
end;
$$;

revoke all on function public.report_branch_shift_waste(uuid, text, timestamptz, timestamptz)
  from public, anon;
grant execute on function public.report_branch_shift_waste(uuid, text, timestamptz, timestamptz)
  to authenticated;

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
      'already_recorded_waste', (select coalesce(sum(abs(m.quantity)),0)
        from public.inventory_movements m where m.branch_id=p_shift.branch_id and m.product_id=v_base.product_id
          and m.branch_stock_action is not null and m.branch_stock_action->'request'->>'shift_id'=p_shift.id::text
          and m.branch_stock_action->'request'->>'action'='waste'),
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

commit;
