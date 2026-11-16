begin;

-- Owner Total Sales / focused Sales-by-Branch drill-in:
-- active selling branches plus any inactive non-Main branch that has completed sales in range.
-- Leaves report_sales_by_branch unchanged (active-only) for the normal Sales by Branch report.

create or replace function public.report_owner_sales_by_branch(
  p_range_type text default 'today',
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
  if not public.is_owner() then
    raise exception 'Unauthorized: Owner access required.' using errcode = '42501';
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
        'branch_id', b.id,
        'branch_name', b.name,
        'is_active', b.is_active,
        'transaction_count', coalesce(s.tx_count, 0),
        'total_sales', coalesce(s.total_sales, 0)
      ) order by b.name, b.id
    ),
    '[]'::jsonb
  ) into v_result
  from public.branches b
  left join (
    select branch_id, sum(tx_count)::bigint as tx_count, sum(total_sales)::numeric(12,2) as total_sales
    from (
      select
        live.branch_id,
        count(live.id)::bigint as tx_count,
        sum(live.total_amount)::numeric(12,2) as total_sales
      from public.sales live
      where live.status = 'completed'
        and (v_start is null or (live.sold_at >= v_start and live.sold_at < v_end))
      group by live.branch_id
      union all
      select
        d.branch_id,
        d.transaction_count,
        d.revenue
      from public.daily_branch_sales_summary d
      where (v_start is null or (
        (d.business_date::timestamp at time zone 'Asia/Manila') >= v_start
        and (d.business_date::timestamp at time zone 'Asia/Manila') < v_end
      ))
        and not exists (
          select 1 from public.sales live
          where (timezone('Asia/Manila', live.sold_at))::date = d.business_date
        )
    ) u
    group by branch_id
  ) s on s.branch_id = b.id
  where not b.is_main_branch
    and (b.is_active or coalesce(s.tx_count, 0) > 0 or coalesce(s.total_sales, 0) <> 0);

  return v_result;
end;
$$;

revoke all on function public.report_owner_sales_by_branch(text, timestamptz, timestamptz) from public, anon;
grant execute on function public.report_owner_sales_by_branch(text, timestamptz, timestamptz) to authenticated;

comment on function public.report_owner_sales_by_branch(text, timestamptz, timestamptz) is
  'Owner-only company sales by branch for a Manila range: all active non-Main branches plus inactive branches that have completed/archived sales in range.';

commit;
