-- Drink Choice, Step 5: POS availability for meals with a drink.
--
-- list_cashier_pos_inventory (same columns, same rows, same access) now also reports, per variant, its eligible drinks
-- and counts drink stock in availability:
--   stock_uses.drinks            { "<branch variant id>": ["<drink product id>", ...] }  (only options that include a drink)
--   stock_uses.ingredient_stock  now also holds each eligible drink's stock at this branch (and its name)
--   variants[].sellable_quantity = the lesser of what the meal's ingredients allow and the total stock of its eligible
--                                  drinks (the cashier picks one drink per meal), so a meal whose drinks are all out
--                                  of stock is not offered as sellable
-- Options are paired with their master variant by product and case-insensitive name, exactly as confirm_sale does.
-- Only ACTIVE drinks are offered. If an option includes drinks but none is active, or its name is ambiguous, it is not
-- sellable (confirm_sale would refuse it). Products and options without Drink Choice are unchanged.
-- ADDITIVE: a new internal helper and create or replace of one function (its return type is unchanged).

begin;

create or replace function public.pos_variant_drink_ids(p_product_id uuid, p_variant_name text)
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_masters uuid[];
  v_configured integer;
  v_ids uuid[];
begin
  select array_agg(pv.id order by pv.id) into v_masters
  from public.product_variants pv
  where pv.product_id = p_product_id
    and lower(pv.name) = lower(p_variant_name);

  -- ambiguous option name: confirm_sale refuses it, so there are no usable drinks
  if coalesce(cardinality(v_masters), 0) > 1 then
    return null;
  end if;
  -- no master variant: the option has no drink choice of its own
  if coalesce(cardinality(v_masters), 0) = 0 then
    return '{}'::uuid[];
  end if;

  select count(*) into v_configured
  from public.product_drink_choices d
  where d.variant_id = v_masters[1] and d.product_id = p_product_id;
  if v_configured = 0 then
    return '{}'::uuid[];
  end if;

  select array_agg(d.drink_product_id order by d.drink_product_id) into v_ids
  from public.product_drink_choices d
  join public.products p on p.id = d.drink_product_id and p.is_active
  where d.variant_id = v_masters[1] and d.product_id = p_product_id;

  -- configured but none active: null = cannot be sold
  return v_ids;
end;
$$;

revoke all on function public.pos_variant_drink_ids(uuid, text) from public, anon, authenticated;

create or replace function public.list_cashier_pos_inventory()
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
      public.pos_effective_stock_lines(bpv.product_id, bpv.name) as v_lines,
      public.pos_variant_drink_ids(bpv.product_id, bpv.name) as v_drinks
    from cat c
    join public.branch_product_variants bpv
      on bpv.branch_id = c.c_branch
     and bpv.product_id = c.c_pid
     and bpv.is_active
  ),
  var_s as (
    select
      v.*,
      case
        -- configured drinks but none can be sold: the option cannot be sold at all
        when v.v_drinks is null and v.v_lines is not null and exists (
          select 1
          from public.product_drink_choices dc
          join public.product_variants dpv on dpv.id = dc.variant_id
          where dc.product_id = v.v_pid and lower(dpv.name) = lower(v.v_name)
        ) then 0
        when v.v_drinks is null or cardinality(v.v_drinks) = 0
          then public.pos_lines_sellable(v_branch_id, v.v_lines)
        else least(
          public.pos_lines_sellable(v_branch_id, v.v_lines),
          (
            select coalesce(sum(floor(coalesce(dbi.quantity_on_hand, 0))), 0)
            from unnest(v.v_drinks) as d(drink_id)
            left join public.branch_inventory dbi
              on dbi.branch_id = v_branch_id and dbi.product_id = d.drink_id
          )
        )
      end as v_sellable
    from var v
  ),
  ing as (
    select s.pid as i_pid, e.ing_id as i_ing
    from (
      select pr.c_pid as pid, pr.c_lines as lines from prod pr
      union all
      select v.v_pid, v.v_lines from var v
      union all
      select v.v_pid, (
        select jsonb_agg(jsonb_build_object('ingredient_product_id', d.drink_id, 'quantity', 1))
        from unnest(coalesce(v.v_drinks, '{}'::uuid[])) as d(drink_id)
      )
      from var v
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
      'drinks', coalesce((
        select jsonb_object_agg(v.v_id::text, to_jsonb(v.v_drinks))
        from var_s v
        where v.v_pid = c.c_pid and v.v_drinks is not null and cardinality(v.v_drinks) > 0
      ), '{}'::jsonb),
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
  'Cashier POS catalog for the open shift branch. quantity_on_hand is the product''s own stock; sellable_quantity and stock_uses (effective recipes, eligible drinks per option, ingredient and drink stock; branch variants mapped to master variants as confirm_sale does) let the POS limit carts by shared stock. confirm_sale remains the final stock authority.';

commit;
