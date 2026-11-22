-- Egg cutover report era fields for inventory reconciliation.
-- Install-only for display: does not change balances, recipes, or movement rows.
-- Splits unit_conversion from ordinary adjustments and returns cutover_at + pre/post
-- movement buckets so reports spanning the cutover do not mix incompatible units.

begin;

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
           p.inventory_mode as product_inventory_mode,
           p.stock_unit_code as product_stock_unit_code,
           c.cutover_at as stock_unit_cutover_at
    from active_branches b
    cross join public.products p
    left join public.stock_unit_cutovers c
      on c.product_id = p.id and c.rolled_back_at is null
    where p.is_active
       or exists (select 1 from public.branch_inventory bi where bi.branch_id = b.id and bi.product_id = p.id)
       or exists (select 1 from public.inventory_movements im where im.branch_id = b.id and im.product_id = p.id)
  ),
  movements_agg as (
    select
      im.branch_id,
      im.product_id,
      coalesce(sum(im.quantity) filter (where im.movement_type = 'opening_stock'), 0)::numeric(14,3) as opening_stock,
      coalesce(abs(sum(im.quantity) filter (where im.movement_type = 'transfer_out')), 0)::numeric(14,3) as transfer_out,
      coalesce(sum(im.quantity) filter (where im.movement_type = 'transfer_in'), 0)::numeric(14,3) as transfer_in,
      coalesce(abs(sum(im.quantity) filter (where im.movement_type = 'sale')), 0)::numeric(14,3) as sale,
      coalesce(abs(sum(im.quantity) filter (where im.movement_type = 'return_out')), 0)::numeric(14,3) as return_out,
      coalesce(sum(im.quantity) filter (where im.movement_type = 'return_in'), 0)::numeric(14,3) as return_in,
      -- Ordinary adjustments only (opening adds, corrections). Unit conversion is separate.
      coalesce(sum(im.quantity) filter (
        where im.movement_type = 'adjustment' and im.reference_type is distinct from 'unit_conversion'
      ), 0)::numeric(14,3) as adjustment,
      coalesce(sum(im.quantity) filter (
        where im.movement_type = 'adjustment' and im.reference_type = 'unit_conversion'
      ), 0)::numeric(14,3) as unit_conversion,
      coalesce(sum(im.quantity), 0)::numeric(14,3) as calculated_stock,
      (array_agg(im.inventory_mode order by im.created_at desc, im.id desc))[1] as latest_inventory_mode,
      -- Era splits (used when stock_unit_cutover_at is set).
      coalesce(sum(im.quantity) filter (
        where im.movement_type = 'opening_stock'
          and (bp.stock_unit_cutover_at is null or im.created_at < bp.stock_unit_cutover_at)
      ), 0)::numeric(14,3) as opening_stock_pre,
      coalesce(sum(im.quantity) filter (
        where im.movement_type = 'opening_stock'
          and bp.stock_unit_cutover_at is not null and im.created_at >= bp.stock_unit_cutover_at
      ), 0)::numeric(14,3) as opening_stock_post,
      coalesce(abs(sum(im.quantity) filter (
        where im.movement_type = 'transfer_out'
          and (bp.stock_unit_cutover_at is null or im.created_at < bp.stock_unit_cutover_at)
      )), 0)::numeric(14,3) as transfer_out_pre,
      coalesce(abs(sum(im.quantity) filter (
        where im.movement_type = 'transfer_out'
          and bp.stock_unit_cutover_at is not null and im.created_at >= bp.stock_unit_cutover_at
      )), 0)::numeric(14,3) as transfer_out_post,
      coalesce(sum(im.quantity) filter (
        where im.movement_type = 'transfer_in'
          and (bp.stock_unit_cutover_at is null or im.created_at < bp.stock_unit_cutover_at)
      ), 0)::numeric(14,3) as transfer_in_pre,
      coalesce(sum(im.quantity) filter (
        where im.movement_type = 'transfer_in'
          and bp.stock_unit_cutover_at is not null and im.created_at >= bp.stock_unit_cutover_at
      ), 0)::numeric(14,3) as transfer_in_post,
      coalesce(abs(sum(im.quantity) filter (
        where im.movement_type = 'sale'
          and (bp.stock_unit_cutover_at is null or im.created_at < bp.stock_unit_cutover_at)
      )), 0)::numeric(14,3) as sale_pre,
      coalesce(abs(sum(im.quantity) filter (
        where im.movement_type = 'sale'
          and bp.stock_unit_cutover_at is not null and im.created_at >= bp.stock_unit_cutover_at
      )), 0)::numeric(14,3) as sale_post,
      coalesce(abs(sum(im.quantity) filter (
        where im.movement_type = 'return_out'
          and (bp.stock_unit_cutover_at is null or im.created_at < bp.stock_unit_cutover_at)
      )), 0)::numeric(14,3) as return_out_pre,
      coalesce(abs(sum(im.quantity) filter (
        where im.movement_type = 'return_out'
          and bp.stock_unit_cutover_at is not null and im.created_at >= bp.stock_unit_cutover_at
      )), 0)::numeric(14,3) as return_out_post,
      coalesce(sum(im.quantity) filter (
        where im.movement_type = 'return_in'
          and (bp.stock_unit_cutover_at is null or im.created_at < bp.stock_unit_cutover_at)
      ), 0)::numeric(14,3) as return_in_pre,
      coalesce(sum(im.quantity) filter (
        where im.movement_type = 'return_in'
          and bp.stock_unit_cutover_at is not null and im.created_at >= bp.stock_unit_cutover_at
      ), 0)::numeric(14,3) as return_in_post,
      coalesce(sum(im.quantity) filter (
        where im.movement_type = 'adjustment'
          and im.reference_type is distinct from 'unit_conversion'
          and (bp.stock_unit_cutover_at is null or im.created_at < bp.stock_unit_cutover_at)
      ), 0)::numeric(14,3) as adjustment_pre,
      coalesce(sum(im.quantity) filter (
        where im.movement_type = 'adjustment'
          and im.reference_type is distinct from 'unit_conversion'
          and bp.stock_unit_cutover_at is not null and im.created_at >= bp.stock_unit_cutover_at
      ), 0)::numeric(14,3) as adjustment_post
    from public.inventory_movements im
    join branch_product_pairs bp on bp.branch_id = im.branch_id and bp.product_id = im.product_id
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
    'stock_unit_code', bp.product_stock_unit_code,
    'stock_unit_cutover_at', bp.stock_unit_cutover_at,
    'inventory_mode', coalesce(ma.latest_inventory_mode, bp.product_inventory_mode),
    'opening_stock', coalesce(ma.opening_stock, 0),
    'transfer_out', coalesce(ma.transfer_out, 0),
    'transfer_in', coalesce(ma.transfer_in, 0),
    'sale', coalesce(ma.sale, 0),
    'return_out', coalesce(ma.return_out, 0),
    'return_in', coalesce(ma.return_in, 0),
    'adjustment', coalesce(ma.adjustment, 0),
    'unit_conversion', coalesce(ma.unit_conversion, 0),
    'adjustment_pre', coalesce(ma.adjustment_pre, 0),
    'adjustment_post', coalesce(ma.adjustment_post, 0),
    'opening_stock_pre', coalesce(ma.opening_stock_pre, 0),
    'opening_stock_post', coalesce(ma.opening_stock_post, 0),
    'transfer_out_pre', coalesce(ma.transfer_out_pre, 0),
    'transfer_out_post', coalesce(ma.transfer_out_post, 0),
    'transfer_in_pre', coalesce(ma.transfer_in_pre, 0),
    'transfer_in_post', coalesce(ma.transfer_in_post, 0),
    'sale_pre', coalesce(ma.sale_pre, 0),
    'sale_post', coalesce(ma.sale_post, 0),
    'return_out_pre', coalesce(ma.return_out_pre, 0),
    'return_out_post', coalesce(ma.return_out_post, 0),
    'return_in_pre', coalesce(ma.return_in_pre, 0),
    'return_in_post', coalesce(ma.return_in_post, 0),
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

comment on function public.report_inventory_reconciliation(uuid) is
  'Owner inventory recon. Variance math unchanged. unit_conversion is separate from adjustment; pre/post buckets support Egg cutover-era labeling.';

commit;
