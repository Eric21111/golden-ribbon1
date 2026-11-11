-- SM1 packaged drinks, from sheet 3 rows 9–21. Run the entire transaction.
-- Uses the existing Main manager's product workflow from the trusted SQL Editor.
-- Matches in the global catalog are skipped, including inactive products.
begin;
set local lock_timeout = '5s';
create temporary table sm1_drink_result(name text, result text) on commit drop;
do $$
declare
  manager_id uuid;
  branch_id_sm1 uuid;
  item record;
  saved public.products%rowtype;
  sku_value text;
begin
  select p.id into strict manager_id from public.profiles p
    join public.branches b on b.id=p.branch_id
    where p.role='manager' and p.is_active and b.is_main_branch and b.is_active;
  select id into strict branch_id_sm1 from public.branches
    where code='SM1' and is_active and not is_main_branch;
  perform set_config('request.jwt.claim.sub',manager_id::text,true);
  lock table public.products in share row exclusive mode;
  for item in select * from (values
    ('Coke mismo',25),('Royal mismo',25),('Sprite mismo',25),
    ('Mountain dew',30),('Pepsi',30),('Sting',30),
    ('Coke can',40),('Royal can',40),('Sprite can',40),
    ('Coke zero',40),('Sprite zero',40),('Royal zero',40),('H2o medium',20)
  ) as drinks(name,price) loop
    sku_value:=upper(replace(item.name,' ','-'));
    if exists(select 1 from public.products p where
      regexp_replace(lower(p.name),'[^[:alnum:]]','','g') =
      regexp_replace(lower(item.name),'[^[:alnum:]]','','g')) then
      insert into sm1_drink_result values(item.name,'Skipped - name already in catalog');
      continue;
    end if;
    if exists(select 1 from public.products p where upper(trim(p.sku))=sku_value) then
      raise exception 'SKU % belongs to another name. Review before import.',sku_value;
    end if;
    select * into strict saved from public.create_complete_product(
      p_name=>item.name,p_sku=>sku_value,p_description=>null,p_variants=>'[]'::jsonb,
      p_branches=>jsonb_build_array(jsonb_build_object('branch_id',branch_id_sm1,'selling_price',item.price)),
      p_selling_price=>item.price::text,p_inventory_mode=>'piece_stock',
      p_closing_stock_behavior=>'keep_at_branch');
    perform public.set_product_category(saved.id,'drinks');
    perform public.set_product_non_returnable(saved.id,true);
    insert into sm1_drink_result values(item.name,'Created - check opening stock and availability');
  end loop;
end $$;
select * from sm1_drink_result order by name;
commit;
