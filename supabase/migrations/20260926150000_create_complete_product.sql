begin;

-- ============================================================================
-- Product Creation Reliability — transactional create + variant/branch edits
-- ============================================================================

create or replace function public.create_complete_product(
  p_name text,
  p_sku text,
  p_description text,
  p_variants jsonb,
  p_branches jsonb,
  p_selling_price text default null
)
returns public.products
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.products%rowtype;
  v_sku text;
  v_name text;
  v_description text;
  v_variants jsonb;
  v_branches jsonb;
  v_selling_price numeric(12,2);
  v_has_variants boolean;
  v_default_name text;
  v_variant record;
  v_branch record;
  v_branch_variant record;
  v_canonical_name text;
  v_branch_price numeric(12,2);
  v_sort int;
  v_price_re text := '^[0-9]{1,10}(\.[0-9]{1,2})?$';
begin
  if not public.is_main_branch_manager() then
    raise exception 'Unauthorized: Main Branch Manager access is required.'
      using errcode = '42501';
  end if;

  v_name := trim(coalesce(p_name, ''));
  if char_length(v_name) not between 2 and 120 then
    raise exception 'Product name must be 2 to 120 characters.'
      using errcode = '22023';
  end if;

  v_sku := upper(trim(coalesce(p_sku, '')));
  if v_sku !~ '^[A-Z0-9-]{2,40}$' then
    raise exception 'SKU must be 2 to 40 letters, numbers, or hyphens.'
      using errcode = '22023';
  end if;

  v_description := nullif(trim(coalesce(p_description, '')), '');
  if v_description is not null and char_length(v_description) > 500 then
    raise exception 'Description must be 500 characters or fewer.'
      using errcode = '22023';
  end if;

  v_variants := case
    when p_variants is null or jsonb_typeof(p_variants) = 'null' then '[]'::jsonb
    else p_variants
  end;
  v_branches := case
    when p_branches is null or jsonb_typeof(p_branches) = 'null' then '[]'::jsonb
    else p_branches
  end;

  if jsonb_typeof(v_variants) is distinct from 'array'
     or jsonb_typeof(v_branches) is distinct from 'array' then
    raise exception 'invalid_product_price: Variants and branches must be JSON arrays.'
      using errcode = '22023';
  end if;

  if jsonb_array_length(v_variants) > 50 then
    raise exception 'Provide 1 to 50 variants.'
      using errcode = '22023';
  end if;

  v_has_variants := jsonb_array_length(v_variants) > 0;

  if v_has_variants then
    if (select count(*) from jsonb_array_elements(v_variants)) <>
       (select count(distinct lower(trim(value->>'name'))) from jsonb_array_elements(v_variants)) then
      raise exception 'duplicate_variant_name: Each variant name may appear only once.'
        using errcode = '22023';
    end if;

    v_sort := 0;
    for v_variant in
      select value
      from jsonb_array_elements(v_variants)
    loop
      if jsonb_typeof(v_variant.value) is distinct from 'object'
         or char_length(trim(coalesce(v_variant.value->>'name', ''))) not between 1 and 60
         or coalesce(v_variant.value->>'default_price', '') !~ v_price_re then
        raise exception 'invalid_product_price: Each variant requires a name and a valid non-negative price.'
          using errcode = '22023';
      end if;
      if v_sort = 0 then
        v_default_name := trim(v_variant.value->>'name');
        v_selling_price := (v_variant.value->>'default_price')::numeric;
      end if;
      v_sort := v_sort + 1;
    end loop;
  else
    if coalesce(p_selling_price, '') !~ v_price_re then
      raise exception 'invalid_product_price: A default base price is required.'
        using errcode = '22023';
    end if;
    v_selling_price := p_selling_price::numeric;
  end if;

  if (
    select count(*) from jsonb_array_elements(v_branches)
  ) <> (
    select count(distinct (value->>'branch_id'))
    from jsonb_array_elements(v_branches)
  ) then
    raise exception 'invalid_branch: Duplicate branch IDs are not allowed.'
      using errcode = '22023';
  end if;

  for v_branch in select value from jsonb_array_elements(v_branches) loop
    if jsonb_typeof(v_branch.value) is distinct from 'object'
       or coalesce(v_branch.value->>'branch_id', '') !~
         '^[0-9a-fA-F-]{8}-[0-9a-fA-F-]{4}-[0-9a-fA-F-]{4}-[0-9a-fA-F-]{4}-[0-9a-fA-F-]{12}$' then
      raise exception 'invalid_branch: Each branch requires a valid branch_id.'
        using errcode = '22023';
    end if;

    perform 1
    from public.branches b
    where b.id = (v_branch.value->>'branch_id')::uuid
      and b.is_active
      and not b.is_main_branch
    for share;
    if not found then
      raise exception 'invalid_branch: Catalog branch is missing, inactive, or is the Main Branch.'
        using errcode = '22023';
    end if;

    if v_has_variants then
      if jsonb_typeof(v_branch.value->'variants') is distinct from 'array' then
        raise exception 'incomplete_branch_pricing: Complete the pricing for all selected branches.'
          using errcode = '22023';
      end if;

      if jsonb_array_length(v_branch.value->'variants') <> jsonb_array_length(v_variants) then
        raise exception 'incomplete_branch_pricing: Complete the pricing for all selected branches.'
          using errcode = '22023';
      end if;

      if (select count(*) from jsonb_array_elements(v_branch.value->'variants')) <>
         (select count(distinct lower(trim(value->>'name')))
          from jsonb_array_elements(v_branch.value->'variants')) then
        raise exception 'duplicate_variant_name: Each variant name may appear only once.'
          using errcode = '22023';
      end if;

      if exists (
        select lower(trim(pv.value->>'name'))
        from jsonb_array_elements(v_variants) pv
        except
        select lower(trim(bv.value->>'name'))
        from jsonb_array_elements(v_branch.value->'variants') bv
      ) or exists (
        select lower(trim(bv.value->>'name'))
        from jsonb_array_elements(v_branch.value->'variants') bv
        except
        select lower(trim(pv.value->>'name'))
        from jsonb_array_elements(v_variants) pv
      ) then
        raise exception 'incomplete_branch_pricing: Enter a price for every enabled variant.'
          using errcode = '22023';
      end if;

      for v_branch_variant in
        select value
        from jsonb_array_elements(v_branch.value->'variants')
      loop
        if jsonb_typeof(v_branch_variant.value) is distinct from 'object'
           or char_length(trim(coalesce(v_branch_variant.value->>'name', ''))) not between 1 and 60
           or coalesce(v_branch_variant.value->>'selling_price', '') !~ v_price_re then
          raise exception 'invalid_product_price: Enter a price for every enabled variant.'
            using errcode = '22023';
        end if;
      end loop;
    else
      if coalesce(v_branch.value->>'selling_price', '') !~ v_price_re then
        raise exception 'invalid_product_price: Each selected branch requires a valid selling price.'
          using errcode = '22023';
      end if;
    end if;
  end loop;

  insert into public.products(name, sku, description, selling_price, is_active)
  values (v_name, v_sku, v_description, v_selling_price, false)
  returning * into v_product;

  if v_has_variants then
    v_sort := 0;
    for v_variant in
      select value
      from jsonb_array_elements(v_variants)
    loop
      insert into public.product_variants(
        product_id, name, default_price, is_active, sort_order
      ) values (
        v_product.id,
        trim(v_variant.value->>'name'),
        (v_variant.value->>'default_price')::numeric,
        true,
        v_sort
      );
      v_sort := v_sort + 1;
    end loop;
  end if;

  for v_branch in select value from jsonb_array_elements(v_branches) loop
    if v_has_variants then
      select (bv.value->>'selling_price')::numeric
      into v_branch_price
      from jsonb_array_elements(v_branch.value->'variants') bv
      where lower(trim(bv.value->>'name')) = lower(v_default_name);

      if v_branch_price is null then
        raise exception 'incomplete_branch_pricing: Enter a price for every enabled variant.'
          using errcode = '22023';
      end if;
    else
      v_branch_price := (v_branch.value->>'selling_price')::numeric;
    end if;

    insert into public.branch_products(branch_id, product_id, selling_price, is_active)
    values (
      (v_branch.value->>'branch_id')::uuid,
      v_product.id,
      v_branch_price,
      true
    );

    if v_has_variants then
      for v_variant in
        select value
        from jsonb_array_elements(v_variants)
      loop
        v_canonical_name := trim(v_variant.value->>'name');
        select (bv.value->>'selling_price')::numeric
        into v_branch_price
        from jsonb_array_elements(v_branch.value->'variants') bv
        where lower(trim(bv.value->>'name')) = lower(v_canonical_name);

        insert into public.branch_product_variants(
          branch_id, product_id, name, selling_price, is_active
        ) values (
          (v_branch.value->>'branch_id')::uuid,
          v_product.id,
          v_canonical_name,
          v_branch_price,
          true
        );
      end loop;
    end if;
  end loop;

  return v_product;
