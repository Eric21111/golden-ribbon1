-- Phase 3: Inventory operations
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
-- Local purchases use movement_type = adjustment + reference_type = local_purchase
-- (avoids ALTER TYPE ADD VALUE same-transaction limits).

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
-- No name-based auto-classification. Preserve any flags already set by ops.

-- Allow KG decimals on branch_inventory for kg_meal products only (PCS stays whole).
alter table public.branch_inventory
  drop constraint if exists branch_inventory_whole_pcs_chk;

create or replace function public.guard_branch_inventory_quantity_mode()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_mode public.inventory_mode;
begin
  select p.inventory_mode into v_mode from public.products p where p.id = new.product_id;
  if v_mode is null then
    raise exception 'Product is missing for inventory balance.' using errcode = '22023';
  end if;
  if v_mode = 'piece_stock' and new.quantity_on_hand <> trunc(new.quantity_on_hand) then
    raise exception 'Piece-stock balances must be whole numbers.' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists branch_inventory_guard_quantity_mode on public.branch_inventory;
create trigger branch_inventory_guard_quantity_mode
before insert or update of quantity_on_hand, product_id on public.branch_inventory
for each row execute function public.guard_branch_inventory_quantity_mode();

alter table public.inventory_movements drop constraint if exists inventory_movements_sign_check;
alter table public.inventory_movements add constraint inventory_movements_sign_check check (
  (movement_type in ('opening_stock', 'transfer_in', 'return_in') and quantity > 0)
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
    or (movement_type = 'adjustment' and reference_type in ('adjustment', 'local_purchase') and reference_id is not null)
    or (movement_type = 'sale' and reference_type = 'sale' and reference_id is not null)
    or (movement_type in ('return_out', 'return_in') and reference_type = 'stock_return' and reference_id is not null)
    or (movement_type in ('waste', 'unsold') and reference_type = 'shift_product_reconciliation' and reference_id is not null)
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
    if v_text !~ '^[0-9]{1,6}(\.[0-9]{1,3})?$' then
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
-- 5) create_complete_product — keep Revision 7A body.
--    Enable KG after create via set_product_inventory_mode when balances are clear.
-- ---------------------------------------------------------------------------

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
    and m.movement_type = 'adjustment'
    and m.reference_type = 'local_purchase'
    and m.created_by = v_user.id
    and m.notes like ('idem:' || p_idempotency_key || '%')
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
      raise exception
        'KG inventory is Main-tracked only. Local purchases and booth stock counts use piece stock — no automatic KG conversion.'
        using errcode = '22023';
    end if;
    -- Explicit non-returnable setting required (BBQ/Tocino/drinks must be flagged by ops).
    if not v_product.is_non_returnable then
      raise exception '% is not marked non-returnable. Flag it in product settings before local purchase.',
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
      v_branch, v_item.product_id, 'adjustment', v_qty,
      'local_purchase', v_ref, v_user.id,
      'idem:' || p_idempotency_key
        || case when nullif(trim(p_notes), '') is null then '' else ' | ' || trim(p_notes) end
    );
  end loop;

  return v_ref;
end;
$$;

revoke all on function public.record_branch_local_purchase(jsonb, text, text) from public, anon;
grant execute on function public.record_branch_local_purchase(jsonb, text, text) to authenticated;

comment on function public.record_branch_local_purchase(jsonb, text, text) is
  'Selling-branch local purchase (PCS adjustment). Does not create a Main transfer — prevents double counting.';

