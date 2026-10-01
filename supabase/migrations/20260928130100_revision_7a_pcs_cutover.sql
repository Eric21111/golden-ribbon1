begin;

-- ============================================================================
-- Revision 7A — PCS inventory data model + safe cutover (local migration).
-- Do not deploy alone. Coordinate with compatible 7B/7C app.
-- branch_inventory.quantity_on_hand remains numeric(14,3); whole-PCS enforced.
-- Movement enums waste/unsold added in 20260928130000_revision_7a_movement_enums.sql.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0) Closing / recon result enums
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'public' and t.typname = 'closing_stock_behavior') then
    create type public.closing_stock_behavior as enum ('keep_at_branch', 'record_as_unsold');
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'public' and t.typname = 'shift_product_recon_result') then
    create type public.shift_product_recon_result as enum ('exact', 'shortage', 'excess');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1) Preflight: open shifts
-- ---------------------------------------------------------------------------
do $$
declare
  v_ids text;
begin
  select string_agg(id::text, ', ' order by started_at, id)
  into v_ids
  from public.shifts
  where status = 'open';

  if v_ids is not null then
    raise exception
      'pcs_cutover_blocked_open_shifts: Close every open shift before PCS cutover. Open shift ids: %',
      v_ids
      using errcode = 'P0001';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 2) Preflight: open KG transfers / returns
-- ---------------------------------------------------------------------------
do $$
declare
  v_transfer_ids text;
  v_return_ids text;
begin
  select string_agg(distinct st.id::text, ', ' order by st.id::text)
  into v_transfer_ids
  from public.stock_transfers st
  join public.stock_transfer_items sti on sti.stock_transfer_id = st.id
  where st.status in ('draft', 'pending_receipt')
    and sti.inventory_mode = 'kg_meal';

  if v_transfer_ids is not null then
    raise exception
      'pcs_cutover_blocked_open_kg_transfers: Finish or cancel open KG transfers first. Ids: %',
      v_transfer_ids
      using errcode = 'P0001';
  end if;

  select string_agg(distinct sr.id::text, ', ' order by sr.id::text)
  into v_return_ids
  from public.stock_returns sr
  join public.stock_return_items sri on sri.stock_return_id = sr.id
  where sr.status in ('draft', 'in_transit')
    and sri.inventory_mode = 'kg_meal';

  if v_return_ids is not null then
    raise exception
      'pcs_cutover_blocked_open_kg_returns: Finish or cancel open KG returns first. Ids: %',
      v_return_ids
      using errcode = 'P0001';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 3) Preflight: fractional piece_stock quantities (do not round)
-- ---------------------------------------------------------------------------
do $$
declare
  v_movement_ids text;
  v_transfer_ids text;
  v_return_ids text;
begin
  select string_agg(id::text, ', ' order by id)
  into v_movement_ids
  from public.inventory_movements
  where inventory_mode = 'piece_stock'
    and quantity <> trunc(quantity);

  if v_movement_ids is not null then
    raise exception
      'pcs_cutover_blocked_fractional_piece_movements: Fractional piece_stock inventory_movements.quantity. Ids: %',
      v_movement_ids
      using errcode = 'P0001';
  end if;

  select string_agg(id::text, ', ' order by id)
  into v_transfer_ids
  from public.stock_transfer_items
  where inventory_mode = 'piece_stock'
    and (
      quantity_sent <> trunc(quantity_sent)
      or (quantity_received is not null and quantity_received <> trunc(quantity_received))
    );

  if v_transfer_ids is not null then
    raise exception
      'pcs_cutover_blocked_fractional_piece_transfers: Fractional piece_stock stock_transfer_items quantities. Ids: %',
      v_transfer_ids
      using errcode = 'P0001';
  end if;

  select string_agg(id::text, ', ' order by id)
  into v_return_ids
  from public.stock_return_items
  where inventory_mode = 'piece_stock'
    and (
      quantity_returned <> trunc(quantity_returned)
      or (quantity_received is not null and quantity_received <> trunc(quantity_received))
    );

  if v_return_ids is not null then
    raise exception
      'pcs_cutover_blocked_fractional_piece_returns: Fractional piece_stock stock_return_items quantities. Ids: %',
      v_return_ids
      using errcode = 'P0001';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 4) Product closing behavior column (before product snapshots)
