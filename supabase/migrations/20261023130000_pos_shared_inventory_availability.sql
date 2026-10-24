-- Shared inventory, Step 4: POS availability from product_stock_uses.
--
-- list_cashier_pos_inventory now also returns, per product and per variant, how many units can really be sold from
-- the branch's ingredient stock, plus the compact recipe data the POS needs to stop a cart from exceeding SHARED
-- stock (Egg, Rice, ...) across different products and variants.
--
-- New columns (appended; every existing column keeps its meaning, including quantity_on_hand = the product's OWN stock):
--   sellable_quantity  numeric  units of this product that can be sold now. No variants: from the product's lines.
--                              With variants: the most any single active variant can sell (0 when none can).
--   stock_uses         jsonb    { "product":          [ {ingredient_product_id, quantity}, ... ] | null,
--                                 "variants":         { "<branch variant id>": [lines...] | null, ... },
--                                 "ingredient_stock": { "<ingredient id>": on-hand at this branch, ... },
--                                 "ingredient_names": { "<ingredient id>": name, ... } }
--                              Lines are the EFFECTIVE recipe, resolved with the same rules as confirm_sale:
--                                variant lines -> product-level lines -> 1 unit of the product itself.
--   variants[].sellable_quantity  numeric  per-variant units sellable now (variants jsonb keeps id, name, selling_price).
--
-- The branch variant is mapped to its master variant by product id and case-insensitive name (as confirm_sale does).
-- A name that matches several master variants is AMBIGUOUS: confirm_sale refuses it, so here its lines are null and
-- its sellable_quantity is 0. Products without recipes are unchanged: their only line is 1 unit of themselves, so
-- sellable_quantity = quantity_on_hand exactly as before.
--
-- confirm_sale stays the FINAL stock authority; this is only the advance view the POS uses to limit the cart.
-- ADDITIVE: new helper functions, and list_cashier_pos_inventory is replaced (its return type grows, so it is
-- dropped and recreated with identical access rules and the same rows, order and existing columns).

begin;

-- ---------------------------------------------------------------------------
-- 1) pos_effective_stock_lines — the recipe a sold unit uses (same resolution as confirm_sale)
-- ---------------------------------------------------------------------------
create or replace function public.pos_effective_stock_lines(p_product_id uuid, p_variant_name text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_masters uuid[];
  v_lines jsonb;
begin
  if p_variant_name is not null then
    select array_agg(pv.id order by pv.id) into v_masters
    from public.product_variants pv
    where pv.product_id = p_product_id
      and lower(pv.name) = lower(p_variant_name);

    -- Ambiguous option name: confirm_sale refuses it, so it has no usable recipe here.
    if coalesce(cardinality(v_masters), 0) > 1 then
      return null;
    end if;

    if coalesce(cardinality(v_masters), 0) = 1 then
      select jsonb_agg(
        jsonb_build_object('ingredient_product_id', u.ingredient_product_id, 'quantity', u.quantity)
        order by u.ingredient_product_id
      )
      into v_lines
      from public.product_stock_uses u
      where u.product_id = p_product_id
        and u.variant_id = v_masters[1];
      if v_lines is not null then
        return v_lines;
      end if;
    end if;
  end if;

  select jsonb_agg(
    jsonb_build_object('ingredient_product_id', u.ingredient_product_id, 'quantity', u.quantity)
    order by u.ingredient_product_id
  )
  into v_lines
  from public.product_stock_uses u
  where u.product_id = p_product_id
    and u.variant_id is null;
  if v_lines is not null then
    return v_lines;
  end if;

  -- no recipe: the legacy rule, one unit of the sold product itself
  return jsonb_build_array(jsonb_build_object('ingredient_product_id', p_product_id, 'quantity', 1));
end;
$$;

-- ---------------------------------------------------------------------------
-- 2) pos_lines_sellable — how many units the branch's stock can supply for a set of lines
-- ---------------------------------------------------------------------------
create or replace function public.pos_lines_sellable(p_branch_id uuid, p_lines jsonb)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result numeric;
begin
  if p_lines is null or jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then
    return 0;
  end if;

  -- One line of quantity 1 (every product without a recipe): the stock itself, exactly as the POS always showed.
  if jsonb_array_length(p_lines) = 1 and (p_lines->0->>'quantity')::numeric = 1 then
    select coalesce(bi.quantity_on_hand, 0) into v_result
    from (select 1) one
    left join public.branch_inventory bi
      on bi.branch_id = p_branch_id
     and bi.product_id = (p_lines->0->>'ingredient_product_id')::uuid;
    return greatest(coalesce(v_result, 0), 0);
  end if;

  -- Otherwise the scarcest ingredient decides, in whole units.
  select coalesce(min(floor(coalesce(bi.quantity_on_hand, 0) / (e.value->>'quantity')::numeric)), 0)
  into v_result
  from jsonb_array_elements(p_lines) e
  left join public.branch_inventory bi
    on bi.branch_id = p_branch_id
   and bi.product_id = (e.value->>'ingredient_product_id')::uuid;
  return greatest(coalesce(v_result, 0), 0);
end;
$$;

revoke all on function public.pos_effective_stock_lines(uuid, text) from public, anon, authenticated;
revoke all on function public.pos_lines_sellable(uuid, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3) list_cashier_pos_inventory (Phase 2 rules and rows + sellable_quantity / stock_uses)
-- ---------------------------------------------------------------------------
drop function if exists public.list_cashier_pos_inventory();

