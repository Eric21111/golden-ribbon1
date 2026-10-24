-- Drink Choice, Step 2: save the eligible drinks of a meal variant with the product.
--
-- create_complete_product and update_complete_product gain ONE more optional trailing parameter,
-- p_drink_choices jsonb default null, and call two new internal helpers. Everything else in both functions is copied
-- unchanged from the Stock Used Per Order version, so every existing caller behaves exactly as before.
--
-- p_drink_choices
--   NULL / omitted -> saved drink choices are NOT touched (unrelated edits never change or lose them)
--   JSON array     -> the COMPLETE set for the product: anything not listed is removed, [] removes them all
--   Each element:  { "drink_product_id": "<products.id>",
--                    "variant_id":   "<product_variants.id>"   -- an option that already exists, OR
--                    "variant_name": "<name>" }                -- an option by name (new or existing)
--   A variant reference is required (drink choice belongs to an option); id and name are mutually exclusive.
--
-- ATOMIC: a drink-choice error rolls back the product, variants, catalog, stock lists and drink choices together.
-- Concurrent edits of one product run one after the other (the update RPC already locks the product row).
--
-- ADDITIVE: no table, column, index or existing migration changes. The old signatures are dropped and replaced by
-- the same functions with the extra optional parameter.

begin;

create or replace function public.normalize_product_drink_choices(p_drink_choices jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uuid_re text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_line jsonb;
  v_out jsonb := '[]'::jsonb;
  v_drink text;
  v_variant_id text;
  v_variant_name text;
begin
  if not public.is_main_branch_manager() then
    raise exception 'Unauthorized: Main Branch Manager access is required.'
      using errcode = '42501';
  end if;

  if p_drink_choices is null or jsonb_typeof(p_drink_choices) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p_drink_choices) is distinct from 'array' then
    raise exception 'invalid_drink_choice: Drink choices must be a JSON array.'
      using errcode = '22023';
  end if;
  if jsonb_array_length(p_drink_choices) > 500 then
    raise exception 'invalid_drink_choice: Provide at most 500 drink choices.'
      using errcode = '22023';
  end if;

  for v_line in select value from jsonb_array_elements(p_drink_choices) loop
    if jsonb_typeof(v_line) is distinct from 'object' then
      raise exception 'invalid_drink_choice: Each drink choice must be an object.'
        using errcode = '22023';
    end if;
    if jsonb_typeof(v_line->'drink_product_id') is distinct from 'string'
       or lower(btrim(v_line->>'drink_product_id')) !~ v_uuid_re then
      raise exception 'invalid_drink_choice: Each drink choice needs a drink_product_id.'
        using errcode = '22023';
    end if;
    v_drink := lower(btrim(v_line->>'drink_product_id'));

    v_variant_id := null;
    v_variant_name := null;
    if v_line->'variant_id' is not null and jsonb_typeof(v_line->'variant_id') <> 'null' then
      if jsonb_typeof(v_line->'variant_id') <> 'string' or lower(btrim(v_line->>'variant_id')) !~ v_uuid_re then
        raise exception 'invalid_drink_choice: variant_id must be a variant id.'
          using errcode = '22023';
      end if;
      v_variant_id := lower(btrim(v_line->>'variant_id'));
    end if;
    if v_line->'variant_name' is not null and jsonb_typeof(v_line->'variant_name') <> 'null' then
      if jsonb_typeof(v_line->'variant_name') <> 'string'
         or char_length(btrim(v_line->>'variant_name')) not between 1 and 60 then
        raise exception 'invalid_drink_choice: variant_name must be 1 to 60 characters.'
          using errcode = '22023';
      end if;
      v_variant_name := lower(btrim(v_line->>'variant_name'));
    end if;
    if v_variant_id is not null and v_variant_name is not null then
      raise exception 'invalid_drink_choice: Use variant_id or variant_name, not both.'
        using errcode = '22023';
    end if;
    if v_variant_id is null and v_variant_name is null then
      raise exception 'invalid_drink_choice: A drink choice belongs to an option (variant_id or variant_name).'
        using errcode = '22023';
    end if;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'drink', v_drink, 'variant_id', v_variant_id, 'variant_name', v_variant_name
    ));
  end loop;

  if exists (
    select 1
    from jsonb_to_recordset(v_out) as l(drink text, variant_id text, variant_name text)
    group by coalesce(l.variant_id, 'n:' || coalesce(l.variant_name, '')), l.drink
    having count(*) > 1
  ) then
    raise exception 'duplicate_drink_choice: Each drink may appear only once per option.'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(v_out) as l(drink text, variant_id text, variant_name text)
    where not exists (select 1 from public.products p where p.id = l.drink::uuid)
  ) then
    raise exception 'invalid_drink_choice: A drink product could not be found.'
      using errcode = '22023';
  end if;

  return v_out;
