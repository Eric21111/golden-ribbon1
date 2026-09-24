-- Owner Sales by Branch: daily totals for week / month / all-time,
-- including archived days from daily_branch_sales_summary.

create or replace function public.report_branch_daily_sales(
  p_branch_id uuid,
  p_range_type text default 'all_time',
  p_start_date timestamptz default null,
  p_end_date timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_start timestamptz := null;
  v_end timestamptz := null;
  v_result jsonb;
begin
  if not public.is_owner() then
    raise exception 'Unauthorized: Owner access required.' using errcode = '42501';
  end if;
  if p_branch_id is null then
    raise exception 'Branch is required.' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.branches b
    where b.id = p_branch_id
      and b.is_active
      and not b.is_main_branch
  ) then
    raise exception 'Selling branch is missing.' using errcode = '22023';
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

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'business_date', x.business_date,
        'transaction_count', x.transaction_count,
        'total_sales', x.total_sales
      ) order by x.business_date desc
    ),
    '[]'::jsonb
  )
  into v_result
  from (
    select
      u.business_date,
      sum(u.tx_count)::bigint as transaction_count,
      sum(u.total_sales)::numeric(12,2) as total_sales
    from (
      select
        (timezone('Asia/Manila', s.sold_at))::date as business_date,
        count(s.id)::bigint as tx_count,
        sum(s.total_amount)::numeric(12,2) as total_sales
      from public.sales s
      where s.branch_id = p_branch_id
        and s.status = 'completed'
        and (v_start is null or (s.sold_at >= v_start and s.sold_at < v_end))
      group by 1
      union all
      select
        d.business_date,
        d.transaction_count,
        d.revenue
      from public.daily_branch_sales_summary d
      where d.branch_id = p_branch_id
        and (v_start is null or (
          (d.business_date::timestamp at time zone 'Asia/Manila') >= v_start
          and (d.business_date::timestamp at time zone 'Asia/Manila') < v_end
        ))
        and not exists (
          select 1
          from public.sales live
          where live.branch_id = p_branch_id
            and live.status = 'completed'
            and (timezone('Asia/Manila', live.sold_at))::date = d.business_date
        )
    ) u
    group by u.business_date
  ) x;

  return v_result;
end;
$$;

revoke all on function public.report_branch_daily_sales(uuid, text, timestamptz, timestamptz)
  from public, anon;
grant execute on function public.report_branch_daily_sales(uuid, text, timestamptz, timestamptz)
  to authenticated;
