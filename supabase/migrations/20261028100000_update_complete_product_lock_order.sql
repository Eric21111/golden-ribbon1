-- Lock order: edits take locks in the same order as the rest of the system.
--
-- Found on a real PostgreSQL run: an edit and a sale of the same product deadlock (PostgreSQL aborts one of them).
--   sale  (confirm_sale):  branch row (lock_branch_inventory_gate, FOR UPDATE) -> shift -> inventory -> product row (FOR SHARE) -> ...
--   edit  (update_complete_product): product row (FOR UPDATE) -> selling branch rows (FOR SHARE)        <- the opposite order
-- and a second inversion with Branch Catalogs:
--   configure_branch_product_variants: branch_products row (FOR SHARE) -> branch_product_variants rows
--   update_complete_product:           branch_product_variants rows (rename / upsert) -> branch_products row   <- the opposite order
-- and a third with the single-option price RPC (no screen calls it today, but it is callable):
--   update_branch_product_variant_price: branch_product_variants row (FOR UPDATE) -> branches -> branch_products row   <- the opposite order
--
-- Fix. One order everywhere: selling branches -> product -> branch_products rows -> branch_product_variants rows.
--   update_complete_product:
--     1. lock the selling branches it writes (FOR SHARE, id order) BEFORE the product row;
--     2. lock the product's branch_products rows (FOR NO KEY UPDATE, branch id order) BEFORE any option row.
--   update_branch_product_variant_price:
--     3. lock its branch, then its branch_products row, BEFORE the option row.
-- No other statement, validation, message, permission, price, availability rule, recipe or stock rule changes. Same signatures, same
-- grants, no data touched. Builds on 20261027100000_edit_product_keeps_branch_availability.sql (it replaces the function that
-- migration defines, so apply it after that one) and is independent of 20261026100000_pos_require_active_branch_variant.sql.
--
-- Cost: an edit now waits for a sale that is in progress at one of the branches it writes (and the reverse), instead of one of them
-- being aborted. Both are short transactions.

begin;

create or replace function public.update_complete_product(
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

  -- LOCK ORDER. Every sale, transfer and catalog function takes the branch row first (lock_branch_inventory_gate, configure_*) and the
  -- product row afterwards. This function used to lock the product first and the branch rows later (validation below), so an edit
  -- holding the product and a sale holding the branch each waited for the other: a deadlock. Lock the selling branches this edit
  -- writes FIRST, in id order, then the product. FOR SHARE is what the validation below already took, only earlier. Input that is
  -- not an array of valid branch ids is skipped here and rejected by the validation below with the same messages as before.
  begin
    if jsonb_typeof(p_branches) = 'array' then
      perform 1
      from public.branches b
      where b.id in (
        select (e.value->>'branch_id')::uuid
        from jsonb_array_elements(p_branches) e
        where jsonb_typeof(e.value) = 'object'
          and coalesce(e.value->>'branch_id', '') ~
            '^[0-9a-fA-F-]{8}-[0-9a-fA-F-]{4}-[0-9a-fA-F-]{4}-[0-9a-fA-F-]{4}-[0-9a-fA-F-]{12}$'
      )
        and b.is_active
        and not b.is_main_branch
      order by b.id
      for share;
    end if;
  exception when invalid_text_representation then
    null;
  end;

  select * into v_product from public.products where id = p_product_id for update;
  if not found then
    raise exception 'product_not_found: That product could not be found.'
      using errcode = '22023';
  end if;

  -- Branch Catalogs (configure_branch_product_variants) locks the branch_products row and then its branch_product_variants rows. This
  -- function renames and upserts option rows, so take the product's branch_products rows first, in branch id order, to keep one order.
  perform 1
  from public.branch_products
  where product_id = p_product_id
  order by branch_id
  for no key update;

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
    -- An existing branch row keeps its is_active: editing a price must not switch the product back on at a branch where
    -- it was switched off. A branch row that does not exist yet is created ON (insert above).
    on conflict (branch_id, product_id) do update
    set selling_price = excluded.selling_price;

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
        -- Same for options: an existing branch option keeps is_active; a new option (or a new branch) is created ON.
        on conflict (branch_id, product_id, name) do update
        set selling_price = excluded.selling_price;
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
  'Atomic product edit. Saving a price at a branch keeps that branch product and option switched on or off as they were; branches and options that do not exist yet are created on. Locks the selling branches, then the product, then its branch_products rows (the order the sale and catalog functions use). Optional p_stock_uses replaces Stock Used Per Order and optional p_drink_choices replaces the eligible drinks (NULL leaves them untouched, [] clears them), in the same transaction.';

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
  v_branch_id uuid;
  v_product_id uuid;
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

  -- LOCK ORDER (see the header): the branch, then the branch_products row, BEFORE the option row, like update_complete_product and
  -- configure_branch_product_variants. The option's branch and product are read without a lock first; the original checks below
  -- (found, active non-Main branch) are unchanged and still run on the locked rows.
  select v0.branch_id, v0.product_id
  into v_branch_id, v_product_id
  from public.branch_product_variants v0
  where v0.id = p_branch_variant_id;
  if found then
    perform 1
    from public.branches b
    where b.id = v_branch_id
      and b.is_active
      and not b.is_main_branch
    for share;
    perform 1
    from public.branch_products
    where branch_id = v_branch_id
      and product_id = v_product_id
    for no key update;
  end if;

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

commit;
