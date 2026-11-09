-- PCS cutover closing_stock_behavior review (read-only)
-- Run before the first PCS selling session after cutover.
-- Reviews EVERY snapshot row (not active-only).
--
-- Provisional mapping at cutover:
--   former piece_stock → keep_at_branch
--   former kg_meal     → record_as_unsold
--
-- Correct live products.closing_stock_behavior via Manager Products / update_complete_product
-- when the provisional mapping does not match real booth handling.

select
  s.product_id,
  s.product_name_snapshot,
  s.sku_snapshot,
  s.former_inventory_mode::text as former_inventory_mode,
  s.former_is_active,
  s.assigned_closing_stock_behavior::text as provisional_closing_stock_behavior,
  p.name as live_name,
  p.sku as live_sku,
  p.is_active as live_is_active,
  p.inventory_mode::text as live_inventory_mode,
  p.closing_stock_behavior::text as live_closing_stock_behavior,
  case
    when p.closing_stock_behavior is distinct from s.assigned_closing_stock_behavior
      then 'CHANGED_SINCE_CUTOVER'
    else 'MATCHES_PROVISIONAL'
  end as review_status
from public.pcs_cutover_product_snapshots s
left join public.products p on p.id = s.product_id
order by s.sku_snapshot, s.product_id;
