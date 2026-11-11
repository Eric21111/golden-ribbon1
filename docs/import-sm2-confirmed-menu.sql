-- SM2 packaged drinks. Run as one transaction in the SQL Editor.
begin;
set local lock_timeout='5s';
create temporary table sm2_menu_result (name text, result text) on commit drop;
do $$
declare
  manager_id uuid;
  target uuid;
  item record;
  product public.products%rowtype;
  branch_row public.branch_products%rowtype;
  proposed_sku text;
begin
  select p.id into strict manager_id from public.profiles p join public.branches b on b.id=p.branch_id
    where p.role='manager' and p.is_active and b.is_active and b.is_main_branch;
  select id into strict target from public.branches where code='SM2' and is_active and not is_main_branch;
  perform set_config('request.jwt.claim.sub',manager_id::text,true);
  lock table public.products, public.branch_products in share row exclusive mode;
  for item in select * from (values
    ('Yakult',15),('Dutchmill',30),('Chuckie (small)',25),('Chuckie (big)',35),
    ('Del monte',40),('Minute maid',35),('Nestea',35),('Kalamansi (small)',25),
    ('Kalamansi (big)',35),('Coke mismo',25),('Royal mismo',25),('Sprite mismo',25),
    ('Mountain dew',30),('Pepsi',30),('Sting',30),('Royal can',40),('Sprite can',40),
    ('H2o small',15),('H2o medium',20),('H2o liter',30)
  ) as menu(name,price) loop
    select * into product from public.products p where lower(trim(p.name))=lower(item.name);
    if found then
      select * into branch_row from public.branch_products where branch_id=target and product_id=product.id;
      if found then
        insert into sm2_menu_result values(item.name,case when branch_row.selling_price<>item.price
          then 'Review existing SM2 price '||branch_row.selling_price||' vs sheet '||item.price
          when not branch_row.is_active then 'Review disabled SM2 entry' else 'Already assigned' end);
      elsif product.product_category is distinct from 'drinks' or not product.sell_in_pos or exists
        (select 1 from public.product_variants where product_id=product.id) then
        insert into sm2_menu_result values(item.name,'Review existing product configuration');
      else
        perform public.configure_branch_products(target,jsonb_build_array(jsonb_build_object(
          'product_id',product.id,'selling_price',item.price,'is_active',true)));
        insert into sm2_menu_result values(item.name,'Assigned existing product to SM2');
      end if;
    else
      proposed_sku:=upper(trim(both '-' from regexp_replace(item.name,'[^[:alnum:]]+','-','g')));
      if exists(select 1 from public.products p where upper(trim(p.sku))=proposed_sku or
        regexp_replace(lower(p.name),'[^[:alnum:]]','','g')=regexp_replace(lower(item.name),'[^[:alnum:]]','','g')) then
        insert into sm2_menu_result values(item.name,'Review similar name or SKU');
        continue;
      end if;
      select * into strict product from public.create_complete_product(p_name=>item.name,p_sku=>proposed_sku,
        p_description=>null,p_variants=>'[]'::jsonb,p_branches=>jsonb_build_array(jsonb_build_object(
        'branch_id',target,'selling_price',item.price)),p_selling_price=>item.price::text,
        p_inventory_mode=>'piece_stock',p_closing_stock_behavior=>'keep_at_branch');
      perform public.set_product_category(product.id,'drinks');
      perform public.set_product_non_returnable(product.id,true);
      insert into sm2_menu_result values(item.name,'Created for SM2');
    end if;
  end loop;
end $$;
select * from sm2_menu_result order by name;
commit;
