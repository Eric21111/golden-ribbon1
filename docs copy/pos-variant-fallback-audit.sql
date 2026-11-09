-- READ-ONLY audit for the POS variant fallback fix (migration 20261026100000_pos_require_active_branch_variant.sql).
-- Run in the Supabase SQL editor, ONE QUERY AT A TIME (each is a single SELECT; nothing is changed).
-- Definitions used by the fix:
--   "has configured options"  = the product has ANY master option row (product_variants), active or not.
--   "affected"                = has configured options AND the branch has NO ACTIVE branch option (branch_product_variants).
--   state 'all options off'   = the branch has option rows, none active.   state 'no option rows' = the branch has none at all.

-- 1) HEADLINE: how many product/branch pairs are affected, split by state, and how many are on the cashier menu TODAY
--    (these are the ones that will disappear from the POS once the migration is applied).
with affected as (
  select bp.branch_id, bp.product_id, p.is_active, p.sell_in_pos, b.is_active as branch_active,
         (select count(*) from public.branch_product_variants v where v.branch_id = bp.branch_id and v.product_id = bp.product_id) as branch_option_rows
  from public.branch_products bp
  join public.products p on p.id = bp.product_id
  join public.branches b on b.id = bp.branch_id and not b.is_main_branch
  where bp.is_active
    and exists (select 1 from public.product_variants pv where pv.product_id = p.id)
    and not exists (select 1 from public.branch_product_variants v where v.branch_id = bp.branch_id and v.product_id = bp.product_id and v.is_active)
)
select case when branch_option_rows = 0 then 'no option rows' else 'all options off' end as state,
       count(*) as product_branch_pairs,
       count(*) filter (where is_active and sell_in_pos and branch_active) as on_cashier_menu_today
from affected
group by 1
order by 1;

-- 2) DETAIL: every affected product at every branch, with what it sells for today versus its options.
select b.name as branch, p.name as product, p.sku, p.is_active as product_enabled, p.sell_in_pos,
       (p.is_active and p.sell_in_pos and b.is_active) as on_cashier_menu_today,
       bp.selling_price as base_price_used_today,
       (select string_agg(pv.name || ' ' || pv.default_price::text || case when pv.is_active then '' else ' (retired)' end, ', ' order by pv.sort_order, pv.name)
          from public.product_variants pv where pv.product_id = p.id) as master_options_and_default_prices,
       (select string_agg(v.name || ' ' || v.selling_price::text || case when v.is_active then '' else ' (off)' end, ', ' order by v.name)
          from public.branch_product_variants v where v.branch_id = bp.branch_id and v.product_id = p.id) as branch_options,
       coalesce((select i.quantity_on_hand from public.branch_inventory i where i.branch_id = bp.branch_id and i.product_id = p.id), 0) as own_stock_at_branch
from public.branch_products bp
join public.products p on p.id = bp.product_id
join public.branches b on b.id = bp.branch_id and not b.is_main_branch
where bp.is_active
  and exists (select 1 from public.product_variants pv where pv.product_id = p.id)
  and not exists (select 1 from public.branch_product_variants v where v.branch_id = bp.branch_id and v.product_id = p.id and v.is_active)
order by b.name, p.name;

-- 3) HISTORY EXPOSURE: sales already made WITHOUT an option for a product that has configured options (these went through the
--    base-price fallback). They are NOT changed by the fix; this just sizes what happened.
select s.branch_id, b.name as branch, p.name as product,
       count(*) as sale_lines, sum(si.quantity) as units, sum(si.subtotal) as revenue,
       min(s.created_at) as first_sale, max(s.created_at) as last_sale
from public.sale_items si
join public.sales s on s.id = si.sale_id
join public.branches b on b.id = s.branch_id
join public.products p on p.id = si.product_id
where si.variant_id is null
  and exists (select 1 from public.product_variants pv where pv.product_id = si.product_id)
group by 1, 2, 3
order by last_sale desc;

-- 4) PRICE DRIFT: for products with options, the base price the fallback used versus the current ACTIVE option prices at that branch
--    (a base price that matches no option is the undercharge/overcharge risk).
select b.name as branch, p.name as product, bp.selling_price as base_price,
       min(v.selling_price) as lowest_active_option, max(v.selling_price) as highest_active_option,
       bool_or(v.selling_price = bp.selling_price) as base_equals_an_active_option
from public.branch_products bp
join public.products p on p.id = bp.product_id
join public.branches b on b.id = bp.branch_id and not b.is_main_branch
join public.branch_product_variants v on v.branch_id = bp.branch_id and v.product_id = bp.product_id and v.is_active
where bp.is_active
group by b.name, p.name, bp.selling_price
having not bool_or(v.selling_price = bp.selling_price)
order by 1, 2;

-- 5) OTHER ANOMALIES that interact with the rule (informational):
--    a) products whose master options are ALL inactive (still "has options" under the new rule, so they cannot bypass option selection);
--    b) active branch options with no matching master option name (orphans);
--    c) master options whose names collide ignoring case (confirm_sale already refuses these as ambiguous).
select 'a. master options all inactive' as finding, p.name as product, null::text as detail
from public.products p
where exists (select 1 from public.product_variants pv where pv.product_id = p.id)
  and not exists (select 1 from public.product_variants pv where pv.product_id = p.id and pv.is_active)
union all
select 'b. active branch option without a master option', p.name, b.name || ': ' || v.name
from public.branch_product_variants v
join public.products p on p.id = v.product_id
join public.branches b on b.id = v.branch_id
where v.is_active
  and not exists (select 1 from public.product_variants pv where pv.product_id = v.product_id and lower(pv.name) = lower(v.name))
union all
select 'c. master option names collide ignoring case', p.name, lower(pv.name)
from public.product_variants pv join public.products p on p.id = pv.product_id
group by p.name, lower(pv.name), pv.product_id
having count(*) > 1
order by 1, 2;

-- 6) BLAST RADIUS AT DEPLOY TIME: open shifts per branch (their carts may contain an affected product; the sale would then be
--    refused with "No option of ... is available at this branch." and the cashier removes the line).
select b.name as branch, count(*) as open_shifts
from public.shifts s join public.branches b on b.id = s.branch_id
where s.status = 'open'
group by 1
order by 1;

-- 7) RETIRED MASTER OPTIONS STILL ACTIVE AT A BRANCH: the master flag (product_variants.is_active) is only a template for branches that
--    receive the product LATER. A branch option that is switched on keeps being listed and sold even if its master option was retired.
--    This is how the system works today and the pending migration does not change it; this query shows where it applies.
select b.name as branch, p.name as product, pv.name as option_name, v.selling_price as branch_price,
       coalesce((select sum(si.quantity) from public.sale_items si where si.variant_id = v.id), 0) as units_sold_ever,
       (select max(s.created_at) from public.sale_items si join public.sales s on s.id = si.sale_id where si.variant_id = v.id) as last_sold
from public.product_variants pv
join public.products p on p.id = pv.product_id
join public.branch_product_variants v on v.product_id = pv.product_id and lower(v.name) = lower(pv.name)
join public.branches b on b.id = v.branch_id
where not pv.is_active and v.is_active
order by 1, 2, 3;
