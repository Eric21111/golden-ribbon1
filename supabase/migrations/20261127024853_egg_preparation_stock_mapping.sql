-- Reviewed menu correction, scoped to the existing production product IDs.
-- No stock conversion, stock creation, sales rewrite, or price changes.
begin;
set local lock_timeout = '10s';

do $migration$
declare
  egg constant uuid := '9f0a71bf-3eaf-4edb-9a98-18177461f270';
  boiled constant uuid := '6bfe9edd-bab8-4435-80bf-2c9584a8d004';
  extra constant uuid := '82667279-eac5-45de-94cb-7e8974a42f0a';
  mapping record;
  source public.product_variants;
  new_variant uuid;
  preparation text;
  new_name text;
  ingredient uuid;
  extra_price numeric;
begin
  -- Fresh installations/test databases have none of these deployment-specific records.
  if not exists(select 1 from public.products where id in (egg,boiled,extra)) then
    raise notice 'Reviewed egg catalog is absent; no menu data changed.';
    return;
  end if;

  lock table public.products, public.product_variants, public.branch_products,
    public.branch_product_variants, public.product_stock_uses, public.product_drink_choices
    in share row exclusive mode;

  if (select count(*) from public.products where id in (egg,boiled,extra) and archived_at is null) <> 3
    or not exists(select 1 from public.products where id=egg and sku='EGG' and sell_in_pos=false)
    or not exists(select 1 from public.products where id=boiled and sku='BOILED-EGG' and is_active)
    or not exists(select 1 from public.products where id=extra and sku='EXTRA-EGG' and is_active)
    or exists(select 1 from public.products where id in (egg,boiled) and
       (inventory_mode <> 'piece_stock' or coalesce(stock_unit_code,'piece') <> 'piece')) then
    raise exception 'Egg catalog or stock units changed. Review the menu correction before applying.';
  end if;
  if exists(select 1 from public.product_variants where product_id=extra)
    or exists(select 1 from public.branch_product_variants where product_id=extra)
    or (select count(*) from public.product_stock_uses where product_id=extra) <> 1
    or not exists(select 1 from public.product_stock_uses where product_id=extra
       and variant_id is null and ingredient_product_id=egg and quantity=1) then
    raise exception 'Extra Egg recipe/options changed. No menu changes applied.';
  end if;

  for mapping in select * from (values
    ('d36959e1-4058-4234-94b4-c665dee13066'::uuid,'7c828877-be6a-46f3-b388-9f3016810485'::uuid,
     'w/ Rice & Fried/Boiled Egg','w/ Rice & Fried Egg','w/ Rice & Boiled Egg'),
    ('d20ccdda-5e1b-4f40-9f14-62acdffb20ea'::uuid,'ada45fda-5837-4fbe-a09a-40b3f6b4c531'::uuid,
     'Tocino with egg Only','Tocino with Fried Egg Only','Tocino with Boiled Egg Only'),
    ('3a5b79cb-05cc-4700-8cdf-253b13e1709e'::uuid,'ada45fda-5837-4fbe-a09a-40b3f6b4c531'::uuid,
     'Tocino with egg and rice','Tocino with Fried Egg and Rice','Tocino with Boiled Egg and Rice')
  ) as m(id,product_id,old_name,fried_name,boiled_name)
  loop
    select * into source from public.product_variants where id=mapping.id;
    if not found or source.product_id<>mapping.product_id or source.name<>mapping.old_name or not source.is_active then
      raise exception 'Expected egg meal option changed: %. No menu changes applied.',mapping.old_name;
    end if;
    if not exists(select 1 from public.product_stock_uses where variant_id=source.id
       and ingredient_product_id=egg and quantity=1)
       or exists(select 1 from public.product_stock_uses where variant_id=source.id and ingredient_product_id=boiled)
       or exists(select 1 from public.product_variants where product_id=source.product_id
         and lower(name) in (lower(mapping.fried_name),lower(mapping.boiled_name)))
       or exists(select 1 from public.branch_product_variants where product_id=source.product_id
         and lower(name) in (lower(mapping.fried_name),lower(mapping.boiled_name))) then
      raise exception 'Egg recipe/options changed for %. No menu changes applied.',mapping.old_name;
    end if;
    foreach preparation in array array['fried','boiled'] loop
      new_name := case when preparation='fried' then mapping.fried_name else mapping.boiled_name end;
      ingredient := case when preparation='fried' then egg else boiled end;
      insert into public.product_variants(product_id,name,default_price,is_active,sort_order)
      values(source.product_id,new_name,source.default_price,source.is_active,source.sort_order)
      returning id into new_variant;
      -- Preserve every other recipe line, including meat/rice and its exact quantity.
      insert into public.product_stock_uses(product_id,variant_id,ingredient_product_id,quantity)
      select product_id,new_variant,case when ingredient_product_id=egg then ingredient else ingredient_product_id end,quantity
      from public.product_stock_uses where variant_id=source.id;
      insert into public.product_drink_choices(product_id,variant_id,drink_product_id)
      select product_id,new_variant,drink_product_id from public.product_drink_choices where variant_id=source.id;
      insert into public.branch_product_variants(branch_id,product_id,name,selling_price,is_active)
      select branch_id,product_id,new_name,selling_price,is_active
      from public.branch_product_variants where product_id=source.product_id and lower(name)=lower(source.name);
    end loop;
    -- Keep original IDs/names/recipes for historical receipts and reject stale carts.
    update public.branch_product_variants set is_active=false
    where product_id=source.product_id and lower(name)=lower(source.name);
    update public.product_variants set is_active=false where id=source.id;
  end loop;

  select selling_price into extra_price from public.products where id=extra;
  if extra_price is null then raise exception 'Extra Egg default price is missing.'; end if;
  foreach preparation in array array['fried','boiled'] loop
    new_name := case when preparation='fried' then 'Fried Egg' else 'Boiled Egg' end;
    ingredient := case when preparation='fried' then egg else boiled end;
    insert into public.product_variants(product_id,name,default_price,sort_order)
    values(extra,new_name,extra_price,case when preparation='fried' then 0 else 1 end)
    returning id into new_variant;
    insert into public.product_stock_uses(product_id,variant_id,ingredient_product_id,quantity)
    values(extra,new_variant,ingredient,1);
    insert into public.branch_product_variants(branch_id,product_id,name,selling_price,is_active)
    select branch_id,product_id,new_name,selling_price,is_active from public.branch_products where product_id=extra;
  end loop;
  -- Enable the existing stock-only item so staff can receive/record actual frying stock.
  -- Zero stock remains zero; it is not borrowed from the boiled stock pool.
  update public.products set is_active=true where id=egg;
end;
$migration$;
commit;
