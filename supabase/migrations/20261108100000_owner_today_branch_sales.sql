-- Owner dashboard "Today Quickview": today's completed sales per selling branch (Asia/Manila business day).
-- Unlike report_sales_by_branch, a branch deactivated during the day keeps its sales in the breakdown,
-- so the total never loses revenue. report_sales_by_branch is intentionally left unchanged.

create or replace function public.get_owner_today_branch_sales()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_business_date date;
  v_start timestamptz;
  v_end timestamptz;
  v_branches jsonb;
begin
  if not public.is_owner() then
    raise exception 'Unauthorized: Owner access required.' using errcode = '42501';
  end if;

  v_business_date := (timezone('Asia/Manila', now()))::date;
  v_start := v_business_date::timestamp at time zone 'Asia/Manila';
  v_end := v_start + interval '1 day';

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
  ) into v_branches
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
        and live.sold_at >= v_start
        and live.sold_at < v_end
      group by live.branch_id
      union all
      select d.branch_id, d.transaction_count, d.revenue
      from public.daily_branch_sales_summary d
      where d.business_date = v_business_date
        and not exists (
          select 1 from public.sales live
          where live.sold_at >= v_start and live.sold_at < v_end
        )
    ) u
    group by branch_id
  ) s on s.branch_id = b.id
  where not b.is_main_branch
    and (b.is_active or coalesce(s.tx_count, 0) > 0 or coalesce(s.total_sales, 0) <> 0);

  return jsonb_build_object(
    'business_date', v_business_date,
    'branches', v_branches
  );
end;
$$;

revoke all on function public.get_owner_today_branch_sales() from public, anon;
grant execute on function public.get_owner_today_branch_sales() to authenticated;

comment on function public.get_owner_today_branch_sales() is
  'Owner-only. Today''s (Asia/Manila) completed sales per non-Main branch: all active branches plus any branch with sales today, even if deactivated since.';
