-- Approach A Phase 2: allow exact 0.5-step piece_stock recipe quantities and balances.
-- Forward-only. Does not rescale existing balances, product IDs, or history.
-- Does not enable client FRACTIONAL_STOCK_USES_ENABLED.
-- Transfer/return/shift-close integer restrictions remain for Phase 4 (documented below).
--
-- Phase 4 still needed for:
--   parse_inventory_quantity piece arm (whole digits only)
--   stock_transfer_items_piece_whole_chk / stock_return_items_piece_whole_chk
--   correct_cashier_stock_count / record_main_inventory_waste / record_branch_stock_action integer args
--   shift_product_* bigint columns + finalize_cashier_shift_reconciliation ::bigint casts
--   leftover return trunc(on_hand) filters
--   client piece Zod/regex validators and close-count helpers

begin;

-- ---------------------------------------------------------------------------
-- 1) Shared half-step predicate (exact; no scale rounding of invalid values)
-- ---------------------------------------------------------------------------
create or replace function public.is_piece_half_step(p_qty numeric)
returns boolean
language sql
immutable
as $$
  select p_qty is not null
     and (p_qty * 2) = trunc(p_qty * 2);
$$;

revoke all on function public.is_piece_half_step(numeric) from public, anon, authenticated;

comment on function public.is_piece_half_step(numeric) is
  'True when qty is an exact multiple of 0.5 (including whole numbers). Used before any numeric coercion of piece stock.';

-- ---------------------------------------------------------------------------
-- 2) Balances may be 9.5 etc. Movements may be ±0.5 for sales.
--    Transfer/return item CHECKs intentionally unchanged (Phase 4).
-- ---------------------------------------------------------------------------
create or replace function public.guard_branch_inventory_quantity_mode()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_mode public.inventory_mode;
  v_unit text;
begin
  select p.inventory_mode, p.stock_unit_code into v_mode, v_unit
  from public.products p where p.id = new.product_id;
  if v_mode is null then
    raise exception 'Product is missing for inventory balance.' using errcode = '22023';
  end if;
  -- Portion counting units stay whole (no physical half-steps / no double conversion).
  if v_mode = 'piece_stock'
     and v_unit in ('half_egg', 'half_serving', 'quarter_serving')
     and new.quantity_on_hand <> trunc(new.quantity_on_hand) then
    raise exception 'Piece-stock balances must be whole numbers.' using errcode = '22023';
  end if;
  if v_mode = 'piece_stock'
     and coalesce(v_unit, '') not in ('half_egg', 'half_serving', 'quarter_serving')
     and not public.is_piece_half_step(new.quantity_on_hand) then
    raise exception 'Piece-stock balances must be whole numbers or exact half-steps (n.0 / n.5).'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

alter table public.inventory_movements
  drop constraint if exists inventory_movements_piece_whole_chk;
alter table public.inventory_movements
  add constraint inventory_movements_piece_whole_chk
  check (
    inventory_mode <> 'piece_stock'
    or public.is_piece_half_step(quantity)
  );

-- Portion-coded products still require whole movement quantities (half-step CHECK alone is not enough).
create or replace function public.guard_inventory_movement_piece_quantity()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_unit text;
begin
  if new.inventory_mode is distinct from 'piece_stock' then
    return new;
  end if;
  select p.stock_unit_code into v_unit from public.products p where p.id = new.product_id;
  if v_unit in ('half_egg', 'half_serving', 'quarter_serving')
     and new.quantity <> trunc(new.quantity) then
    raise exception 'Piece-stock movements must be whole numbers.' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists inventory_movements_guard_piece_quantity on public.inventory_movements;
create trigger inventory_movements_guard_piece_quantity
before insert or update of quantity, product_id, inventory_mode on public.inventory_movements
for each row execute function public.guard_inventory_movement_piece_quantity();

revoke all on function public.guard_inventory_movement_piece_quantity() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3) product_stock_uses.quantity → numeric half-steps 0.5..99
-- ---------------------------------------------------------------------------
alter table public.product_stock_uses
  alter column quantity type numeric(14,1)
  using quantity::numeric(14,1);

alter table public.product_stock_uses
  drop constraint if exists product_stock_uses_quantity_check;

alter table public.product_stock_uses
  add constraint product_stock_uses_quantity_half_step_chk
  check (
    quantity >= 0.5
    and quantity <= 99
    and public.is_piece_half_step(quantity)
  );

comment on column public.product_stock_uses.quantity is
  'Stock units of the ingredient used per ONE sold unit. Exact half-steps 0.5–99. Portion-coded ingredients (half_egg/half_serving/quarter_serving) must stay whole integers.';

-- ---------------------------------------------------------------------------
-- 4) normalize_product_stock_uses — validate half-steps before coercion
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
  v_qty numeric(14,1);
  v_variant_id text;
  v_variant_name text;
