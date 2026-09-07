-- Milestone 8: Branch Performance & Inventory Reconciliation
-- Company-wide Owner-only reporting and inventory reconciliation RPCs

begin;

-- ============================================================================
-- 1. BRANCH PERFORMANCE REPORT
-- ============================================================================

create or replace function public.report_branch_performance(
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
  v_start timestamptz;
  v_end timestamptz;
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

  with sales_agg as (
    select
      s.branch_id,
      count(distinct s.id)::bigint as tx_count,
      coalesce(sum(s.total_amount), 0)::numeric(12,2) as total_sales,
      coalesce(sum(si.quantity), 0)::bigint as quantity_sold
    from public.sales s
    join public.sale_items si on si.sale_id = s.id
    where s.status = 'completed'
      and (v_start is null or (s.sold_at >= v_start and s.sold_at < v_end))
    group by s.branch_id
  ),
  transfer_disc_agg as (
    select
      st.to_branch_id as branch_id,
      coalesce(sum(td.difference) filter (where td.discrepancy_type = 'missing'), 0)::bigint as transfer_missing_qty,
      coalesce(sum(abs(td.difference)) filter (where td.discrepancy_type = 'excess'), 0)::bigint as transfer_excess_qty
    from public.transfer_discrepancies td
    join public.stock_transfers st on st.id = td.stock_transfer_id
    where (v_start is null or (td.created_at >= v_start and td.created_at < v_end))
    group by st.to_branch_id
  ),
  return_disc_agg as (
    select
      sr.from_branch_id as branch_id,
      coalesce(sum(rd.difference) filter (where rd.discrepancy_type = 'missing'), 0)::bigint as return_missing_qty,
      coalesce(sum(abs(rd.difference)) filter (where rd.discrepancy_type = 'excess'), 0)::bigint as return_excess_qty
    from public.return_discrepancies rd
    join public.stock_returns sr on sr.id = rd.stock_return_id
    where (v_start is null or (rd.created_at >= v_start and rd.created_at < v_end))
    group by sr.from_branch_id
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'branch_id', b.id,
        'branch_name', b.name,
        'transaction_count', coalesce(sa.tx_count, 0),
        'total_sales', coalesce(sa.total_sales, 0),
        'quantity_sold', coalesce(sa.quantity_sold, 0),
        'transfer_missing_qty', coalesce(tda.transfer_missing_qty, 0),
        'transfer_excess_qty', coalesce(tda.transfer_excess_qty, 0),
        'return_missing_qty', coalesce(rda.return_missing_qty, 0),
        'return_excess_qty', coalesce(rda.return_excess_qty, 0),
        'total_missing_qty', coalesce(tda.transfer_missing_qty, 0) + coalesce(rda.return_missing_qty, 0),
        'total_excess_qty', coalesce(tda.transfer_excess_qty, 0) + coalesce(rda.return_excess_qty, 0)
      ) order by b.name
    ),
    '[]'::jsonb
  ) into v_result
  from public.branches b
  left join sales_agg sa on sa.branch_id = b.id
  left join transfer_disc_agg tda on tda.branch_id = b.id
  left join return_disc_agg rda on rda.branch_id = b.id
  where b.is_active and not b.is_main_branch;

  return v_result;
end;
$$;

revoke all on function public.report_branch_performance(text, timestamptz, timestamptz) from public, anon;
grant execute on function public.report_branch_performance(text, timestamptz, timestamptz) to authenticated;

-- ============================================================================
-- 2. BRANCH PERFORMANCE DETAILS
-- ============================================================================

