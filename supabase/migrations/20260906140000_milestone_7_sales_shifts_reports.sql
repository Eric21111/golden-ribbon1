begin;

-- ============================================================================
-- 1. RLS POLICIES FOR SALES, SALE ITEMS, AND SHIFTS
-- ============================================================================

-- Sales RLS:
-- Owner: can select all sales
-- Manager: can select sales from assigned branch
-- Cashier: can select own sales
drop policy if exists sales_select_own_shift on public.sales;
drop policy if exists sales_select_authorized on public.sales;
create policy sales_select_authorized on public.sales for select to authenticated using (
  public.is_owner()
  or (public.current_user_role() = 'manager' and branch_id = public.current_user_branch_id())
  or (public.current_user_role() = 'cashier' and cashier_id = auth.uid())
);

-- Sale items RLS:
-- Sale items are selectable strictly when the parent sale record is accessible under caller's RLS
drop policy if exists sale_items_select_own on public.sale_items;
drop policy if exists sale_items_select_authorized on public.sale_items;
create policy sale_items_select_authorized on public.sale_items for select to authenticated using (
  exists (select 1 from public.sales s where s.id = sale_id)
);

-- Shifts RLS:
-- Owner: can select all shifts
-- Manager: can select shifts from assigned branch
-- Cashier: can select own shifts
drop policy if exists "shifts_select_own" on public.shifts;
drop policy if exists shifts_select_authorized on public.shifts;
create policy shifts_select_authorized on public.shifts for select to authenticated using (
  public.is_owner()
  or (public.current_user_role() = 'manager' and branch_id = public.current_user_branch_id())
  or (public.current_user_role() = 'cashier' and cashier_id = auth.uid())
);

-- ============================================================================
-- 2. SHIFT CLOSURE & SUMMARY RPCS
-- ============================================================================