begin
  if not public.is_main_branch_manager() then
    raise exception 'Unauthorized: Main Branch Manager access is required.'
      using errcode = '42501';
  end if;

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

    if jsonb_typeof(v_line->'ingredient_product_id') is distinct from 'string' then
      raise exception 'invalid_stock_use: Each stock use needs an ingredient_product_id.'
        using errcode = '22023';
    end if;
    v_ingredient := lower(btrim(v_line->>'ingredient_product_id'));
    if v_ingredient <> 'self' and v_ingredient !~ v_uuid_re then
      raise exception 'invalid_stock_use: ingredient_product_id must be a product id or "self".'
        using errcode = '22023';
    end if;

    -- Intermediate safety: this migration widens the table CHECK to half-steps, but RPC
    -- saves stay whole-number until 20261123130000 installs the owner feature gate.
    v_quantity := btrim(v_line->>'quantity');
    if v_quantity is null or v_quantity !~ '^[1-9][0-9]?$' then
      raise exception 'invalid_stock_use: Quantity must be a whole number from 1 to 99.'
        using errcode = '22023';
    end if;
    v_qty := v_quantity::numeric(14,1);
    if v_qty < 1 or v_qty > 99 or v_qty <> trunc(v_qty) then
      raise exception 'invalid_stock_use: Quantity must be a whole number from 1 to 99.'
        using errcode = '22023';
    end if;

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
      'quantity', v_qty,
      'variant_id', v_variant_id,
      'variant_name', v_variant_name
    ));
  end loop;

  if exists (
    select 1
    from jsonb_to_recordset(v_out) as l(ingredient text, quantity numeric, variant_id text, variant_name text)
    group by coalesce(l.variant_id, 'n:' || coalesce(l.variant_name, '')), l.ingredient
    having count(*) > 1
  ) then
    raise exception 'duplicate_stock_use: Each ingredient may appear only once per product or variant.'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(v_out) as l(ingredient text, quantity numeric, variant_id text, variant_name text)
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
-- 5) apply_product_stock_uses — numeric quantities; portion ingredients stay whole
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

  if p_stock_uses is null then
    return;
  end if;

  perform 1 from public.products where id = p_product_id for update;
  if not found then
    raise exception 'product_not_found: That product could not be found.'
      using errcode = '22023';
  end if;

  for v_line in
    select *
    from jsonb_to_recordset(p_stock_uses) as l(ingredient text, quantity numeric, variant_id text, variant_name text)
  loop
    v_ingredient := case when v_line.ingredient = 'self' then p_product_id else v_line.ingredient::uuid end;

    if exists (
      select 1
      from public.products p
      where p.id = v_ingredient
        and p.stock_unit_code in ('half_egg', 'half_serving', 'quarter_serving')
        and v_line.quantity <> trunc(v_line.quantity)
    ) then
      raise exception
        'invalid_stock_use: Portion-unit ingredients require a whole number of stock units (1–99).'
        using errcode = '22023';
    end if;

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

  if exists (
    select 1
    from jsonb_to_recordset(v_resolved) as r(variant_id uuid, ingredient_product_id uuid, quantity numeric)
    group by r.variant_id, r.ingredient_product_id
    having count(*) > 1
  ) then
    raise exception 'duplicate_stock_use: Each ingredient may appear only once per product or variant.'
      using errcode = '22023';
  end if;

  perform 1
  from public.products p
  where p.id in (
    select distinct r.ingredient_product_id
    from jsonb_to_recordset(v_resolved) as r(variant_id uuid, ingredient_product_id uuid, quantity numeric)
  )
  order by p.id
  for key share;

  delete from public.product_stock_uses u
  where u.product_id = p_product_id
    and not exists (
      select 1
      from jsonb_to_recordset(v_resolved) as r(variant_id uuid, ingredient_product_id uuid, quantity numeric)
      where r.variant_id is not distinct from u.variant_id
        and r.ingredient_product_id = u.ingredient_product_id
    );

  insert into public.product_stock_uses(product_id, variant_id, ingredient_product_id, quantity)
  select p_product_id, r.variant_id, r.ingredient_product_id, r.quantity
  from jsonb_to_recordset(v_resolved) as r(variant_id uuid, ingredient_product_id uuid, quantity numeric)
  where r.variant_id is null
  on conflict (product_id, ingredient_product_id) where variant_id is null
  do update set quantity = excluded.quantity
  where public.product_stock_uses.quantity is distinct from excluded.quantity;

  insert into public.product_stock_uses(product_id, variant_id, ingredient_product_id, quantity)
  select p_product_id, r.variant_id, r.ingredient_product_id, r.quantity
  from jsonb_to_recordset(v_resolved) as r(variant_id uuid, ingredient_product_id uuid, quantity numeric)
  where r.variant_id is not null
  on conflict (variant_id, ingredient_product_id) where variant_id is not null
  do update set quantity = excluded.quantity
  where public.product_stock_uses.quantity is distinct from excluded.quantity;
end;
$$;

revoke all on function public.normalize_product_stock_uses(jsonb) from public, anon, authenticated;
revoke all on function public.apply_product_stock_uses(uuid, jsonb) from public, anon, authenticated;

commit;