create function public.list_cashier_pos_inventory()
returns table (
  branch_id uuid,
  branch_name text,
  product_id uuid,
  product_name text,
  product_sku text,
  selling_price numeric,
  quantity_on_hand numeric,
  updated_at timestamptz,
  variants jsonb,
  inventory_mode public.inventory_mode,
  sellable_quantity numeric,
  stock_uses jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user public.profiles%rowtype;
  v_branch_id uuid;
begin
  select * into v_user from public.profiles where id = auth.uid() and is_active;
  if not found or v_user.role is distinct from 'cashier' then
    raise exception 'Unauthorized: cashier access is required.' using errcode = '42501';
  end if;

  select s.branch_id into v_branch_id
  from public.shifts s
  where s.cashier_id = v_user.id and s.status = 'open'
  order by s.started_at desc
  limit 1;
  if v_branch_id is null then
    v_branch_id := v_user.branch_id;
  end if;
  if v_branch_id is null or v_branch_id is distinct from v_user.branch_id then
    raise exception 'No authorized branch is assigned to this cashier.' using errcode = '42501';
  end if;

  return query
  with cat as (
    select
      b.id as c_branch,
      b.name as c_branch_name,
      p.id as c_pid,
      p.name as c_pname,
      p.sku as c_sku,
      bp.selling_price as c_price,
      coalesce(bi.quantity_on_hand, 0) as c_qoh,
      coalesce(bi.updated_at, bp.updated_at) as c_upd,
      p.inventory_mode as c_mode
    from public.branch_products bp
    join public.products p on p.id = bp.product_id
    join public.branches b on b.id = bp.branch_id
    left join public.branch_inventory bi
      on bi.product_id = bp.product_id and bi.branch_id = bp.branch_id
    where bp.branch_id = v_branch_id
      and bp.is_active
      and p.is_active
      and b.is_active
      and not b.is_main_branch
  ),
  prod as (
    select c.*, public.pos_effective_stock_lines(c.c_pid, null) as c_lines
    from cat c
  ),
  var as (
    select
      c.c_pid as v_pid,
      bpv.id as v_id,
      bpv.name as v_name,
      bpv.selling_price as v_price,
      (
        select min(pv.sort_order)
        from public.product_variants pv
        where pv.product_id = bpv.product_id
          and lower(pv.name) = lower(bpv.name)
      ) as v_sort,
      public.pos_effective_stock_lines(bpv.product_id, bpv.name) as v_lines
    from cat c
    join public.branch_product_variants bpv
      on bpv.branch_id = c.c_branch
     and bpv.product_id = c.c_pid
     and bpv.is_active
  ),
  var_s as (
    select v.*, public.pos_lines_sellable(v_branch_id, v.v_lines) as v_sellable
    from var v
  ),
  ing as (
    select s.pid as i_pid, e.ing_id as i_ing
    from (
      select pr.c_pid as pid, pr.c_lines as lines from prod pr
      union all
      select v.v_pid, v.v_lines from var v
    ) s
    cross join lateral (
      select distinct (x.value->>'ingredient_product_id')::uuid as ing_id
      from jsonb_array_elements(coalesce(s.lines, '[]'::jsonb)) x
    ) e
  ),
  ing_stock as (
    select
      i.i_pid as s_pid,
      jsonb_object_agg(i.i_ing::text, coalesce(ibi.quantity_on_hand, 0)) as s_stock,
      jsonb_object_agg(i.i_ing::text, ip.name) as s_names
    from ing i
    join public.products ip on ip.id = i.i_ing
    left join public.branch_inventory ibi
      on ibi.branch_id = v_branch_id and ibi.product_id = i.i_ing
    group by i.i_pid
  )
  select
    c.c_branch,
    c.c_branch_name,
    c.c_pid,
    c.c_pname,
    c.c_sku,
    c.c_price,
    c.c_qoh,
    c.c_upd,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', v.v_id,
          'name', v.v_name,
          'selling_price', v.v_price,
          'sellable_quantity', v.v_sellable
        )
        order by coalesce(v.v_sort, 2147483647), v.v_name, v.v_id
      )
      from var_s v
      where v.v_pid = c.c_pid
    ), '[]'::jsonb),
    c.c_mode,
    case
      when exists (select 1 from var_s v where v.v_pid = c.c_pid)
        then (select max(v.v_sellable) from var_s v where v.v_pid = c.c_pid)
      else public.pos_lines_sellable(v_branch_id, c.c_lines)
    end,
    jsonb_build_object(
      'product', c.c_lines,
      'variants', coalesce((select jsonb_object_agg(v.v_id::text, v.v_lines) from var_s v where v.v_pid = c.c_pid), '{}'::jsonb),
      'ingredient_stock', coalesce(s.s_stock, '{}'::jsonb),
      'ingredient_names', coalesce(s.s_names, '{}'::jsonb)
    )
  from prod c
  left join ing_stock s on s.s_pid = c.c_pid
  order by c.c_pname, c.c_pid;
end;
$$;

revoke all on function public.list_cashier_pos_inventory() from public, anon;
grant execute on function public.list_cashier_pos_inventory() to authenticated;

comment on function public.list_cashier_pos_inventory() is
  'Cashier POS catalog for the open shift branch. quantity_on_hand is the product''s own stock; sellable_quantity and stock_uses (effective recipes + ingredient stock, branch variants mapped to master variants as confirm_sale does) let the POS limit carts by shared ingredient stock. confirm_sale remains the final stock authority.';

commit;