-- Improved end_cashier_shift:
-- Closes shift atomically, computes completed sales total and transaction count, and returns ShiftSummary
-- Drop first because return type changed from void → jsonb (PostgreSQL cannot CREATE OR REPLACE across type changes)
drop function if exists public.end_cashier_shift(uuid);
create or replace function public.end_cashier_shift(p_shift_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_user public.profiles%rowtype;
  v_shift public.shifts%rowtype;
  v_branch_name text;
  v_tx_count bigint;
  v_total_sales numeric(12,2);
begin
  select * into v_user
  from public.profiles
  where id = v_user_id and is_active and role = 'cashier'
  for update;

  if not found then
    raise exception 'Unauthorized: active cashier access required.' using errcode = '42501';
  end if;

  select * into v_shift
  from public.shifts
  where id = p_shift_id
  for update;

  if not found or v_shift.cashier_id <> v_user_id or v_shift.branch_id <> v_user.branch_id then
    raise exception 'Unable to access this shift.' using errcode = '42501';
  end if;

  if v_shift.status = 'closed' then
    raise exception 'This shift is already closed.' using errcode = '55000';
  end if;

  update public.shifts
  set status = 'closed', ended_at = now()
  where id = p_shift_id
  returning * into v_shift;

  select name into v_branch_name
  from public.branches
  where id = v_shift.branch_id;

  select
    count(id)::bigint,
    coalesce(sum(total_amount), 0)::numeric(12,2)
  into v_tx_count, v_total_sales
  from public.sales
  where shift_id = p_shift_id and status = 'completed';

  return jsonb_build_object(
    'id', v_shift.id,
    'branch_id', v_shift.branch_id,
    'branch_name', v_branch_name,
    'cashier_id', v_shift.cashier_id,
    'cashier_name', v_user.full_name,
    'status', v_shift.status,
    'started_at', v_shift.started_at,
    'ended_at', v_shift.ended_at,
    'completed_transaction_count', v_tx_count,
    'total_sales', v_total_sales
  );
end;
$$;

revoke all on function public.end_cashier_shift(uuid) from public, anon;
grant execute on function public.end_cashier_shift(uuid) to authenticated;

-- Get single shift summary
create or replace function public.get_shift_summary(p_shift_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_user public.profiles%rowtype;
  v_shift public.shifts%rowtype;
  v_cashier_name text;
  v_branch_name text;
  v_tx_count bigint;
  v_total_sales numeric(12,2);
begin
  select * into v_user
  from public.profiles
  where id = v_user_id and is_active;

  if not found then
    raise exception 'Active profile required.' using errcode = '42501';
  end if;

  select * into v_shift
  from public.shifts
  where id = p_shift_id;

  if not found then
    raise exception 'Shift not found.' using errcode = 'P0002';
  end if;

  -- Authorization check
  if v_user.role = 'owner' then
    -- Allowed
    null;
  elsif v_user.role = 'manager' then
    if v_shift.branch_id is distinct from v_user.branch_id then
      raise exception 'Unauthorized: shift belongs to another branch.' using errcode = '42501';
    end if;
  elsif v_user.role = 'cashier' then
    if v_shift.cashier_id is distinct from v_user_id then
      raise exception 'Unauthorized: shift belongs to another cashier.' using errcode = '42501';
    end if;
  else
    raise exception 'Unauthorized.' using errcode = '42501';
  end if;

  select full_name into v_cashier_name
  from public.profiles
  where id = v_shift.cashier_id;

  select name into v_branch_name
  from public.branches
  where id = v_shift.branch_id;

  select
    count(id)::bigint,
    coalesce(sum(total_amount), 0)::numeric(12,2)
  into v_tx_count, v_total_sales
  from public.sales
  where shift_id = p_shift_id and status = 'completed';

  return jsonb_build_object(
    'id', v_shift.id,
    'branch_id', v_shift.branch_id,
    'branch_name', coalesce(v_branch_name, 'Branch'),
    'cashier_id', v_shift.cashier_id,
    'cashier_name', coalesce(v_cashier_name, 'Cashier'),
    'status', v_shift.status,
    'started_at', v_shift.started_at,
    'ended_at', v_shift.ended_at,
    'completed_transaction_count', v_tx_count,
    'total_sales', v_total_sales
  );
end;
$$;

revoke all on function public.get_shift_summary(uuid) from public, anon;
grant execute on function public.get_shift_summary(uuid) to authenticated;

-- List shift summaries with server-side aggregated metrics and authorization
create or replace function public.list_shift_summaries(
  p_page int default 0,
  p_page_size int default 50,
  p_branch_id uuid default null,
  p_cashier_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_user public.profiles%rowtype;
  v_filter_branch uuid := null;
  v_filter_cashier uuid := null;
  v_limit int := greatest(1, least(coalesce(p_page_size, 50), 100));
  v_offset int := greatest(0, coalesce(p_page, 0)) * v_limit;
  v_result jsonb;
begin
  select * into v_user
  from public.profiles
  where id = v_user_id and is_active;

  if not found then
    raise exception 'Active profile required.' using errcode = '42501';
  end if;

  if v_user.role = 'owner' then
    v_filter_branch := p_branch_id;
    v_filter_cashier := p_cashier_id;
  elsif v_user.role = 'manager' then
    -- Manager branch is strictly derived from profile
    v_filter_branch := v_user.branch_id;
    v_filter_cashier := p_cashier_id;
  elsif v_user.role = 'cashier' then
    -- Cashier identity is strictly derived from profile
    v_filter_cashier := v_user_id;
    v_filter_branch := null;
  else
    raise exception 'Unauthorized.' using errcode = '42501';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', q.id,
        'branch_id', q.branch_id,
        'branch_name', q.branch_name,
        'cashier_id', q.cashier_id,
        'cashier_name', q.cashier_name,
        'status', q.status,
        'started_at', q.started_at,
        'ended_at', q.ended_at,
        'completed_transaction_count', q.completed_tx_count,
        'total_sales', q.total_sales
      ) order by q.started_at desc
    ),
    '[]'::jsonb
  ) into v_result
  from (
    select
      s.id,
      s.branch_id,
      b.name as branch_name,
      s.cashier_id,
      p.full_name as cashier_name,
      s.status,
      s.started_at,
      s.ended_at,
      coalesce(sales_agg.tx_count, 0) as completed_tx_count,
      coalesce(sales_agg.total_sales, 0) as total_sales
    from public.shifts s
    join public.branches b on b.id = s.branch_id
    join public.profiles p on p.id = s.cashier_id
    left join (
      select
        shift_id,
        count(id)::bigint as tx_count,
        sum(total_amount)::numeric(12,2) as total_sales
      from public.sales
      where status = 'completed'
      group by shift_id
    ) sales_agg on sales_agg.shift_id = s.id
    where (v_filter_branch is null or s.branch_id = v_filter_branch)
      and (v_filter_cashier is null or s.cashier_id = v_filter_cashier)
    order by s.started_at desc
    limit v_limit offset v_offset
  ) q;

  return v_result;