-- ---------------------------------------------------------------------------
alter table public.products
  add column if not exists closing_stock_behavior public.closing_stock_behavior
    not null default 'keep_at_branch';

-- ---------------------------------------------------------------------------
-- 5) pcs_cutover_product_snapshots (ALL products, before mode rewrite)
-- ---------------------------------------------------------------------------
create table if not exists public.pcs_cutover_product_snapshots (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete restrict,
  product_name_snapshot text not null,
  sku_snapshot text not null,
  former_inventory_mode public.inventory_mode not null,
  former_is_active boolean not null,
  assigned_closing_stock_behavior public.closing_stock_behavior not null,
  snapshotted_at timestamptz not null default now(),
  unique (product_id)
);

alter table public.pcs_cutover_product_snapshots enable row level security;

drop policy if exists pcs_cutover_product_snapshots_select on public.pcs_cutover_product_snapshots;
create policy pcs_cutover_product_snapshots_select
on public.pcs_cutover_product_snapshots for select to authenticated
using (public.is_owner() or public.is_main_branch_manager());

revoke all on public.pcs_cutover_product_snapshots from public, anon;
grant select on public.pcs_cutover_product_snapshots to authenticated;

insert into public.pcs_cutover_product_snapshots (
  product_id,
  product_name_snapshot,
  sku_snapshot,
  former_inventory_mode,
  former_is_active,
  assigned_closing_stock_behavior,
  snapshotted_at
)
select
  p.id,
  p.name,
  p.sku,
  p.inventory_mode,
  p.is_active,
  case
    when p.inventory_mode = 'kg_meal' then 'record_as_unsold'::public.closing_stock_behavior
    else 'keep_at_branch'::public.closing_stock_behavior
  end,
  now()
from public.products p
on conflict (product_id) do nothing;

update public.products p
set closing_stock_behavior = s.assigned_closing_stock_behavior
from public.pcs_cutover_product_snapshots s
where s.product_id = p.id;

-- ---------------------------------------------------------------------------
-- 6) kg_meal_cutover_balance_snapshots + operational clear
-- ---------------------------------------------------------------------------
create table if not exists public.kg_meal_cutover_balance_snapshots (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  quantity_on_hand numeric(14,3) not null,
  product_name_snapshot text not null,
  sku_snapshot text not null,
  snapshotted_at timestamptz not null default now()
);

create index if not exists kg_meal_cutover_balance_snapshots_product_idx
  on public.kg_meal_cutover_balance_snapshots (product_id);

alter table public.kg_meal_cutover_balance_snapshots enable row level security;

drop policy if exists kg_meal_cutover_balance_snapshots_select on public.kg_meal_cutover_balance_snapshots;
create policy kg_meal_cutover_balance_snapshots_select
on public.kg_meal_cutover_balance_snapshots for select to authenticated
using (public.is_owner() or public.is_main_branch_manager());

revoke all on public.kg_meal_cutover_balance_snapshots from public, anon;
grant select on public.kg_meal_cutover_balance_snapshots to authenticated;

insert into public.kg_meal_cutover_balance_snapshots (
  branch_id, product_id, quantity_on_hand, product_name_snapshot, sku_snapshot, snapshotted_at
)
select
  bi.branch_id,
  bi.product_id,
  bi.quantity_on_hand,
  p.name,
  p.sku,
  now()
from public.branch_inventory bi
join public.products p on p.id = bi.product_id
where p.inventory_mode = 'kg_meal'
  and bi.quantity_on_hand <> 0;

