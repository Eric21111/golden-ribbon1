-- READ ONLY. Select statements only: nothing here changes data. Run in the Supabase SQL editor.
--
-- Which products have NO stock of their own to count (the Opening stock screen leaves them out), judged from the saved recipes
-- by the same rule the app uses and the database uses when a sale is confirmed:
--   * a product with options is sold through each option; a product without options is sold as itself
--   * a sale takes: the option's own list, else the product-level list, else the product itself x1
--   * a product is "shared" when NO sale path takes its own stock, at least one other product is taken from, nobody else
--     needs it (it is not another product's ingredient and not offered as a drink choice), and it is sold in the POS

-- 1. The products Opening stock leaves out, and what they take from
with paths as (
  select p.id as product_id, p.name, pv.id as variant_id
  from public.products p
  left join public.product_variants pv on pv.product_id = p.id
  where p.sell_in_pos is distinct from false
),
used as (
  -- the list each path really takes from (none = the product itself x1)
  select pa.product_id, pa.variant_id, l.ingredient_product_id
  from paths pa
  left join lateral (
    select u.ingredient_product_id
    from public.product_stock_uses u
    where u.product_id = pa.product_id
      and u.variant_id is not distinct from (
        case
          when pa.variant_id is not null
            and exists (select 1 from public.product_stock_uses own where own.product_id = pa.product_id and own.variant_id = pa.variant_id)
          then pa.variant_id
          else null
        end
      )
  ) l on true
),
per_path as (
  select product_id, variant_id,
         bool_or(ingredient_product_id is null or ingredient_product_id = product_id) as takes_own_stock
  from used
  group by product_id, variant_id
),
needed_by_others as (
  select ingredient_product_id as product_id from public.product_stock_uses where ingredient_product_id <> product_id
  union
  select drink_product_id from public.product_drink_choices where drink_product_id <> product_id
),
per_product as (
  select product_id, bool_or(takes_own_stock) as takes_own_stock
  from per_path
  group by product_id
)
select p.name as product,
       p.sku,
       (select string_agg(distinct src.name, ', ' order by src.name)
          from public.product_stock_uses u
          join public.products src on src.id = u.ingredient_product_id
         where u.product_id = p.id and u.ingredient_product_id <> p.id) as takes_stock_from,
       coalesce(bi.quantity_on_hand, 0) as own_balance_at_main
from per_product pp
join public.products p on p.id = pp.product_id
left join public.branches mb on mb.is_main_branch and mb.is_active
left join public.branch_inventory bi on bi.branch_id = mb.id and bi.product_id = p.id
where not pp.takes_own_stock
  and exists (select 1 from public.product_stock_uses u where u.product_id = p.id and u.ingredient_product_id <> p.id)
  and not exists (select 1 from needed_by_others n where n.product_id = p.id)
order by p.name;
