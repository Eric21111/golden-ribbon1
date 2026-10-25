-- Inventory-only products (meal components such as Rice or Egg).
--
-- sell_in_pos is independent of is_active. Existing products default to sold in POS, with their prices unchanged.
-- A stock-only product has no selling price (NULL, never 0) and is omitted from the cashier catalog. It can still
-- be stocked, transferred, and used by several meals or add-ons through product_stock_uses. Stock and movements
-- are not rewritten.
--
-- ADDITIVE. Does not replace create_complete_product, update_complete_product, or the sale RPC.

begin;

alter table public.products
  add column if not exists sell_in_pos boolean not null default true;

alter table public.products alter column selling_price drop not null;

alter table public.products drop constraint products_selling_price_check;

alter table public.products
  add constraint products_selling_price_check
  check (selling_price is null or selling_price >= 0);

alter table public.products
  add constraint products_sell_in_pos_requires_price
  check (sell_in_pos = false or selling_price is not null);

comment on column public.products.sell_in_pos is
  'When false the product is stock only: no POS price is required, and cashiers cannot sell it. Stock, transfers, and meal components still use it. Independent of is_active.';

-- ---------------------------------------------------------------------------
-- Create / update a stock-only product. No catalog price is written.
-- ---------------------------------------------------------------------------
create function public.create_inventory_product(
  p_name text,
  p_sku text,
  p_description text,
  p_closing_stock_behavior text default 'keep_at_branch'
)
returns public.products
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.products%rowtype;
  v_name text := trim(coalesce(p_name, ''));
  v_sku text := upper(trim(coalesce(p_sku, '')));
  v_description text := nullif(trim(coalesce(p_description, '')), '');
  v_closing text := btrim(coalesce(p_closing_stock_behavior, 'keep_at_branch'));
begin
  if not public.is_main_branch_manager() then
    raise exception 'Unauthorized: Main Branch Manager access is required.' using errcode = '42501';
  end if;
  if char_length(v_name) not between 2 and 120 then
    raise exception 'Product name must be 2 to 120 characters.' using errcode = '22023';
  end if;
  if v_sku !~ '^[A-Z0-9-]{2,40}$' then
    raise exception 'SKU must be 2 to 40 letters, numbers, or hyphens.' using errcode = '22023';
  end if;
  if v_description is not null and char_length(v_description) > 500 then
    raise exception 'Description must be 500 characters or fewer.' using errcode = '22023';
  end if;
  if v_closing not in ('keep_at_branch', 'record_as_unsold') then
    raise exception 'Closing stock behavior must be keep_at_branch or record_as_unsold.' using errcode = '22023';
  end if;

  insert into public.products(
    name, sku, description, selling_price, is_active, inventory_mode, closing_stock_behavior, sell_in_pos
  ) values (
    v_name, v_sku, v_description, null, false, 'piece_stock', v_closing::public.closing_stock_behavior, false
  )
  returning * into v_product;

  return v_product;
end;
$$;

revoke all on function public.create_inventory_product(text, text, text, text) from public, anon;
grant execute on function public.create_inventory_product(text, text, text, text) to authenticated;

create function public.update_inventory_product(
  p_product_id uuid,
  p_name text,
  p_sku text,
  p_description text,
  p_is_active boolean,
  p_closing_stock_behavior text default null
)
returns public.products
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.products%rowtype;
  v_name text := trim(coalesce(p_name, ''));
  v_sku text := upper(trim(coalesce(p_sku, '')));
  v_description text := nullif(trim(coalesce(p_description, '')), '');
  v_closing text := nullif(btrim(coalesce(p_closing_stock_behavior, '')), '');
begin
  if not public.is_main_branch_manager() then
    raise exception 'Unauthorized: Main Branch Manager access is required.' using errcode = '42501';
  end if;
  if char_length(v_name) not between 2 and 120 then
    raise exception 'Product name must be 2 to 120 characters.' using errcode = '22023';
  end if;
  if v_sku !~ '^[A-Z0-9-]{2,40}$' then
    raise exception 'SKU must be 2 to 40 letters, numbers, or hyphens.' using errcode = '22023';
  end if;
  if v_description is not null and char_length(v_description) > 500 then
    raise exception 'Description must be 500 characters or fewer.' using errcode = '22023';
  end if;
  if v_closing is not null and v_closing not in ('keep_at_branch', 'record_as_unsold') then
    raise exception 'Closing stock behavior must be keep_at_branch or record_as_unsold.' using errcode = '22023';
  end if;

  update public.products
  set name = v_name,
      sku = v_sku,
      description = v_description,
      is_active = coalesce(p_is_active, is_active),
      closing_stock_behavior = coalesce(v_closing::public.closing_stock_behavior, closing_stock_behavior),
      sell_in_pos = false
  where id = p_product_id
  returning * into v_product;

  if not found then
    raise exception 'Product is missing.' using errcode = '22023';
  end if;
  return v_product;
