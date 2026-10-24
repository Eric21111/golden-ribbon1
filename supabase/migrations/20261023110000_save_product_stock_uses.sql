-- Shared inventory, Step 3: save Stock Used Per Order with the product.
--
-- create_complete_product and update_complete_product gain ONE optional trailing parameter,
-- p_stock_uses jsonb default null, and call two new internal helpers. Everything else in both functions is copied
-- unchanged from Revision 7A, so existing callers (named or positional, 8 / 11 arguments) behave exactly as before.
--
-- p_stock_uses
--   NULL / omitted  -> recipes are NOT touched (unrelated edits never change or lose a recipe)
--   JSON array      -> the COMPLETE recipe set of the product: anything not listed is removed, [] clears all
--   Each element:   {
--                     "ingredient_product_id": "<products.id>" | "self",   -- "self" = the product being saved
--                     "quantity": 1..99,                                   -- whole number
--                     "variant_id":   "<product_variants.id>" | null,     -- an existing variant, OR
--                     "variant_name": "<name>" | null                     -- a variant by name (new or existing)
--                   }                                                      -- neither = product-level recipe
--   (variant_id and variant_name are mutually exclusive; names are matched like the RPC matches variants, trimmed
--   and case-insensitive.)
--
-- ATOMIC: one transaction. A recipe error rolls back the product, variants, branch catalog and recipes together.
-- CONCURRENT EDITS: update_complete_product locks the product row first (FOR UPDATE), so two edits of one product run
-- one after the other; the second replaces what the first saved (last write wins), never a mix of both.
--
-- ADDITIVE: no table, column, index or existing migration changes. The old function signatures are dropped and
-- replaced by the same functions with the extra optional parameter.

begin;

-- ---------------------------------------------------------------------------
-- 1) normalize_product_stock_uses — shape validation, before any write
-- ---------------------------------------------------------------------------
create or replace function public.normalize_product_stock_uses(p_stock_uses jsonb)
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
  v_ingredient text;
  v_quantity text;
  v_variant_id text;
  v_variant_name text;
begin
  if not public.is_main_branch_manager() then
    raise exception 'Unauthorized: Main Branch Manager access is required.'
      using errcode = '42501';
  end if;

  -- Not supplied: the caller leaves existing recipes alone.
  if p_stock_uses is null or jsonb_typeof(p_stock_uses) = 'null' then
    return null;
  end if;

  if jsonb_typeof(p_stock_uses) is distinct from 'array' then
    raise exception 'invalid_stock_use: Stock uses must be a JSON array.'
      using errcode = '22023';
  end if;
  if jsonb_array_length(p_stock_uses) > 500 then
    raise exception 'invalid_stock_use: Provide at most 500 stock use lines.'
      using errcode = '22023';
  end if;

  for v_line in select value from jsonb_array_elements(p_stock_uses) loop
    if jsonb_typeof(v_line) is distinct from 'object' then
      raise exception 'invalid_stock_use: Each stock use must be an object.'
        using errcode = '22023';
    end if;

    -- ingredient: a product id, or "self" for the product being saved
    if jsonb_typeof(v_line->'ingredient_product_id') is distinct from 'string' then
      raise exception 'invalid_stock_use: Each stock use needs an ingredient_product_id.'
        using errcode = '22023';
    end if;
    v_ingredient := lower(btrim(v_line->>'ingredient_product_id'));
    if v_ingredient <> 'self' and v_ingredient !~ v_uuid_re then
      raise exception 'invalid_stock_use: ingredient_product_id must be a product id or "self".'
        using errcode = '22023';
    end if;

    -- quantity: a whole number 1..99 (as a JSON number or a digit string); 1.5, 0, 100, -1, "abc" are refused
    v_quantity := v_line->>'quantity';
    if v_quantity is null or v_quantity !~ '^[1-9][0-9]?$' then
      raise exception 'invalid_stock_use: Quantity must be a whole number from 1 to 99.'
        using errcode = '22023';
    end if;

    -- variant reference: by id, or by name, never both; neither = product-level
    v_variant_id := null;
    v_variant_name := null;
    if v_line->'variant_id' is not null and jsonb_typeof(v_line->'variant_id') <> 'null' then
      if jsonb_typeof(v_line->'variant_id') <> 'string' or lower(btrim(v_line->>'variant_id')) !~ v_uuid_re then
        raise exception 'invalid_stock_use: variant_id must be a variant id.'
          using errcode = '22023';
      end if;
      v_variant_id := lower(btrim(v_line->>'variant_id'));
    end if;
    if v_line->'variant_name' is not null and jsonb_typeof(v_line->'variant_name') <> 'null' then
      if jsonb_typeof(v_line->'variant_name') <> 'string'
         or char_length(btrim(v_line->>'variant_name')) not between 1 and 60 then
        raise exception 'invalid_stock_use: variant_name must be 1 to 60 characters.'
          using errcode = '22023';
      end if;
      v_variant_name := lower(btrim(v_line->>'variant_name'));
    end if;
    if v_variant_id is not null and v_variant_name is not null then
      raise exception 'invalid_stock_use: Use variant_id or variant_name, not both.'
        using errcode = '22023';
    end if;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'ingredient', v_ingredient,
      'quantity', v_quantity::int,
      'variant_id', v_variant_id,
      'variant_name', v_variant_name
    ));
  end loop;

  -- the same ingredient twice in one configuration
  if exists (
    select 1
    from jsonb_to_recordset(v_out) as l(ingredient text, quantity int, variant_id text, variant_name text)
    group by coalesce(l.variant_id, 'n:' || coalesce(l.variant_name, '')), l.ingredient
    having count(*) > 1
  ) then
    raise exception 'duplicate_stock_use: Each ingredient may appear only once per product or variant.'
      using errcode = '22023';
  end if;

  -- every named ingredient must be a real product ("self" is resolved when the product id is known)
  if exists (
    select 1
    from jsonb_to_recordset(v_out) as l(ingredient text, quantity int, variant_id text, variant_name text)
    where l.ingredient <> 'self'
      and not exists (select 1 from public.products p where p.id = l.ingredient::uuid)
  ) then
    raise exception 'invalid_stock_use: An ingredient product could not be found.'
      using errcode = '22023';
  end if;

  return v_out;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2) apply_product_stock_uses — resolve variants, then replace the product's recipes