end;
$$;

revoke all on function public.create_complete_product(text, text, text, jsonb, jsonb, text)
  from public, anon;
grant execute on function public.create_complete_product(text, text, text, jsonb, jsonb, text)
  to authenticated;

comment on function public.create_complete_product(text, text, text, jsonb, jsonb, text) is
  'Atomically creates a product, optional default variants, and selected selling-branch prices. Variant products derive products.selling_price from sort_order 0 and branch_products.selling_price from the matching default-variant name, not JSON array order.';

create or replace function public.update_product_variant(
  p_variant_id uuid,
  p_new_name text,
  p_new_default_price text
)
returns public.product_variants
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product_id uuid;
  v_old_name text;
  v_sort_order integer;
  v_name text;
  v_price numeric(12,2);
  v_updated public.product_variants%rowtype;
begin
  if not public.is_main_branch_manager() then
    raise exception 'Unauthorized: Main Branch Manager access is required.'
      using errcode = '42501';
  end if;

  v_name := trim(coalesce(p_new_name, ''));
  if char_length(v_name) not between 1 and 60 then
    raise exception 'duplicate_variant_name: Variant name must be 1 to 60 characters.'
      using errcode = '22023';
  end if;

  if coalesce(p_new_default_price, '') !~ '^[0-9]{1,10}(\.[0-9]{1,2})?$' then
    raise exception 'invalid_product_price: Price must be a valid non-negative amount.'
      using errcode = '22023';
  end if;
  v_price := p_new_default_price::numeric;

  select product_id, name, sort_order
  into v_product_id, v_old_name, v_sort_order
  from public.product_variants
  where id = p_variant_id
  for update;

  if not found then
    raise exception 'invalid_product_price: That variant could not be found.'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.product_variants pv
    where pv.product_id = v_product_id
      and pv.id <> p_variant_id
      and lower(trim(pv.name)) = lower(v_name)
  ) then
    raise exception 'duplicate_variant_name: Each variant name may appear only once.'
      using errcode = '22023';
  end if;

  update public.product_variants
  set name = v_name,
      default_price = v_price
  where id = p_variant_id
  returning * into v_updated;

  if v_old_name is distinct from v_name then
    update public.branch_product_variants
    set name = v_name
    where product_id = v_product_id
      and name = v_old_name;
  end if;

  if v_sort_order = 0 then
    update public.products
    set selling_price = v_price
    where id = v_product_id;
  end if;

  return v_updated;
