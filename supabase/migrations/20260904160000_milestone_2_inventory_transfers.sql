begin;

create type public.inventory_movement_type as enum (
  'opening_stock',
  'transfer_out',
  'transfer_in',
  'adjustment'
);

create type public.stock_transfer_status as enum (
  'draft',
  'pending_receipt',
  'received',
  'received_with_discrepancy',
  'cancelled'
);

create type public.transfer_discrepancy_type as enum ('missing', 'excess');

create sequence public.stock_transfer_number_seq;

create table public.branch_inventory (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  quantity_on_hand bigint not null default 0 check (quantity_on_hand >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (branch_id, product_id)
);

create index branch_inventory_product_id_idx on public.branch_inventory(product_id);

create table public.stock_transfers (
  id uuid primary key default gen_random_uuid(),
  transfer_number text not null unique,
  from_branch_id uuid not null references public.branches(id) on delete restrict,
  to_branch_id uuid not null references public.branches(id) on delete restrict,
  status public.stock_transfer_status not null default 'draft',
  created_by uuid not null references public.profiles(id) on delete restrict,
  sent_by uuid references public.profiles(id) on delete restrict,
  received_by uuid references public.profiles(id) on delete restrict,
  sent_at timestamptz,
  received_at timestamptz,
  notes text check (notes is null or char_length(notes) <= 1000),
  send_idempotency_key text,
  receive_idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stock_transfers_different_branches check (from_branch_id <> to_branch_id),
  constraint stock_transfers_send_key_length check (
    send_idempotency_key is null or char_length(send_idempotency_key) between 16 and 100
  ),
  constraint stock_transfers_receive_key_length check (
    receive_idempotency_key is null or char_length(receive_idempotency_key) between 16 and 100
  ),
  constraint stock_transfers_lifecycle_fields_check check (
    (status in ('draft', 'cancelled') and received_by is null and received_at is null)
    or (status = 'pending_receipt' and sent_by is not null and sent_at is not null and received_by is null and received_at is null)
    or (status in ('received', 'received_with_discrepancy') and sent_by is not null and sent_at is not null and received_by is not null and received_at is not null)
  )
);

create unique index stock_transfers_send_idempotency_key_idx
on public.stock_transfers(send_idempotency_key) where send_idempotency_key is not null;
create unique index stock_transfers_receive_idempotency_key_idx
on public.stock_transfers(receive_idempotency_key) where receive_idempotency_key is not null;
create index stock_transfers_to_branch_status_idx on public.stock_transfers(to_branch_id, status);
create index stock_transfers_created_at_idx on public.stock_transfers(created_at desc);

create table public.stock_transfer_items (
  id uuid primary key default gen_random_uuid(),
  stock_transfer_id uuid not null references public.stock_transfers(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  quantity_sent bigint not null check (quantity_sent > 0),
  quantity_received bigint check (quantity_received is null or quantity_received >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (stock_transfer_id, product_id)
);

create index stock_transfer_items_product_id_idx on public.stock_transfer_items(product_id);

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  movement_type public.inventory_movement_type not null,
  quantity bigint not null check (quantity <> 0),
  reference_type text not null check (reference_type in ('opening_stock', 'stock_transfer', 'adjustment')),
  reference_id uuid,
  created_by uuid not null references public.profiles(id) on delete restrict,
  notes text check (notes is null or char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  constraint inventory_movements_reference_check check (
    (reference_type = 'opening_stock' and reference_id is null)
    or (reference_type <> 'opening_stock' and reference_id is not null)
  ),
  constraint inventory_movements_sign_check check (
    (movement_type in ('opening_stock', 'transfer_in') and quantity > 0)
    or (movement_type = 'transfer_out' and quantity < 0)
    or movement_type = 'adjustment'
  )
);

create index inventory_movements_branch_created_idx
on public.inventory_movements(branch_id, created_at desc);
create index inventory_movements_product_id_idx on public.inventory_movements(product_id);
create unique index inventory_movements_one_opening_per_product_idx
on public.inventory_movements(branch_id, product_id) where movement_type = 'opening_stock';
create unique index inventory_movements_transfer_once_idx
on public.inventory_movements(branch_id, product_id, movement_type, reference_id)
where reference_type = 'stock_transfer';

create table public.transfer_discrepancies (
  id uuid primary key default gen_random_uuid(),
  stock_transfer_id uuid not null references public.stock_transfers(id) on delete restrict,
  stock_transfer_item_id uuid not null unique references public.stock_transfer_items(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  quantity_expected bigint not null check (quantity_expected > 0),
  quantity_received bigint not null check (quantity_received >= 0),
  difference bigint not null check (difference <> 0),
  discrepancy_type public.transfer_discrepancy_type not null,
  notes text check (notes is null or char_length(notes) <= 1000),
  recorded_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint transfer_discrepancy_math_check check (difference = quantity_expected - quantity_received),
  constraint transfer_discrepancy_type_check check (
    (difference > 0 and discrepancy_type = 'missing')
    or (difference < 0 and discrepancy_type = 'excess')
  )
);

create index transfer_discrepancies_transfer_id_idx
on public.transfer_discrepancies(stock_transfer_id);

create trigger branch_inventory_set_updated_at
before update on public.branch_inventory
for each row execute function public.set_updated_at();

create trigger stock_transfers_set_updated_at
before update on public.stock_transfers
for each row execute function public.set_updated_at();

create trigger stock_transfer_items_set_updated_at
before update on public.stock_transfer_items
for each row execute function public.set_updated_at();

create or replace function public.block_immutable_record_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Completed inventory audit records are immutable.' using errcode = '55000';
end;
$$;

create trigger inventory_movements_immutable
before update or delete on public.inventory_movements
for each row execute function public.block_immutable_record_changes();

create trigger transfer_discrepancies_immutable
before update or delete on public.transfer_discrepancies
for each row execute function public.block_immutable_record_changes();

create or replace function public.enforce_transfer_status_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status and not (
    (old.status = 'draft' and new.status in ('pending_receipt', 'cancelled'))
    or (old.status = 'pending_receipt' and new.status in ('received', 'received_with_discrepancy'))
  ) then
    raise exception 'Invalid stock transfer status transition.' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger stock_transfers_status_transition
before update of status on public.stock_transfers
for each row execute function public.enforce_transfer_status_transition();

create or replace function public.protect_completed_transfer_items()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_status public.stock_transfer_status;
begin
  select status into v_status
  from public.stock_transfers
  where id = case when tg_op = 'DELETE' then old.stock_transfer_id else new.stock_transfer_id end;

  if v_status in ('received', 'received_with_discrepancy', 'cancelled') then
    raise exception 'Completed transfer items are immutable.' using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger stock_transfer_items_protect_completed
before update or delete on public.stock_transfer_items
for each row execute function public.protect_completed_transfer_items();

create or replace function public.ensure_transfer_has_complete_items()
returns trigger
language plpgsql
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
    where stock_transfer_id = new.id and quantity_received is null
  ) then
    raise exception 'Every transfer item requires an actual received quantity.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create constraint trigger stock_transfers_require_items
after insert or update on public.stock_transfers
deferrable initially deferred
for each row execute function public.ensure_transfer_has_complete_items();

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
  v_user_id uuid := auth.uid();
  v_main_branch_id uuid;
  v_item record;
  v_current_quantity bigint;
  v_product_active boolean;
begin
  if public.current_user_role() is distinct from 'owner'::public.user_role then
    raise exception 'Unauthorized: owner access is required.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Select at least one product with a positive opening quantity.' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_array_elements(p_items)) <>
     (select count(distinct value->>'product_id') from jsonb_array_elements(p_items)) then
    raise exception 'Each product may appear only once.' using errcode = '22023';
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
           (value->>'quantity')::bigint as quantity
    from jsonb_array_elements(p_items)
    order by value->>'product_id'
  loop
    if v_item.quantity <= 0 then
      raise exception 'Opening quantities must be positive.' using errcode = '22023';
    end if;

    select is_active into v_product_active
    from public.products where id = v_item.product_id for share;
    if not found or not v_product_active then
      raise exception 'Product is missing or inactive.' using errcode = '22023';
    end if;

    insert into public.branch_inventory(branch_id, product_id, quantity_on_hand)
    values (v_main_branch_id, v_item.product_id, 0)
    on conflict (branch_id, product_id) do nothing;

    select quantity_on_hand into v_current_quantity
    from public.branch_inventory
    where branch_id = v_main_branch_id and product_id = v_item.product_id
    for update;

    if v_current_quantity <> 0 or exists (
      select 1 from public.inventory_movements
      where branch_id = v_main_branch_id
        and product_id = v_item.product_id
        and movement_type = 'opening_stock'
    ) then
      raise exception 'Opening stock has already been initialized for a selected product.' using errcode = '55000';
    end if;

    update public.branch_inventory
    set quantity_on_hand = v_item.quantity
    where branch_id = v_main_branch_id and product_id = v_item.product_id;

    insert into public.inventory_movements(
      branch_id, product_id, movement_type, quantity,
      reference_type, reference_id, created_by, notes
    ) values (
      v_main_branch_id, v_item.product_id, 'opening_stock', v_item.quantity,
      'opening_stock', null, v_user_id, nullif(trim(p_notes), '')
    );
  end loop;
end;
$$;

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
  v_available bigint;
  v_product_active boolean;
begin
  if public.current_user_role() is distinct from 'owner'::public.user_role then
    raise exception 'Unauthorized: owner access is required.' using errcode = '42501';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 16 and 100 then
    raise exception 'Invalid request key.' using errcode = '22023';
  end if;

  select id into v_transfer_id
  from public.stock_transfers where send_idempotency_key = p_idempotency_key;
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
  from public.branches where is_main_branch and is_active for share;
  if v_from_branch_id is null then
    raise exception 'No active Main Branch is configured.' using errcode = '22023';
  end if;

  perform 1 from public.branches
  where id = p_to_branch_id and is_active and not is_main_branch
  for share;
  if not found then
    raise exception 'Destination branch is missing, inactive, or is the Main Branch.' using errcode = '22023';
  end if;

  for v_item in
    select (value->>'product_id')::uuid as product_id,
           (value->>'quantity_sent')::bigint as quantity_sent
    from jsonb_array_elements(p_items)
    order by value->>'product_id'
  loop
    if v_item.quantity_sent <= 0 then
      raise exception 'Transfer quantities must be positive.' using errcode = '22023';
    end if;

    select is_active into v_product_active
    from public.products where id = v_item.product_id for share;
    if not found or not v_product_active then
      raise exception 'Product is missing or inactive.' using errcode = '22023';
    end if;

    select quantity_on_hand into v_available
    from public.branch_inventory
    where branch_id = v_from_branch_id and product_id = v_item.product_id
    for update;

    if v_available is null or v_available < v_item.quantity_sent then
      raise exception 'Insufficient stock. Available: %, requested: %.',
        coalesce(v_available, 0), v_item.quantity_sent using errcode = '22003';
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
    select (value->>'product_id')::uuid as product_id,
           (value->>'quantity_sent')::bigint as quantity_sent
    from jsonb_array_elements(p_items)
    order by value->>'product_id'
  loop
    insert into public.stock_transfer_items(stock_transfer_id, product_id, quantity_sent)
    values (v_transfer_id, v_item.product_id, v_item.quantity_sent);

    update public.branch_inventory
    set quantity_on_hand = quantity_on_hand - v_item.quantity_sent
    where branch_id = v_from_branch_id
      and product_id = v_item.product_id
      and quantity_on_hand >= v_item.quantity_sent;

    if not found then
      raise exception 'Insufficient stock during transfer processing.' using errcode = '22003';
    end if;

    insert into public.inventory_movements(
      branch_id, product_id, movement_type, quantity,
      reference_type, reference_id, created_by, notes
    ) values (
      v_from_branch_id, v_item.product_id, 'transfer_out', -v_item.quantity_sent,
      'stock_transfer', v_transfer_id, v_user_id, nullif(trim(p_notes), '')
    );
  end loop;

  return v_transfer_id;
end;
$$;

create or replace function public.receive_stock_transfer(
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
  v_role public.user_role := public.current_user_role();
  v_user_branch_id uuid := public.current_user_branch_id();
  v_transfer public.stock_transfers%rowtype;
  v_item record;
  v_received bigint;
  v_difference bigint;
  v_has_discrepancy boolean := false;
  v_final_status public.stock_transfer_status;
begin
  if v_role is null or v_role not in ('owner', 'manager') then
    raise exception 'Unauthorized: manager or owner access is required.' using errcode = '42501';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 16 and 100 then
    raise exception 'Invalid request key.' using errcode = '22023';
  end if;

  select * into v_transfer
  from public.stock_transfers
  where id = p_transfer_id
  for update;

  if not found then
    raise exception 'Unable to load transfer.' using errcode = 'P0002';
  end if;
  if v_role = 'manager' and v_transfer.to_branch_id <> v_user_branch_id then
    raise exception 'Unauthorized: this transfer belongs to another branch.' using errcode = '42501';
  end if;
  if v_transfer.receive_idempotency_key = p_idempotency_key and
     v_transfer.status in ('received', 'received_with_discrepancy') then
    return v_transfer.status;
  end if;
  if v_transfer.status <> 'pending_receipt' then
    raise exception 'Transfer has already been received or is not pending receipt.' using errcode = '55000';
  end if;
  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'Actual received quantity is required for every item.' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_array_elements(p_items)) <>
     (select count(distinct value->>'stock_transfer_item_id') from jsonb_array_elements(p_items)) then
    raise exception 'Each transfer item may appear only once.' using errcode = '22023';
  end if;
  if (select count(*) from public.stock_transfer_items where stock_transfer_id = p_transfer_id) <>
     jsonb_array_length(p_items) then
    raise exception 'Actual received quantity is required for every item.' using errcode = '22023';
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

  for v_item in
    select sti.id, sti.product_id, sti.quantity_sent
    from public.stock_transfer_items sti
    where sti.stock_transfer_id = p_transfer_id
    order by sti.product_id
  loop
    select (value->>'quantity_received')::bigint into v_received
    from jsonb_array_elements(p_items)
    where (value->>'stock_transfer_item_id')::uuid = v_item.id;

    if v_received is null or v_received < 0 then
      raise exception 'Received quantities must be zero or greater.' using errcode = '22023';
    end if;

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
      v_has_discrepancy := true;
      insert into public.transfer_discrepancies(
        stock_transfer_id, stock_transfer_item_id, product_id,
        quantity_expected, quantity_received, difference,
        discrepancy_type, notes, recorded_by
      ) values (
        p_transfer_id, v_item.id, v_item.product_id,
        v_item.quantity_sent, v_received, v_difference,
        case when v_difference > 0 then 'missing'::public.transfer_discrepancy_type
             else 'excess'::public.transfer_discrepancy_type end,
        nullif(trim(p_notes), ''), v_user_id
      );
    end if;
  end loop;

  v_final_status := case when v_has_discrepancy
    then 'received_with_discrepancy'::public.stock_transfer_status
    else 'received'::public.stock_transfer_status end;

  update public.stock_transfers
  set status = v_final_status,
      received_by = v_user_id,
      received_at = now(),
      receive_idempotency_key = p_idempotency_key
  where id = p_transfer_id;

  return v_final_status;
end;
$$;

revoke all on function public.block_immutable_record_changes() from public;
revoke all on function public.enforce_transfer_status_transition() from public;
revoke all on function public.protect_completed_transfer_items() from public;
revoke all on function public.ensure_transfer_has_complete_items() from public;
revoke all on function public.initialize_main_branch_inventory(jsonb, text) from public, anon;
revoke all on function public.send_stock_transfer(uuid, jsonb, text, text) from public, anon;
revoke all on function public.receive_stock_transfer(uuid, jsonb, text, text) from public, anon;
grant execute on function public.initialize_main_branch_inventory(jsonb, text) to authenticated;
grant execute on function public.send_stock_transfer(uuid, jsonb, text, text) to authenticated;
grant execute on function public.receive_stock_transfer(uuid, jsonb, text, text) to authenticated;

alter table public.branch_inventory enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.stock_transfers enable row level security;
alter table public.stock_transfer_items enable row level security;
alter table public.transfer_discrepancies enable row level security;

create policy "branch_inventory_select_authorized"
on public.branch_inventory for select to authenticated
using (
  public.is_owner()
  or (public.current_user_role() = 'manager' and branch_id = public.current_user_branch_id())
);

create policy "inventory_movements_select_authorized"
on public.inventory_movements for select to authenticated
using (
  public.is_owner()
  or (public.current_user_role() = 'manager' and branch_id = public.current_user_branch_id())
);

create policy "stock_transfers_select_authorized"
on public.stock_transfers for select to authenticated
using (
  public.is_owner()
  or (public.current_user_role() = 'manager' and to_branch_id = public.current_user_branch_id())
);

create policy "stock_transfer_items_select_authorized"
on public.stock_transfer_items for select to authenticated
using (
  exists (
    select 1 from public.stock_transfers st
    where st.id = stock_transfer_id
      and (
        public.is_owner()
        or (public.current_user_role() = 'manager' and st.to_branch_id = public.current_user_branch_id())
      )
  )
);

create policy "transfer_discrepancies_select_authorized"
on public.transfer_discrepancies for select to authenticated
using (
  exists (
    select 1 from public.stock_transfers st
    where st.id = stock_transfer_id
      and (
        public.is_owner()
        or (public.current_user_role() = 'manager' and st.to_branch_id = public.current_user_branch_id())
      )
  )
);

create policy "profiles_select_transfer_actors"
on public.profiles for select to authenticated
using (
  public.is_owner()
  or exists (
    select 1
    from public.stock_transfers st
    where st.to_branch_id = public.current_user_branch_id()
      and profiles.id in (st.created_by, st.sent_by, st.received_by)
  )
);

revoke all on public.branch_inventory, public.inventory_movements,
  public.stock_transfers, public.stock_transfer_items, public.transfer_discrepancies from anon, authenticated;
grant select on public.branch_inventory, public.inventory_movements,
  public.stock_transfers, public.stock_transfer_items, public.transfer_discrepancies to authenticated;

comment on table public.branch_inventory is 'Current per-branch product balance; mutations occur only through inventory RPCs.';
comment on table public.inventory_movements is 'Immutable signed inventory audit ledger.';
comment on table public.stock_transfers is 'Main Branch to selling branch transfer headers.';
comment on table public.stock_transfer_items is 'Expected and actual quantities for each transfer product.';
comment on table public.transfer_discrepancies is 'Immutable missing or excess receipt records.';

commit;
