begin;

-- KG-delivered meals, shift waste, and cash remittance.
-- Piece quantities stay whole numbers. KG is numeric(14,3) and Main-only.
-- Existing rows default to piece_stock so history is not reinterpreted.
-- NULL quantity_received means an unmeasured KG delivery, not zero.

create type public.inventory_mode as enum ('piece_stock', 'kg_meal');
create type public.cash_reconciliation_result as enum ('exact', 'shortage', 'excess');

alter table public.products
  add column inventory_mode public.inventory_mode not null default 'piece_stock';

alter table public.branch_inventory
  alter column quantity_on_hand type numeric(14,3);

alter table public.inventory_movements
  alter column quantity type numeric(14,3);

alter table public.inventory_movements
  add column inventory_mode public.inventory_mode not null default 'piece_stock';

alter table public.stock_transfer_items
  alter column quantity_sent type numeric(14,3);

alter table public.stock_transfer_items
  alter column quantity_received type numeric(14,3);

alter table public.stock_transfer_items
  add column inventory_mode public.inventory_mode not null default 'piece_stock';

alter table public.stock_return_items
  add column inventory_mode public.inventory_mode not null default 'piece_stock';

create table public.shift_reconciliations (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null unique references public.shifts(id) on delete restrict,
  branch_id uuid not null references public.branches(id) on delete restrict,
  expected_cash numeric(12,2) not null,
  actual_cash numeric(12,2) not null check (actual_cash >= 0),
  difference numeric(12,2) not null,
  result public.cash_reconciliation_result not null,
  reconciled_at timestamptz not null default now(),
  recorded_by uuid not null references public.profiles(id) on delete restrict,
  constraint shift_reconciliations_difference_chk
    check (difference = expected_cash - actual_cash),
  constraint shift_reconciliations_result_chk
    check (
      (difference = 0 and result = 'exact')
      or (difference > 0 and result = 'shortage')
      or (difference < 0 and result = 'excess')
    )
);

create table public.shift_waste_occurrences (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.shifts(id) on delete restrict,
  branch_id uuid not null references public.branches(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  recorded_by uuid not null references public.profiles(id) on delete restrict,
  note text,
  created_at timestamptz not null default now(),
  unique (shift_id, product_id),
  constraint shift_waste_note_len check (note is null or char_length(note) <= 500)
);

alter table public.shift_reconciliations enable row level security;
alter table public.shift_waste_occurrences enable row level security;

create policy shift_reconciliations_select
on public.shift_reconciliations for select to authenticated
using (
  public.is_owner()
  or public.is_main_branch_manager()
  or recorded_by = (select auth.uid())
);

create policy shift_waste_select
on public.shift_waste_occurrences for select to authenticated
using (
  public.is_owner()
  or public.is_main_branch_manager()
  or recorded_by = (select auth.uid())
);

revoke all on public.shift_reconciliations from public, anon;
revoke all on public.shift_waste_occurrences from public, anon;
grant select on public.shift_reconciliations to authenticated;
grant select on public.shift_waste_occurrences to authenticated;

revoke insert, update on table public.products from public, anon, authenticated;
grant update (name, sku, description, selling_price, is_active, updated_at)
  on public.products to authenticated;
drop policy if exists "products_insert_main_manager" on public.products;

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
        using errcode = '42501';
    end if;
    return new;
  end if;

  select p.inventory_mode into v_mode
  from public.products p
  where p.id = new.product_id;
  if v_mode is null then
    raise exception 'Product is missing.' using errcode = '22023';
  end if;
  new.inventory_mode := v_mode;
  return new;
end;
$$;

drop trigger if exists inventory_movements_snapshot_mode on public.inventory_movements;
create trigger inventory_movements_snapshot_mode
before insert or update of inventory_mode on public.inventory_movements
for each row execute function public.snapshot_movement_inventory_mode();

create or replace function public.snapshot_transfer_item_inventory_mode()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_mode public.inventory_mode;
begin
  if tg_op = 'UPDATE' and new.inventory_mode is distinct from old.inventory_mode then
    raise exception 'Historical inventory type cannot be changed.'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    select p.inventory_mode into v_mode
    from public.products p
    where p.id = new.product_id;
    if v_mode is null then
      raise exception 'Product is missing.' using errcode = '22023';
    end if;
    new.inventory_mode := v_mode;
  end if;

  if new.inventory_mode = 'kg_meal' and new.quantity_received is not null then
    raise exception 'KG delivery is confirmed, not weighed. Received weight stays unmeasured.'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists stock_transfer_items_snapshot_mode on public.stock_transfer_items;
create trigger stock_transfer_items_snapshot_mode
before insert or update of quantity_received, inventory_mode on public.stock_transfer_items
for each row execute function public.snapshot_transfer_item_inventory_mode();

create or replace function public.guard_return_item_inventory_mode()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_mode public.inventory_mode;
begin
  if tg_op = 'UPDATE' and new.inventory_mode is distinct from old.inventory_mode then
    raise exception 'Historical inventory type cannot be changed.'
      using errcode = '42501';
  end if;

  select p.inventory_mode into v_mode
  from public.products p
  where p.id = new.product_id;
  if v_mode is null then
    raise exception 'Product is missing.' using errcode = '22023';
  end if;
  if v_mode = 'kg_meal' then
    raise exception 'KG-delivered meals cannot be returned by quantity.'
      using errcode = '22023';
  end if;
  new.inventory_mode := v_mode;
  return new;
end;
$$;

drop trigger if exists stock_return_items_guard_mode on public.stock_return_items;
create trigger stock_return_items_guard_mode
before insert or update of inventory_mode on public.stock_return_items
for each row execute function public.guard_return_item_inventory_mode();

create or replace function public.guard_selling_branch_kg_stock()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_mode public.inventory_mode;
  v_main boolean;
begin
  if tg_op = 'UPDATE' and new.quantity_on_hand <= old.quantity_on_hand then
    return new;
  end if;
  if new.quantity_on_hand <= 0 then
    return new;
  end if;

  select p.inventory_mode into v_mode
  from public.products p
  where p.id = new.product_id;
  select b.is_main_branch into v_main
  from public.branches b
  where b.id = new.branch_id;

  if v_mode = 'kg_meal' and coalesce(v_main, false) = false then
    raise exception 'KG meal stock is kept only at Main Branch.'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists branch_inventory_guard_kg on public.branch_inventory;
create trigger branch_inventory_guard_kg
before insert or update of quantity_on_hand on public.branch_inventory
for each row execute function public.guard_selling_branch_kg_stock();

create or replace function public.protect_inventory_mode_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.inventory_mode is not distinct from old.inventory_mode then
    return new;
  end if;
  if current_setting('golden.allow_inventory_mode_change', true) is distinct from 'on' then
    raise exception 'Inventory type can only be changed through set product inventory mode.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists products_protect_inventory_mode on public.products;
create trigger products_protect_inventory_mode
before update of inventory_mode on public.products
for each row execute function public.protect_inventory_mode_change();

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
  if p_mode = 'piece_stock' then
    if v_text !~ '^[0-9]{1,6}$' then
      raise exception 'Piece quantities must be whole numbers.' using errcode = '22023';
    end if;
  elsif v_text !~ '^[0-9]{1,6}(\.[0-9]{1,3})?$' then
    raise exception 'KG quantities may have at most 3 decimal places.' using errcode = '22023';
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

create or replace function public.parse_actual_cash(p_raw text)
returns numeric(12,2)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_text text := btrim(coalesce(p_raw, ''));
  v_value numeric;
begin
  if v_text = '' then
    raise exception 'Enter the actual cash remitted.' using errcode = '22023';
  end if;
  if left(v_text, 1) = '-' then
    raise exception 'Actual cash cannot be negative.' using errcode = '22023';
  end if;
  if v_text !~ '^[0-9]+(\.[0-9]{1,2})?$' then
    raise exception 'Enter a valid cash amount with at most 2 decimal places.' using errcode = '22023';
  end if;
  v_value := v_text::numeric;
  if v_value > 9999999999.99 then
    raise exception 'Actual cash exceeds the supported limit.' using errcode = '22023';
  end if;
  return v_value::numeric(12,2);
end;
$$;

revoke all on function public.parse_actual_cash(text) from public, anon, authenticated;

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
    raise exception 'Inventory type must be piece stock or KG-delivered meal.'
      using errcode = '22023';
  end if;
  v_mode := v_requested::public.inventory_mode;

  select * into v_product
  from public.products
  where id = p_product_id
  for update;
  if not found then
    raise exception 'Product is missing.' using errcode = '22023';
  end if;
  if v_product.inventory_mode = v_mode then
    return v_product;
  end if;

  if exists (
    select 1
    from public.branch_inventory i
    where i.product_id = p_product_id
      and i.quantity_on_hand <> 0
  ) then
    raise exception 'Clear every current balance, including Main Branch, before changing inventory type.'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.stock_transfer_items sti
    join public.stock_transfers st on st.id = sti.stock_transfer_id
    where sti.product_id = p_product_id
      and st.status in ('draft', 'pending_receipt')
  ) then
    raise exception 'Finish or cancel open transfers for this product before changing inventory type.'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.stock_return_items sri
    join public.stock_returns sr on sr.id = sri.stock_return_id
    where sri.product_id = p_product_id
      and sr.status in ('draft', 'in_transit')
  ) then
    raise exception 'Finish or cancel open returns for this product before changing inventory type.'
      using errcode = '22023';
  end if;

  perform set_config('golden.allow_inventory_mode_change', 'on', true);
  update public.products
  set inventory_mode = v_mode
  where id = p_product_id
  returning * into v_product;
  return v_product;