-- Auditable operational clear (while products still kg_meal so movement snapshots stay kg_meal)
do $$
declare
  v_row record;
  v_adjustment_id uuid := gen_random_uuid();
  v_actor uuid;
begin
  if exists (
    select 1
    from public.branch_inventory bi
    join public.products p on p.id = bi.product_id
    where p.inventory_mode = 'kg_meal'
      and bi.quantity_on_hand <> 0
  ) then
    select id into v_actor
    from public.profiles
    where role = 'owner' and is_active
    order by id
    limit 1;
    if v_actor is null then
      select id into v_actor
      from public.profiles
      where role = 'manager' and is_active
      order by id
      limit 1;
    end if;
    if v_actor is null then
      raise exception 'pcs_cutover_missing_actor: Need an owner or manager profile to audit cutover adjustments.'
        using errcode = 'P0001';
    end if;
  end if;

  for v_row in
    select bi.branch_id, bi.product_id, bi.quantity_on_hand
    from public.branch_inventory bi
    join public.products p on p.id = bi.product_id
    where p.inventory_mode = 'kg_meal'
      and bi.quantity_on_hand <> 0
    order by bi.branch_id, bi.product_id
    for update of bi
  loop
    update public.branch_inventory
    set quantity_on_hand = 0,
        updated_at = now()
    where branch_id = v_row.branch_id
      and product_id = v_row.product_id;

    insert into public.inventory_movements (
      branch_id, product_id, movement_type, quantity,
      reference_type, reference_id, created_by, notes
    ) values (
      v_row.branch_id,
      v_row.product_id,
      'adjustment',
      -v_row.quantity_on_hand,
      'adjustment',
      v_adjustment_id,
      v_actor,
      'pcs_cutover: clear former kg_meal operational balance'
    );
  end loop;
end
$$;

-- Deactivate former kg products until Main PCS opening stock
update public.products
set is_active = false,
    updated_at = now()
where inventory_mode = 'kg_meal';

-- Freeze all live products to piece_stock
do $$
begin
  perform set_config('golden.allow_inventory_mode_change', 'on', true);
  update public.products
  set inventory_mode = 'piece_stock',
      updated_at = now()
  where inventory_mode is distinct from 'piece_stock';
end
$$;

-- ---------------------------------------------------------------------------
-- 7) Shift scaffolding columns
-- ---------------------------------------------------------------------------
alter table public.shifts
  add column if not exists sales_cutoff_at timestamptz null;

alter table public.shifts
  add column if not exists inventory_reconciliation_required boolean not null default false;

-- Existing shifts stay false (cash/legacy only). New inserts also default false until 7C
-- End Shift / auto-close writers set this true for PCS sessions.
alter table public.shifts
  alter column inventory_reconciliation_required set default false;

update public.shifts
set inventory_reconciliation_required = false
where inventory_reconciliation_required is distinct from false;

-- ---------------------------------------------------------------------------
-- 8) Quantified waste
-- ---------------------------------------------------------------------------
alter table public.shift_waste_occurrences
  add column if not exists quantity bigint null;

alter table public.shift_waste_occurrences
  drop constraint if exists shift_waste_occurrences_quantity_chk;

alter table public.shift_waste_occurrences
  add constraint shift_waste_occurrences_quantity_chk
  check (quantity is null or quantity > 0);

