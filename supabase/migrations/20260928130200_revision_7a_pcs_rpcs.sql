begin;

-- ============================================================================
-- Revision 7A — product RPCs, start_cashier_shift opening snapshot, lock order.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- create_complete_product — exact forward signature (one callable)
-- ---------------------------------------------------------------------------
drop function if exists public.create_complete_product(text, text, text, jsonb, jsonb, text, text);

create function public.create_complete_product(
  p_name text,
  p_sku text,
  p_description text,
  p_variants jsonb,
  p_branches jsonb,
  p_selling_price text default null,
  p_inventory_mode text default 'piece_stock',
  p_closing_stock_behavior text default 'keep_at_branch'
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
  v_mode text := btrim(coalesce(p_inventory_mode, 'piece_stock'));
  v_closing text := btrim(coalesce(p_closing_stock_behavior, 'keep_at_branch'));
  v_closing_enum public.closing_stock_behavior;
  v_price_re text := '^[0-9]{1,10}(\.[0-9]{1,2})?$';
begin
  if v_mode = 'kg_meal' then
    raise exception 'KG-delivered meal inventory is retired. Use piece stock (PCS) only.'
      using errcode = '22023';
  end if;
  if v_mode is distinct from 'piece_stock' then
    raise exception 'Inventory type must be piece stock.'
      using errcode = '22023';
  end if;
  if v_closing not in ('keep_at_branch', 'record_as_unsold') then
    raise exception 'Closing stock behavior must be keep_at_branch or record_as_unsold.'
      using errcode = '22023';
  end if;
  v_closing_enum := v_closing::public.closing_stock_behavior;

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
         '^[0-9a-fA-F-]{8}-[0-9a-fA-F-]{4}-[0-9a-fA-F-]{4}-[0-9a-fA-F-]{4}-[0-9a-fA-F-]{12}$'
 then
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

  insert into public.products(
    name, sku, description, selling_price, is_active, inventory_mode, closing_stock_behavior
  ) values (
    v_name, v_sku, v_description, v_selling_price, false, 'piece_stock', v_closing_enum
  )
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

revoke all on function public.create_complete_product(text, text, text, jsonb, jsonb, text, text, text)
  from public, anon;
grant execute on function public.create_complete_product(text, text, text, jsonb, jsonb, text, text, text)
  to authenticated;

comment on function public.create_complete_product(text, text, text, jsonb, jsonb, text, text, text) is
  'Creates a PCS product with atomic closing_stock_behavior. kg_meal is rejected. Final DEFAULT keep_at_branch preserves callers that omit closing behavior.';

-- ---------------------------------------------------------------------------
-- update_complete_product — exact forward signature (one callable)
-- ---------------------------------------------------------------------------
drop function if exists public.update_complete_product(uuid, text, text, text, boolean, jsonb, jsonb, jsonb, text, text);

create function public.update_complete_product(
  p_product_id uuid,
  p_name text,
  p_sku text,
  p_description text,
  p_is_active boolean,
  p_variants jsonb,
  p_deleted_variant_ids jsonb,
  p_branches jsonb,
  p_selling_price text default null,
  p_inventory_mode text default null,
  p_closing_stock_behavior text default null
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
  v_closing text;
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

  if p_inventory_mode is not null then
    perform public.set_product_inventory_mode(p_product_id, p_inventory_mode);
  end if;

  if p_closing_stock_behavior is not null then
    v_closing := btrim(p_closing_stock_behavior);
    if v_closing not in ('keep_at_branch', 'record_as_unsold') then
      raise exception 'Closing stock behavior must be keep_at_branch or record_as_unsold.'
        using errcode = '22023';
    end if;
    update public.products
    set closing_stock_behavior = v_closing::public.closing_stock_behavior
    where id = p_product_id;
  end if;

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

  update public.products set is_active = p_is_active where id = p_product_id;

  select * into v_product from public.products where id = p_product_id;
  return v_product;
end;
$$;

revoke all on function public.update_complete_product(uuid, text, text, text, boolean, jsonb, jsonb, jsonb, text, text, text)
  from public, anon;
grant execute on function public.update_complete_product(uuid, text, text, text, boolean, jsonb, jsonb, jsonb, text, text, text)
  to authenticated;

comment on function public.update_complete_product(uuid, text, text, text, boolean, jsonb, jsonb, jsonb, text, text, text) is
  'Atomic product update with optional inventory_mode and closing_stock_behavior. NULL closing behavior leaves it unchanged. kg_meal is rejected. No conflicting overload remains.';

-- ---------------------------------------------------------------------------
-- start_cashier_shift — lock order + opening-stock snapshot + inventory recon gate
-- ---------------------------------------------------------------------------
create or replace function public.start_cashier_shift()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cashier_id         uuid := auth.uid();
  v_user               public.profiles%rowtype;
  v_branch_id          uuid;
  v_shift_id           uuid;
  v_existing_branch_id uuid;
  v_captured_at        timestamptz := now();
begin
  select * into v_user
  from public.profiles
  where id = v_cashier_id and role = 'cashier' and is_active
  for update;
  if not found then
    raise exception 'Unauthorized: cashier access is required.' using errcode = '42501';
  end if;

  v_branch_id := v_user.branch_id;
  if v_branch_id is null then
    raise exception 'No branch is assigned to this cashier.' using errcode = '42501';
  end if;

  -- Global lock order: branch → open shift → inventory by product_id
  perform public.lock_branch_inventory_gate(v_branch_id);

  perform 1
  from public.branches
  where id = v_branch_id and is_active and not is_main_branch;
  if not found then
    raise exception 'The assigned branch is inactive or invalid.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.shifts s
    where s.branch_id = v_branch_id
      and s.status = 'closed'
      and s.inventory_reconciliation_required = true
  ) then
    raise exception 'Pending inventory reconciliation must be finished before starting a new shift.'
      using errcode = 'P0001';
  end if;

  select id, branch_id into v_shift_id, v_existing_branch_id
  from public.shifts
  where cashier_id = v_cashier_id and status = 'open'
  limit 1;

  if v_shift_id is not null then
    if v_existing_branch_id <> v_branch_id then
      raise exception 'The existing shift belongs to another branch.' using errcode = '42501';
    end if;
    return v_shift_id;
  end if;

  insert into public.shifts(
    branch_id, cashier_id, status, started_at,
    reconciliation_required, inventory_reconciliation_required
  )
  values (v_branch_id, v_cashier_id, 'open', v_captured_at, true, false)
  returning id into v_shift_id;

  perform 1 from public.shifts where id = v_shift_id for update;

  -- Immutable opening snapshot for catalog/stock products at this branch.
  insert into public.shift_product_opening_stock (
    shift_id, branch_id, product_id, product_name_snapshot, opening_quantity, captured_at
  )
  select
    v_shift_id,
    v_branch_id,
    p.id,
    p.name,
    coalesce(bi.quantity_on_hand, 0)::bigint,
    v_captured_at
  from public.products p
  left join public.branch_inventory bi
    on bi.product_id = p.id
   and bi.branch_id = v_branch_id
  where exists (
      select 1
      from public.branch_products bp
      where bp.branch_id = v_branch_id
        and bp.product_id = p.id
    )
    or bi.product_id is not null
  order by p.id;

  return v_shift_id;
end;
$$;

revoke all on function public.start_cashier_shift() from public, anon;
grant execute on function public.start_cashier_shift() to authenticated;

-- ---------------------------------------------------------------------------
-- confirm_shipment_arrival — follow global lock order on selling branch
-- ---------------------------------------------------------------------------
create or replace function public.confirm_shipment_arrival(
  p_transfer_id uuid,
  p_idempotency_key text
)
returns public.stock_transfer_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_user public.profiles%rowtype;
  v_branch public.branches%rowtype;
  v_transfer public.stock_transfers%rowtype;
  v_item record;
  v_product_id uuid;
begin
  if v_user_id is null then
    raise exception 'Unauthorized: sign in required.' using errcode = '42501';
  end if;
  select * into v_user from public.profiles where id = v_user_id and is_active;
  if not found or v_user.role is distinct from 'cashier' then
    raise exception 'Unauthorized: cashier access is required.' using errcode = '42501';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 16 and 100 then
    raise exception 'Invalid request key.' using errcode = '22023';
  end if;
  if v_user.branch_id is null then
    raise exception 'Unauthorized: no authorized branch is assigned to this cashier.' using errcode = '42501';
  end if;

  -- Serialize with shift-start opening snapshot (branch → open shift → inventory).
  perform public.lock_branch_inventory_gate(v_user.branch_id);

  select * into v_branch from public.branches where id = v_user.branch_id;
  if not found or v_branch.receiving_mode is distinct from 'cashier_confirm' then
    raise exception 'Unauthorized: this branch does not use cashier shipment confirmation.' using errcode = '42501';
  end if;

  select * into v_transfer from public.stock_transfers where id = p_transfer_id for update;
  if not found then
    raise exception 'Unable to load transfer.' using errcode = 'P0002';
  end if;
  if v_transfer.to_branch_id <> v_user.branch_id then
    raise exception 'Unauthorized: this transfer belongs to another branch.' using errcode = '42501';
  end if;
  if v_transfer.receive_idempotency_key = p_idempotency_key
     and v_transfer.status in ('received', 'received_with_discrepancy') then
    return v_transfer.status;
  end if;
  if v_transfer.status <> 'pending_receipt' then
    raise exception 'Transfer has already been received or is not pending receipt.' using errcode = '55000';
  end if;

  for v_product_id in
    select distinct sti.product_id
    from public.stock_transfer_items sti
    where sti.stock_transfer_id = v_transfer.id
    order by sti.product_id
  loop
    perform 1
    from public.products p
    where p.id = v_product_id
    for share;
  end loop;

  if exists (
    select 1
    from public.stock_transfer_items sti
    join public.products p on p.id = sti.product_id
    where sti.stock_transfer_id = v_transfer.id
      and sti.inventory_mode is distinct from p.inventory_mode
  ) then
    raise exception 'Product inventory type changed while this shipment was in transit.'
      using errcode = '22023';
  end if;

  for v_item in
    select sti.id, sti.product_id, sti.quantity_sent, sti.inventory_mode
    from public.stock_transfer_items sti
    where sti.stock_transfer_id = p_transfer_id
    order by sti.product_id
  loop
    perform public.seed_branch_catalog(v_transfer.to_branch_id, v_item.product_id);

    -- Historical kg_meal transfer rows (if any) remain unmeasured / no selling credit.
    if v_item.inventory_mode = 'kg_meal' then
      continue;
    end if;

    update public.stock_transfer_items
    set quantity_received = v_item.quantity_sent
    where id = v_item.id;

    insert into public.branch_inventory(branch_id, product_id, quantity_on_hand)
    values (v_transfer.to_branch_id, v_item.product_id, v_item.quantity_sent)
    on conflict (branch_id, product_id) do update
    set quantity_on_hand = branch_inventory.quantity_on_hand + excluded.quantity_on_hand;

    insert into public.inventory_movements(
      branch_id, product_id, movement_type, quantity,
      reference_type, reference_id, created_by, notes
    ) values (
      v_transfer.to_branch_id, v_item.product_id, 'transfer_in', v_item.quantity_sent,
      'stock_transfer', p_transfer_id, v_user_id, 'Cashier shipment arrival confirmation'
    );
  end loop;

  update public.stock_transfers
  set status = 'received',
      received_by = v_user_id,
      received_at = now(),
      receive_idempotency_key = p_idempotency_key
  where id = p_transfer_id;

  return 'received'::public.stock_transfer_status;
end;
$$;

revoke all on function public.confirm_shipment_arrival(uuid, text) from public, anon;
grant execute on function public.confirm_shipment_arrival(uuid, text) to authenticated;

commit;