create or replace function public.get_branch_performance_details(
  p_branch_id uuid,
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
  v_start timestamptz;
  v_end timestamptz;
  v_branch record;
  v_metrics jsonb;
  v_inventory jsonb;
  v_products_sold jsonb;
  v_transfer_disc jsonb;
  v_return_disc jsonb;
  v_recent_transfers jsonb;
  v_recent_returns jsonb;
begin
  if not public.is_owner() then
    raise exception 'Unauthorized: Owner access required.' using errcode = '42501';
  end if;

  select id, name, is_active, is_main_branch into v_branch
  from public.branches
  where id = p_branch_id;

  if not found then
    raise exception 'Branch not found.' using errcode = '22023';
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

  -- 1. Metrics
  select jsonb_build_object(
    'transaction_count', coalesce(count(distinct s.id), 0),
    'total_sales', coalesce(sum(s.total_amount), 0)::numeric(12,2),
    'quantity_sold', coalesce(sum(si.quantity), 0),
    'transfer_missing_qty', coalesce((
      select sum(td.difference) filter (where td.discrepancy_type = 'missing')
      from public.transfer_discrepancies td
      join public.stock_transfers st on st.id = td.stock_transfer_id
      where st.to_branch_id = p_branch_id
        and (v_start is null or (td.created_at >= v_start and td.created_at < v_end))
    ), 0),
    'transfer_excess_qty', coalesce((
      select sum(abs(td.difference)) filter (where td.discrepancy_type = 'excess')
      from public.transfer_discrepancies td
      join public.stock_transfers st on st.id = td.stock_transfer_id
      where st.to_branch_id = p_branch_id
        and (v_start is null or (td.created_at >= v_start and td.created_at < v_end))
    ), 0),
    'return_missing_qty', coalesce((
      select sum(rd.difference) filter (where rd.discrepancy_type = 'missing')
      from public.return_discrepancies rd
      join public.stock_returns sr on sr.id = rd.stock_return_id
      where sr.from_branch_id = p_branch_id
        and (v_start is null or (rd.created_at >= v_start and rd.created_at < v_end))
    ), 0),
    'return_excess_qty', coalesce((
      select sum(abs(rd.difference)) filter (where rd.discrepancy_type = 'excess')
      from public.return_discrepancies rd
      join public.stock_returns sr on sr.id = rd.stock_return_id
      where sr.from_branch_id = p_branch_id
        and (v_start is null or (rd.created_at >= v_start and rd.created_at < v_end))
    ), 0)
  ) into v_metrics
  from public.sales s
  left join public.sale_items si on si.sale_id = s.id
  where s.branch_id = p_branch_id
    and s.status = 'completed'
    and (v_start is null or (s.sold_at >= v_start and s.sold_at < v_end));

  -- 2. Read-only Current Inventory
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'product_id', p.id,
        'product_name', p.name,
        'product_sku', p.sku,
        'quantity_on_hand', coalesce(bi.quantity_on_hand, 0)
      ) order by p.name
    ),
    '[]'::jsonb
  ) into v_inventory
  from public.products p
  left join public.branch_inventory bi on bi.product_id = p.id and bi.branch_id = p_branch_id
  where p.is_active;

  -- 3. Products Sold in Range
  with prod_sales as (
    select
      p.id as product_id,
      p.name as product_name,
      p.sku as product_sku,
      sum(si.quantity)::bigint as quantity_sold,
      sum(si.subtotal)::numeric(12,2) as total_revenue
    from public.sale_items si
    join public.sales s on s.id = si.sale_id
    join public.products p on p.id = si.product_id
    where s.branch_id = p_branch_id
      and s.status = 'completed'
      and (v_start is null or (s.sold_at >= v_start and s.sold_at < v_end))
    group by p.id, p.name, p.sku
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'product_id', ps.product_id,
        'product_name', ps.product_name,
        'product_sku', ps.product_sku,
        'quantity_sold', ps.quantity_sold,
        'total_revenue', ps.total_revenue
      ) order by ps.quantity_sold desc
    ),
    '[]'::jsonb
  ) into v_products_sold
  from prod_sales ps;

  -- 4. Transfer Discrepancies
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', td.id,
        'stock_transfer_id', st.id,
        'transfer_number', st.transfer_number,
        'product_id', p.id,
        'product_name', p.name,
        'product_sku', p.sku,
        'quantity_expected', td.quantity_expected,
        'quantity_received', td.quantity_received,
        'difference', td.difference,
        'discrepancy_type', td.discrepancy_type,
        'created_at', td.created_at,
        'notes', td.notes
      ) order by td.created_at desc
    ),
    '[]'::jsonb
  ) into v_transfer_disc
  from public.transfer_discrepancies td
  join public.stock_transfers st on st.id = td.stock_transfer_id
  join public.products p on p.id = td.product_id
  where st.to_branch_id = p_branch_id
    and (v_start is null or (td.created_at >= v_start and td.created_at < v_end));

  -- 5. Return Discrepancies
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', rd.id,
        'stock_return_id', sr.id,
        'return_number', sr.return_number,
        'product_id', p.id,
        'product_name', p.name,
        'product_sku', p.sku,
        'quantity_expected', rd.quantity_expected,
        'quantity_received', rd.quantity_received,
        'difference', rd.difference,
        'discrepancy_type', rd.discrepancy_type,
        'created_at', rd.created_at,
        'notes', rd.notes
      ) order by rd.created_at desc
    ),
    '[]'::jsonb
  ) into v_return_disc
  from public.return_discrepancies rd
  join public.stock_returns sr on sr.id = rd.stock_return_id
  join public.products p on p.id = rd.product_id
  where sr.from_branch_id = p_branch_id
    and (v_start is null or (rd.created_at >= v_start and rd.created_at < v_end));

  -- 6. Recent Transfers (last 5)
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', st.id,
        'transfer_number', st.transfer_number,
        'status', st.status,
        'sent_at', st.sent_at,
        'received_at', st.received_at,
        'items_count', (select count(*) from public.stock_transfer_items sti where sti.stock_transfer_id = st.id)
      ) order by st.created_at desc
    ),
    '[]'::jsonb
  ) into v_recent_transfers
  from (
    select * from public.stock_transfers
    where to_branch_id = p_branch_id
    order by created_at desc
    limit 5
  ) st;

  -- 7. Recent Returns (last 5)
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', sr.id,
        'return_number', sr.return_number,
        'status', sr.status,
        'returned_at', sr.returned_at,
        'received_at', sr.received_at,
        'items_count', (select count(*) from public.stock_return_items sri where sri.stock_return_id = sr.id)
      ) order by sr.created_at desc
    ),
    '[]'::jsonb
  ) into v_recent_returns
  from (
    select * from public.stock_returns
    where from_branch_id = p_branch_id
    order by created_at desc
    limit 5
  ) sr;

  return jsonb_build_object(
    'branch', jsonb_build_object('id', v_branch.id, 'name', v_branch.name),
    'metrics', v_metrics || jsonb_build_object(
      'total_missing_qty', (v_metrics->>'transfer_missing_qty')::bigint + (v_metrics->>'return_missing_qty')::bigint,
      'total_excess_qty', (v_metrics->>'transfer_excess_qty')::bigint + (v_metrics->>'return_excess_qty')::bigint
    ),
    'current_inventory', v_inventory,
    'products_sold', v_products_sold,
    'transfer_discrepancies', v_transfer_disc,
    'return_discrepancies', v_return_disc,
    'recent_transfers', v_recent_transfers,
    'recent_returns', v_recent_returns
  );
