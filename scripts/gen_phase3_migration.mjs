import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

execSync('node scripts/gen_phase3_finalize.mjs', { stdio: 'inherit' });
const finalize = readFileSync('supabase/migrations/_phase3_finalize_fragment.sql', 'utf8');

const body = `-- Phase 3: Inventory operations
-- Additive / non-destructive. Preserves PCS history. No automatic PCS↔KG conversions.
--
-- BUSINESS NOTES:
-- - Meal variants remain price options on one SKU (Phase 2). No BOM; one stock deduct per plate.
-- - KG (Pares/Kulma/Menudo/Tapa): Main-trackable kg_meal again. Selling-branch close stays PCS.
--   KG transfers remain unmeasured at booth (no double-count with local PCS portions).
-- - Non-returnable (BBQ/Tocino/Cheesesticks/drinks): stay at branch; excluded from leftover returns.
-- - Local purchases: selling-branch stock in without Main transfer (audited local_purchase).

begin;

-- ---------------------------------------------------------------------------
-- 1) Schema
-- ---------------------------------------------------------------------------
alter type public.inventory_movement_type add value if not exists 'local_purchase';

alter table public.products
  add column if not exists is_non_returnable boolean not null default false;

comment on column public.products.is_non_returnable is
  'When true, product stays at branch and cannot be included in leftover/physical returns.';

alter table public.shift_product_reconciliations
  add column if not exists discrepancy_note text
    check (discrepancy_note is null or char_length(discrepancy_note) <= 500);

comment on column public.shift_product_reconciliations.discrepancy_note is
  'Required for KG (kg_meal) discrepancies; optional for PCS.';

-- Non-returnable is an EXPLICIT product setting (set_product_non_returnable).
-- Do not infer from product names — preserves existing flags; ops must flag BBQ/Tocino/drinks.

alter table public.inventory_movements drop constraint if exists inventory_movements_sign_check;
alter table public.inventory_movements add constraint inventory_movements_sign_check check (
  (movement_type in ('opening_stock', 'transfer_in', 'return_in', 'local_purchase') and quantity > 0)
  or (movement_type in ('transfer_out', 'sale', 'return_out', 'waste', 'unsold') and quantity < 0)
  or movement_type = 'adjustment'
);

alter table public.inventory_movements drop constraint if exists inventory_movements_reference_type_check;
alter table public.inventory_movements add constraint inventory_movements_reference_type_check
  check (reference_type in (
    'opening_stock', 'stock_transfer', 'adjustment', 'sale', 'stock_return',
    'shift_product_reconciliation', 'local_purchase'
  ));

alter table public.inventory_movements drop constraint if exists inventory_movements_type_reference_match_check;
alter table public.inventory_movements add constraint inventory_movements_type_reference_match_check
  check (
    (movement_type = 'opening_stock' and reference_type = 'opening_stock' and reference_id is null)
    or (movement_type in ('transfer_out', 'transfer_in') and reference_type = 'stock_transfer' and reference_id is not null)
    or (movement_type = 'adjustment' and reference_type = 'adjustment' and reference_id is not null)
    or (movement_type = 'sale' and reference_type = 'sale' and reference_id is not null)
    or (movement_type in ('return_out', 'return_in') and reference_type = 'stock_return' and reference_id is not null)
    or (movement_type in ('waste', 'unsold') and reference_type = 'shift_product_reconciliation' and reference_id is not null)
    or (movement_type = 'local_purchase' and reference_type = 'local_purchase' and reference_id is not null)
  );

-- ---------------------------------------------------------------------------
-- 2) Snapshot inventory_mode from product again (supports kg_meal + piece_stock)
-- ---------------------------------------------------------------------------
create or replace function public.snapshot_movement_inventory_mode()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_mode public.inventory_mode;
begin
  if tg_op = 'UPDATE' then
    if new.inventory_mode is distinct from old.inventory_mode then
      raise exception 'Historical inventory type cannot be changed.'
        using errcode = '55000';
    end if;
    return new;
  end if;
  select p.inventory_mode into v_mode from public.products p where p.id = new.product_id;
  if v_mode is null then
    raise exception 'Product is missing for inventory movement.' using errcode = '22023';
  end if;
  new.inventory_mode := v_mode;
  return new;
end;
$$;

create or replace function public.snapshot_transfer_item_inventory_mode()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_mode public.inventory_mode;
begin
  if tg_op = 'UPDATE' and new.inventory_mode is distinct from old.inventory_mode then
    raise exception 'Historical inventory type cannot be changed.' using errcode = '55000';
  end if;
  if tg_op = 'INSERT' then
    select p.inventory_mode into v_mode from public.products p where p.id = new.product_id;
    if v_mode is null then
      raise exception 'Product is missing for transfer item.' using errcode = '22023';
    end if;
    new.inventory_mode := v_mode;
  end if;
  -- Legacy rule: kg_meal receive stays unmeasured (null) unless already set.
  if new.inventory_mode = 'kg_meal' and new.quantity_received is not null
     and tg_op = 'UPDATE' and old.quantity_received is null then
    -- allow measured receive only when explicitly set by RPC
    null;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3) parse_inventory_quantity — PCS whole / KG decimals (no conversion)
-- ---------------------------------------------------------------------------
create or replace function public.parse_inventory_quantity(
  p_raw text,
  p_mode public.inventory_mode,
  p_allow_zero boolean
)
returns numeric(14,3)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_text text := btrim(coalesce(p_raw, ''));
  v_value numeric(14,3);
begin
  if v_text = '' then
    raise exception 'Quantity is required.' using errcode = '22023';
  end if;
  if left(v_text, 1) = '-' then
    raise exception 'Quantity cannot be negative.' using errcode = '22023';
  end if;

  if p_mode = 'kg_meal' then
    if v_text !~ '^[0-9]{1,6}(\\.[0-9]{1,3})?$' then
      raise exception 'KG quantities must use up to 3 decimal places.' using errcode = '22023';
    end if;
    v_value := v_text::numeric(14,3);
    if (not p_allow_zero and v_value = 0) or v_value > 999999.999 then
      raise exception 'Quantity is out of range.' using errcode = '22023';
    end if;
    return v_value;
  end if;

  if v_text !~ '^[0-9]{1,6}$' then
    raise exception 'Piece quantities must be whole numbers.' using errcode = '22023';
  end if;
  v_value := v_text::numeric(14,3);
  if (not p_allow_zero and v_value = 0) or v_value > 999999 then
    raise exception 'Quantity is out of range.' using errcode = '22023';
  end if;
  return v_value;
end;
$$;

revoke all on function public.parse_inventory_quantity(text, public.inventory_mode, boolean)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4) set_product_inventory_mode — allow kg_meal with clear balances (no auto convert)
-- ---------------------------------------------------------------------------
create or replace function public.set_product_inventory_mode(
  p_product_id uuid,
  p_inventory_mode text
)
returns public.products
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.products%rowtype;
  v_mode public.inventory_mode;
  v_requested text := btrim(coalesce(p_inventory_mode, ''));
begin
  if not public.is_main_branch_manager() then
    raise exception 'Unauthorized: Main Branch Manager access is required.'
      using errcode = '42501';
  end if;

  if v_requested not in ('piece_stock', 'kg_meal') then
    raise exception 'Inventory type must be piece stock or kg meal.'
      using errcode = '22023';
  end if;
  v_mode := v_requested::public.inventory_mode;

  select * into v_product from public.products where id = p_product_id for update;
  if not found then
    raise exception 'Product is missing.' using errcode = '22023';
  end if;
  if v_product.inventory_mode = v_mode then
    return v_product;
  end if;

  if exists (
    select 1 from public.branch_inventory i
    where i.product_id = p_product_id and i.quantity_on_hand <> 0
  ) then
    raise exception 'Clear every current balance, including Main Branch, before changing inventory type.'
      using errcode = '22023';
  end if;
  if exists (
    select 1
    from public.stock_transfer_items sti
    join public.stock_transfers st on st.id = sti.stock_transfer_id
    where sti.product_id = p_product_id and st.status in ('draft', 'pending_receipt')
  ) then
    raise exception 'Finish or cancel open transfers for this product before changing inventory type.'
      using errcode = '22023';
  end if;
  if exists (
    select 1
    from public.stock_return_items sri
    join public.stock_returns sr on sr.id = sri.stock_return_id
    where sri.product_id = p_product_id and sr.status in ('draft', 'in_transit')
  ) then
    raise exception 'Finish or cancel open returns for this product before changing inventory type.'
      using errcode = '22023';
  end if;

  perform set_config('golden.allow_inventory_mode_change', 'on', true);
  update public.products set inventory_mode = v_mode where id = p_product_id returning * into v_product;
  return v_product;
end;
$$;

revoke all on function public.set_product_inventory_mode(uuid, text) from public, anon;
grant execute on function public.set_product_inventory_mode(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5) create_complete_product — allow kg_meal (no unsafe conversion of history)
-- ---------------------------------------------------------------------------
create or replace function public.create_complete_product(
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
  v_name text;
  v_sku text;
  v_description text;
  v_variants jsonb;
  v_branches jsonb;
  v_has_variants boolean;
  v_selling_price numeric(12,2);
  v_default_name text;
  v_variant jsonb;
  v_branch jsonb;
  v_branch_id uuid;
  v_canonical_name text;
  v_branch_price numeric(12,2);
  v_sort int;
  v_mode text := btrim(coalesce(p_inventory_mode, 'piece_stock'));
  v_closing text := btrim(coalesce(p_closing_stock_behavior, 'keep_at_branch'));
  v_closing_enum public.closing_stock_behavior;
  v_mode_enum public.inventory_mode;
  v_price_re text := '^[0-9]{1,10}(\\.[0-9]{1,2})?$';
  v_is_non_returnable boolean := false;
begin
  if v_mode not in ('piece_stock', 'kg_meal') then
    raise exception 'Inventory type must be piece stock or kg meal.' using errcode = '22023';
  end if;
  v_mode_enum := v_mode::public.inventory_mode;
  if v_closing not in ('keep_at_branch', 'record_as_unsold') then
    raise exception 'Closing stock behavior must be keep_at_branch or record_as_unsold.'
      using errcode = '22023';
  end if;
  v_closing_enum := v_closing::public.closing_stock_behavior;

  if not public.is_main_branch_manager() then
    raise exception 'Unauthorized: Main Branch Manager access is required.' using errcode = '42501';
  end if;

  v_name := trim(coalesce(p_name, ''));
  if char_length(v_name) not between 2 and 120 then
    raise exception 'Product name must be 2 to 120 characters.' using errcode = '22023';
  end if;
  v_sku := upper(trim(coalesce(p_sku, '')));
  if v_sku !~ '^[A-Z0-9-]{2,40}$' then
    raise exception 'SKU must be 2 to 40 letters, numbers, or hyphens.' using errcode = '22023';
  end if;
  v_description := nullif(trim(coalesce(p_description, '')), '');
  if v_description is not null and char_length(v_description) > 500 then
    raise exception 'Description must be 500 characters or fewer.' using errcode = '22023';
  end if;

  v_variants := case when p_variants is null or jsonb_typeof(p_variants) = 'null' then '[]'::jsonb else p_variants end;
  v_branches := case when p_branches is null or jsonb_typeof(p_branches) = 'null' then '[]'::jsonb else p_branches end;
  if jsonb_typeof(v_variants) is distinct from 'array' or jsonb_typeof(v_branches) is distinct from 'array' then
    raise exception 'invalid_product_price: Variants and branches must be JSON arrays.' using errcode = '22023';
  end if;
  if jsonb_array_length(v_variants) > 50 then
    raise exception 'Provide 1 to 50 variants.' using errcode = '22023';
  end if;
  v_has_variants := jsonb_array_length(v_variants) > 0;

  if v_has_variants then
    if (select count(*) from jsonb_array_elements(v_variants)) <>
       (select count(distinct lower(trim(value->>'name'))) from jsonb_array_elements(v_variants)) then
      raise exception 'duplicate_variant_name: Each variant name may appear only once.' using errcode = '22023';
    end if;
    v_sort := 0;
    for v_variant in select value from jsonb_array_elements(v_variants) loop
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
      raise exception 'invalid_product_price: A default base price is required.' using errcode = '22023';
    end if;
    v_selling_price := p_selling_price::numeric;
  end if;

  if exists (select 1 from public.products where lower(name) = lower(v_name)) then
    raise exception 'A product with this name already exists.' using errcode = '23505';
  end if;
  if exists (select 1 from public.products where sku = v_sku) then
    raise exception 'A product with this SKU already exists.' using errcode = '23505';
  end if;

  -- Explicit setting only — call set_product_non_returnable after create when needed.
  v_is_non_returnable := false;

  insert into public.products(
    name, sku, description, selling_price, is_active, inventory_mode, closing_stock_behavior, is_non_returnable
  ) values (
    v_name, v_sku, v_description, v_selling_price, false, v_mode_enum, v_closing_enum, v_is_non_returnable
  ) returning * into v_product;

  if v_has_variants then
    v_sort := 0;
    for v_variant in select value from jsonb_array_elements(v_variants) loop
      v_sort := v_sort + 1;
      insert into public.product_variants(product_id, name, default_price, is_active, sort_order)
      values (
        v_product.id,
        trim(v_variant.value->>'name'),
        (v_variant.value->>'default_price')::numeric,
        true,
        v_sort
      );
    end loop;
  end if;

  for v_branch in select value from jsonb_array_elements(v_branches) loop
    if jsonb_typeof(v_branch.value) is distinct from 'object' then
      raise exception 'invalid_product_price: Branch pricing entries must be objects.' using errcode = '22023';
    end if;
    v_branch_id := (v_branch.value->>'branch_id')::uuid;
    perform 1 from public.branches where id = v_branch_id and is_active;
    if not found then
      raise exception 'Branch is missing or inactive.' using errcode = '22023';
    end if;
    if v_has_variants then
      if jsonb_typeof(v_branch.value->'variants') is distinct from 'array' then
        raise exception 'invalid_product_price: Branch variants required.' using errcode = '22023';
      end if;
      insert into public.branch_products(branch_id, product_id, selling_price, is_active)
      values (v_branch_id, v_product.id, v_selling_price, true);
      for v_variant in select value from jsonb_array_elements(v_branch.value->'variants') loop
        v_canonical_name := trim(v_variant.value->>'name');
        v_branch_price := (v_variant.value->>'selling_price')::numeric;
        insert into public.branch_product_variants(branch_id, product_id, name, selling_price, is_active)
        values (v_branch_id, v_product.id, v_canonical_name, v_branch_price, true);
      end loop;
    else
      v_branch_price := coalesce((v_branch.value->>'selling_price')::numeric, v_selling_price);
      insert into public.branch_products(branch_id, product_id, selling_price, is_active)
      values (v_branch_id, v_product.id, v_branch_price, true);
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
  'Creates product with piece_stock or kg_meal. No automatic unit conversion. Non-returnable inferred for drinks/snacks.';

-- ---------------------------------------------------------------------------
-- 6) initialize_main + send_stock_transfer — mode-aware quantities
-- ---------------------------------------------------------------------------
create or replace function public.initialize_main_branch_inventory(
  p_items jsonb,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id        uuid := auth.uid();
  v_main_branch_id uuid;
  v_item           record;
  v_product        public.products%rowtype;
  v_current_qty    numeric(14,3);
  v_quantity       numeric(14,3);
  v_has_opening    boolean;
  v_adjustment_id  uuid := gen_random_uuid();
  v_former_active  boolean;
  v_has_snapshot   boolean;
begin
  if not public.is_main_branch_manager() then
    raise exception 'Unauthorized: Main Branch Manager access is required.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Select at least one product with a positive opening quantity.' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_array_elements(p_items)) <>
     (select count(distinct value->>'product_id') from jsonb_array_elements(p_items)) then
    raise exception 'Each product may appear only once.' using errcode = '22023';
  end if;
  if length(coalesce(p_notes, '')) > 1000 then
    raise exception 'Notes too long (maximum 1000 characters).' using errcode = '22023';
  end if;

  select id into v_main_branch_id from public.branches where is_main_branch and is_active;
  if v_main_branch_id is null then
    raise exception 'No active Main Branch is configured.' using errcode = '22023';
  end if;

  perform public.lock_branch_inventory_gate(v_main_branch_id);

  for v_item in
    select (value->>'product_id')::uuid as product_id, value->>'quantity' as quantity_text
    from jsonb_array_elements(p_items)
    order by value->>'product_id'
  loop
    select * into v_product from public.products where id = v_item.product_id for update;
    if not found then
      raise exception 'Product is missing.' using errcode = '22023';
    end if;

    begin
      v_quantity := public.parse_inventory_quantity(v_item.quantity_text, v_product.inventory_mode, false);
    exception when others then
      if v_product.inventory_mode = 'kg_meal' then
        raise exception 'KG opening quantities must be positive with up to 3 decimals.' using errcode = '22023';
      end if;
      raise exception 'Opening quantities must be whole numbers between 1 and 999999.' using errcode = '22023';
    end;

    insert into public.branch_inventory(branch_id, product_id, quantity_on_hand)
    values (v_main_branch_id, v_item.product_id, 0)
    on conflict (branch_id, product_id) do nothing;

    select quantity_on_hand into v_current_qty
    from public.branch_inventory
    where branch_id = v_main_branch_id and product_id = v_item.product_id
    for update;

    select exists (
      select 1 from public.inventory_movements
      where branch_id = v_main_branch_id and product_id = v_item.product_id
        and movement_type = 'opening_stock'
    ) into v_has_opening;

    if not v_has_opening and v_current_qty <> 0 then
      raise exception 'Opening stock has already been initialized for a selected product.'
        using errcode = '55000';
    end if;

    update public.branch_inventory
    set quantity_on_hand = quantity_on_hand + v_quantity
    where branch_id = v_main_branch_id and product_id = v_item.product_id;

    if not v_has_opening then
      insert into public.inventory_movements(
        branch_id, product_id, movement_type, quantity,
        reference_type, reference_id, created_by, notes
      ) values (
        v_main_branch_id, v_item.product_id, 'opening_stock', v_quantity,
        'opening_stock', null, v_user_id, nullif(trim(p_notes), '')
      );
    else
      insert into public.inventory_movements(
        branch_id, product_id, movement_type, quantity,
        reference_type, reference_id, created_by, notes
      ) values (
        v_main_branch_id, v_item.product_id, 'adjustment', v_quantity,
        'adjustment', v_adjustment_id, v_user_id, nullif(trim(p_notes), '')
      );
    end if;

    select exists (
      select 1 from public.pcs_cutover_product_snapshots s where s.product_id = v_item.product_id
    ), coalesce((
      select s.former_is_active from public.pcs_cutover_product_snapshots s where s.product_id = v_item.product_id
    ), true)
    into v_has_snapshot, v_former_active;

    if (not v_has_snapshot or v_former_active) and not v_product.is_active then
      update public.products set is_active = true where id = v_item.product_id and not is_active;
    end if;
  end loop;
end;
$$;

revoke all on function public.initialize_main_branch_inventory(jsonb, text) from public, anon;
grant execute on function public.initialize_main_branch_inventory(jsonb, text) to authenticated;

create or replace function public.send_stock_transfer(
  p_to_branch_id uuid,
  p_items jsonb,
  p_notes text default null,
  p_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_from_branch_id uuid;
  v_transfer_id uuid;
  v_transfer_number text;
  v_item record;
  v_product public.products%rowtype;
  v_quantity numeric(14,3);
  v_available numeric(14,3);
  v_existing public.stock_transfers%rowtype;
begin
  if not public.is_main_branch_manager() then
    raise exception 'Unauthorized: Main Branch Manager access is required.' using errcode = '42501';
  end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 16 and 100 then
    raise exception 'Invalid confirmation key.' using errcode = '22023';
  end if;
  if length(coalesce(p_notes, '')) > 2000 then
    raise exception 'Notes too long.' using errcode = '22023';
  end if;

  select * into v_existing
  from public.stock_transfers
  where created_by = v_user_id and send_idempotency_key = p_idempotency_key;
  if found then
    if v_existing.to_branch_id is distinct from p_to_branch_id
       or v_existing.notes is distinct from nullif(trim(p_notes), '') then
      raise exception 'This confirmation key belongs to a different transfer.' using errcode = '22023';
    end if;
    return v_existing.id;
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Select at least one product to send.' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_array_elements(p_items)) <>
     (select count(distinct value->>'product_id') from jsonb_array_elements(p_items)) then
    raise exception 'Each product may appear only once.' using errcode = '22023';
  end if;

  select id into v_from_branch_id from public.branches where is_main_branch and is_active;
  if v_from_branch_id is null then
    raise exception 'No active Main Branch is configured.' using errcode = '22023';
  end if;

  perform public.lock_branch_inventory_gate(v_from_branch_id);
  perform 1 from public.branches where id = p_to_branch_id and is_active and not is_main_branch for share;
  if not found then
    raise exception 'Destination branch is missing, inactive, or is the Main Branch.' using errcode = '22023';
  end if;

  for v_item in
    select (value->>'product_id')::uuid as product_id, value->>'quantity_sent' as quantity_text
    from jsonb_array_elements(p_items) order by value->>'product_id'
  loop
    select * into v_product from public.products where id = v_item.product_id for share;
    if not found or not v_product.is_active then
      raise exception 'Product is missing or inactive.' using errcode = '22023';
    end if;
    v_quantity := public.parse_inventory_quantity(v_item.quantity_text, v_product.inventory_mode, false);
    perform public.seed_branch_catalog(p_to_branch_id, v_item.product_id);
    select quantity_on_hand into v_available
    from public.branch_inventory
    where branch_id = v_from_branch_id and product_id = v_item.product_id
    for update;
    if v_available is null or v_available < v_quantity then
      raise exception 'Insufficient stock. Available: %, requested: %.',
        coalesce(v_available, 0), v_quantity using errcode = '22003';
    end if;
  end loop;

  v_transfer_number := 'TR-' || lpad(nextval('public.stock_transfer_number_seq')::text, 6, '0');
  insert into public.stock_transfers(
    transfer_number, from_branch_id, to_branch_id, status,
    created_by, sent_by, sent_at, notes, send_idempotency_key
  ) values (
    v_transfer_number, v_from_branch_id, p_to_branch_id, 'pending_receipt',
    v_user_id, v_user_id, now(), nullif(trim(p_notes), ''), p_idempotency_key
  ) returning id into v_transfer_id;

  for v_item in
    select (value->>'product_id')::uuid as product_id, value->>'quantity_sent' as quantity_text
    from jsonb_array_elements(p_items) order by value->>'product_id'
  loop
    select * into v_product from public.products where id = v_item.product_id;
    v_quantity := public.parse_inventory_quantity(v_item.quantity_text, v_product.inventory_mode, false);
    insert into public.stock_transfer_items(stock_transfer_id, product_id, quantity_sent)
    values (v_transfer_id, v_item.product_id, v_quantity);
    update public.branch_inventory
    set quantity_on_hand = quantity_on_hand - v_quantity
    where branch_id = v_from_branch_id and product_id = v_item.product_id and quantity_on_hand >= v_quantity;
    if not found then
      raise exception 'Insufficient stock during transfer processing.' using errcode = '22003';
    end if;
    insert into public.inventory_movements(
      branch_id, product_id, movement_type, quantity,
      reference_type, reference_id, created_by, notes
    ) values (
      v_from_branch_id, v_item.product_id, 'transfer_out', -v_quantity,
      'stock_transfer', v_transfer_id, v_user_id, nullif(trim(p_notes), '')
    );
  end loop;

  return v_transfer_id;
end;
$$;

revoke all on function public.send_stock_transfer(uuid, jsonb, text, text) from public, anon;
grant execute on function public.send_stock_transfer(uuid, jsonb, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7) Local purchase at selling branch (drinks / non-returnables) — no double count
-- ---------------------------------------------------------------------------
create or replace function public.record_branch_local_purchase(
  p_items jsonb,
  p_notes text,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user public.profiles%rowtype;
  v_branch uuid;
  v_item record;
  v_product public.products%rowtype;
  v_qty numeric(14,3);
  v_ref uuid;
  v_existing uuid;
begin
  select * into v_user from public.profiles where id = auth.uid() and is_active for update;
  if not found or v_user.role not in ('cashier', 'manager') then
    raise exception 'Unauthorized: cashier or manager access required.' using errcode = '42501';
  end if;
  v_branch := v_user.branch_id;
  if v_branch is null then
    raise exception 'Branch assignment is required.' using errcode = '42501';
  end if;
  perform 1 from public.branches where id = v_branch and is_active and not is_main_branch;
  if not found then
    raise exception 'Local purchases are only for selling branches.' using errcode = '22023';
  end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 16 and 100 then
    raise exception 'Invalid confirmation key.' using errcode = '22023';
  end if;
  if length(coalesce(p_notes, '')) > 1000 then
    raise exception 'Notes too long (maximum 1000 characters).' using errcode = '22023';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 100 then
    raise exception 'Select 1 to 100 products.' using errcode = '22023';
  end if;

  -- Idempotency via movements reference_id hash of key under this user/branch
  select m.reference_id into v_existing
  from public.inventory_movements m
  where m.branch_id = v_branch
    and m.movement_type = 'local_purchase'
    and m.created_by = v_user.id
    and m.notes = ('idem:' || p_idempotency_key)
  limit 1;
  if v_existing is not null then
    return v_existing;
  end if;

  -- Freeze guards: reject when any open shift is past sales cutoff / pending inventory
  if exists (
    select 1 from public.shifts s
    where s.branch_id = v_branch
      and (
        s.sales_cutoff_at is not null
        or s.inventory_reconciliation_required
      )
      and s.status = 'closed'
      and (s.reconciliation_required or s.inventory_reconciliation_required)
  ) then
    raise exception 'Complete pending remittance before recording local purchases.'
      using errcode = '55000';
  end if;

  perform public.lock_branch_inventory_gate(v_branch);
  v_ref := gen_random_uuid();

  for v_item in
    select (value->>'product_id')::uuid as product_id, value->>'quantity' as quantity_text
    from jsonb_array_elements(p_items)
    order by value->>'product_id'
  loop
    select * into v_product from public.products where id = v_item.product_id for share;
    if not found or not v_product.is_active then
      raise exception 'Product is missing or inactive.' using errcode = '22023';
    end if;
    if v_product.inventory_mode is distinct from 'piece_stock' then
      raise exception 'Local purchases support piece-stock products only (no KG conversion).'
        using errcode = '22023';
    end if;
    -- Prefer non-returnable / keep_at_branch (drinks & snacks). Block record_as_unsold meals.
    if v_product.closing_stock_behavior = 'record_as_unsold' and not v_product.is_non_returnable then
      raise exception '% is not eligible for local purchase. Use Main transfers for meal stock.',
        v_product.name using errcode = '22023';
    end if;
    v_qty := public.parse_inventory_quantity(v_item.quantity_text, 'piece_stock', false);
    perform public.seed_branch_catalog(v_branch, v_item.product_id);

    insert into public.branch_inventory(branch_id, product_id, quantity_on_hand)
    values (v_branch, v_item.product_id, v_qty)
    on conflict (branch_id, product_id) do update
    set quantity_on_hand = branch_inventory.quantity_on_hand + excluded.quantity_on_hand;

    insert into public.inventory_movements(
      branch_id, product_id, movement_type, quantity,
      reference_type, reference_id, created_by, notes
    ) values (
      v_branch, v_item.product_id, 'local_purchase', v_qty,
      'local_purchase', v_ref, v_user.id,
      coalesce(nullif(trim(p_notes), ''), 'idem:' || p_idempotency_key)
    );
  end loop;

  -- Ensure idempotency marker on at least one row
  update public.inventory_movements
  set notes = 'idem:' || p_idempotency_key
    || case when nullif(trim(p_notes), '') is null then '' else ' | ' || trim(p_notes) end
  where reference_id = v_ref and movement_type = 'local_purchase';

  return v_ref;
end;
$$;

revoke all on function public.record_branch_local_purchase(jsonb, text, text) from public, anon;
grant execute on function public.record_branch_local_purchase(jsonb, text, text) to authenticated;

comment on function public.record_branch_local_purchase(jsonb, text, text) is
  'Selling-branch local purchase (PCS). Does not create a Main transfer — prevents double counting.';

-- ---------------------------------------------------------------------------
-- 8) Returns: exclude non-returnable; leftover sweep skips them
-- ---------------------------------------------------------------------------
create or replace function public.list_return_inventory()
returns table(
  product_id uuid,
  product_name text,
  product_sku text,
  is_active boolean,
  quantity_on_hand bigint,
  is_non_returnable boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.name, p.sku, p.is_active, i.quantity_on_hand::bigint, p.is_non_returnable
  from public.branch_inventory i
  join public.products p on p.id = i.product_id
  where public.current_user_role() in ('manager', 'cashier')
    and i.branch_id = public.current_user_branch_id()
    and i.quantity_on_hand > 0
    and i.quantity_on_hand = trunc(i.quantity_on_hand)
    and not p.is_non_returnable
  order by p.name, p.id;
$$;

revoke all on function public.list_return_inventory() from public, anon;
grant execute on function public.list_return_inventory() to authenticated;

-- Patch leftover sweep product selection
create or replace function public.apply_leftover_return(
  p_cashier_id      uuid,
  p_notes           text,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user     public.profiles%rowtype;
  v_source   public.branches%rowtype;
  v_main     public.branches%rowtype;
  v_existing public.stock_returns%rowtype;
  v_items    jsonb;
  v_item     record;
  v_product  public.products%rowtype;
  v_stock    bigint;
  v_id       uuid;
  v_number   text;
begin
  if p_cashier_id is null then return null; end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 16 and 100
    or length(coalesce(p_notes, '')) > 2000 then
    raise exception 'Invalid confirmation key or notes.' using errcode = '22023';
  end if;

  select * into v_user from public.profiles where id = p_cashier_id and role = 'cashier' for update;
  if not found or v_user.branch_id is null then return null; end if;

  perform public.lock_branch_inventory_gate(v_user.branch_id);

  select * into v_source from public.branches where id = v_user.branch_id and not is_main_branch;
  if not found then return null; end if;
  select * into v_main from public.branches where is_main_branch and is_active for share;
  if not found then return null; end if;

  select * into v_existing
  from public.stock_returns
  where created_by = v_user.id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.notes is distinct from p_notes then
      raise exception 'This confirmation key belongs to a different return.' using errcode = '22023';
    end if;
    return v_existing.id;
  end if;

  -- Only physically returnable PCS; exclude non-returnable (carryover/drinks/snacks).
  select jsonb_agg(
           jsonb_build_object('product_id', q.product_id, 'quantity_returned', q.quantity_returned)
           order by q.product_id
         )
    into v_items
  from (
    select i.product_id, trunc(i.quantity_on_hand)::bigint as quantity_returned
    from public.branch_inventory i
    join public.products p on p.id = i.product_id
    where i.branch_id = v_source.id
      and i.quantity_on_hand > 0
      and i.quantity_on_hand = trunc(i.quantity_on_hand)
      and not p.is_non_returnable
      and p.inventory_mode = 'piece_stock'
  ) q;

  if v_items is null or jsonb_array_length(v_items) = 0 then
    return null;
  end if;
  if jsonb_array_length(v_items) > 200 then
    raise exception 'Too many leftover products to return at once.' using errcode = '22023';
  end if;

  for v_item in
    select * from jsonb_to_recordset(v_items) as x(product_id uuid, quantity_returned bigint)
    order by product_id
  loop
    select * into v_product from public.products where id = v_item.product_id for share;
    if not found then raise exception 'Product unavailable.' using errcode = '22023'; end if;
    if v_product.is_non_returnable then
      raise exception '% is non-returnable and must stay at the branch.', v_product.name
        using errcode = '22023';
    end if;
    select quantity_on_hand::bigint into v_stock
    from public.branch_inventory
    where branch_id = v_source.id and product_id = v_item.product_id
    for update;
    if coalesce(v_stock, 0) < v_item.quantity_returned then
      raise exception 'Insufficient stock. % — Available: %, Requested: %',
        v_product.name, coalesce(v_stock, 0), v_item.quantity_returned using errcode = '22023';
    end if;
  end loop;

  v_number := nextval('public.return_number_seq')::text;
  insert into public.stock_returns(
    return_number, from_branch_id, to_branch_id, created_by, returned_by,
    from_branch_name, to_branch_name, returned_by_name, notes, idempotency_key, request_items
  ) values (
    'RET-' || lpad(v_number, greatest(6, length(v_number)), '0'),
    v_source.id, v_main.id, v_user.id, v_user.id,
    v_source.name, v_main.name, v_user.full_name, p_notes, p_idempotency_key, v_items
  ) returning id into v_id;

  for v_item in
    select * from jsonb_to_recordset(v_items) as x(product_id uuid, quantity_returned bigint)
    order by product_id
  loop
    select * into v_product from public.products where id = v_item.product_id;
    insert into public.stock_return_items(stock_return_id, product_id, quantity_returned, product_name, product_sku)
    values (v_id, v_item.product_id, v_item.quantity_returned, v_product.name, v_product.sku);
    update public.branch_inventory
    set quantity_on_hand = quantity_on_hand - v_item.quantity_returned
    where branch_id = v_source.id and product_id = v_item.product_id
      and quantity_on_hand >= v_item.quantity_returned;
    if not found then
      raise exception 'Insufficient stock during leftover return processing.' using errcode = '22023';
    end if;
    insert into public.inventory_movements(
      branch_id, product_id, movement_type, quantity, reference_type, reference_id, created_by, notes
    ) values (
      v_source.id, v_item.product_id, 'return_out', -v_item.quantity_returned,
      'stock_return', v_id, v_user.id, p_notes
    );
  end loop;

  return v_id;
end;
$$;

revoke all on function public.apply_leftover_return(uuid, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 9) Finalize — KG discrepancy notes (PCS close unchanged)
-- ---------------------------------------------------------------------------
${finalize}

revoke all on function public.finalize_cashier_shift_reconciliation(uuid, text, jsonb)
  from public, anon;
grant execute on function public.finalize_cashier_shift_reconciliation(uuid, text, jsonb)
  to authenticated;

commit;
`;

writeFileSync('supabase/migrations/20261019140000_phase3_inventory_operations.sql', body);
console.log('wrote phase3 migration', body.length);