-- ---------------------------------------------------------------------------
-- 9) Opening stock + product reconciliations (7A schema / 7C engine)
-- ---------------------------------------------------------------------------
create table if not exists public.shift_product_opening_stock (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.shifts(id) on delete restrict,
  branch_id uuid not null references public.branches(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  product_name_snapshot text not null,
  opening_quantity bigint not null check (opening_quantity >= 0),
  captured_at timestamptz not null default now(),
  unique (shift_id, product_id)
);

create index if not exists shift_product_opening_stock_branch_idx
  on public.shift_product_opening_stock (branch_id, shift_id);

alter table public.shift_product_opening_stock enable row level security;

drop policy if exists shift_product_opening_stock_select on public.shift_product_opening_stock;
create policy shift_product_opening_stock_select
on public.shift_product_opening_stock for select to authenticated
using (
  public.is_owner()
  or public.is_main_branch_manager()
  or exists (
    select 1 from public.shifts s
    where s.id = shift_id and s.cashier_id = (select auth.uid())
  )
);

revoke all on public.shift_product_opening_stock from public, anon;
grant select on public.shift_product_opening_stock to authenticated;

create table if not exists public.shift_product_reconciliations (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.shifts(id) on delete restrict,
  branch_id uuid not null references public.branches(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  product_name_snapshot text not null,
  sku_snapshot text,
  closing_stock_behavior public.closing_stock_behavior not null,
  opening_quantity bigint not null check (opening_quantity >= 0),
  received_quantity bigint not null default 0,
  outgoing_quantity bigint not null default 0,
  sold_quantity bigint not null default 0,
  waste_quantity bigint not null default 0 check (waste_quantity >= 0),
  adjustment_quantity bigint not null default 0,
  net_other_movement_quantity bigint not null default 0,
  expected_remaining bigint not null,
  actual_remaining bigint not null check (actual_remaining >= 0),
  discrepancy bigint not null,
  unsold_quantity bigint not null default 0 check (unsold_quantity >= 0),
  carried_quantity bigint not null default 0 check (carried_quantity >= 0),
  result public.shift_product_recon_result not null,
  reconciled_at timestamptz not null default now(),
  recorded_by uuid not null references public.profiles(id) on delete restrict,
  unique (shift_id, product_id),
  constraint shift_product_reconciliations_discrepancy_chk
    check (discrepancy = actual_remaining - expected_remaining),
  constraint shift_product_reconciliations_result_chk
    check (
      (discrepancy = 0 and result = 'exact')
      or (discrepancy < 0 and result = 'shortage')
      or (discrepancy > 0 and result = 'excess')
    )
);

create index if not exists shift_product_reconciliations_branch_idx
  on public.shift_product_reconciliations (branch_id, shift_id);

alter table public.shift_product_reconciliations enable row level security;

drop policy if exists shift_product_reconciliations_select on public.shift_product_reconciliations;
create policy shift_product_reconciliations_select
on public.shift_product_reconciliations for select to authenticated
using (
  public.is_owner()
  or public.is_main_branch_manager()
  or recorded_by = (select auth.uid())
);

revoke all on public.shift_product_reconciliations from public, anon;
grant select on public.shift_product_reconciliations to authenticated;

-- ---------------------------------------------------------------------------
-- 10) Movement sign / reference checks include waste / unsold (7C scaffolding)
-- ---------------------------------------------------------------------------
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
    'shift_product_reconciliation'
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
  );

-- ---------------------------------------------------------------------------
-- 11) Rewrite snapshot triggers — new rows snapshot piece_stock without
--     reading products.inventory_mode (safe for later column drop).
-- ---------------------------------------------------------------------------
create or replace function public.snapshot_movement_inventory_mode()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.inventory_mode is distinct from old.inventory_mode then
      raise exception 'Historical inventory type cannot be changed.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- Revision 7A+: all new operational movements are piece_stock.
  new.inventory_mode := 'piece_stock';
  return new;
end;
$$;

create or replace function public.snapshot_transfer_item_inventory_mode()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.inventory_mode is distinct from old.inventory_mode then
    raise exception 'Historical inventory type cannot be changed.'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    new.inventory_mode := 'piece_stock';
  end if;

  -- Legacy kg_meal rows may still exist; unmeasured receive rule preserved for them.
  if new.inventory_mode = 'kg_meal' and new.quantity_received is not null then
    raise exception 'KG delivery is confirmed, not weighed. Received weight stays unmeasured.'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

