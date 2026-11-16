begin;

-- Owner inventory reconciliation: active audit qty from open discrepancies only.
-- Resolved discrepancies remain historical, with reason/note returned for product cards.

create or replace function public.report_inventory_reconciliation(p_branch_id uuid default null)
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

  with active_branches as (
    select b.id, b.name
    from public.branches b
    where b.is_active and (p_branch_id is null or b.id = p_branch_id)
  ),
  branch_product_pairs as (
    select b.id as branch_id, b.name as branch_name,
           p.id as product_id, p.name as product_name, p.sku as product_sku,
           p.inventory_mode as product_inventory_mode
    from active_branches b
    cross join public.products p
    where p.is_active
       or exists (select 1 from public.branch_inventory bi where bi.branch_id = b.id and bi.product_id = p.id)
       or exists (select 1 from public.inventory_movements im where im.branch_id = b.id and im.product_id = p.id)
  ),
  movements_agg as (
    select im.branch_id, im.product_id,
      coalesce(sum(im.quantity) filter (where im.movement_type = 'opening_stock'), 0)::numeric(14,3) as opening_stock,
      coalesce(abs(sum(im.quantity) filter (where im.movement_type = 'transfer_out')), 0)::numeric(14,3) as transfer_out,
      coalesce(sum(im.quantity) filter (where im.movement_type = 'transfer_in'), 0)::numeric(14,3) as transfer_in,
      coalesce(abs(sum(im.quantity) filter (where im.movement_type = 'sale')), 0)::numeric(14,3) as sale,
      coalesce(abs(sum(im.quantity) filter (where im.movement_type = 'return_out')), 0)::numeric(14,3) as return_out,
      coalesce(sum(im.quantity) filter (where im.movement_type = 'return_in'), 0)::numeric(14,3) as return_in,
      coalesce(sum(im.quantity) filter (where im.movement_type = 'adjustment'), 0)::numeric(14,3) as adjustment,
      coalesce(sum(im.quantity), 0)::numeric(14,3) as calculated_stock,
      (array_agg(im.inventory_mode order by im.created_at desc, im.id desc))[1] as latest_inventory_mode
    from public.inventory_movements im
    group by im.branch_id, im.product_id
  ),
  transfer_disc_agg as (
    select st.to_branch_id as branch_id, td.product_id,
      coalesce(sum(td.difference) filter (where td.discrepancy_type = 'missing'), 0)::bigint as transfer_missing_qty,
      coalesce(sum(abs(td.difference)) filter (where td.discrepancy_type = 'excess'), 0)::bigint as transfer_excess_qty
    from public.transfer_discrepancies td
    join public.stock_transfers st on st.id = td.stock_transfer_id
    where td.status = 'open'
    group by st.to_branch_id, td.product_id
  ),
  return_disc_agg as (
    select sr.from_branch_id as branch_id, rd.product_id,
      coalesce(sum(rd.difference) filter (where rd.discrepancy_type = 'missing'), 0)::bigint as return_missing_qty,
      coalesce(sum(abs(rd.difference)) filter (where rd.discrepancy_type = 'excess'), 0)::bigint as return_excess_qty
    from public.return_discrepancies rd
    join public.stock_returns sr on sr.id = rd.stock_return_id
    where rd.status = 'open'
    group by sr.from_branch_id, rd.product_id
  ),
  resolved_disc_rows as (
    select
      sr.from_branch_id as branch_id,
      rd.product_id,
      rd.resolved_at,
      jsonb_build_object(
        'kind', 'return',
        'id', rd.id,
        'discrepancy_type', rd.discrepancy_type,
        'difference', rd.difference,
        'resolution_reason', rd.resolution_reason,
        'resolution_note', rd.resolution_note,
        'resolved_at', rd.resolved_at
      ) as item
    from public.return_discrepancies rd
    join public.stock_returns sr on sr.id = rd.stock_return_id
    where rd.status = 'resolved'
    union all
    select
      st.to_branch_id as branch_id,
      td.product_id,
      td.resolved_at,
      jsonb_build_object(
        'kind', 'transfer',
        'id', td.id,
        'discrepancy_type', td.discrepancy_type,
        'difference', td.difference,
        'resolution_reason', td.resolution_reason,
        'resolution_note', td.resolution_note,
        'resolved_at', td.resolved_at
      ) as item
    from public.transfer_discrepancies td
    join public.stock_transfers st on st.id = td.stock_transfer_id
    where td.status = 'resolved'
  ),
  resolved_disc_agg as (
    select
      branch_id,
      product_id,
      coalesce(jsonb_agg(item order by resolved_at desc nulls last), '[]'::jsonb) as resolved_discrepancies
    from resolved_disc_rows
    group by branch_id, product_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'branch_id', bp.branch_id,
    'branch_name', bp.branch_name,
    'product_id', bp.product_id,
    'product_name', bp.product_name,
    'product_sku', bp.product_sku,
    'inventory_mode', coalesce(ma.latest_inventory_mode, bp.product_inventory_mode),
    'opening_stock', coalesce(ma.opening_stock, 0),
    'transfer_out', coalesce(ma.transfer_out, 0),
    'transfer_in', coalesce(ma.transfer_in, 0),
    'sale', coalesce(ma.sale, 0),
    'return_out', coalesce(ma.return_out, 0),
    'return_in', coalesce(ma.return_in, 0),
    'adjustment', coalesce(ma.adjustment, 0),
    'calculated_stock', coalesce(ma.calculated_stock, 0),
    'current_stock', coalesce(bi.quantity_on_hand, 0),
    'variance', coalesce(bi.quantity_on_hand, 0) - coalesce(ma.calculated_stock, 0),
    'has_reconciliation_issue', coalesce(bi.quantity_on_hand, 0) <> coalesce(ma.calculated_stock, 0),
    'transfer_missing_qty', coalesce(tda.transfer_missing_qty, 0),
    'transfer_excess_qty', coalesce(tda.transfer_excess_qty, 0),
    'return_missing_qty', coalesce(rda.return_missing_qty, 0),
    'return_excess_qty', coalesce(rda.return_excess_qty, 0),
    'resolved_discrepancies', coalesce(res.resolved_discrepancies, '[]'::jsonb)
  ) order by bp.branch_name, bp.product_name), '[]'::jsonb)
  into v_result
  from branch_product_pairs bp
  left join movements_agg ma on ma.branch_id = bp.branch_id and ma.product_id = bp.product_id
  left join public.branch_inventory bi on bi.branch_id = bp.branch_id and bi.product_id = bp.product_id
  left join transfer_disc_agg tda on tda.branch_id = bp.branch_id and tda.product_id = bp.product_id
  left join return_disc_agg rda on rda.branch_id = bp.branch_id and rda.product_id = bp.product_id
  left join resolved_disc_agg res on res.branch_id = bp.branch_id and res.product_id = bp.product_id;

  return v_result;
end;
$$;

revoke all on function public.report_inventory_reconciliation(uuid) from public, anon;
grant execute on function public.report_inventory_reconciliation(uuid) to authenticated;

commit;