end;
$$;

revoke all on function public.get_branch_performance_details(uuid, text, timestamptz, timestamptz) from public, anon;
grant execute on function public.get_branch_performance_details(uuid, text, timestamptz, timestamptz) to authenticated;

-- ============================================================================
-- 3. TRANSFER DISCREPANCIES REPORT
-- ============================================================================

create or replace function public.report_transfer_discrepancies(
  p_branch_id uuid default null,
  p_discrepancy_type text default null,
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
  v_start timestamptz;
  v_end timestamptz;
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
        'id', td.id,
        'transfer_id', st.id,
        'transfer_number', st.transfer_number,
        'branch_id', b.id,
        'branch_name', b.name,
        'product_id', p.id,
        'product_name', p.name,
        'product_sku', p.sku,
        'quantity_sent', td.quantity_expected,
        'quantity_received', td.quantity_received,
        'difference', td.difference,
        'discrepancy_type', td.discrepancy_type,
        'created_at', td.created_at,
        'notes', td.notes
      ) order by td.created_at desc
    ),
    '[]'::jsonb
  ) into v_result
  from public.transfer_discrepancies td
  join public.stock_transfers st on st.id = td.stock_transfer_id
  join public.branches b on b.id = st.to_branch_id
  join public.products p on p.id = td.product_id
  where (p_branch_id is null or st.to_branch_id = p_branch_id)
    and (p_discrepancy_type is null or p_discrepancy_type = 'all' or td.discrepancy_type::text = p_discrepancy_type)
    and (v_start is null or (td.created_at >= v_start and td.created_at < v_end));

  return v_result;