end;
$$;

revoke all on function public.update_inventory_product(uuid, text, text, text, boolean, text) from public, anon;
grant execute on function public.update_inventory_product(uuid, text, text, text, boolean, text) to authenticated;

create function public.set_product_sell_in_pos(
  p_product_id uuid,
  p_sell_in_pos boolean
)
returns public.products
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.products%rowtype;
  v_flag boolean := coalesce(p_sell_in_pos, true);
begin
  if not public.is_main_branch_manager() then
    raise exception 'Unauthorized: Main Branch Manager access is required.' using errcode = '42501';
  end if;

  select * into v_product from public.products where id = p_product_id for update;
  if not found then
    raise exception 'Product is missing.' using errcode = '22023';
  end if;
  if v_flag and v_product.selling_price is null then
    raise exception 'Enter a selling price before selling this in POS.' using errcode = '22023';
  end if;

  update public.products
  set sell_in_pos = v_flag
  where id = p_product_id
  returning * into v_product;
  return v_product;
end;
$$;

revoke all on function public.set_product_sell_in_pos(uuid, boolean) from public, anon;
grant execute on function public.set_product_sell_in_pos(uuid, boolean) to authenticated;

-- A transfer must not invent a POS price. Stock-only products skip catalog seeding.
create or replace function public.seed_branch_catalog(
  p_branch_id uuid,
  p_product_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.products%rowtype;
  v_branch_product public.branch_products%rowtype;
begin
  select * into v_product from public.products where id = p_product_id;
  if not found then
    raise exception 'Product is missing or inactive.' using errcode = '22023';
  end if;

  if not v_product.sell_in_pos or v_product.selling_price is null then
    return;
  end if;

  select * into v_branch_product
  from public.branch_products
  where branch_id = p_branch_id and product_id = p_product_id
  for update;

  if not found then
    insert into public.branch_products(branch_id, product_id, selling_price, is_active)
    values (p_branch_id, p_product_id, v_product.selling_price, true);

    insert into public.branch_product_variants(
      branch_id, product_id, name, selling_price, is_active
    )
    select p_branch_id, p_product_id, pv.name, pv.default_price, true
    from public.product_variants pv
    where pv.product_id = p_product_id and pv.is_active
    on conflict (branch_id, product_id, name) do nothing;
  elsif not v_branch_product.is_active then
    update public.branch_products
    set is_active = true
    where branch_id = p_branch_id and product_id = p_product_id;
  end if;
end;
$$;

revoke all on function public.seed_branch_catalog(uuid, uuid) from public, anon, authenticated;

-- Active drinks stay eligible for a meal even when they are not sold on their own.
-- Standalone POS still omits sell_in_pos = false (see list_cashier_pos_inventory).
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

  if coalesce(cardinality(v_masters), 0) > 1 then
    return null;
  end if;
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

  return v_ids;
end;
$$;

revoke all on function public.pos_variant_drink_ids(uuid, text) from public, anon, authenticated;

-- Hide stock-only products from the cashier catalog. Ingredient stock is still reported on meals that use them.
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
      and p.sell_in_pos
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
  'Cashier POS catalog for the open shift branch. Products with sell_in_pos false are omitted as standalone items. Their stock can still fill a meal Drink Choice or a recipe.';

-- A standalone line for a stock-only product is refused. A drink chosen inside a meal may be sell_in_pos false:
-- it is not charged on its own, and its stock is deducted with the meal.
create function public.reject_unsellable_sale_line()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  if exists (select 1 from public.products p where p.id = new.product_id and not p.sell_in_pos) then
    select name into v_name from public.products where id = new.product_id;
    raise exception '% is not sold in POS.', coalesce(v_name, 'This item') using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke all on function public.reject_unsellable_sale_line() from public, anon, authenticated;

drop trigger if exists sale_items_reject_unsellable on public.sale_items;
create trigger sale_items_reject_unsellable
before insert on public.sale_items
for each row execute function public.reject_unsellable_sale_line();

commit;