-- ---------------------------------------------------------------------------
create or replace function public.apply_product_stock_uses(p_product_id uuid, p_stock_uses jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_line record;
  v_resolved jsonb := '[]'::jsonb;
  v_variant uuid;
  v_ingredient uuid;
begin
  if not public.is_main_branch_manager() then
    raise exception 'Unauthorized: Main Branch Manager access is required.'
      using errcode = '42501';
  end if;

  -- Not supplied: leave existing recipes exactly as they are.
  if p_stock_uses is null then
    return;
  end if;

  -- Serialise recipe writers for this product (the update RPC already holds this lock; for a new product it is free).
  perform 1 from public.products where id = p_product_id for update;
  if not found then
    raise exception 'product_not_found: That product could not be found.'
      using errcode = '22023';
  end if;

  for v_line in
    select *
    from jsonb_to_recordset(p_stock_uses) as l(ingredient text, quantity int, variant_id text, variant_name text)
  loop
    v_ingredient := case when v_line.ingredient = 'self' then p_product_id else v_line.ingredient::uuid end;

    v_variant := null;
    if v_line.variant_id is not null then
      select pv.id into v_variant
      from public.product_variants pv
      where pv.id = v_line.variant_id::uuid and pv.product_id = p_product_id;
      if v_variant is null then
        raise exception 'invalid_stock_use: A recipe refers to a variant that does not belong to this product.'
          using errcode = '22023';
      end if;
    elsif v_line.variant_name is not null then
      select pv.id into v_variant
      from public.product_variants pv
      where pv.product_id = p_product_id and lower(btrim(pv.name)) = v_line.variant_name
      limit 1;
      if v_variant is null then
        raise exception 'invalid_stock_use: A recipe refers to a variant name that this product does not have.'
          using errcode = '22023';
      end if;
    end if;

    v_resolved := v_resolved || jsonb_build_array(jsonb_build_object(
      'variant_id', v_variant,
      'ingredient_product_id', v_ingredient,
      'quantity', v_line.quantity
    ));
  end loop;

  -- A duplicate that only shows after resolution (an id and a name for the same variant, or "self" plus the
  -- product's own id) is still a duplicate.
  if exists (
    select 1
    from jsonb_to_recordset(v_resolved) as r(variant_id uuid, ingredient_product_id uuid, quantity int)
    group by r.variant_id, r.ingredient_product_id
    having count(*) > 1
  ) then
    raise exception 'duplicate_stock_use: Each ingredient may appear only once per product or variant.'
      using errcode = '22023';
  end if;

  -- Keep every referenced ingredient in place for the rest of the transaction (ordered, to avoid lock cycles
  -- between concurrent saves that reference the same ingredients).
  perform 1
  from public.products p
  where p.id in (
    select distinct r.ingredient_product_id
    from jsonb_to_recordset(v_resolved) as r(variant_id uuid, ingredient_product_id uuid, quantity int)
  )
  order by p.id
  for key share;

  -- Remove what is no longer listed ...
  delete from public.product_stock_uses u
  where u.product_id = p_product_id
    and not exists (
      select 1
      from jsonb_to_recordset(v_resolved) as r(variant_id uuid, ingredient_product_id uuid, quantity int)
      where r.variant_id is not distinct from u.variant_id
        and r.ingredient_product_id = u.ingredient_product_id
    );

  -- ... add new lines and change quantities. Unchanged lines are left alone (updated_at does not move).
  insert into public.product_stock_uses(product_id, variant_id, ingredient_product_id, quantity)
  select p_product_id, r.variant_id, r.ingredient_product_id, r.quantity
  from jsonb_to_recordset(v_resolved) as r(variant_id uuid, ingredient_product_id uuid, quantity int)
  where r.variant_id is null
  on conflict (product_id, ingredient_product_id) where variant_id is null
  do update set quantity = excluded.quantity
  where public.product_stock_uses.quantity is distinct from excluded.quantity;

  insert into public.product_stock_uses(product_id, variant_id, ingredient_product_id, quantity)
  select p_product_id, r.variant_id, r.ingredient_product_id, r.quantity
  from jsonb_to_recordset(v_resolved) as r(variant_id uuid, ingredient_product_id uuid, quantity int)
  where r.variant_id is not null
  on conflict (variant_id, ingredient_product_id) where variant_id is not null
  do update set quantity = excluded.quantity
  where public.product_stock_uses.quantity is distinct from excluded.quantity;
end;
$$;

-- Internal helpers: only the two product RPCs (security definer) call them.
revoke all on function public.normalize_product_stock_uses(jsonb) from public, anon, authenticated;
revoke all on function public.apply_product_stock_uses(uuid, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3) create_complete_product (Revision 7A body + p_stock_uses)
-- ---------------------------------------------------------------------------
drop function if exists public.create_complete_product(text, text, text, jsonb, jsonb, text, text, text);

create function public.create_complete_product(
  p_name text,
  p_sku text,
  p_description text,
  p_variants jsonb,
  p_branches jsonb,
  p_selling_price text default null,
  p_inventory_mode text default 'piece_stock',
  p_closing_stock_behavior text default 'keep_at_branch',
  p_stock_uses jsonb default null
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

  return v_product;
end;
$$;

revoke all on function public.create_complete_product(text, text, text, jsonb, jsonb, text, text, text, jsonb)
  from public, anon;
grant execute on function public.create_complete_product(text, text, text, jsonb, jsonb, text, text, text, jsonb)
  to authenticated;

comment on function public.create_complete_product(text, text, text, jsonb, jsonb, text, text, text, jsonb) is
  'Creates a PCS product with atomic closing_stock_behavior. Optional p_stock_uses saves Stock Used Per Order (product-level and variant-level) in the same transaction. kg_meal is rejected.';

-- ---------------------------------------------------------------------------
-- 4) update_complete_product (Revision 7A body + p_stock_uses)
-- ---------------------------------------------------------------------------
drop function if exists public.update_complete_product(uuid, text, text, text, boolean, jsonb, jsonb, jsonb, text, text, text);

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
  p_stock_uses jsonb default null
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

  update public.products set is_active = p_is_active where id = p_product_id;

  select * into v_product from public.products where id = p_product_id;
  return v_product;
end;
$$;

revoke all on function public.update_complete_product(uuid, text, text, text, boolean, jsonb, jsonb, jsonb, text, text, text, jsonb)
  from public, anon;
grant execute on function public.update_complete_product(uuid, text, text, text, boolean, jsonb, jsonb, jsonb, text, text, text, jsonb)
  to authenticated;

comment on function public.update_complete_product(uuid, text, text, text, boolean, jsonb, jsonb, jsonb, text, text, text, jsonb) is
  'Atomic product edit. Optional p_stock_uses replaces the product''s Stock Used Per Order (NULL leaves recipes untouched, [] clears them) in the same transaction.';

commit;