end;
$$;

revoke all on function public.report_transfer_discrepancies(uuid, text, text, timestamptz, timestamptz) from public, anon;
grant execute on function public.report_transfer_discrepancies(uuid, text, text, timestamptz, timestamptz) to authenticated;

-- ============================================================================
-- 4. RETURN DISCREPANCIES REPORT
-- ============================================================================

create or replace function public.report_return_discrepancies(
  p_branch_id uuid default null,
  p_discrepancy_type text default null,
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
  v_start timestamptz;
  v_end timestamptz;
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
        'id', rd.id,
        'return_id', sr.id,
        'return_number', sr.return_number,
        'branch_id', b.id,
        'branch_name', b.name,
        'product_id', p.id,
        'product_name', p.name,
        'product_sku', p.sku,
        'quantity_returned', rd.quantity_expected,
        'quantity_received', rd.quantity_received,
        'difference', rd.difference,
        'discrepancy_type', rd.discrepancy_type,
        'created_at', rd.created_at,
        'notes', rd.notes
      ) order by rd.created_at desc
    ),
    '[]'::jsonb
  ) into v_result
  from public.return_discrepancies rd
  join public.stock_returns sr on sr.id = rd.stock_return_id
  join public.branches b on b.id = sr.from_branch_id
  join public.products p on p.id = rd.product_id
  where (p_branch_id is null or sr.from_branch_id = p_branch_id)
    and (p_discrepancy_type is null or p_discrepancy_type = 'all' or rd.discrepancy_type::text = p_discrepancy_type)
    and (v_start is null or (rd.created_at >= v_start and rd.created_at < v_end));

  return v_result;
end;
$$;

revoke all on function public.report_return_discrepancies(uuid, text, text, timestamptz, timestamptz) from public, anon;
grant execute on function public.report_return_discrepancies(uuid, text, text, timestamptz, timestamptz) to authenticated;

-- ============================================================================
-- 5. INVENTORY RECONCILIATION REPORT (CUMULATIVE THROUGH NOW)
-- ============================================================================