end;
$$;

revoke all on function public.set_product_inventory_mode(uuid, text) from public, anon;
grant execute on function public.set_product_inventory_mode(uuid, text) to authenticated;

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

  select id into v_main_branch_id
  from public.branches
  where is_main_branch and is_active
  for share;
  if v_main_branch_id is null then
    raise exception 'No active Main Branch is configured.' using errcode = '22023';
  end if;

  for v_item in
    select (value->>'product_id')::uuid as product_id,
           value->>'quantity' as quantity_text
    from jsonb_array_elements(p_items)
    order by value->>'product_id'
  loop
    select * into v_product
    from public.products
    where id = v_item.product_id
    for update;
    if not found then
      raise exception 'Product is missing.' using errcode = '22023';
    end if;

    begin
      v_quantity := public.parse_inventory_quantity(v_item.quantity_text, v_product.inventory_mode, false);
    exception when others then
      if v_product.inventory_mode = 'piece_stock' then
        raise exception 'Opening quantities must be whole numbers between 1 and 999999.'
          using errcode = '22023';
      end if;
      raise;
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
      where branch_id = v_main_branch_id
        and product_id = v_item.product_id
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

    update public.products
    set is_active = true
    where id = v_item.product_id and not is_active;
  end loop;
end;
$$;

revoke all on function public.initialize_main_branch_inventory(jsonb, text) from public, anon;
grant execute on function public.initialize_main_branch_inventory(jsonb, text) to authenticated;