-- ---------------------------------------------------------------------------
-- 8) Returns: exclude non-returnable; leftover sweep skips them
-- ---------------------------------------------------------------------------
-- Keep OUT columns identical (cannot change return type in place).
drop function if exists public.list_return_inventory();
create function public.list_return_inventory()
returns table(
  product_id uuid,
  product_name text,
  product_sku text,
  is_active boolean,
  quantity_on_hand bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.name, p.sku, p.is_active, i.quantity_on_hand::bigint
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
create or replace function public.finalize_cashier_shift_reconciliation(
  p_shift_id uuid,
  p_actual_cash text,
  p_products jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user public.profiles%rowtype;
  v_shift public.shifts%rowtype;
  v_branch_id uuid;
  v_actual numeric(12,2);
  v_expected numeric(12,2);
  v_cash_diff numeric(12,2);
  v_cash_result public.cash_reconciliation_result;
  v_existing_cash public.shift_reconciliations%rowtype;
  v_needs_inventory boolean;
  v_products jsonb;
  v_item record;
  v_base public.shift_product_close_baselines%rowtype;
  v_agg record;
  v_waste bigint;
  v_actual_rem bigint;
  v_expected_rem bigint;
  v_discrepancy bigint;
  v_result public.shift_product_recon_result;
  v_unsold bigint;
  v_carried bigint;
  v_recon_id uuid;
  v_adjust_ref uuid := gen_random_uuid();
  v_adjust_qty bigint;
  v_live numeric(14,3);
  v_norm_products jsonb := '[]'::jsonb;
  v_existing_products jsonb;
  v_product_summaries jsonb := '[]'::jsonb;
  v_note text;
  v_mode public.inventory_mode;
begin
  select * into v_user
  from public.profiles
  where id = auth.uid() and is_active and role = 'cashier'
  for update;
  if not found then
    raise exception 'Unauthorized: active cashier access required.' using errcode = '42501';
  end if;

  select branch_id into v_branch_id
  from public.shifts
  where id = p_shift_id
    and cashier_id = v_user.id
    and branch_id is not distinct from v_user.branch_id;
  if v_branch_id is null then
    raise exception 'Unable to access this shift.' using errcode = '42501';
  end if;

  -- Branch → exact target shift (no inventory yet; may be read-only idempotent)
  perform public.lock_shift_inventory_gate(v_branch_id, p_shift_id, false, false);

  select * into v_shift from public.shifts where id = p_shift_id;
  if v_shift.status <> 'closed' then
    raise exception 'Only a closed shift can be reconciled.' using errcode = '42501';
  end if;
  if not v_shift.reconciliation_required
     and not v_shift.inventory_reconciliation_required
     and exists (select 1 from public.shift_reconciliations r where r.shift_id = v_shift.id) then
    null;
  elsif not v_shift.reconciliation_required and not v_shift.inventory_reconciliation_required then
    raise exception 'This historical shift does not require reconciliation.' using errcode = '22023';
  end if;

  v_needs_inventory := v_shift.inventory_reconciliation_required
    or exists (select 1 from public.shift_product_close_baselines b where b.shift_id = v_shift.id);

  v_actual := public.parse_actual_cash(p_actual_cash);
  select coalesce(sum(s.total_amount), 0)::numeric(12,2) into v_expected
  from public.sales s
  where s.shift_id = v_shift.id and s.status = 'completed';

  if p_products is null or jsonb_typeof(p_products) = 'null' then
    v_products := '[]'::jsonb;
  elsif jsonb_typeof(p_products) <> 'array' then
    raise exception 'Product reconciliation list is invalid.' using errcode = '22023';
  else
    v_products := p_products;
  end if;

  if (select count(*) from jsonb_array_elements(v_products)) <>
     (select count(distinct value->>'product_id') from jsonb_array_elements(v_products)) then
    raise exception 'Each product may appear only once.' using errcode = '22023';
  end if;

  if v_needs_inventory and exists (
    select 1 from public.shift_product_close_baselines b where b.shift_id = v_shift.id
  ) then
    if exists (
      select 1 from public.shift_product_close_baselines b
      where b.shift_id = v_shift.id
        and not exists (
          select 1 from jsonb_array_elements(v_products) x
          where (x.value->>'product_id')::uuid = b.product_id
        )
    ) then
      raise exception 'Actual remaining is required for every close product.' using errcode = '22023';
    end if;
    if exists (
      select 1 from jsonb_array_elements(v_products) x
      where not exists (
        select 1 from public.shift_product_close_baselines b
        where b.shift_id = v_shift.id and b.product_id = (x.value->>'product_id')::uuid
      )
    ) then
      raise exception 'Unknown product in reconciliation payload.' using errcode = '22023';
    end if;
  elsif v_needs_inventory = false and jsonb_array_length(v_products) > 0 then
    raise exception 'This legacy shift does not accept product inventory counts.' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(norm.obj order by norm.product_id), '[]'::jsonb)
  into v_norm_products
  from (
    select
      (value->>'product_id')::uuid as product_id,
      jsonb_build_object(
        'product_id', (value->>'product_id')::uuid,
        'actual_remaining', public.parse_inventory_quantity(value->>'actual_remaining', 'piece_stock', true)::bigint,
        'waste_quantity', public.parse_inventory_quantity(
          coalesce(nullif(btrim(value->>'waste_quantity'), ''), '0'),
          'piece_stock',
          true
        )::bigint,
        'discrepancy_note', nullif(btrim(coalesce(value->>'discrepancy_note', '')), '')
      ) as obj
    from jsonb_array_elements(v_products)
  ) norm;

  -- Idempotent retry (branch+exact shift already locked; no inventory mutation)
  select * into v_existing_cash from public.shift_reconciliations where shift_id = v_shift.id;
  if found then
    if v_existing_cash.actual_cash is distinct from v_actual then
      raise exception 'This shift has already been reconciled with a different cash amount.'
        using errcode = '22023';
    end if;
    if v_needs_inventory then
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'product_id', r.product_id,
          'actual_remaining', r.actual_remaining,
          'waste_quantity', r.waste_quantity,
          'discrepancy_note', r.discrepancy_note
        )
        order by r.product_id
      ), '[]'::jsonb)
      into v_existing_products
      from public.shift_product_reconciliations r
      where r.shift_id = v_shift.id;
      if v_existing_products is distinct from v_norm_products then
        raise exception 'This shift has already been reconciled with a different inventory payload.'
          using errcode = '22023';
      end if;
    end if;
    -- Heal stuck pending flags after a prior successful remittance (no inventory rewrite).
    update public.shifts
    set reconciliation_required = false,
        inventory_reconciliation_required = false
    where id = v_shift.id
      and (reconciliation_required or inventory_reconciliation_required);
    return jsonb_build_object(
      'shift_id', v_shift.id,
      'shift_status', 'closed',
      'expected_cash', v_existing_cash.expected_cash,
      'actual_cash', v_existing_cash.actual_cash,
      'difference', v_existing_cash.difference,
      'result', v_existing_cash.result,
      'products', public.shift_close_product_summaries(v_shift.id),
      'status', 'reconciled',
      'idempotent', true
    );
  end if;

  -- Mutating path: lock inventory rows now (branch+shift already held)
  perform 1
  from public.branch_inventory bi
  where bi.branch_id = v_branch_id
  order by bi.product_id
  for update;

  if v_needs_inventory and exists (
    select 1 from public.shift_product_close_baselines b where b.shift_id = v_shift.id
  ) then
    for v_item in
      select *
      from jsonb_to_recordset(v_norm_products)
        as x(product_id uuid, actual_remaining bigint, waste_quantity bigint, discrepancy_note text)
      order by product_id
    loop
      select * into v_base
      from public.shift_product_close_baselines
      where shift_id = v_shift.id and product_id = v_item.product_id;

      v_actual_rem := v_item.actual_remaining;
      v_waste := v_item.waste_quantity;
      v_note := nullif(btrim(coalesce(v_item.discrepancy_note, '')), '');
      if v_actual_rem is null or v_actual_rem < 0 or v_waste is null or v_waste < 0 then
        raise exception 'Actual remaining and waste must be whole PCS quantities >= 0.'
          using errcode = '22023';
      end if;
      if length(coalesce(v_note, '')) > 500 then
        raise exception 'Discrepancy note is too long (maximum 500 characters).'
          using errcode = '22023';
      end if;

      select p.inventory_mode into v_mode
      from public.products p
      where p.id = v_base.product_id;
      if v_mode = 'kg_meal' and (v_actual_rem <> 0 or v_waste <> 0) then
        raise exception
          'KG (%) is Main-tracked only. Booth close does not count KG stock — enter 0 remaining and 0 waste.',
          v_base.product_name_snapshot
          using errcode = '22023';
      end if;

      select * into v_agg
      from public.aggregate_shift_product_movements(v_shift, v_base.product_id, v_base.opening_quantity);

      select quantity_on_hand into v_live
      from public.branch_inventory
      where branch_id = v_shift.branch_id and product_id = v_base.product_id;
      if coalesce(v_live, 0) <> v_agg.system_balance_before_waste then
        raise exception 'System stock for % changed unexpectedly during close (live %, expected %).',
          v_base.product_name_snapshot, coalesce(v_live, 0), v_agg.system_balance_before_waste
          using errcode = '55000';
      end if;

      v_expected_rem := v_agg.system_balance_before_waste - v_waste;
      v_discrepancy := v_actual_rem - v_expected_rem;
      v_result := case
        when v_discrepancy = 0 then 'exact'::public.shift_product_recon_result
        when v_discrepancy < 0 then 'shortage'::public.shift_product_recon_result
        else 'excess'::public.shift_product_recon_result
      end;

      if v_discrepancy <> 0 and v_mode = 'kg_meal' and v_note is null then
        raise exception 'KG discrepancy note is required for %.', v_base.product_name_snapshot
          using errcode = '22023';
      end if;

      if v_base.closing_stock_behavior = 'keep_at_branch' then
        v_carried := v_actual_rem;
        v_unsold := 0;
      else
        v_carried := 0;
        v_unsold := v_actual_rem;
      end if;

      insert into public.shift_product_reconciliations (
        shift_id, branch_id, product_id,
        product_name_snapshot, sku_snapshot, closing_stock_behavior,
        opening_quantity, received_quantity, outgoing_quantity, sold_quantity,
        waste_quantity, adjustment_quantity, net_other_movement_quantity,
        expected_remaining, actual_remaining, discrepancy,
        unsold_quantity, carried_quantity, result, discrepancy_note, recorded_by
      ) values (
        v_shift.id, v_shift.branch_id, v_base.product_id,
        v_base.product_name_snapshot, v_base.sku_snapshot, v_base.closing_stock_behavior,
        v_base.opening_quantity, v_agg.received_quantity, v_agg.outgoing_quantity, v_agg.sold_quantity,
        v_waste, v_agg.adjustment_quantity, 0,
        v_expected_rem, v_actual_rem, v_discrepancy,
        v_unsold, v_carried, v_result, v_note, v_user.id
      )
      returning id into v_recon_id;

      v_adjust_qty := (v_actual_rem + v_waste) - v_agg.system_balance_before_waste;
      if v_adjust_qty <> 0 then
        update public.branch_inventory
        set quantity_on_hand = quantity_on_hand + v_adjust_qty
        where branch_id = v_shift.branch_id and product_id = v_base.product_id;
        if not found then
          insert into public.branch_inventory(branch_id, product_id, quantity_on_hand)
          values (v_shift.branch_id, v_base.product_id, greatest(v_adjust_qty, 0));
          if v_adjust_qty < 0 then
            raise exception 'Insufficient stock during close adjustment for %.', v_base.product_name_snapshot
              using errcode = '22023';
          end if;
        end if;
        insert into public.inventory_movements(
          branch_id, product_id, movement_type, quantity,
          reference_type, reference_id, created_by, notes
        ) values (
          v_shift.branch_id, v_base.product_id, 'adjustment', v_adjust_qty,
          'adjustment', v_adjust_ref, v_user.id, 'Shift close inventory reconciliation'
        );
      end if;

      if v_waste > 0 then
        update public.branch_inventory
        set quantity_on_hand = quantity_on_hand - v_waste
        where branch_id = v_shift.branch_id
          and product_id = v_base.product_id
          and quantity_on_hand >= v_waste;
        if not found then
          raise exception 'Insufficient stock during waste write for %.', v_base.product_name_snapshot
            using errcode = '22023';
        end if;
        insert into public.inventory_movements(
          branch_id, product_id, movement_type, quantity,
          reference_type, reference_id, created_by
        ) values (
          v_shift.branch_id, v_base.product_id, 'waste', -v_waste,
          'shift_product_reconciliation', v_recon_id, v_user.id
        );
        insert into public.shift_waste_occurrences(
          shift_id, branch_id, product_id, recorded_by, quantity
        ) values (
          v_shift.id, v_shift.branch_id, v_base.product_id, v_user.id, v_waste
        );
      end if;

      if v_base.closing_stock_behavior = 'record_as_unsold' and v_actual_rem > 0 then
        update public.branch_inventory
        set quantity_on_hand = quantity_on_hand - v_actual_rem
        where branch_id = v_shift.branch_id
          and product_id = v_base.product_id
          and quantity_on_hand >= v_actual_rem;
        if not found then
          raise exception 'Insufficient stock during unsold write for %.', v_base.product_name_snapshot
            using errcode = '22023';
        end if;
        insert into public.inventory_movements(
          branch_id, product_id, movement_type, quantity,
          reference_type, reference_id, created_by
        ) values (
          v_shift.branch_id, v_base.product_id, 'unsold', -v_actual_rem,
          'shift_product_reconciliation', v_recon_id, v_user.id
        );
      end if;

      select quantity_on_hand into v_live
      from public.branch_inventory
      where branch_id = v_shift.branch_id and product_id = v_base.product_id;
      if v_base.closing_stock_behavior = 'keep_at_branch' then
        if coalesce(v_live, 0) <> v_actual_rem then
          raise exception 'Close left unexpected usable stock for %.', v_base.product_name_snapshot
            using errcode = '55000';
        end if;
      else
        if coalesce(v_live, 0) <> 0 then
          raise exception 'Unsold close left usable stock for %.', v_base.product_name_snapshot
            using errcode = '55000';
        end if;
      end if;

      v_product_summaries := v_product_summaries || jsonb_build_array(jsonb_build_object(
        'product_id', v_base.product_id,
        'expected_remaining', v_expected_rem,
        'actual_remaining', v_actual_rem,
        'waste_quantity', v_waste,
        'discrepancy', v_discrepancy,
        'result', v_result,
        'unsold_quantity', v_unsold,
        'carried_quantity', v_carried
      ));
    end loop;
  end if;

  v_cash_diff := v_expected - v_actual;
  v_cash_result := case
    when v_cash_diff = 0 then 'exact'::public.cash_reconciliation_result
    when v_cash_diff > 0 then 'shortage'::public.cash_reconciliation_result
    else 'excess'::public.cash_reconciliation_result
  end;

  insert into public.shift_reconciliations(
    shift_id, branch_id, expected_cash, actual_cash, difference, result, recorded_by
  ) values (
    v_shift.id, v_shift.branch_id, v_expected, v_actual, v_cash_diff, v_cash_result, v_user.id
  );

  update public.shifts
  set reconciliation_required = false,
      inventory_reconciliation_required = false
  where id = v_shift.id;

  return jsonb_build_object(
    'shift_id', v_shift.id,
    'shift_status', 'closed',
    'expected_cash', v_expected,
    'actual_cash', v_actual,
    'difference', v_cash_diff,
    'result', v_cash_result,
    'products', v_product_summaries,
    'status', 'reconciled',
    'idempotent', false
  );
