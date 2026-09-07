begin;

-- Forward-only lint fix: keep the existing RPC contract and reporting rules,
-- but aggregate each metric at one query level before constructing JSON.
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
  v_transaction_count bigint;
  v_total_sales numeric(12,2);
  v_quantity_sold bigint;
  v_transfer_missing_qty bigint;
  v_transfer_excess_qty bigint;
  v_return_missing_qty bigint;
  v_return_excess_qty bigint;
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

  select b.id, b.name, b.is_active, b.is_main_branch
    into v_branch
  from public.branches b
  where b.id = p_branch_id;

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

  select count(*)::bigint,
         coalesce(sum(s.total_amount), 0)::numeric(12,2)
    into v_transaction_count, v_total_sales
  from public.sales s
  where s.branch_id = p_branch_id
    and s.status = 'completed'
    and (v_start is null or (s.sold_at >= v_start and s.sold_at < v_end));

  select coalesce(sum(si.quantity), 0)::bigint
    into v_quantity_sold
  from public.sale_items si
  join public.sales s on s.id = si.sale_id
  where s.branch_id = p_branch_id
    and s.status = 'completed'
    and (v_start is null or (s.sold_at >= v_start and s.sold_at < v_end));

  select
    coalesce(sum(td.difference) filter (where td.discrepancy_type = 'missing'), 0)::bigint,
    coalesce(sum(abs(td.difference)) filter (where td.discrepancy_type = 'excess'), 0)::bigint
    into v_transfer_missing_qty, v_transfer_excess_qty
  from public.transfer_discrepancies td
  join public.stock_transfers st on st.id = td.stock_transfer_id
  where st.to_branch_id = p_branch_id
    and (v_start is null or (td.created_at >= v_start and td.created_at < v_end));

  select
    coalesce(sum(rd.difference) filter (where rd.discrepancy_type = 'missing'), 0)::bigint,
    coalesce(sum(abs(rd.difference)) filter (where rd.discrepancy_type = 'excess'), 0)::bigint
    into v_return_missing_qty, v_return_excess_qty
  from public.return_discrepancies rd
  join public.stock_returns sr on sr.id = rd.stock_return_id
  where sr.from_branch_id = p_branch_id
    and (v_start is null or (rd.created_at >= v_start and rd.created_at < v_end));

  v_metrics := jsonb_build_object(
    'transaction_count', v_transaction_count,
    'total_sales', v_total_sales,
    'quantity_sold', v_quantity_sold,
    'transfer_missing_qty', v_transfer_missing_qty,
    'transfer_excess_qty', v_transfer_excess_qty,
    'return_missing_qty', v_return_missing_qty,
    'return_excess_qty', v_return_excess_qty,
    'total_missing_qty', v_transfer_missing_qty + v_return_missing_qty,
    'total_excess_qty', v_transfer_excess_qty + v_return_excess_qty
  );

  select coalesce(jsonb_agg(jsonb_build_object(
      'product_id', inventory.product_id,
      'product_name', inventory.product_name,
      'product_sku', inventory.product_sku,
      'quantity_on_hand', inventory.quantity_on_hand
    ) order by inventory.product_name), '[]'::jsonb)
    into v_inventory
  from (
    select p.id as product_id, p.name as product_name, p.sku as product_sku,
           coalesce(bi.quantity_on_hand, 0) as quantity_on_hand
    from public.products p
    left join public.branch_inventory bi
      on bi.product_id = p.id and bi.branch_id = p_branch_id
    where p.is_active
  ) inventory;

  with product_totals as (
    select p.id as product_id, p.name as product_name, p.sku as product_sku,
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
  select coalesce(jsonb_agg(jsonb_build_object(
      'product_id', pt.product_id,
      'product_name', pt.product_name,
      'product_sku', pt.product_sku,
      'quantity_sold', pt.quantity_sold,
      'total_revenue', pt.total_revenue
    ) order by pt.quantity_sold desc), '[]'::jsonb)
    into v_products_sold
  from product_totals pt;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', d.id,
      'stock_transfer_id', d.stock_transfer_id,
      'transfer_number', d.transfer_number,
      'product_id', d.product_id,
      'product_name', d.product_name,
      'product_sku', d.product_sku,
      'quantity_expected', d.quantity_expected,
      'quantity_received', d.quantity_received,
      'difference', d.difference,
      'discrepancy_type', d.discrepancy_type,
      'created_at', d.created_at,
      'notes', d.notes
    ) order by d.created_at desc), '[]'::jsonb)
    into v_transfer_disc
  from (
    select td.id, st.id as stock_transfer_id, st.transfer_number,
           p.id as product_id, p.name as product_name, p.sku as product_sku,
           td.quantity_expected, td.quantity_received, td.difference,
           td.discrepancy_type, td.created_at, td.notes
    from public.transfer_discrepancies td
    join public.stock_transfers st on st.id = td.stock_transfer_id
    join public.products p on p.id = td.product_id
    where st.to_branch_id = p_branch_id
      and (v_start is null or (td.created_at >= v_start and td.created_at < v_end))
  ) d;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', d.id,
      'stock_return_id', d.stock_return_id,
      'return_number', d.return_number,
      'product_id', d.product_id,
      'product_name', d.product_name,
      'product_sku', d.product_sku,
      'quantity_expected', d.quantity_expected,
      'quantity_received', d.quantity_received,
      'difference', d.difference,
      'discrepancy_type', d.discrepancy_type,
      'created_at', d.created_at,
      'notes', d.notes
    ) order by d.created_at desc), '[]'::jsonb)
    into v_return_disc
  from (
    select rd.id, sr.id as stock_return_id, sr.return_number,
           p.id as product_id, p.name as product_name, p.sku as product_sku,
           rd.quantity_expected, rd.quantity_received, rd.difference,
           rd.discrepancy_type, rd.created_at, rd.notes
    from public.return_discrepancies rd
    join public.stock_returns sr on sr.id = rd.stock_return_id
    join public.products p on p.id = rd.product_id
    where sr.from_branch_id = p_branch_id
      and (v_start is null or (rd.created_at >= v_start and rd.created_at < v_end))
  ) d;

  with recent as (
    select st.id, st.transfer_number, st.status, st.sent_at, st.received_at, st.created_at
    from public.stock_transfers st
    where st.to_branch_id = p_branch_id
    order by st.created_at desc
    limit 5
  ), item_counts as (
    select sti.stock_transfer_id, count(*)::bigint as items_count
    from public.stock_transfer_items sti
    join recent r on r.id = sti.stock_transfer_id
    group by sti.stock_transfer_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id,
      'transfer_number', r.transfer_number,
      'status', r.status,
      'sent_at', r.sent_at,
      'received_at', r.received_at,
      'items_count', coalesce(ic.items_count, 0)
    ) order by r.created_at desc), '[]'::jsonb)
    into v_recent_transfers
  from recent r
  left join item_counts ic on ic.stock_transfer_id = r.id;

  with recent as (
    select sr.id, sr.return_number, sr.status, sr.returned_at, sr.received_at, sr.created_at
    from public.stock_returns sr
    where sr.from_branch_id = p_branch_id
    order by sr.created_at desc
    limit 5
  ), item_counts as (
    select sri.stock_return_id, count(*)::bigint as items_count
    from public.stock_return_items sri
    join recent r on r.id = sri.stock_return_id
    group by sri.stock_return_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id,
      'return_number', r.return_number,
      'status', r.status,
      'returned_at', r.returned_at,
      'received_at', r.received_at,
      'items_count', coalesce(ic.items_count, 0)
    ) order by r.created_at desc), '[]'::jsonb)
    into v_recent_returns
  from recent r
  left join item_counts ic on ic.stock_return_id = r.id;

  return jsonb_build_object(
    'branch', jsonb_build_object('id', v_branch.id, 'name', v_branch.name),
    'metrics', v_metrics,
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

-- Preserve receive_stock_return behavior while avoiding an unread row variable:
-- only existence of an active Main Branch destination is required here.
do $migration$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'public.receive_stock_return(uuid,jsonb,text,text)'::regprocedure
  ) into v_definition;

  if position('v_target_branch  public.branches%rowtype;' in v_definition) = 0
     or position('select * into v_target_branch' in v_definition) = 0 then
    raise exception 'Unexpected receive_stock_return definition; refusing unsafe rewrite.';
  end if;

  v_definition := replace(
    v_definition,
    '  v_target_branch  public.branches%rowtype;' || chr(10),
    ''
  );
  v_definition := replace(
    v_definition,
    '  select * into v_target_branch' || chr(10) ||
    '  from public.branches' || chr(10) ||
    '  where id = v_return.to_branch_id and is_main_branch and is_active;',
    '  perform 1' || chr(10) ||
    '  from public.branches' || chr(10) ||
    '  where id = v_return.to_branch_id and is_main_branch and is_active;'
  );

  execute v_definition;
end;
$migration$;

revoke all on function public.receive_stock_return(uuid, jsonb, text, text) from public, anon;
grant execute on function public.receive_stock_return(uuid, jsonb, text, text) to authenticated;

commit;