create or replace function public.seed_branch_catalog(
  p_branch_id uuid,
  p_product_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.products%rowtype;
  v_branch_product public.branch_products%rowtype;
begin
  select * into v_product from public.products where id = p_product_id;
  if not found then
    raise exception 'Product is missing or inactive.' using errcode = '22023';
  end if;

  select * into v_branch_product
  from public.branch_products
  where branch_id = p_branch_id and product_id = p_product_id
  for update;

  if not found then
    insert into public.branch_products(branch_id, product_id, selling_price, is_active)
    values (p_branch_id, p_product_id, v_product.selling_price, true);

    insert into public.branch_product_variants(
      branch_id, product_id, name, selling_price, is_active
    )
    select p_branch_id, p_product_id, pv.name, pv.default_price, true
    from public.product_variants pv
    where pv.product_id = p_product_id and pv.is_active
    on conflict (branch_id, product_id, name) do nothing;
  elsif not v_branch_product.is_active then
    update public.branch_products
    set is_active = true
    where branch_id = p_branch_id and product_id = p_product_id;
  end if;
end;
$$;

revoke all on function public.seed_branch_catalog(uuid, uuid) from public, anon, authenticated;

create or replace function public.send_stock_transfer(
  p_to_branch_id uuid,
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
  v_user_id uuid := auth.uid();
  v_from_branch_id uuid;
  v_transfer_id uuid;
  v_transfer_number text;
  v_item record;
  v_available numeric(14,3);
  v_quantity numeric(14,3);
  v_mode public.inventory_mode;
  v_product public.products%rowtype;
begin
  if not public.is_main_branch_manager() then
    raise exception 'Unauthorized: Main Branch Manager access is required.'
      using errcode = '42501';
  end if;
  if p_idempotency_key is null
     or char_length(p_idempotency_key) not between 16 and 100 then
    raise exception 'Invalid request key.' using errcode = '22023';
  end if;

  select id into v_transfer_id
  from public.stock_transfers
  where send_idempotency_key = p_idempotency_key;
  if v_transfer_id is not null then
    return v_transfer_id;
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Select at least one product to send.' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_array_elements(p_items)) <>
     (select count(distinct value->>'product_id') from jsonb_array_elements(p_items)) then
    raise exception 'Each product may appear only once.' using errcode = '22023';
  end if;

  select id into v_from_branch_id
  from public.branches
  where is_main_branch and is_active
  for share;
  if v_from_branch_id is null then
    raise exception 'No active Main Branch is configured.' using errcode = '22023';
  end if;

  perform 1
  from public.branches
  where id = p_to_branch_id and is_active and not is_main_branch
  for share;
  if not found then
    raise exception 'Destination branch is missing, inactive, or is the Main Branch.'
      using errcode = '22023';
  end if;

  for v_item in
    select (value->>'product_id')::uuid as product_id,
           value->>'quantity_sent' as quantity_text
    from jsonb_array_elements(p_items)
    order by value->>'product_id'
  loop
    select * into v_product
    from public.products
    where id = v_item.product_id
    for share;
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
        coalesce(v_available, 0), v_quantity
        using errcode = '22003';
    end if;
  end loop;

  v_transfer_number := 'TR-' || lpad(nextval('public.stock_transfer_number_seq')::text, 6, '0');
  insert into public.stock_transfers(
    transfer_number, from_branch_id, to_branch_id, status,
    created_by, sent_by, sent_at, notes, send_idempotency_key
  ) values (
    v_transfer_number, v_from_branch_id, p_to_branch_id, 'pending_receipt',
    v_user_id, v_user_id, now(), nullif(trim(p_notes), ''), p_idempotency_key
  )
  returning id into v_transfer_id;

  for v_item in
    select (value->>'product_id')::uuid as product_id,
           value->>'quantity_sent' as quantity_text
    from jsonb_array_elements(p_items)
    order by value->>'product_id'
  loop
    select p.inventory_mode into v_mode
    from public.products p where p.id = v_item.product_id;
    v_quantity := public.parse_inventory_quantity(v_item.quantity_text, v_mode, false);

    insert into public.stock_transfer_items(stock_transfer_id, product_id, quantity_sent)
    values (v_transfer_id, v_item.product_id, v_quantity);

    update public.branch_inventory
    set quantity_on_hand = quantity_on_hand - v_quantity
    where branch_id = v_from_branch_id
      and product_id = v_item.product_id
      and quantity_on_hand >= v_quantity;
    if not found then
      raise exception 'Insufficient stock during transfer processing.' using errcode = '22003';
    end if;

    insert into public.inventory_movements(
      branch_id, product_id, movement_type, quantity,
      reference_type, reference_id, created_by, notes
    ) values (
      v_from_branch_id, v_item.product_id, 'transfer_out',
      -v_quantity, 'stock_transfer', v_transfer_id,
      v_user_id, nullif(trim(p_notes), '')
    );
  end loop;

  return v_transfer_id;
end;
$$;

revoke all on function public.send_stock_transfer(uuid, jsonb, text, text) from public, anon;
grant execute on function public.send_stock_transfer(uuid, jsonb, text, text) to authenticated;

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

  select * into v_branch from public.branches where id = v_user.branch_id for share;
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

  for v_item in
    select sti.id, sti.product_id, sti.quantity_sent, sti.inventory_mode
    from public.stock_transfer_items sti
    where sti.stock_transfer_id = p_transfer_id
    order by sti.product_id
  loop
    perform public.seed_branch_catalog(v_transfer.to_branch_id, v_item.product_id);

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

create or replace function public.list_cashier_pending_transfers()
returns table (
  id uuid,
  transfer_number text,
  from_branch_id uuid,
  from_branch_name text,
  sent_at timestamptz,
  notes text,
  items jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user public.profiles%rowtype;
  v_mode public.branch_receiving_mode;
begin
  select * into v_user from public.profiles p where p.id = auth.uid() and p.is_active;
  if not found or v_user.role is distinct from 'cashier' then
    raise exception 'Unauthorized: cashier access is required.' using errcode = '42501';
  end if;
  if v_user.branch_id is null then
    raise exception 'No authorized branch is assigned to this cashier.' using errcode = '42501';
  end if;
  select b.receiving_mode into v_mode from public.branches b where b.id = v_user.branch_id;
  if v_mode is distinct from 'cashier_confirm' then
    raise exception 'This branch does not use cashier shipment confirmation.' using errcode = '42501';
  end if;

  return query
  select
    st.id,
    st.transfer_number,
    st.from_branch_id,
    fb.name,
    st.sent_at,
    st.notes,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'stock_transfer_item_id', sti.id,
        'product_id', sti.product_id,
        'product_name', p.name,
        'product_sku', p.sku,
        'quantity_sent', sti.quantity_sent,
        'inventory_mode', sti.inventory_mode
      ) order by p.name)
      from public.stock_transfer_items sti
      join public.products p on p.id = sti.product_id
      where sti.stock_transfer_id = st.id
    ), '[]'::jsonb)
  from public.stock_transfers st
  join public.branches fb on fb.id = st.from_branch_id
  where st.to_branch_id = v_user.branch_id
    and st.status = 'pending_receipt'
  order by st.sent_at asc;
end;
$$;

revoke all on function public.list_cashier_pending_transfers() from public, anon;
grant execute on function public.list_cashier_pending_transfers() to authenticated;

create or replace function public.report_shipment_issue(
  p_transfer_id uuid,
  p_items jsonb,
  p_notes text,
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
  v_received numeric(14,3);
  v_difference numeric(14,3);
  v_has_discrepancy boolean := false;
  v_text text;
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
  if char_length(trim(coalesce(p_notes, ''))) < 3 then
    raise exception 'Describe what is wrong with the shipment.' using errcode = '22023';
  end if;
  if length(coalesce(p_notes, '')) > 1000 then
    raise exception 'Notes too long (maximum 1000 characters).' using errcode = '22023';
  end if;
  if v_user.branch_id is null then
    raise exception 'Unauthorized: no authorized branch is assigned to this cashier.' using errcode = '42501';
  end if;

  select * into v_branch from public.branches where id = v_user.branch_id for share;
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
  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'Actual received quantity is required for every piece item.' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_array_elements(p_items)) <>
     (select count(distinct value->>'stock_transfer_item_id') from jsonb_array_elements(p_items)) then
    raise exception 'Each transfer item may appear only once.' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_items) x
    left join public.stock_transfer_items sti
      on sti.id = (x.value->>'stock_transfer_item_id')::uuid
     and sti.stock_transfer_id = p_transfer_id
    where sti.id is null
  ) then
    raise exception 'Receipt contains an invalid transfer item.' using errcode = '22023';
  end if;
  if exists (
    select 1
    from public.stock_transfer_items sti
    where sti.stock_transfer_id = p_transfer_id
      and sti.inventory_mode = 'piece_stock'
      and not exists (
        select 1 from jsonb_array_elements(p_items) x
        where (x.value->>'stock_transfer_item_id')::uuid = sti.id
      )
  ) then
    raise exception 'Actual received quantity is required for every piece item.' using errcode = '22023';
  end if;

  for v_item in
    select sti.id, sti.product_id, sti.quantity_sent, sti.inventory_mode
    from public.stock_transfer_items sti
    where sti.stock_transfer_id = p_transfer_id
    order by sti.product_id
  loop
    if v_item.inventory_mode = 'kg_meal' then
      continue;
    end if;
    select value->>'quantity_received' into v_text
    from jsonb_array_elements(p_items)
    where (value->>'stock_transfer_item_id')::uuid = v_item.id;
    v_received := public.parse_inventory_quantity(v_text, 'piece_stock', true);
    if v_item.quantity_sent <> v_received then
      v_has_discrepancy := true;
    end if;
  end loop;

  if not v_has_discrepancy then
    raise exception 'Enter a different quantity than sent, or confirm the shipment arrived as sent.'
      using errcode = '22023';
  end if;

  for v_item in
    select sti.id, sti.product_id, sti.quantity_sent, sti.inventory_mode
    from public.stock_transfer_items sti
    where sti.stock_transfer_id = p_transfer_id
    order by sti.product_id
  loop
    perform public.seed_branch_catalog(v_transfer.to_branch_id, v_item.product_id);
    if v_item.inventory_mode = 'kg_meal' then
      continue;
    end if;

    select value->>'quantity_received' into v_text
    from jsonb_array_elements(p_items)
    where (value->>'stock_transfer_item_id')::uuid = v_item.id;
    v_received := public.parse_inventory_quantity(v_text, 'piece_stock', true);

    update public.stock_transfer_items
    set quantity_received = v_received
    where id = v_item.id;

    if v_received > 0 then
      insert into public.branch_inventory(branch_id, product_id, quantity_on_hand)
      values (v_transfer.to_branch_id, v_item.product_id, v_received)
      on conflict (branch_id, product_id) do update
      set quantity_on_hand = branch_inventory.quantity_on_hand + excluded.quantity_on_hand;

      insert into public.inventory_movements(
        branch_id, product_id, movement_type, quantity,
        reference_type, reference_id, created_by, notes
      ) values (
        v_transfer.to_branch_id, v_item.product_id, 'transfer_in', v_received,
        'stock_transfer', p_transfer_id, v_user_id, nullif(trim(p_notes), '')
      );
    end if;

    v_difference := v_item.quantity_sent - v_received;
    if v_difference <> 0 then
      insert into public.transfer_discrepancies(
        stock_transfer_id, stock_transfer_item_id, product_id,
        quantity_expected, quantity_received, difference,
        discrepancy_type, notes, recorded_by
      ) values (
        p_transfer_id, v_item.id, v_item.product_id,
        v_item.quantity_sent::bigint, v_received::bigint, v_difference::bigint,
        case when v_difference > 0 then 'missing'::public.transfer_discrepancy_type
             else 'excess'::public.transfer_discrepancy_type end,
        nullif(trim(p_notes), ''), v_user_id
      );
    end if;
  end loop;

  update public.stock_transfers
  set status = 'received_with_discrepancy',
      received_by = v_user_id,
      received_at = now(),
      receive_idempotency_key = p_idempotency_key
  where id = p_transfer_id;

  return 'received_with_discrepancy'::public.stock_transfer_status;