end;
$$;

create or replace function public.apply_product_drink_choices(p_product_id uuid, p_drink_choices jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_line record;
  v_resolved jsonb := '[]'::jsonb;
  v_variant uuid;
  v_drink uuid;
begin
  if not public.is_main_branch_manager() then
    raise exception 'Unauthorized: Main Branch Manager access is required.'
      using errcode = '42501';
  end if;

  -- Not supplied: leave saved drink choices exactly as they are.
  if p_drink_choices is null then
    return;
  end if;

  perform 1 from public.products where id = p_product_id for update;
  if not found then
    raise exception 'product_not_found: That product could not be found.'
      using errcode = '22023';
  end if;

  for v_line in
    select * from jsonb_to_recordset(p_drink_choices) as l(drink text, variant_id text, variant_name text)
  loop
    v_drink := v_line.drink::uuid;
    if v_drink = p_product_id then
      raise exception 'invalid_drink_choice: A meal cannot be its own drink.'
        using errcode = '22023';
    end if;

    v_variant := null;
    if v_line.variant_id is not null then
      select pv.id into v_variant
      from public.product_variants pv
      where pv.id = v_line.variant_id::uuid and pv.product_id = p_product_id;
    else
      select pv.id into v_variant
      from public.product_variants pv
      where pv.product_id = p_product_id and lower(btrim(pv.name)) = v_line.variant_name
      limit 1;
    end if;
    if v_variant is null then
      raise exception 'invalid_drink_choice: A drink choice refers to an option that does not belong to this product.'
        using errcode = '22023';
    end if;

    v_resolved := v_resolved || jsonb_build_array(jsonb_build_object('variant_id', v_variant, 'drink_product_id', v_drink));
  end loop;

  if exists (
    select 1
    from jsonb_to_recordset(v_resolved) as r(variant_id uuid, drink_product_id uuid)
    group by r.variant_id, r.drink_product_id
    having count(*) > 1
  ) then
    raise exception 'duplicate_drink_choice: Each drink may appear only once per option.'
      using errcode = '22023';
  end if;

  -- Keep every offered drink in place for the rest of the transaction (ordered, to avoid lock cycles).
  perform 1
  from public.products p
  where p.id in (select distinct r.drink_product_id from jsonb_to_recordset(v_resolved) as r(variant_id uuid, drink_product_id uuid))
  order by p.id
  for key share;

  delete from public.product_drink_choices d
  where d.product_id = p_product_id
    and not exists (
      select 1
      from jsonb_to_recordset(v_resolved) as r(variant_id uuid, drink_product_id uuid)
      where r.variant_id = d.variant_id and r.drink_product_id = d.drink_product_id
    );

  insert into public.product_drink_choices(product_id, variant_id, drink_product_id)
  select p_product_id, r.variant_id, r.drink_product_id
  from jsonb_to_recordset(v_resolved) as r(variant_id uuid, drink_product_id uuid)
  on conflict (variant_id, drink_product_id) do nothing;
end;
$$;

revoke all on function public.normalize_product_drink_choices(jsonb) from public, anon, authenticated;
revoke all on function public.apply_product_drink_choices(uuid, jsonb) from public, anon, authenticated;

drop function if exists public.create_complete_product(text, text, text, jsonb, jsonb, text, text, text, jsonb);

create function public.create_complete_product(
  p_name text,
  p_sku text,
  p_description text,
  p_variants jsonb,
  p_branches jsonb,
  p_selling_price text default null,
  p_inventory_mode text default 'piece_stock',
  p_closing_stock_behavior text default 'keep_at_branch',
  p_stock_uses jsonb default null,
  p_drink_choices jsonb default null
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
  v_stock_uses jsonb;
  v_drink_choices jsonb;
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

  -- Stock Used Per Order (optional). Validated before anything is written; NULL means "no recipes".
  v_stock_uses := public.normalize_product_stock_uses(p_stock_uses);
  -- Drink Choice (optional): validated before anything is written. NULL / omitted = leave saved drink choices alone.
  v_drink_choices := public.normalize_product_drink_choices(p_drink_choices);

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

  -- Recipes are saved in the same transaction as the product, its variants and its branch catalog. Any
  -- failure above or below rolls everything back, including the product row.
  perform public.apply_product_stock_uses(v_product.id, v_stock_uses);
  -- Eligible drinks of each option are saved in the same transaction, after the options are final.
  perform public.apply_product_drink_choices(v_product.id, v_drink_choices);

  return v_product;
end;
$$;

revoke all on function public.create_complete_product(text, text, text, jsonb, jsonb, text, text, text, jsonb, jsonb)
  from public, anon;
grant execute on function public.create_complete_product(text, text, text, jsonb, jsonb, text, text, text, jsonb, jsonb)
  to authenticated;

comment on function public.create_complete_product(text, text, text, jsonb, jsonb, text, text, text, jsonb, jsonb) is
  'Creates a PCS product. Optional p_stock_uses saves Stock Used Per Order and optional p_drink_choices saves the eligible drinks of each option, in the same transaction. kg_meal is rejected.';

drop function if exists public.update_complete_product(uuid, text, text, text, boolean, jsonb, jsonb, jsonb, text, text, text, jsonb);

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
  p_closing_stock_behavior text default null,
  p_stock_uses jsonb default null,
  p_drink_choices jsonb default null
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
  v_stock_uses jsonb;
  v_drink_choices jsonb;
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

  -- Stock Used Per Order (optional). Validated before anything is written. NULL / omitted = leave every
  -- existing recipe untouched. The product row is already locked above, which serialises every recipe writer
  -- for this product.
  v_stock_uses := public.normalize_product_stock_uses(p_stock_uses);
  -- Drink Choice (optional): validated before anything is written. NULL / omitted = leave saved drink choices alone.
  v_drink_choices := public.normalize_product_drink_choices(p_drink_choices);

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

  -- Variants (created, renamed, deleted) are final at this point, so recipe references resolve against them.
  -- Deleting a variant already removed its recipe lines (foreign key cascade).
  perform public.apply_product_stock_uses(p_product_id, v_stock_uses);
  -- Eligible drinks of each option are saved in the same transaction, after the options are final.
  perform public.apply_product_drink_choices(p_product_id, v_drink_choices);

  update public.products set is_active = p_is_active where id = p_product_id;

  select * into v_product from public.products where id = p_product_id;
  return v_product;
end;
$$;

revoke all on function public.update_complete_product(uuid, text, text, text, boolean, jsonb, jsonb, jsonb, text, text, text, jsonb, jsonb)
  from public, anon;
grant execute on function public.update_complete_product(uuid, text, text, text, boolean, jsonb, jsonb, jsonb, text, text, text, jsonb, jsonb)
  to authenticated;

comment on function public.update_complete_product(uuid, text, text, text, boolean, jsonb, jsonb, jsonb, text, text, text, jsonb, jsonb) is
  'Atomic product edit. Optional p_stock_uses replaces Stock Used Per Order and optional p_drink_choices replaces the eligible drinks (NULL leaves them untouched, [] clears them), in the same transaction.';

commit;
