begin;

-- ============================================================================
-- Edit Product Reliability — one atomic update for info + variants + branch
-- pricing, mirroring create_complete_product. Also the first real delete path
-- for product_variants (cascading their branch_product_variants rows).
-- Historical sale_items keep their own frozen variant_name/unit_price and
-- already null out sale_items.variant_id on delete (see milestone 12.2), so
-- deleting a variant never touches past sales.
-- ============================================================================

create or replace function public.update_complete_product(
  p_product_id uuid,
  p_name text,
  p_sku text,
  p_description text,
  p_is_active boolean,
  p_variants jsonb,
  p_deleted_variant_ids jsonb,
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
  v_deleted_ids jsonb;
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
  v_deleted_id uuid;
  v_deleted_name text;
  v_old_name text;
  v_new_name text;
  v_variant_id uuid;
begin
  if not public.is_main_branch_manager() then
    raise exception 'Unauthorized: Main Branch Manager access is required.'
      using errcode = '42501';
  end if;

  select * into v_product from public.products where id = p_product_id for update;
  if not found then
    raise exception 'product_not_found: That product could not be found.'
      using errcode = '22023';
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
  v_deleted_ids := case
    when p_deleted_variant_ids is null or jsonb_typeof(p_deleted_variant_ids) = 'null' then '[]'::jsonb
    else p_deleted_variant_ids
  end;
  v_branches := case
    when p_branches is null or jsonb_typeof(p_branches) = 'null' then '[]'::jsonb
    else p_branches
  end;

  if jsonb_typeof(v_variants) is distinct from 'array'
     or jsonb_typeof(v_deleted_ids) is distinct from 'array'
     or jsonb_typeof(v_branches) is distinct from 'array' then
    raise exception 'invalid_product_price: Variants, deletions, and branches must be JSON arrays.'
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

    for v_variant in select value from jsonb_array_elements(v_variants) loop
      if jsonb_typeof(v_variant.value) is distinct from 'object'
         or char_length(trim(coalesce(v_variant.value->>'name', ''))) not between 1 and 60
         or coalesce(v_variant.value->>'default_price', '') !~ v_price_re then
        raise exception 'invalid_product_price: Each variant requires a name and a valid non-negative price.'
          using errcode = '22023';
      end if;
      if v_variant.value ? 'id' and v_variant.value->>'id' is not null then
        perform 1 from public.product_variants
        where id = (v_variant.value->>'id')::uuid and product_id = p_product_id
        for update;
        if not found then
          raise exception 'invalid_product_price: A variant could not be found.'
            using errcode = '22023';
        end if;
      end if;
    end loop;
  else
    if coalesce(p_selling_price, '') !~ v_price_re then
      raise exception 'invalid_product_price: A selling price is required.'
        using errcode = '22023';
    end if;
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
      if jsonb_typeof(v_branch.value->'variants') is distinct from 'array'
         or jsonb_array_length(v_branch.value->'variants') <> jsonb_array_length(v_variants) then
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

  -- Apply deletions first so a freed-up name can be reused by a renamed/new variant below.
  for v_deleted_id in select (value#>>'{}')::uuid from jsonb_array_elements(v_deleted_ids) loop
    select name into v_deleted_name
    from public.product_variants
    where id = v_deleted_id and product_id = p_product_id
    for update;

    if v_deleted_name is null then
      continue;
    end if;

    delete from public.branch_product_variants
    where product_id = p_product_id and name = v_deleted_name;

    delete from public.product_variants where id = v_deleted_id;
  end loop;

  update public.products
  set name = v_name,
      sku = v_sku,
      description = v_description
  where id = p_product_id;

  if v_has_variants then
    v_sort := 0;
    for v_variant in select value from jsonb_array_elements(v_variants) loop
      v_new_name := trim(v_variant.value->>'name');

      if v_variant.value ? 'id' and v_variant.value->>'id' is not null then
        v_variant_id := (v_variant.value->>'id')::uuid;
        select name into v_old_name from public.product_variants where id = v_variant_id;

        update public.product_variants
        set name = v_new_name,
            default_price = (v_variant.value->>'default_price')::numeric,
            sort_order = v_sort
        where id = v_variant_id;

        if v_old_name is distinct from v_new_name then
          update public.branch_product_variants
          set name = v_new_name
          where product_id = p_product_id and name = v_old_name;
        end if;
      else
        insert into public.product_variants(
          product_id, name, default_price, is_active, sort_order
        ) values (
          p_product_id, v_new_name, (v_variant.value->>'default_price')::numeric, true, v_sort
        );
      end if;

      if v_sort = 0 then
        v_default_name := v_new_name;
        v_selling_price := (v_variant.value->>'default_price')::numeric;
      end if;
      v_sort := v_sort + 1;
    end loop;

    update public.products set selling_price = v_selling_price where id = p_product_id;
  else
    update public.products set selling_price = p_selling_price::numeric where id = p_product_id;
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
      p_product_id,
      v_branch_price,
      true
    )
    on conflict (branch_id, product_id) do update
    set selling_price = excluded.selling_price,
        is_active = true;

    if v_has_variants then
      for v_variant in select value from jsonb_array_elements(v_variants) loop
        v_canonical_name := trim(v_variant.value->>'name');
        select (bv.value->>'selling_price')::numeric
        into v_branch_price
        from jsonb_array_elements(v_branch.value->'variants') bv
        where lower(trim(bv.value->>'name')) = lower(v_canonical_name);

        insert into public.branch_product_variants(
          branch_id, product_id, name, selling_price, is_active
        ) values (
          (v_branch.value->>'branch_id')::uuid,
          p_product_id,
          v_canonical_name,
          v_branch_price,
          true
        )
        on conflict (branch_id, product_id, name) do update
        set selling_price = excluded.selling_price,
            is_active = true;
      end loop;
    end if;
  end loop;

  -- Runs last: products_protect_activation (before update of is_active) enforces the
  -- opening-stock gate, so an invalid activation attempt rolls back the whole edit.
  update public.products set is_active = p_is_active where id = p_product_id;

  select * into v_product from public.products where id = p_product_id;
  return v_product;
end;
$$;

revoke all on function public.update_complete_product(uuid, text, text, text, boolean, jsonb, jsonb, jsonb, text)
  from public, anon;
grant execute on function public.update_complete_product(uuid, text, text, text, boolean, jsonb, jsonb, jsonb, text)
  to authenticated;

comment on function public.update_complete_product(uuid, text, text, text, boolean, jsonb, jsonb, jsonb, text) is
  'Atomically updates a product''s info, variant set (add/rename/reprice/hard-delete), and selected selling-branch prices in one transaction. Deleting a variant cascades to its branch_product_variants rows across every branch; sale_items keeps its own frozen variant_name/unit_price and already nulls sale_items.variant_id on delete, so past sales are unaffected.';

commit;