end;
$$;

revoke all on function public.report_shipment_issue(uuid, jsonb, text, text) from public, anon;
grant execute on function public.report_shipment_issue(uuid, jsonb, text, text) to authenticated;

create or replace function public.confirm_sale(
  p_shift_id uuid,
  p_items jsonb,
  p_amount_paid numeric,
  p_idempotency_key text
)
returns public.sales
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_actor public.profiles%rowtype;
  v_branch uuid;
  v_shift public.shifts%rowtype;
  v_sale public.sales%rowtype;
  v_items jsonb;
  v_item record;
  v_product public.products%rowtype;
  v_branch_product public.branch_products%rowtype;
  v_variant public.branch_product_variants%rowtype;
  v_price numeric;
  v_variant_name text;
  v_stock bigint;
  v_total numeric := 0;
begin
  select * into v_actor
  from public.profiles
  where id = v_user
    and is_active
    and role = 'cashier'
  for update;
  if not found then
    raise exception 'An active Cashier account is required.'
      using errcode = '42501';
  end if;
  v_branch := v_actor.branch_id;

  if p_idempotency_key is null
     or length(p_idempotency_key) not between 16 and 100 then
    raise exception 'Invalid order confirmation key.'
      using errcode = '22023';
  end if;
  if p_amount_paid is null
     or p_amount_paid::text in ('NaN','Infinity','-Infinity')
     or p_amount_paid < 0
     or p_amount_paid > 9999999999.99
     or p_amount_paid <> round(p_amount_paid, 2) then
    raise exception 'Enter a valid payment with at most two decimal places.'
      using errcode = '22023';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'The cart must contain products.'
      using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) not between 1 and 200 then
    raise exception 'The cart must contain 1 to 200 products.'
      using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item.value) is distinct from 'object'
       or coalesce(v_item.value->>'quantity', '') !~ '^[1-9][0-9]{0,5}$'
       or coalesce(v_item.value->>'product_id', '') !~*
         '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or (
         v_item.value->'variant_id' is not null
         and jsonb_typeof(v_item.value->'variant_id') is distinct from 'null'
         and coalesce(v_item.value->>'variant_id', '') !~*
           '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

       ) then
      raise exception 'Invalid product, variant, or quantity.'
        using errcode = '22023';
    end if;
  end loop;

  select jsonb_agg(
    jsonb_build_object('product_id', product_id, 'variant_id', variant_id, 'quantity', quantity)
    order by product_id, variant_id
  )
  into v_items
  from (
    select (value->>'product_id')::uuid as product_id,
           nullif(value->>'variant_id', '')::uuid as variant_id,
           sum((value->>'quantity')::bigint) as quantity
    from jsonb_array_elements(p_items)
    group by 1, 2
  ) normalized;

  select * into v_sale
  from public.sales
  where cashier_id = v_user
    and idempotency_key = p_idempotency_key;
  if found then
    if v_sale.shift_id <> p_shift_id
       or v_sale.request_items <> v_items
       or v_sale.amount_paid <> p_amount_paid then
      raise exception 'This confirmation key belongs to a different order.'
        using errcode = '22023';
    end if;
    return v_sale;
  end if;

  perform 1
  from public.branches
  where id = v_branch
    and is_active
    and not is_main_branch
  for share;
  if not found then
    raise exception 'Your assigned branch is unavailable.'
      using errcode = '42501';
  end if;

  select * into v_shift
  from public.shifts
  where id = p_shift_id
  for update;
  if not found
     or v_shift.cashier_id <> v_user
     or v_shift.branch_id <> v_branch
     or v_shift.status <> 'open' then
    raise exception 'An open shift belonging to you is required.'
      using errcode = '42501';
  end if;

  -- Pass 1: per product (aggregated across any variant lines), lock and
  -- validate the product, branch catalog entry, and available stock.
  -- Deterministic product order preserves the existing deadlock protections.
  for v_item in
    select product_id, sum(quantity) as quantity
    from jsonb_to_recordset(v_items) as x(product_id uuid, variant_id uuid, quantity bigint)
    group by product_id
    order by product_id
  loop
    select * into v_product
    from public.products
    where id = v_item.product_id
    for share;
    if not found or not v_product.is_active then
      raise exception 'A selected product is inactive or unavailable.'
        using errcode = '22023';
    end if;

    select * into v_branch_product
    from public.branch_products
    where branch_id = v_branch
      and product_id = v_item.product_id
      and is_active
    for share;
    if not found then
      raise exception 'A selected product is not available in this branch catalog.'
        using errcode = '22023';
    end if;

    if v_product.inventory_mode = 'kg_meal' then
      continue;
    end if;

    select quantity_on_hand into v_stock
    from public.branch_inventory
    where branch_id = v_branch
      and product_id = v_item.product_id
    for update;
    if coalesce(v_stock, 0) < v_item.quantity then
      raise exception 'Insufficient stock. % — Available: %, Requested: %',
        v_product.name, coalesce(v_stock, 0), v_item.quantity
        using errcode = '22023';
    end if;
  end loop;

  -- Pass 2: per line (product + optional variant), resolve the authoritative
  -- price — the variant price when a valid active variant is selected,
  -- otherwise the branch catalog price — and accumulate the order total.
  for v_item in
    select *
    from jsonb_to_recordset(v_items) as x(product_id uuid, variant_id uuid, quantity bigint)
    order by product_id, variant_id
  loop
    if v_item.variant_id is not null then
      select * into v_variant
      from public.branch_product_variants
      where id = v_item.variant_id
        and branch_id = v_branch
        and product_id = v_item.product_id
        and is_active
      for share;
      if not found then
        raise exception 'A selected variant is not available in this branch catalog.'
          using errcode = '22023';
      end if;
      v_price := v_variant.selling_price;
    else
      select * into v_branch_product
      from public.branch_products
      where branch_id = v_branch
        and product_id = v_item.product_id;
      v_price := v_branch_product.selling_price;
    end if;

    v_total := v_total + v_price * v_item.quantity;
  end loop;

  if v_total > 9999999999.99 then
    raise exception 'Order total exceeds the supported limit.'
      using errcode = '22023';
  end if;
  if p_amount_paid < v_total then
    raise exception 'Insufficient payment. Total: %, Remaining: %',
      v_total, v_total - p_amount_paid
      using errcode = '22023';
  end if;

  insert into public.sales(
    sale_number, branch_id, shift_id, cashier_id,
    subtotal, total_amount, amount_paid, change_amount,
    idempotency_key, request_items
  ) values (
    'SALE-' || lpad(nextval('public.sale_number_seq')::text, 10, '0'),
    v_branch, p_shift_id, v_user,
    v_total, v_total, p_amount_paid, p_amount_paid - v_total,
    p_idempotency_key, v_items
  )
  returning * into v_sale;

  -- Pass 3: one sale_items row per line, snapshotting the resolved price and
  -- variant name so later repricing or renaming never alters this history.
  for v_item in
    select *
    from jsonb_to_recordset(v_items) as x(product_id uuid, variant_id uuid, quantity bigint)
    order by product_id, variant_id
  loop
    if v_item.variant_id is not null then
      select * into v_variant
      from public.branch_product_variants
      where id = v_item.variant_id;
      v_price := v_variant.selling_price;
      v_variant_name := v_variant.name;
    else
      select * into v_branch_product
      from public.branch_products
      where branch_id = v_branch
        and product_id = v_item.product_id;
      v_price := v_branch_product.selling_price;
      v_variant_name := null;
    end if;

    insert into public.sale_items(
      sale_id, product_id, variant_id, variant_name, quantity, unit_price, subtotal
    ) values (
      v_sale.id,
      v_item.product_id,
      v_item.variant_id,
      v_variant_name,
      v_item.quantity,
      v_price,
      v_item.quantity * v_price
    );
  end loop;

  -- Pass 4: one inventory movement per product, aggregating quantity across
  -- any variant lines. Inventory tracking stays on the base product only.
  for v_item in
    select product_id, sum(quantity) as quantity
    from jsonb_to_recordset(v_items) as x(product_id uuid, variant_id uuid, quantity bigint)
    group by product_id
    order by product_id
  loop
    if (select p.inventory_mode from public.products p where p.id = v_item.product_id) = 'kg_meal' then
      continue;
    end if;

    update public.branch_inventory
    set quantity_on_hand = quantity_on_hand - v_item.quantity
    where branch_id = v_branch
      and product_id = v_item.product_id;

    insert into public.inventory_movements(
      branch_id, product_id, movement_type, quantity,
      reference_type, reference_id, created_by
    ) values (
      v_branch, v_item.product_id, 'sale', -v_item.quantity,
      'sale', v_sale.id, v_user
    );
  end loop;

  return v_sale;
