begin;
alter table public.products add column stock_unit_code text
  check (stock_unit_code in ('piece','half_egg','half_serving','quarter_serving'));
comment on column public.products.stock_unit_code is 'Immutable count unit, selected at creation. NULL is legacy/unspecified; never infer from product name or convert historical quantities.';
create function public.protect_stock_unit_definition() returns trigger language plpgsql set search_path='' as $$
begin
  if new.stock_unit_code is distinct from old.stock_unit_code then
    raise exception 'Stock units cannot be changed. Create a new stock item with the correct unit.' using errcode='55000';
  end if;
  if new.stock_unit_code in ('half_egg','half_serving','quarter_serving') and new.inventory_mode <> 'piece_stock' then
    raise exception 'Portion stock must remain piece-based.' using errcode='22023';
  end if;
  return new;
end $$;
create trigger products_protect_stock_unit before update on public.products
for each row execute function public.protect_stock_unit_definition();
alter table public.products add constraint products_portion_mode check
(stock_unit_code is null or stock_unit_code='piece' or (inventory_mode='piece_stock' and not sell_in_pos));
revoke all on function public.protect_stock_unit_definition() from public,anon,authenticated;
create function public.create_portion_stock_product(
  p_name text,
  p_sku text,
  p_description text,
  p_stock_unit_code text,
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
  if p_stock_unit_code is null or p_stock_unit_code not in ('piece','half_egg','half_serving','quarter_serving') then
    raise exception 'Choose a valid stock unit.' using errcode = '22023';
  end if;
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
    name, sku, description, selling_price, is_active, inventory_mode, closing_stock_behavior, sell_in_pos, stock_unit_code
  ) values (
    v_name, v_sku, v_description, null, false, 'piece_stock', v_closing::public.closing_stock_behavior, false, p_stock_unit_code
  )
  returning * into v_product;

  return v_product;
end;
$$;

revoke all on function public.create_portion_stock_product(text, text, text, text, text) from public, anon;
grant execute on function public.create_portion_stock_product(text, text, text, text, text) to authenticated;


-- Only metadata for requested product IDs; no balances, prices or branch records.
create function public.get_stock_unit_codes(p_product_ids uuid[])
returns table(product_id uuid, stock_unit_code text)
language plpgsql stable security definer set search_path='' as $$
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and is_active) then
    raise exception 'Active staff access required.' using errcode='42501';
  end if;
  if coalesce(cardinality(p_product_ids),0)>500 then raise exception 'Too many products.' using errcode='22023'; end if;
  return query select p.id,p.stock_unit_code from public.products p where p.id=any(p_product_ids);
end $$;
revoke all on function public.get_stock_unit_codes(uuid[]) from public,anon;
grant execute on function public.get_stock_unit_codes(uuid[]) to authenticated;
commit;