end;
$$;



revoke all on function public.finalize_cashier_shift_reconciliation(uuid, text, jsonb)
  from public, anon;
grant execute on function public.finalize_cashier_shift_reconciliation(uuid, text, jsonb)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 10) create_stock_return — reject non-returnable products
-- ---------------------------------------------------------------------------
create or replace function public.create_stock_return(
  p_items           jsonb,
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
  select * into v_user
  from public.profiles
  where id = auth.uid() and is_active and role in ('manager', 'cashier')
  for update;
  if not found then
    raise exception 'An active Cashier or Manager account is required.' using errcode = '42501';
  end if;
  if v_user.role = 'manager' then
    raise exception 'Returns from selling branches are created by cashiers.' using errcode = '42501';
  end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 16 and 100
    or length(coalesce(p_notes, '')) > 2000 then
    raise exception 'Invalid confirmation key or notes.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'Select products to return.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) not between 1 and 200 then
    raise exception 'Select 1 to 200 products.' using errcode = '22023';
  end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item.value) is distinct from 'object'
      or coalesce(v_item.value->>'quantity_returned', '') !~ '^[1-9][0-9]{0,5}$'
      or coalesce(v_item.value->>'product_id', '') !~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Return quantities must be positive whole numbers (maximum 999999).'
        using errcode = '22023';
    end if;
  end loop;
  select jsonb_agg(jsonb_build_object('product_id', product_id, 'quantity_returned', quantity_returned) order by product_id)
    into v_items
  from (
    select (value->>'product_id')::uuid product_id,
           sum((value->>'quantity_returned')::bigint) quantity_returned
    from jsonb_array_elements(p_items)
    group by 1
  ) q;
  select * into v_existing
  from public.stock_returns
  where created_by = v_user.id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_items <> v_items or v_existing.notes is distinct from p_notes then
      raise exception 'This confirmation key belongs to a different return.' using errcode = '22023';
    end if;
    return v_existing.id;
  end if;

  if v_user.branch_id is null then
    raise exception 'Your assigned branch is unavailable.' using errcode = '42501';
  end if;

  perform public.lock_branch_inventory_gate(v_user.branch_id);

  select * into v_source from public.branches where id = v_user.branch_id and not is_main_branch;
  if not found then
    raise exception 'Your assigned branch is unavailable.' using errcode = '42501';
  end if;
  select * into v_main from public.branches where is_main_branch and is_active for share;
  if not found then
    raise exception 'No active Main Branch is configured.' using errcode = '22023';
  end if;

  for v_item in
    select * from jsonb_to_recordset(v_items) as x(product_id uuid, quantity_returned bigint)
    order by product_id
  loop
    select * into v_product from public.products where id = v_item.product_id for share;
    if not found then
      raise exception 'Product unavailable.' using errcode = '22023';
    end if;
    if v_product.is_non_returnable then
      raise exception '% is non-returnable and must stay at the branch.', v_product.name
        using errcode = '22023';
    end if;
    if v_product.inventory_mode is distinct from 'piece_stock' then
      raise exception
        'KG (%) is Main-tracked only. Booth returns cannot move KG stock.',
        v_product.name
        using errcode = '22023';
    end if;
    select quantity_on_hand::bigint into v_stock
    from public.branch_inventory
    where branch_id = v_source.id and product_id = v_item.product_id
    for update;
    if coalesce(v_stock, 0) < v_item.quantity_returned then
      raise exception 'Insufficient stock. % — Available: %, Requested: %',
        v_product.name, coalesce(v_stock, 0), v_item.quantity_returned
        using errcode = '22023';
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
      raise exception 'Insufficient stock during return processing.' using errcode = '22023';
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

revoke all on function public.create_stock_return(jsonb, text, text) from public, anon;
grant execute on function public.create_stock_return(jsonb, text, text) to authenticated;

create or replace function public.set_product_non_returnable(
  p_product_id uuid,
  p_is_non_returnable boolean
)
returns public.products
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.products%rowtype;
begin
  if not public.is_main_branch_manager() then
    raise exception 'Unauthorized: Main Branch Manager access is required.' using errcode = '42501';
  end if;
  update public.products
  set is_non_returnable = coalesce(p_is_non_returnable, false),
      closing_stock_behavior = case
        when coalesce(p_is_non_returnable, false) then 'keep_at_branch'::public.closing_stock_behavior
        else closing_stock_behavior
      end
  where id = p_product_id
  returning * into v_product;
  if not found then
    raise exception 'Product is missing.' using errcode = '22023';
  end if;
  return v_product;
end;
$$;

revoke all on function public.set_product_non_returnable(uuid, boolean) from public, anon;
grant execute on function public.set_product_non_returnable(uuid, boolean) to authenticated;

commit;