end;
$$;

revoke all on function public.list_shift_summaries(int, int, uuid, uuid) from public, anon;
grant execute on function public.list_shift_summaries(int, int, uuid, uuid) to authenticated;

-- ============================================================================
-- 3. REPORTS & DASHBOARD RPCS
-- ============================================================================

-- Owner-only report: Sales by Branch
create or replace function public.report_sales_by_branch(
  p_range_type text default 'today',
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
        'transaction_count', coalesce(s.tx_count, 0),
        'total_sales', coalesce(s.total_sales, 0)
      ) order by b.name
    ),
    '[]'::jsonb
  ) into v_result
  from public.branches b
  left join (
    select
      branch_id,
      count(id)::bigint as tx_count,
      sum(total_amount)::numeric(12,2) as total_sales
    from public.sales
    where status = 'completed'
      and (v_start is null or (sold_at >= v_start and sold_at < v_end))
    group by branch_id
  ) s on s.branch_id = b.id
  where b.is_active and not b.is_main_branch;

  return v_result;
end;
$$;

revoke all on function public.report_sales_by_branch(text, timestamptz, timestamptz) from public, anon;
grant execute on function public.report_sales_by_branch(text, timestamptz, timestamptz) to authenticated;

-- Product sales summary report (Owner or Manager)
create or replace function public.report_product_sales(
  p_range_type text default 'today',
  p_branch_id uuid default null,
  p_start_date timestamptz default null,
  p_end_date timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_user public.profiles%rowtype;
  v_branch uuid := null;
  v_start timestamptz := null;
  v_end timestamptz := null;
  v_result jsonb;
begin
  select * into v_user
  from public.profiles
  where id = v_user_id and is_active;

  if not found then
    raise exception 'Active profile required.' using errcode = '42501';
  end if;

  if v_user.role = 'owner' then
    v_branch := p_branch_id;
  elsif v_user.role = 'manager' then
    -- Manager branch is strictly derived from profile
    v_branch := v_user.branch_id;
  else
    raise exception 'Unauthorized: Owner or Manager access required.' using errcode = '42501';
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
        'product_id', p.id,
        'product_name', p.name,
        'product_sku', p.sku,
        'quantity_sold', coalesce(agg.qty, 0),
        'total_revenue', coalesce(agg.revenue, 0)
      ) order by coalesce(agg.revenue, 0) desc, p.name
    ),
    '[]'::jsonb
  ) into v_result
  from public.products p
  left join (
    select
      si.product_id,
      sum(si.quantity)::bigint as qty,
      sum(si.subtotal)::numeric(12,2) as revenue
    from public.sale_items si
    join public.sales s on s.id = si.sale_id
    where s.status = 'completed'
      and (v_branch is null or s.branch_id = v_branch)
      and (v_start is null or (s.sold_at >= v_start and s.sold_at < v_end))
    group by si.product_id
  ) agg on agg.product_id = p.id
  where p.is_active or coalesce(agg.qty, 0) > 0;

  return v_result;
end;
$$;