end;
$$;

revoke all on function public.confirm_sale(uuid, jsonb, numeric, text) from public, anon;
grant execute on function public.confirm_sale(uuid, jsonb, numeric, text) to authenticated;

drop function if exists public.create_complete_product(text, text, text, jsonb, jsonb, text);

create or replace function public.create_complete_product(
  p_name text,
  p_sku text,
  p_description text,
  p_variants jsonb,
  p_branches jsonb,
  p_selling_price text default null,
  p_inventory_mode text default 'piece_stock'
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
  v_price_re text := '^[0-9]{1,10}(\.[0-9]{1,2})?$';
begin
  if v_mode not in ('piece_stock', 'kg_meal') then
    raise exception 'Inventory type must be piece stock or KG-delivered meal.'
      using errcode = '22023';
  end if;
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

  insert into public.products(name, sku, description, selling_price, is_active, inventory_mode)
  values (v_name, v_sku, v_description, v_selling_price, false, v_mode::public.inventory_mode)
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

revoke all on function public.create_complete_product(text, text, text, jsonb, jsonb, text, text) from public, anon;
grant execute on function public.create_complete_product(text, text, text, jsonb, jsonb, text, text) to authenticated;

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
  -- Selling-branch managers are retired; only cashiers create selling-branch returns.
  -- Main managers should not create returns from Main.
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
      or coalesce(v_item.value->>'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
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
  select * into v_source
  from public.branches
  where id = v_user.branch_id and is_active and not is_main_branch
  for share;
  if not found then
    raise exception 'Your assigned branch is unavailable.' using errcode = '42501';
  end if;
  select * into v_main from public.branches where is_main_branch and is_active for share;
  if not found then
    raise exception 'An active Main Branch is required.' using errcode = '22023';
  end if;
  for v_item in
    select * from jsonb_to_recordset(v_items) as x(product_id uuid, quantity_returned bigint)
    order by product_id
  loop
    select * into v_product from public.products where id = v_item.product_id for share;
    if not found then
      raise exception 'Product unavailable.' using errcode = '22023';
    end if;
    if v_product.inventory_mode = 'kg_meal' then
      raise exception 'KG-delivered meals cannot be returned by quantity.' using errcode = '22023';
    end if;
    select quantity_on_hand into v_stock
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
  )
  values (
    'RET-' || lpad(v_number, greatest(6, length(v_number)), '0'),
    v_source.id, v_main.id, v_user.id, v_user.id,
    v_source.name, v_main.name, v_user.full_name, p_notes, p_idempotency_key, v_items
  )
  returning id into v_id;
  for v_item in
    select * from jsonb_to_recordset(v_items) as x(product_id uuid, quantity_returned bigint)
    order by product_id
  loop
    select * into v_product from public.products where id = v_item.product_id;
    insert into public.stock_return_items(stock_return_id, product_id, quantity_returned, product_name, product_sku)
    values (v_id, v_item.product_id, v_item.quantity_returned, v_product.name, v_product.sku);
    update public.branch_inventory
    set quantity_on_hand = quantity_on_hand - v_item.quantity_returned
    where branch_id = v_source.id and product_id = v_item.product_id;
    insert into public.inventory_movements(
      branch_id, product_id, movement_type, quantity, reference_type, reference_id, created_by, notes
    )
    values (
      v_source.id, v_item.product_id, 'return_out', -v_item.quantity_returned,
      'stock_return', v_id, v_user.id, p_notes
    );
  end loop;

  return v_id;
end;
$$;

revoke all on function public.create_stock_return(jsonb, text, text) from public, anon;
grant execute on function public.create_stock_return(jsonb, text, text) to authenticated;

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
  if p_cashier_id is null then
    return null;
  end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 16 and 100
    or length(coalesce(p_notes, '')) > 2000 then
    raise exception 'Invalid confirmation key or notes.' using errcode = '22023';
  end if;

  select * into v_user
  from public.profiles
  where id = p_cashier_id and role = 'cashier'
  for update;
  if not found or v_user.branch_id is null then
    return null;
  end if;

  select * into v_source
  from public.branches
  where id = v_user.branch_id and not is_main_branch
  for share;
  if not found then
    return null;
  end if;

  select * into v_main
  from public.branches
  where is_main_branch and is_active
  for share;
  if not found then
    return null;
  end if;

  select * into v_existing
  from public.stock_returns
  where created_by = v_user.id
    and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.notes is distinct from p_notes then
      raise exception 'This confirmation key belongs to a different return.' using errcode = '22023';
    end if;
    return v_existing.id;
  end if;

  perform 1
  from public.branch_inventory i
  join public.products p on p.id = i.product_id and p.inventory_mode = 'piece_stock'
  where i.branch_id = v_source.id
    and i.quantity_on_hand > 0
  for update;

  select jsonb_agg(
           jsonb_build_object(
             'product_id', q.product_id,
             'quantity_returned', q.quantity_returned
           )
           order by q.product_id
         )
    into v_items
  from (
    select i.product_id, i.quantity_on_hand as quantity_returned
    from public.branch_inventory i
    join public.products p on p.id = i.product_id and p.inventory_mode = 'piece_stock'
    where i.branch_id = v_source.id
      and i.quantity_on_hand > 0
  ) q;

  if v_items is null or jsonb_array_length(v_items) = 0 then
    return null;
  end if;
  if jsonb_array_length(v_items) > 200 then
    raise exception 'Too many leftover products to return at once.' using errcode = '22023';
  end if;

  for v_item in
    select * from jsonb_to_recordset(v_items) as x(product_id uuid, quantity_returned numeric)
    order by product_id
  loop
    if v_item.quantity_returned is null
      or v_item.quantity_returned <> trunc(v_item.quantity_returned)
      or v_item.quantity_returned <= 0 then
      raise exception 'Leftover quantities must be whole numbers.' using errcode = '22023';
    end if;
    select * into v_product from public.products where id = v_item.product_id for share;
    if not found then
      raise exception 'Product unavailable.' using errcode = '22023';
    end if;
    select quantity_on_hand::bigint into v_stock
    from public.branch_inventory
    where branch_id = v_source.id and product_id = v_item.product_id
    for update;
    if coalesce(v_stock, 0) < v_item.quantity_returned::bigint then
      raise exception 'Insufficient stock. % — Available: %, Requested: %',
        v_product.name, coalesce(v_stock, 0), v_item.quantity_returned::bigint
        using errcode = '22023';
    end if;
  end loop;

  v_number := nextval('public.return_number_seq')::text;
  insert into public.stock_returns(
    return_number, from_branch_id, to_branch_id, created_by, returned_by,
    from_branch_name, to_branch_name, returned_by_name, notes, idempotency_key, request_items
  )
  values (
    'RET-' || lpad(v_number, greatest(6, length(v_number)), '0'),
    v_source.id, v_main.id, v_user.id, v_user.id,
    v_source.name, v_main.name, v_user.full_name, p_notes, p_idempotency_key, v_items
  )
  returning id into v_id;

  for v_item in
    select * from jsonb_to_recordset(v_items) as x(product_id uuid, quantity_returned numeric)
    order by product_id
  loop
    select * into v_product from public.products where id = v_item.product_id;
    insert into public.stock_return_items(stock_return_id, product_id, quantity_returned, product_name, product_sku)
    values (v_id, v_item.product_id, v_item.quantity_returned::bigint, v_product.name, v_product.sku);
    update public.branch_inventory
    set quantity_on_hand = quantity_on_hand - v_item.quantity_returned::bigint
    where branch_id = v_source.id and product_id = v_item.product_id;
    insert into public.inventory_movements(
      branch_id, product_id, movement_type, quantity, reference_type, reference_id, created_by, notes
    )
    values (
      v_source.id, v_item.product_id, 'return_out', -v_item.quantity_returned::bigint,
      'stock_return', v_id, v_user.id, p_notes
    );
  end loop;

  return v_id;
end;
$$;

revoke all on function public.apply_leftover_return(uuid, text, text) from public, anon, authenticated;

create or replace function public.list_return_inventory()
returns table(product_id uuid, product_name text, product_sku text, is_active boolean, quantity_on_hand bigint)
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
    and p.inventory_mode = 'piece_stock'
  order by p.name, p.id;
$$;

revoke all on function public.list_return_inventory() from public, anon;
grant execute on function public.list_return_inventory() to authenticated;

drop function if exists public.list_cashier_pos_inventory();

create function public.list_cashier_pos_inventory()
returns table (
  branch_id uuid,
  branch_name text,
  product_id uuid,
  product_name text,
  product_sku text,
  selling_price numeric,
  quantity_on_hand numeric,
  updated_at timestamptz,
  variants jsonb,
  inventory_mode public.inventory_mode
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user public.profiles%rowtype;
  v_branch_id uuid;
begin
  select * into v_user from public.profiles where id = auth.uid() and is_active;
  if not found or v_user.role is distinct from 'cashier' then
    raise exception 'Unauthorized: cashier access is required.' using errcode = '42501';
  end if;

  select s.branch_id into v_branch_id
  from public.shifts s
  where s.cashier_id = v_user.id and s.status = 'open'
  order by s.started_at desc
  limit 1;
  if v_branch_id is null then
    v_branch_id := v_user.branch_id;
  end if;
  if v_branch_id is null or v_branch_id is distinct from v_user.branch_id then
    raise exception 'No authorized branch is assigned to this cashier.' using errcode = '42501';
  end if;

  return query
  select
    b.id,
    b.name,
    p.id,
    p.name,
    p.sku,
    bp.selling_price,
    case when p.inventory_mode = 'kg_meal' then null else coalesce(bi.quantity_on_hand, 0) end,
    coalesce(bi.updated_at, bp.updated_at),
    coalesce((
      select jsonb_agg(jsonb_build_object('id', bpv.id, 'name', bpv.name, 'selling_price', bpv.selling_price) order by bpv.name)
      from public.branch_product_variants bpv
      where bpv.branch_id = bp.branch_id and bpv.product_id = bp.product_id and bpv.is_active
    ), '[]'::jsonb),
    p.inventory_mode
  from public.branch_products bp
  join public.products p on p.id = bp.product_id
  join public.branches b on b.id = bp.branch_id
  left join public.branch_inventory bi
    on bi.product_id = bp.product_id and bi.branch_id = bp.branch_id
  where bp.branch_id = v_branch_id
    and bp.is_active
    and p.is_active
    and b.is_active
    and not b.is_main_branch
  order by p.name, p.id;
end;
$$;

revoke all on function public.list_cashier_pos_inventory() from public, anon;
grant execute on function public.list_cashier_pos_inventory() to authenticated;

create or replace function public.end_cashier_shift(p_shift_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Use close cashier shift.' using errcode = '42501';
end;
$$;

revoke all on function public.end_cashier_shift(uuid) from public, anon;
grant execute on function public.end_cashier_shift(uuid) to authenticated;

create or replace function public.close_overdue_shifts()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now_manila          timestamp;
  v_cutoff_manila_date  date;
  v_cutoff              timestamptz;
  v_shift               public.shifts%rowtype;
  v_leftover_id         uuid;
  v_closed_count        integer := 0;
  v_leftover_count      integer := 0;
begin
  v_now_manila := timezone('Asia/Manila', now());
  if v_now_manila < (v_now_manila::date + time '21:00') then
    v_cutoff_manila_date := v_now_manila::date - 1;
  else
    v_cutoff_manila_date := v_now_manila::date;
  end if;
  v_cutoff := (v_cutoff_manila_date + time '21:00') at time zone 'Asia/Manila';

  for v_shift in
    select *
    from public.shifts
    where status = 'open'
      and started_at < v_cutoff
    order by started_at, id
    for update skip locked
  loop
    begin
      v_leftover_id := null;
      update public.shifts
      set status = 'closed', ended_at = now()
      where id = v_shift.id
        and status = 'open';
      if found then
        v_closed_count := v_closed_count + 1;
        if v_leftover_id is not null then
          v_leftover_count := v_leftover_count + 1;
        end if;
      end if;
    exception when others then
      null;
    end;
  end loop;

  return jsonb_build_object(
    'closed_count', v_closed_count,
    'leftover_return_count', v_leftover_count,
    'cutoff_at', v_cutoff
  );
end;
$$;

revoke all on function public.close_overdue_shifts() from public, anon, authenticated;

create or replace function public.record_shift_reconciliation(
  p_shift public.shifts,
  p_actor uuid,
  p_actual_cash text,
  p_waste jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actual numeric(12,2);
  v_expected numeric(12,2);
  v_difference numeric(12,2);
  v_result public.cash_reconciliation_result;
  v_waste jsonb;
  v_item record;
  v_note text;
begin
  if exists (select 1 from public.shift_reconciliations r where r.shift_id = p_shift.id) then
    raise exception 'This shift has already been reconciled.' using errcode = '22023';
  end if;

  v_actual := public.parse_actual_cash(p_actual_cash);
  select coalesce(sum(s.total_amount), 0)::numeric(12,2) into v_expected
  from public.sales s
  where s.shift_id = p_shift.id and s.status = 'completed';
  v_difference := v_expected - v_actual;
  v_result := case
    when v_difference = 0 then 'exact'::public.cash_reconciliation_result
    when v_difference > 0 then 'shortage'::public.cash_reconciliation_result
    else 'excess'::public.cash_reconciliation_result
  end;

  if p_waste is null or jsonb_typeof(p_waste) = 'null' then
    v_waste := '[]'::jsonb;
  elsif jsonb_typeof(p_waste) <> 'array' then
    raise exception 'Waste list is invalid.' using errcode = '22023';
  else
    v_waste := p_waste;
  end if;
  if jsonb_array_length(v_waste) > 200 then
    raise exception 'Too many waste products.' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_array_elements(v_waste)) <>
     (select count(distinct value->>'product_id') from jsonb_array_elements(v_waste)) then
    raise exception 'Each waste product may be recorded only once for this shift.' using errcode = '22023';
  end if;

  for v_item in
    select (value->>'product_id')::uuid as product_id, value->>'note' as note
    from jsonb_array_elements(v_waste)
    order by value->>'product_id'
  loop
    v_note := nullif(btrim(coalesce(v_item.note, '')), '');
    if v_note is not null and char_length(v_note) > 500 then
      raise exception 'Waste note is too long.' using errcode = '22023';
    end if;
    if not exists (
      select 1 from public.products p
      where p.id = v_item.product_id and p.inventory_mode = 'kg_meal'
    ) then
      raise exception 'Waste can only be recorded for a KG-delivered meal.' using errcode = '22023';
    end if;
    if not exists (
      select 1 from public.branch_products bp
      where bp.branch_id = p_shift.branch_id
        and bp.product_id = v_item.product_id
        and bp.is_active
    ) then
      raise exception 'Waste product is not in this branch active catalog.' using errcode = '22023';
    end if;
    insert into public.shift_waste_occurrences(shift_id, branch_id, product_id, recorded_by, note)
    values (p_shift.id, p_shift.branch_id, v_item.product_id, p_actor, v_note);
  end loop;

  insert into public.shift_reconciliations(
    shift_id, branch_id, expected_cash, actual_cash, difference, result, recorded_by
  ) values (
    p_shift.id, p_shift.branch_id, v_expected, v_actual, v_difference, v_result, p_actor
  );

  return jsonb_build_object(
    'shift_id', p_shift.id,
    'expected_cash', v_expected,
    'actual_cash', v_actual,
    'difference', v_difference,
    'result', v_result,
    'status', 'reconciled'
  );
end;
$$;

revoke all on function public.record_shift_reconciliation(public.shifts, uuid, text, jsonb)
  from public, anon, authenticated;

create or replace function public.close_cashier_shift(
  p_shift_id uuid,
  p_actual_cash text,
  p_waste jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user public.profiles%rowtype;
  v_shift public.shifts%rowtype;
  v_result jsonb;
begin
  select * into v_user
  from public.profiles
  where id = auth.uid() and is_active and role = 'cashier'
  for update;
  if not found then
    raise exception 'Unauthorized: active cashier access required.' using errcode = '42501';
  end if;

  select * into v_shift from public.shifts where id = p_shift_id for update;
  if not found or v_shift.cashier_id <> v_user.id or v_shift.branch_id is distinct from v_user.branch_id then
    raise exception 'Unable to access this shift.' using errcode = '42501';
  end if;
  if v_shift.status <> 'open' then
    raise exception 'This shift is already closed.' using errcode = '42501';
  end if;

  v_result := public.record_shift_reconciliation(v_shift, v_user.id, p_actual_cash, p_waste);
  update public.shifts
  set status = 'closed', ended_at = now()
  where id = p_shift_id and status = 'open';
  return v_result || jsonb_build_object('shift_status', 'closed');
end;
$$;

revoke all on function public.close_cashier_shift(uuid, text, jsonb) from public, anon;
grant execute on function public.close_cashier_shift(uuid, text, jsonb) to authenticated;

create or replace function public.reconcile_closed_shift(
  p_shift_id uuid,
  p_actual_cash text,
  p_waste jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user public.profiles%rowtype;
  v_shift public.shifts%rowtype;
begin
  select * into v_user
  from public.profiles
  where id = auth.uid() and is_active and role = 'cashier'
  for update;
  if not found then
    raise exception 'Unauthorized: active cashier access required.' using errcode = '42501';
  end if;

  select * into v_shift from public.shifts where id = p_shift_id for update;
  if not found or v_shift.cashier_id <> v_user.id or v_shift.branch_id is distinct from v_user.branch_id then
    raise exception 'Unable to access this shift.' using errcode = '42501';
  end if;
  if v_shift.status <> 'closed' then
    raise exception 'Only a closed shift can be reconciled later.' using errcode = '42501';
  end if;

  return public.record_shift_reconciliation(v_shift, v_user.id, p_actual_cash, p_waste);
end;
$$;

revoke all on function public.reconcile_closed_shift(uuid, text, jsonb) from public, anon;
grant execute on function public.reconcile_closed_shift(uuid, text, jsonb) to authenticated;

create or replace function public.get_my_pending_shift_reconciliation()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user public.profiles%rowtype;
  v_shift public.shifts%rowtype;
  v_expected numeric(12,2);
begin
  select * into v_user
  from public.profiles
  where id = auth.uid() and is_active and role = 'cashier';
  if not found then
    raise exception 'Unauthorized: active cashier access required.' using errcode = '42501';
  end if;

  select * into v_shift
  from public.shifts s
  where s.cashier_id = v_user.id
    and s.branch_id = v_user.branch_id
    and s.status = 'closed'
    and not exists (select 1 from public.shift_reconciliations r where r.shift_id = s.id)
  order by s.ended_at asc, s.id
  limit 1;
  if not found then
    return null;
  end if;

  select coalesce(sum(sales.total_amount), 0)::numeric(12,2) into v_expected
  from public.sales
  where shift_id = v_shift.id and status = 'completed';

  return jsonb_build_object(
    'shift_id', v_shift.id,
    'started_at', v_shift.started_at,
    'ended_at', v_shift.ended_at,
    'expected_cash', v_expected,
    'actual_cash', null,
    'difference', null,
    'result', null,
    'status', 'pending'
  );
end;
$$;

revoke all on function public.get_my_pending_shift_reconciliation() from public, anon;
grant execute on function public.get_my_pending_shift_reconciliation() to authenticated;

create or replace function public.report_branch_shift_remittances(
  p_branch_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not (public.is_owner() or public.is_main_branch_manager()) then
    raise exception 'Unauthorized: Owner or Main Branch Manager access is required.'
      using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(row_to_json(q)::jsonb order by q.ended_at desc), '[]'::jsonb)
  into v_result
  from (
    select
      s.id as shift_id,
      s.branch_id,
      b.name as branch_name,
      s.cashier_id,
      s.ended_at,
      case when r.id is null then 'pending' else 'reconciled' end as status,
      coalesce(r.expected_cash, (
        select coalesce(sum(sales.total_amount), 0)::numeric(12,2)
        from public.sales
        where sales.shift_id = s.id and sales.status = 'completed'
      )) as expected_cash,
      r.actual_cash,
      r.difference,
      r.result
    from public.shifts s
    join public.branches b on b.id = s.branch_id
    left join public.shift_reconciliations r on r.shift_id = s.id
    where s.status = 'closed'
      and not b.is_main_branch
      and (p_branch_id is null or s.branch_id = p_branch_id)
  ) q;
  return v_result;
end;
$$;

revoke all on function public.report_branch_shift_remittances(uuid) from public, anon;
grant execute on function public.report_branch_shift_remittances(uuid) to authenticated;

create or replace function public.ensure_transfer_has_complete_items()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.stock_transfer_items where stock_transfer_id = new.id
  ) then
    raise exception 'A stock transfer must contain at least one item.' using errcode = '23514';
  end if;
  if new.status in ('received', 'received_with_discrepancy') and exists (
    select 1 from public.stock_transfer_items
    where stock_transfer_id = new.id
      and inventory_mode = 'piece_stock'
      and quantity_received is null
  ) then
    raise exception 'Every piece item requires an actual received quantity.' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.ensure_transfer_has_complete_items() from public, anon, authenticated;

create or replace function public.report_inventory_reconciliation(p_branch_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not public.is_owner() then
    raise exception 'Unauthorized: Owner access required.' using errcode = '42501';
  end if;

  with active_branches as (
    select b.id, b.name
    from public.branches b
    where b.is_active and (p_branch_id is null or b.id = p_branch_id)
  ),
  branch_product_pairs as (
    select b.id as branch_id, b.name as branch_name,
           p.id as product_id, p.name as product_name, p.sku as product_sku,
           p.inventory_mode as product_inventory_mode
    from active_branches b
    cross join public.products p
    where p.is_active
       or exists (select 1 from public.branch_inventory bi where bi.branch_id = b.id and bi.product_id = p.id)
       or exists (select 1 from public.inventory_movements im where im.branch_id = b.id and im.product_id = p.id)
  ),
  movements_agg as (
    select im.branch_id, im.product_id,
      coalesce(sum(im.quantity) filter (where im.movement_type = 'opening_stock'), 0)::numeric(14,3) as opening_stock,
      coalesce(abs(sum(im.quantity) filter (where im.movement_type = 'transfer_out')), 0)::numeric(14,3) as transfer_out,
      coalesce(sum(im.quantity) filter (where im.movement_type = 'transfer_in'), 0)::numeric(14,3) as transfer_in,
      coalesce(abs(sum(im.quantity) filter (where im.movement_type = 'sale')), 0)::numeric(14,3) as sale,
      coalesce(abs(sum(im.quantity) filter (where im.movement_type = 'return_out')), 0)::numeric(14,3) as return_out,
      coalesce(sum(im.quantity) filter (where im.movement_type = 'return_in'), 0)::numeric(14,3) as return_in,
      coalesce(sum(im.quantity) filter (where im.movement_type = 'adjustment'), 0)::numeric(14,3) as adjustment,
      coalesce(sum(im.quantity), 0)::numeric(14,3) as calculated_stock,
      (array_agg(im.inventory_mode order by im.created_at desc, im.id desc))[1] as latest_inventory_mode
    from public.inventory_movements im
    group by im.branch_id, im.product_id
  ),
  transfer_disc_agg as (
    select st.to_branch_id as branch_id, td.product_id,
      coalesce(sum(td.difference) filter (where td.discrepancy_type = 'missing'), 0)::bigint as transfer_missing_qty,
      coalesce(sum(abs(td.difference)) filter (where td.discrepancy_type = 'excess'), 0)::bigint as transfer_excess_qty
    from public.transfer_discrepancies td
    join public.stock_transfers st on st.id = td.stock_transfer_id
    group by st.to_branch_id, td.product_id
  ),
  return_disc_agg as (
    select sr.from_branch_id as branch_id, rd.product_id,
      coalesce(sum(rd.difference) filter (where rd.discrepancy_type = 'missing'), 0)::bigint as return_missing_qty,
      coalesce(sum(abs(rd.difference)) filter (where rd.discrepancy_type = 'excess'), 0)::bigint as return_excess_qty
    from public.return_discrepancies rd
    join public.stock_returns sr on sr.id = rd.stock_return_id
    group by sr.from_branch_id, rd.product_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'branch_id', bp.branch_id,
    'branch_name', bp.branch_name,
    'product_id', bp.product_id,
    'product_name', bp.product_name,
    'product_sku', bp.product_sku,
    'inventory_mode', coalesce(ma.latest_inventory_mode, bp.product_inventory_mode),
    'opening_stock', coalesce(ma.opening_stock, 0),
    'transfer_out', coalesce(ma.transfer_out, 0),
    'transfer_in', coalesce(ma.transfer_in, 0),
    'sale', coalesce(ma.sale, 0),
    'return_out', coalesce(ma.return_out, 0),
    'return_in', coalesce(ma.return_in, 0),
    'adjustment', coalesce(ma.adjustment, 0),
    'calculated_stock', coalesce(ma.calculated_stock, 0),
    'current_stock', coalesce(bi.quantity_on_hand, 0),
    'variance', coalesce(bi.quantity_on_hand, 0) - coalesce(ma.calculated_stock, 0),
    'has_reconciliation_issue', coalesce(bi.quantity_on_hand, 0) <> coalesce(ma.calculated_stock, 0),
    'transfer_missing_qty', coalesce(tda.transfer_missing_qty, 0),
    'transfer_excess_qty', coalesce(tda.transfer_excess_qty, 0),
    'return_missing_qty', coalesce(rda.return_missing_qty, 0),
    'return_excess_qty', coalesce(rda.return_excess_qty, 0)
  ) order by bp.branch_name, bp.product_name), '[]'::jsonb)
  into v_result
  from branch_product_pairs bp
  left join movements_agg ma on ma.branch_id = bp.branch_id and ma.product_id = bp.product_id
  left join public.branch_inventory bi on bi.branch_id = bp.branch_id and bi.product_id = bp.product_id
  left join transfer_disc_agg tda on tda.branch_id = bp.branch_id and tda.product_id = bp.product_id
  left join return_disc_agg rda on rda.branch_id = bp.branch_id and rda.product_id = bp.product_id;

  return v_result;
end;
$$;

revoke all on function public.report_inventory_reconciliation(uuid) from public, anon;
grant execute on function public.report_inventory_reconciliation(uuid) to authenticated;

commit;