create or replace function public.guard_return_item_inventory_mode()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.inventory_mode is distinct from old.inventory_mode then
    raise exception 'Historical inventory type cannot be changed.'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    new.inventory_mode := 'piece_stock';
  end if;

  -- New returns are always piece_stock after cutover. Legacy kg return rows stay immutable.
  if new.inventory_mode = 'kg_meal' then
    raise exception 'KG-delivered meals cannot be returned by quantity.'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

-- Retire selling-branch KG stock guard (no active kg_meal products remain).
drop trigger if exists branch_inventory_guard_kg on public.branch_inventory;
drop function if exists public.guard_selling_branch_kg_stock();

-- ---------------------------------------------------------------------------
-- 12) Whole-PCS DB constraints (retain numeric(14,3) on live stock)
-- ---------------------------------------------------------------------------
alter table public.branch_inventory
  drop constraint if exists branch_inventory_whole_pcs_chk;
alter table public.branch_inventory
  add constraint branch_inventory_whole_pcs_chk
  check (quantity_on_hand = trunc(quantity_on_hand));

alter table public.inventory_movements
  drop constraint if exists inventory_movements_piece_whole_chk;
alter table public.inventory_movements
  add constraint inventory_movements_piece_whole_chk
  check (
    inventory_mode <> 'piece_stock'
    or quantity = trunc(quantity)
  );

alter table public.stock_transfer_items
  drop constraint if exists stock_transfer_items_piece_whole_chk;
alter table public.stock_transfer_items
  add constraint stock_transfer_items_piece_whole_chk
  check (
    inventory_mode <> 'piece_stock'
    or (
      quantity_sent = trunc(quantity_sent)
      and (quantity_received is null or quantity_received = trunc(quantity_received))
    )
  );

alter table public.stock_return_items
  drop constraint if exists stock_return_items_piece_whole_chk;
alter table public.stock_return_items
  add constraint stock_return_items_piece_whole_chk
  check (
    inventory_mode <> 'piece_stock'
    or (
      quantity_returned = trunc(quantity_returned)
      and (quantity_received is null or quantity_received = trunc(quantity_received))
    )
  );

-- ---------------------------------------------------------------------------
-- 13) Global lock gate helper
--     Order: branches FOR UPDATE → open shift FOR UPDATE → inventory by product_id
-- ---------------------------------------------------------------------------
create or replace function public.lock_branch_inventory_gate(p_branch_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shift_id uuid;
begin
  if p_branch_id is null then
    raise exception 'Branch is required for inventory lock.' using errcode = '22023';
  end if;

  perform 1
  from public.branches
  where id = p_branch_id
  for update;
  if not found then
    raise exception 'Branch is missing.' using errcode = '22023';
  end if;

  select s.id
  into v_shift_id
  from public.shifts s
  where s.branch_id = p_branch_id
    and s.status = 'open'
  order by s.started_at, s.id
  limit 1
  for update;

  perform 1
  from public.branch_inventory bi
  where bi.branch_id = p_branch_id
  order by bi.product_id
  for update;
end;
$$;

revoke all on function public.lock_branch_inventory_gate(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 14) set_product_inventory_mode — reject kg_meal
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

  if v_requested = 'kg_meal' then
    raise exception 'KG-delivered meal inventory is retired. Use piece stock (PCS) only.'
      using errcode = '22023';
  end if;
  if v_requested is distinct from 'piece_stock' then
    raise exception 'Inventory type must be piece stock.'
      using errcode = '22023';
  end if;
  v_mode := 'piece_stock'::public.inventory_mode;

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

-- parse_inventory_quantity: active ops are PCS; kg_meal parsing retired for new ops
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
  if p_mode = 'kg_meal' then
    raise exception 'KG-delivered meal inventory is retired. Use whole PCS quantities.'
      using errcode = '22023';
  end if;
  if v_text = '' then
    raise exception 'Quantity is required.' using errcode = '22023';
  end if;
  if left(v_text, 1) = '-' then
    raise exception 'Quantity cannot be negative.' using errcode = '22023';
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

commit;