end;
$$;

revoke all on function public.update_product_variant(uuid, text, text)
  from public, anon;
grant execute on function public.update_product_variant(uuid, text, text)
  to authenticated;

comment on function public.update_product_variant(uuid, text, text) is
  'Updates a product variant by id. Renames matching branch_product_variants while keeping their ids. If sort_order = 0, also updates products.selling_price.';

create or replace function public.update_branch_product_variant_price(
  p_branch_variant_id uuid,
  p_selling_price text
)
returns public.branch_product_variants
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.branch_product_variants%rowtype;
  v_price numeric(12,2);
  v_sort_order integer;
begin
  if not public.is_main_branch_manager() then
    raise exception 'Unauthorized: Main Branch Manager access is required.'
      using errcode = '42501';
  end if;

  if coalesce(p_selling_price, '') !~ '^[0-9]{1,10}(\.[0-9]{1,2})?$' then
    raise exception 'invalid_product_price: Price must be a valid non-negative amount.'
      using errcode = '22023';
  end if;
  v_price := p_selling_price::numeric;

  select *
  into v_row
  from public.branch_product_variants
  where id = p_branch_variant_id
  for update;

  if not found then
    raise exception 'invalid_branch: That branch variant could not be found.'
      using errcode = '22023';
  end if;

  perform 1
  from public.branches b
  where b.id = v_row.branch_id
    and b.is_active
    and not b.is_main_branch
  for share;
  if not found then
    raise exception 'invalid_branch: Catalog branch is missing, inactive, or is the Main Branch.'
      using errcode = '22023';
  end if;

  update public.branch_product_variants
  set selling_price = v_price
  where id = p_branch_variant_id
  returning * into v_row;

  select pv.sort_order
  into v_sort_order
  from public.product_variants pv
  where pv.product_id = v_row.product_id
    and lower(trim(pv.name)) = lower(trim(v_row.name));

  if v_sort_order = 0 then
    update public.branch_products
    set selling_price = v_price
    where branch_id = v_row.branch_id
      and product_id = v_row.product_id;
  end if;

  return v_row;
end;
$$;

revoke all on function public.update_branch_product_variant_price(uuid, text)
  from public, anon;
grant execute on function public.update_branch_product_variant_price(uuid, text)
  to authenticated;

comment on function public.update_branch_product_variant_price(uuid, text) is
  'Updates one branch variant price. When it matches product_variants.sort_order = 0, also updates branch_products.selling_price in the same transaction.';

commit;
