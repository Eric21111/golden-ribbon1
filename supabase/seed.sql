insert into public.branches (name, code, address, is_main_branch, is_active)
values
  ('Main Branch', 'MAIN', null, true, true),
  ('Branch 1', 'BR-01', null, false, true),
  ('Branch 2', 'BR-02', null, false, true)
on conflict (lower(code)) do update set
  name = excluded.name,
  address = excluded.address,
  is_main_branch = excluded.is_main_branch,
  is_active = excluded.is_active;

insert into public.products (name, sku, description, selling_price, is_active)
values
  ('Chicken Nuggets', 'CHK-NUG', null, 80.00, true),
  ('Beef Meal', 'BF-MEAL', null, 100.00, true),
  ('Pork Meal', 'PK-MEAL', null, 90.00, true)
on conflict (lower(sku)) do update set
  name = excluded.name,
  description = excluded.description,
  selling_price = excluded.selling_price,
  is_active = excluded.is_active;
