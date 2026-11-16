begin;

-- Manager Revision #7: Waste History includes Main inventory waste (no shift_id)
-- alongside shift close waste and cashier mid-shift waste, without double-counting.
-- Selling-branch rows stay shift-grouped; Main rows are one inventory entry per day.

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

  with shift_waste_events as (
    -- Close-path waste (shift_waste_occurrences). Closing also writes movement_type=waste
    -- without branch_stock_action — do not also pull those movements (would duplicate).
    select
      w.id,
      w.shift_id,
      w.product_id,
      w.recorded_by,
      w.created_at,
      w.quantity,
      w.note
    from public.shift_waste_occurrences w
    union all
    -- Cashier mid-shift waste (adjustment + branch_stock_action). Requires shift_id.
    -- Exclude Main inventory waste (scope=main, no shift_id) — handled below.
    select
      m.id,
      (m.branch_stock_action->'request'->>'shift_id')::uuid,
      m.product_id,
      m.created_by,
      m.created_at,
      abs(m.quantity),
      m.branch_stock_action->'request'->>'reason'
    from public.inventory_movements m
    where m.branch_stock_action is not null
      and m.branch_stock_action->'request'->>'action' = 'waste'
      and m.branch_stock_action->'request'->>'shift_id' is not null
      and coalesce(m.branch_stock_action->'request'->>'scope', '') is distinct from 'main'
  ),
  main_waste_events as (
    select
      m.id,
      m.branch_id,
      m.product_id,
      m.created_by as recorded_by,
      m.created_at,
      abs(m.quantity) as quantity,
      m.branch_stock_action->'request'->>'reason' as note,
      (timezone('Asia/Manila', m.created_at))::date as business_date
    from public.inventory_movements m
    where m.branch_stock_action is not null
      and m.branch_stock_action->'request'->>'action' = 'waste'
      and m.branch_stock_action->'request'->>'scope' = 'main'
      and (p_branch_id is null or m.branch_id = p_branch_id)
      and (v_start is null or (m.created_at >= v_start and m.created_at < v_end))
  ),
  eligible_shifts as (
    select
      s.id as shift_id,
      (timezone('Asia/Manila', s.ended_at))::date as business_date,
      s.branch_id,
      b.name as branch_name,
      s.cashier_id,
      cashier.full_name as cashier_name,
      s.started_at,
      s.ended_at,
      'shift'::text as entry_kind,
      case
        when r.id is null then 'pending'
        when exists (
          select 1 from shift_waste_events w where w.shift_id = s.id
        ) then 'waste_recorded'
        else 'no_waste'
      end as waste_status,
      (
        select count(*)::integer
        from shift_waste_events w
        where w.shift_id = s.id
      ) as occurrence_count,
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'product_id', w.product_id,
            'product_name', pr.name,
            'recorded_at', w.created_at,
            'recorded_by', w.recorded_by,
            'recorded_by_name', recorder.full_name,
            'note', w.note,
            'occurrence_id', w.id,
            'quantity', w.quantity
          )
          order by pr.name, w.created_at, w.id
        )
        from shift_waste_events w
        join public.products pr on pr.id = w.product_id
        left join public.profiles recorder on recorder.id = w.recorded_by
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
  ),
  eligible_main as (
    select
      null::uuid as shift_id,
      e.business_date,
      b.id as branch_id,
      b.name as branch_name,
      null::uuid as cashier_id,
      'Main inventory'::text as cashier_name,
      min(e.created_at) as started_at,
      max(e.created_at) as ended_at,
      'main_inventory'::text as entry_kind,
      'waste_recorded'::text as waste_status,
      count(*)::integer as occurrence_count,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'product_id', e.product_id,
            'product_name', pr.name,
            'recorded_at', e.created_at,
            'recorded_by', e.recorded_by,
            'recorded_by_name', recorder.full_name,
            'note', e.note,
            'occurrence_id', e.id,
            'quantity', e.quantity
          )
          order by pr.name, e.created_at, e.id
        ),
        '[]'::jsonb
      ) as occurrences
    from main_waste_events e
    join public.branches b on b.id = e.branch_id and b.is_main_branch
    join public.products pr on pr.id = e.product_id
    left join public.profiles recorder on recorder.id = e.recorded_by
    group by e.business_date, b.id, b.name
  ),
  eligible as (
    select
      shift_id, business_date, branch_id, branch_name, cashier_id, cashier_name,
      started_at, ended_at, entry_kind, waste_status, occurrence_count, occurrences
    from eligible_shifts
    union all
    select
      shift_id, business_date, branch_id, branch_name, cashier_id, cashier_name,
      started_at, ended_at, entry_kind, waste_status, occurrence_count, occurrences
    from eligible_main
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
      (
        select count(distinct x.product_id)::integer
        from (
          select w.product_id
          from shift_waste_events w
          where w.shift_id in (
            select x.shift_id from eligible x
            where x.business_date = e.business_date and x.shift_id is not null
          )
          union
          select m.product_id
          from main_waste_events m
          where m.business_date = e.business_date
        ) x
      ) as distinct_product_count,
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
            'entry_kind', e.entry_kind,
            'waste_status', e.waste_status,
            'occurrences', e.occurrences
          )
          order by e.ended_at desc nulls last, e.shift_id nulls first
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

comment on function public.report_branch_shift_waste(uuid, text, timestamptz, timestamptz) is
  'Waste History: selling-branch shift waste + Main inventory waste (scope=main). Read-only. No duplicates across sources.';

commit;
