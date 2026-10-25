-- Remember the product category so meal stock and drink pickers can tell supplies from drinks.
-- Existing products stay uncategorized. Prices, stock, and sell_in_pos are not changed.

begin;

alter table public.products
  add column if not exists product_category text;

alter table public.products drop constraint if exists products_product_category_check;
alter table public.products
  add constraint products_product_category_check
  check (
    product_category is null
    or product_category in ('meals', 'snacks', 'drinks', 'extras', 'supplies')
  );

comment on column public.products.product_category is
  'Wizard category: meals, snacks, drinks, extras, or supplies. Null until a manager saves one. Does not change price or POS selling.';

create function public.set_product_category(
  p_product_id uuid,
  p_category text
)
returns public.products
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.products%rowtype;
  v_category text := nullif(lower(btrim(coalesce(p_category, ''))), '');
begin
  if not public.is_main_branch_manager() then
    raise exception 'Unauthorized: Main Branch Manager access is required.' using errcode = '42501';
  end if;
  if v_category is not null and v_category not in ('meals', 'snacks', 'drinks', 'extras', 'supplies') then
    raise exception 'Category must be meals, snacks, drinks, extras, or supplies.' using errcode = '22023';
  end if;

  select * into v_product from public.products where id = p_product_id for update;
  if not found then
    raise exception 'Product is missing.' using errcode = '22023';
  end if;

  update public.products
  set product_category = v_category
  where id = p_product_id
  returning * into v_product;
  return v_product;
end;
$$;

revoke all on function public.set_product_category(uuid, text) from public, anon;
grant execute on function public.set_product_category(uuid, text) to authenticated;

commit;