create or replace function public.report_inventory_reconciliation(
  p_branch_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not public.is_owner() then
    raise exception 'Unauthorized: Owner access required.' using errcode = '42501';
  end if;

  with active_selling_branches as (
    select id, name
    from public.branches
    where is_active and not is_main_branch
      and (p_branch_id is null or id = p_branch_id)
  ),
  branch_product_pairs as (
    select
      b.id as branch_id,
      b.name as branch_name,
      p.id as product_id,
      p.name as product_name,
      p.sku as product_sku
    from active_selling_branches b
    cross join public.products p
    where p.is_active or exists (
      select 1 from public.branch_inventory bi
      where bi.branch_id = b.id and bi.product_id = p.id and bi.quantity_on_hand > 0
    ) or exists (
      select 1 from public.inventory_movements im
      where im.branch_id = b.id and im.product_id = p.id
    )
  ),
  movements_agg as (
    select
      im.branch_id,
      im.product_id,
      coalesce(sum(im.quantity) filter (where im.movement_type = 'opening_stock'), 0)::bigint as opening_stock,
      coalesce(sum(im.quantity) filter (where im.movement_type = 'transfer_in'), 0)::bigint as transfer_in,
      coalesce(abs(sum(im.quantity) filter (where im.movement_type = 'sale')), 0)::bigint as sale,
      coalesce(abs(sum(im.quantity) filter (where im.movement_type = 'return_out')), 0)::bigint as return_out,
      coalesce(sum(im.quantity) filter (where im.movement_type = 'adjustment'), 0)::bigint as adjustment,
      coalesce(sum(im.quantity), 0)::bigint as calculated_stock
    from public.inventory_movements im
    group by im.branch_id, im.product_id
  ),
  transfer_disc_agg as (
    select
      st.to_branch_id as branch_id,
      td.product_id,
      coalesce(sum(td.difference) filter (where td.discrepancy_type = 'missing'), 0)::bigint as transfer_missing_qty,
      coalesce(sum(abs(td.difference)) filter (where td.discrepancy_type = 'excess'), 0)::bigint as transfer_excess_qty
    from public.transfer_discrepancies td
    join public.stock_transfers st on st.id = td.stock_transfer_id
    group by st.to_branch_id, td.product_id
  ),
  return_disc_agg as (
    select
      sr.from_branch_id as branch_id,
      rd.product_id,
      coalesce(sum(rd.difference) filter (where rd.discrepancy_type = 'missing'), 0)::bigint as return_missing_qty,
      coalesce(sum(abs(rd.difference)) filter (where rd.discrepancy_type = 'excess'), 0)::bigint as return_excess_qty
    from public.return_discrepancies rd
    join public.stock_returns sr on sr.id = rd.stock_return_id
    group by sr.from_branch_id, rd.product_id
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'branch_id', bp.branch_id,
        'branch_name', bp.branch_name,
        'product_id', bp.product_id,
        'product_name', bp.product_name,
        'product_sku', bp.product_sku,
        'opening_stock', coalesce(ma.opening_stock, 0),
        'transfer_in', coalesce(ma.transfer_in, 0),
        'sale', coalesce(ma.sale, 0),
        'return_out', coalesce(ma.return_out, 0),
        'adjustment', coalesce(ma.adjustment, 0),
        'calculated_stock', coalesce(ma.calculated_stock, 0),
        'current_stock', coalesce(bi.quantity_on_hand, 0),
        'variance', coalesce(bi.quantity_on_hand, 0) - coalesce(ma.calculated_stock, 0),
        'has_reconciliation_issue', (coalesce(bi.quantity_on_hand, 0) - coalesce(ma.calculated_stock, 0)) <> 0,
        'transfer_missing_qty', coalesce(tda.transfer_missing_qty, 0),
        'transfer_excess_qty', coalesce(tda.transfer_excess_qty, 0),
        'return_missing_qty', coalesce(rda.return_missing_qty, 0),
        'return_excess_qty', coalesce(rda.return_excess_qty, 0)
      ) order by bp.branch_name, bp.product_name
    ),
    '[]'::jsonb
  ) into v_result
  from branch_product_pairs bp
  left join movements_agg ma on ma.branch_id = bp.branch_id and ma.product_id = bp.product_id
  left join public.branch_inventory bi on bi.branch_id = bp.branch_id and bi.product_id = bp.product_id
  left join transfer_disc_agg tda on tda.branch_id = bp.branch_id and tda.product_id = bp.product_id
  left join return_disc_agg rda on rda.branch_id = bp.branch_id and rda.product_id = bp.product_id;

  return v_result;
end;
$$;

revoke all on function public.report_inventory_reconciliation(uuid) from public, anon;
grant execute on function public.report_inventory_reconciliation(uuid) to authenticated;

commit;
