-- Phase 4B: reporting + list RPC compatibility for exact 0.5 piece_stock quantities.
-- Disposable/local only until gates are deliberately activated. No production deploy from this phase.

begin;

-- ---------------------------------------------------------------------------
-- list_return_inventory: return numeric on-hand; include exact half-step balances
-- ---------------------------------------------------------------------------
drop function if exists public.list_return_inventory();
create function public.list_return_inventory()
returns table(
  product_id uuid,
  product_name text,
  product_sku text,
  is_active boolean,
  quantity_on_hand numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.name, p.sku, p.is_active, i.quantity_on_hand
  from public.branch_inventory i
  join public.products p on p.id = i.product_id
  where public.current_user_role() in ('manager', 'cashier')
    and i.branch_id = public.current_user_branch_id()
    and i.quantity_on_hand > 0
    and public.is_piece_half_step(i.quantity_on_hand)
    and (
      p.stock_unit_code is null
      or p.stock_unit_code not in ('half_egg', 'half_serving', 'quarter_serving')
      or i.quantity_on_hand = trunc(i.quantity_on_hand)
    )
    and not p.is_non_returnable
  order by p.name, p.id;
$$;

revoke all on function public.list_return_inventory() from public, anon;
grant execute on function public.list_return_inventory() to authenticated;

-- ---------------------------------------------------------------------------
-- report_inventory_reconciliation: preserve fractional discrepancy aggregates
-- ---------------------------------------------------------------------------
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
      coalesce(sum(td.difference) filter (where td.discrepancy_type = 'missing'), 0)::numeric(14,3) as transfer_missing_qty,
      coalesce(sum(abs(td.difference)) filter (where td.discrepancy_type = 'excess'), 0)::numeric(14,3) as transfer_excess_qty
    from public.transfer_discrepancies td
    join public.stock_transfers st on st.id = td.stock_transfer_id
    where td.status = 'open'
    group by st.to_branch_id, td.product_id
  ),
  return_disc_agg as (
    select sr.from_branch_id as branch_id, rd.product_id,
      coalesce(sum(rd.difference) filter (where rd.discrepancy_type = 'missing'), 0)::numeric(14,3) as return_missing_qty,
      coalesce(sum(abs(rd.difference)) filter (where rd.discrepancy_type = 'excess'), 0)::numeric(14,3) as return_excess_qty
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

-- Guard: list_return_inventory must not cast on-hand to bigint.
do $guard$
declare
  def text := pg_get_functiondef('public.list_return_inventory()'::regprocedure);
begin
  if position('quantity_on_hand::bigint' in def) > 0 then
    raise exception 'list_return_inventory still casts quantity_on_hand to bigint.';
  end if;
  if position('trunc(i.quantity_on_hand)' in def) > 0
     and position('or i.quantity_on_hand = trunc(i.quantity_on_hand)' in def) = 0 then
    raise exception 'list_return_inventory still truncates ordinary half-step balances.';
  end if;
end;
$guard$;

commit;