revoke all on function public.report_product_sales(text, uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.report_product_sales(text, uuid, timestamptz, timestamptz) to authenticated;

-- Owner dashboard metrics (Owner-only)
create or replace function public.get_owner_dashboard_metrics()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_start timestamptz;
  v_end timestamptz;
  v_today_sales numeric(12,2);
  v_today_tx bigint;
  v_active_products bigint;
  v_pending_transfers bigint;
  v_in_transit_returns bigint;
  v_transfer_discrepancies bigint;
  v_return_discrepancies bigint;
begin
  if not public.is_owner() then
    raise exception 'Unauthorized: Owner access required.' using errcode = '42501';
  end if;

  v_start := (timezone('Asia/Manila', now()))::date::timestamp at time zone 'Asia/Manila';
  v_end := v_start + interval '1 day';

  select
    coalesce(sum(total_amount), 0)::numeric(12,2),
    count(id)::bigint
  into v_today_sales, v_today_tx
  from public.sales
  where status = 'completed'
    and sold_at >= v_start
    and sold_at < v_end;

  select count(id)::bigint into v_active_products
  from public.products where is_active;

  select count(id)::bigint into v_pending_transfers
  from public.stock_transfers where status = 'pending_receipt';

  select count(id)::bigint into v_in_transit_returns
  from public.stock_returns where status = 'in_transit';

  select count(id)::bigint into v_transfer_discrepancies
  from public.transfer_discrepancies;

  select count(id)::bigint into v_return_discrepancies
  from public.return_discrepancies;

  return jsonb_build_object(
    'today_sales', v_today_sales,
    'today_transactions', v_today_tx,
    'active_products_count', v_active_products,
    'pending_transfers_count', v_pending_transfers,
    'in_transit_returns_count', v_in_transit_returns,
    'transfer_discrepancies_count', v_transfer_discrepancies,
    'return_discrepancies_count', v_return_discrepancies
  );
end;
$$;

revoke all on function public.get_owner_dashboard_metrics() from public, anon;
grant execute on function public.get_owner_dashboard_metrics() to authenticated;

-- Manager dashboard metrics (Manager-only)
create or replace function public.get_manager_dashboard_metrics()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_user public.profiles%rowtype;
  v_branch uuid;
  v_start timestamptz;
  v_end timestamptz;
  v_today_sales numeric(12,2);
  v_today_tx bigint;
  v_inventory_count bigint;
  v_pending_incoming bigint;
  v_returns_in_transit bigint;
begin
  select * into v_user
  from public.profiles
  where id = v_user_id and is_active;

  if not found or v_user.role is distinct from 'manager' then
    raise exception 'Unauthorized: Manager access required.' using errcode = '42501';
  end if;

  v_branch := v_user.branch_id;
  if v_branch is null then
    raise exception 'No branch assigned to this manager.' using errcode = '42501';
  end if;

  v_start := (timezone('Asia/Manila', now()))::date::timestamp at time zone 'Asia/Manila';
  v_end := v_start + interval '1 day';

  select
    coalesce(sum(total_amount), 0)::numeric(12,2),
    count(id)::bigint
  into v_today_sales, v_today_tx
  from public.sales
  where branch_id = v_branch
    and status = 'completed'
    and sold_at >= v_start
    and sold_at < v_end;

  select count(id)::bigint into v_inventory_count
  from public.branch_inventory
  where branch_id = v_branch and quantity_on_hand > 0;

  select count(id)::bigint into v_pending_incoming
  from public.stock_transfers
  where to_branch_id = v_branch and status = 'pending_receipt';

  select count(id)::bigint into v_returns_in_transit
  from public.stock_returns
  where (from_branch_id = v_branch or to_branch_id = v_branch)
    and status = 'in_transit';

  return jsonb_build_object(
    'today_sales', v_today_sales,
    'today_transactions', v_today_tx,
    'current_inventory_count', v_inventory_count,
    'pending_incoming_transfers_count', v_pending_incoming,
    'returns_in_transit_count', v_returns_in_transit
  );
end;
$$;

revoke all on function public.get_manager_dashboard_metrics() from public, anon;
grant execute on function public.get_manager_dashboard_metrics() to authenticated;

-- Manager recent sales (Manager-only, returns latest 5-10 completed sales for assigned branch)
create or replace function public.get_manager_recent_sales(p_limit int default 5)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_user public.profiles%rowtype;
  v_limit int := greatest(1, least(coalesce(p_limit, 5), 10));
  v_result jsonb;
begin
  select * into v_user
  from public.profiles
  where id = v_user_id and is_active;

  if not found or v_user.role is distinct from 'manager' then
    raise exception 'Unauthorized: Manager access required.' using errcode = '42501';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', s.id,
        'sale_number', s.sale_number,
        'branch_id', s.branch_id,
        'shift_id', s.shift_id,
        'cashier_id', s.cashier_id,
        'cashier_name', p.full_name,
        'subtotal', s.subtotal,
        'total_amount', s.total_amount,
        'amount_paid', s.amount_paid,
        'change_amount', s.change_amount,
        'status', s.status,
        'sold_at', s.sold_at
      ) order by s.sold_at desc
    ),
    '[]'::jsonb
  ) into v_result
  from (
    select * from public.sales
    where branch_id = v_user.branch_id
      and status = 'completed'
    order by sold_at desc
    limit v_limit
  ) s
  join public.profiles p on p.id = s.cashier_id;

  return v_result;
end;
$$;

revoke all on function public.get_manager_recent_sales(int) from public, anon;
grant execute on function public.get_manager_recent_sales(int) to authenticated;

commit;
