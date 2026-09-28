begin;

drop function if exists public.report_branch_shift_remittances(uuid);

create or replace function public.report_branch_shift_remittances(
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

  select jsonb_build_object(
    'days',
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'business_date', d.business_date,
          'expected_cash', d.expected_cash,
          'actual_remitted', d.actual_remitted,
          'total_shortage', d.total_shortage,
          'total_excess', d.total_excess,
          'reconciled_shift_count', d.reconciled_shift_count,
          'pending_shift_count', d.pending_shift_count,
          'pending_expected_cash', d.pending_expected_cash,
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
      coalesce(sum(e.expected_cash), 0)::numeric(12,2) as expected_cash,
      count(*) filter (where e.status = 'reconciled')::integer as reconciled_shift_count,
      case
        when count(*) filter (where e.status = 'reconciled') = 0 then null
        else coalesce(sum(e.actual_cash) filter (where e.status = 'reconciled'), 0)::numeric(12,2)
      end as actual_remitted,
      coalesce(sum(e.difference) filter (where e.status = 'reconciled' and e.difference > 0), 0)::numeric(12,2)
        as total_shortage,
      coalesce(sum(abs(e.difference)) filter (where e.status = 'reconciled' and e.difference < 0), 0)::numeric(12,2)
        as total_excess,
      count(*) filter (where e.status = 'pending')::integer as pending_shift_count,
      coalesce(sum(e.expected_cash) filter (where e.status = 'pending'), 0)::numeric(12,2) as pending_expected_cash,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'business_date', e.business_date,
            'shift_id', e.shift_id,
            'branch_id', e.branch_id,
            'branch_name', e.branch_name,
            'cashier_id', e.cashier_id,
            'cashier_name', e.cashier_name,
            'started_at', e.started_at,
            'ended_at', e.ended_at,
            'status', e.status,
            'expected_cash', e.expected_cash,
            'actual_cash', e.actual_cash,
            'difference', e.difference,
            'result', e.result,
            'reconciled_at', e.reconciled_at
          )
          order by e.ended_at desc, e.shift_id
        ),
        '[]'::jsonb
      ) as shifts
    from (
      select
        s.id as shift_id,
        (timezone('Asia/Manila', s.ended_at))::date as business_date,
        s.branch_id,
        b.name as branch_name,
        s.cashier_id,
        cashier.full_name as cashier_name,
        s.started_at,
        s.ended_at,
        case when r.id is null then 'pending' else 'reconciled' end as status,
        coalesce(r.expected_cash, (
          select coalesce(sum(sales.total_amount), 0)::numeric(12,2)
          from public.sales
          where sales.shift_id = s.id and sales.status = 'completed'
        )) as expected_cash,
        r.actual_cash,
        r.difference,
        r.result,
        r.reconciled_at
      from public.shifts s
      join public.branches b on b.id = s.branch_id
      join public.profiles cashier on cashier.id = s.cashier_id
      left join public.shift_reconciliations r on r.shift_id = s.id
      where s.status = 'closed'
        and not b.is_main_branch
        and (p_branch_id is null or s.branch_id = p_branch_id)
        and (r.id is not null or s.reconciliation_required)
        and (v_start is null or (s.ended_at >= v_start and s.ended_at < v_end))
    ) e
    group by e.business_date
  ) d;

  return v_result;
end;
$$;

revoke all on function public.report_branch_shift_remittances(uuid, text, timestamptz, timestamptz)
  from public, anon;
grant execute on function public.report_branch_shift_remittances(uuid, text, timestamptz, timestamptz)
  to authenticated;

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

  with eligible as (
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
          select 1 from public.shift_waste_occurrences w where w.shift_id = s.id
        ) then 'waste_recorded'
        else 'no_waste'
      end as waste_status,
      (
        select count(*)::integer
        from public.shift_waste_occurrences w
        where w.shift_id = s.id
      ) as occurrence_count,
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'product_id', w.product_id,
            'product_name', pr.name,
            'recorded_at', w.created_at,
            'recorded_by', w.recorded_by,
            'note', w.note
          )
          order by pr.name, w.product_id
        )
        from public.shift_waste_occurrences w
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
        from public.shift_waste_occurrences w
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

commit;
