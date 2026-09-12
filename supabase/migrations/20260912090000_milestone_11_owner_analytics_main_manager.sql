begin;

-- ============================================================================
-- Milestone 11 — Owner analytics / Main Branch Manager operations / audit removal
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1. Helpers
-- --------------------------------------------------------------------------

create or replace function public.is_main_branch_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    join public.branches b on b.id = p.branch_id
    where p.id = auth.uid()
      and p.is_active
      and p.role = 'manager'
      and b.is_main_branch
  )
$$;

create or replace function public.employee_assignment_is_valid(
  p_role public.user_role,
  p_branch_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_role = 'cashier' then exists (
      select 1 from public.branches b
      where b.id = p_branch_id and b.is_active and not b.is_main_branch
    )
    when p_role = 'manager' then exists (
      select 1 from public.branches b
      where b.id = p_branch_id and b.is_active
    )
    else false
  end
$$;

revoke all on function public.is_main_branch_manager() from public, anon;
revoke all on function public.employee_assignment_is_valid(public.user_role, uuid) from public, anon;
grant execute on function public.is_main_branch_manager() to authenticated;

-- --------------------------------------------------------------------------
-- 2. Profile / branch assignment rules
-- --------------------------------------------------------------------------

create or replace function public.validate_profile_branch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.role = 'cashier' then
    if not exists (
      select 1 from public.branches b
      where b.id = new.branch_id and not b.is_main_branch
    ) then
      raise exception 'Cashiers must be assigned to a selling branch.';
    end if;
  elsif new.role = 'manager' then
    if not exists (
      select 1 from public.branches b
      where b.id = new.branch_id
    ) then
      raise exception 'Managers must be assigned to an existing branch.';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.prevent_assigned_branch_becoming_main()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.is_main_branch and not old.is_main_branch and exists (
    select 1 from public.profiles p
    where p.branch_id = new.id and p.role = 'cashier'
  ) then
    raise exception 'A branch assigned to cashiers cannot become the Main Branch.';
  end if;
  return new;
end;
$$;

create or replace function public.protect_main_branch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.is_main_branch then
    if new.is_main_branch is distinct from true then
      raise exception 'The Main Branch cannot be converted to a selling branch.' using errcode = '55000';
    end if;
    if not new.is_active then
      raise exception 'The Main Branch cannot be deactivated.' using errcode = '55000';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists branches_protect_main on public.branches;
create trigger branches_protect_main
before update on public.branches
for each row execute function public.protect_main_branch();

revoke all on function public.protect_main_branch() from public, anon, authenticated;

-- --------------------------------------------------------------------------
-- 3. RLS — operational writes move to Main Branch Manager
-- --------------------------------------------------------------------------

drop policy if exists "branches_select_allowed" on public.branches;
create policy "branches_select_allowed"
on public.branches for select
to authenticated
using (
  public.is_owner()
  or public.is_main_branch_manager()
  or id = public.current_user_branch_id()
);

drop policy if exists "branches_insert_owner" on public.branches;
drop policy if exists "branches_insert_main_manager" on public.branches;
create policy "branches_insert_main_manager"
on public.branches for insert
to authenticated
with check (public.is_main_branch_manager() and not is_main_branch);

drop policy if exists "branches_update_owner" on public.branches;
drop policy if exists "branches_update_main_manager" on public.branches;
create policy "branches_update_main_manager"
on public.branches for update
to authenticated
using (public.is_main_branch_manager())
with check (public.is_main_branch_manager());

drop policy if exists "products_insert_owner" on public.products;
drop policy if exists "products_insert_main_manager" on public.products;
create policy "products_insert_main_manager"
on public.products for insert
to authenticated
with check (public.is_main_branch_manager());

drop policy if exists "products_update_owner" on public.products;
drop policy if exists "products_update_main_manager" on public.products;
create policy "products_update_main_manager"
on public.products for update
to authenticated
using (public.is_main_branch_manager())
with check (public.is_main_branch_manager());

drop policy if exists "stock_transfers_select_authorized" on public.stock_transfers;
create policy "stock_transfers_select_authorized"
on public.stock_transfers for select
to authenticated
using (
  public.is_owner()
  or public.is_main_branch_manager()
  or (
    public.current_user_role() = 'manager'
    and (
      to_branch_id = public.current_user_branch_id()
      or from_branch_id = public.current_user_branch_id()
    )
  )
);

drop policy if exists "stock_transfer_items_select_authorized" on public.stock_transfer_items;
create policy "stock_transfer_items_select_authorized"
on public.stock_transfer_items for select
to authenticated
using (
  exists (
    select 1 from public.stock_transfers st
    where st.id = stock_transfer_id
      and (
        public.is_owner()
        or public.is_main_branch_manager()
        or (
          public.current_user_role() = 'manager'
          and (
            st.to_branch_id = public.current_user_branch_id()
            or st.from_branch_id = public.current_user_branch_id()
          )
        )
      )
  )
);

drop policy if exists "transfer_discrepancies_select_authorized" on public.transfer_discrepancies;
create policy "transfer_discrepancies_select_authorized"
on public.transfer_discrepancies for select
to authenticated
using (
  exists (
    select 1 from public.stock_transfers st
    where st.id = stock_transfer_id
      and (
        public.is_owner()
        or public.is_main_branch_manager()
        or (
          public.current_user_role() = 'manager'
          and (
            st.to_branch_id = public.current_user_branch_id()
            or st.from_branch_id = public.current_user_branch_id()
          )
        )
      )
  )
);

drop policy if exists "profiles_select_transfer_actors" on public.profiles;
create policy "profiles_select_transfer_actors"
on public.profiles for select
to authenticated
using (
  public.is_owner()
  or public.is_main_branch_manager()
  or exists (
    select 1
    from public.stock_transfers st
    where (
      st.to_branch_id = public.current_user_branch_id()
      or st.from_branch_id = public.current_user_branch_id()
    )
      and profiles.id in (st.created_by, st.sent_by, st.received_by)
  )
);

-- --------------------------------------------------------------------------
-- 4. Employee RPCs — Main Branch Manager only; managers may be assigned to Main
-- --------------------------------------------------------------------------

create or replace function public.list_employees()
returns table (
  id uuid,
  full_name text,
  email text,
  role public.user_role,
  branch_id uuid,
  branch_name text,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_main_branch_manager() then
    raise exception 'Unauthorized: Main Branch Manager access is required.' using errcode = '42501';
  end if;

  return query
  select p.id, p.full_name, u.email::text, p.role, p.branch_id,
         b.name, p.is_active, p.created_at, p.updated_at
  from public.profiles p
  join auth.users u on u.id = p.id
  left join public.branches b on b.id = p.branch_id
  where p.role in ('manager', 'cashier')
  order by p.full_name, u.email;
end;
$$;

create or replace function public.owner_update_employee(
  p_employee_id uuid,
  p_full_name   text,
  p_role        public.user_role,
  p_branch_id   uuid,
  p_is_active   boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id      uuid := auth.uid();
  v_existing_role public.user_role;
begin
  if not public.is_main_branch_manager() then
    raise exception 'Unauthorized: Main Branch Manager access is required.' using errcode = '42501';
  end if;
  if p_full_name is null or char_length(trim(p_full_name)) not between 2 and 120 then
    raise exception 'Full name must contain between 2 and 120 characters.' using errcode = '22023';
  end if;
  if p_role is null or p_role not in ('manager', 'cashier') then
    raise exception 'Employee role must be Manager or Cashier.' using errcode = '22023';
  end if;
  if p_is_active is null then
    raise exception 'Employee status is required.' using errcode = '22023';
  end if;
  if p_employee_id = v_actor_id then
    if p_role is distinct from 'manager' then
      raise exception 'You cannot change your own role.' using errcode = '42501';
    end if;
    if not p_is_active then
      raise exception 'You cannot deactivate your own account.' using errcode = '42501';
    end if;
  end if;
  if not public.employee_assignment_is_valid(p_role, p_branch_id) then
    if p_role = 'cashier' then
      raise exception 'Select an active selling branch.' using errcode = '22023';
    end if;
    raise exception 'Select an active branch.' using errcode = '22023';
  end if;

  perform 1 from public.branches where id = p_branch_id for share;

  select role into v_existing_role
  from public.profiles
  where id = p_employee_id
  for update;
  if not found or v_existing_role not in ('manager', 'cashier') then
    raise exception 'Employee account was not found.' using errcode = 'P0002';
  end if;
  if v_existing_role = 'owner' or exists (
    select 1 from public.profiles where id = p_employee_id and role = 'owner'
  ) then
    raise exception 'The Owner account cannot be modified.' using errcode = '42501';
  end if;

  update public.profiles
  set full_name = trim(p_full_name),
      role      = p_role,
      branch_id = p_branch_id,
      is_active = p_is_active
  where id = p_employee_id;
end;
$$;

create or replace function public.create_employee_profile_from_server(
  p_requester_id uuid,
  p_employee_id  uuid,
  p_full_name    text,
  p_role         public.user_role,
  p_branch_id    uuid,
  p_is_active    boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.profiles p
    join public.branches b on b.id = p.branch_id
    where p.id = p_requester_id
      and p.role = 'manager'
      and p.is_active
      and b.is_main_branch
  ) then
    raise exception 'Unauthorized: Main Branch Manager access is required.' using errcode = '42501';
  end if;
  if p_full_name is null or char_length(trim(p_full_name)) not between 2 and 120 then
    raise exception 'Full name must contain between 2 and 120 characters.' using errcode = '22023';
  end if;
  if p_role is null or p_role not in ('manager', 'cashier') then
    raise exception 'Employee role must be Manager or Cashier.' using errcode = '22023';
  end if;
  if p_is_active is null then
    raise exception 'Employee status is required.' using errcode = '22023';
  end if;
  if not public.employee_assignment_is_valid(p_role, p_branch_id) then
    if p_role = 'cashier' then
      raise exception 'Select an active selling branch.' using errcode = '22023';
    end if;
    raise exception 'Select an active branch.' using errcode = '22023';
  end if;

  insert into public.profiles(id, full_name, role, branch_id, is_active)
  values (p_employee_id, trim(p_full_name), p_role, p_branch_id, p_is_active);
end;
$$;

revoke all on function public.list_employees() from public, anon;
revoke all on function public.owner_update_employee(uuid, text, public.user_role, uuid, boolean) from public, anon;
revoke all on function public.create_employee_profile_from_server(uuid, uuid, text, public.user_role, uuid, boolean) from public, anon, authenticated;
grant execute on function public.list_employees() to authenticated;
grant execute on function public.owner_update_employee(uuid, text, public.user_role, uuid, boolean) to authenticated;
grant execute on function public.create_employee_profile_from_server(uuid, uuid, text, public.user_role, uuid, boolean) to service_role;

-- --------------------------------------------------------------------------
-- 5. Operational RPCs — Main Branch Manager / selling-branch manager
-- --------------------------------------------------------------------------

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
  v_current_qty    bigint;
  v_product_active boolean;
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

    select quantity_on_hand into v_current_qty
    from public.branch_inventory
    where branch_id = v_main_branch_id and product_id = v_item.product_id
    for update;

    if v_current_qty <> 0 or exists (
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

revoke all on function public.initialize_main_branch_inventory(jsonb, text) from public, anon;
grant execute on function public.initialize_main_branch_inventory(jsonb, text) to authenticated;

create or replace function public.send_stock_transfer(
  p_to_branch_id    uuid,
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
  v_user_id         uuid := auth.uid();
  v_from_branch_id  uuid;
  v_transfer_id     uuid;
  v_transfer_number text;
  v_item            record;
  v_available       bigint;
  v_product_active  boolean;
begin
  if not public.is_main_branch_manager() then
    raise exception 'Unauthorized: Main Branch Manager access is required.' using errcode = '42501';
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

revoke all on function public.send_stock_transfer(uuid, jsonb, text, text) from public, anon;
grant execute on function public.send_stock_transfer(uuid, jsonb, text, text) to authenticated;

create or replace function public.receive_stock_transfer(
  p_transfer_id     uuid,
  p_items           jsonb,
  p_notes           text,
  p_idempotency_key text
)
returns public.stock_transfer_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id         uuid := auth.uid();
  v_user            public.profiles%rowtype;
  v_transfer        public.stock_transfers%rowtype;
  v_item            record;
  v_received        bigint;
  v_difference      bigint;
  v_has_discrepancy boolean := false;
  v_final_status    public.stock_transfer_status;
begin
  select * into v_user
  from public.profiles
  where id = v_user_id and is_active;
  if not found or v_user.role is distinct from 'manager' then
    raise exception 'Unauthorized: manager access is required.' using errcode = '42501';
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
  if v_transfer.to_branch_id <> v_user.branch_id then
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

revoke all on function public.receive_stock_transfer(uuid, jsonb, text, text) from public, anon;
grant execute on function public.receive_stock_transfer(uuid, jsonb, text, text) to authenticated;

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
  select * into v_user from public.profiles where id=auth.uid() and is_active and role='manager' for update;
  if not found then raise exception 'An active Manager account is required.' using errcode='42501'; end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 16 and 100
    or length(coalesce(p_notes,'')) > 2000 then
    raise exception 'Invalid confirmation key or notes.' using errcode='22023'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'Select products to return.' using errcode='22023'; end if;
  if jsonb_array_length(p_items) not between 1 and 200 then
    raise exception 'Select 1 to 200 products.' using errcode='22023'; end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item.value) is distinct from 'object'
      or coalesce(v_item.value->>'quantity_returned','') !~ '^[1-9][0-9]{0,5}$'
      or coalesce(v_item.value->>'product_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Return quantities must be positive whole numbers (maximum 999999).'
        using errcode='22023'; end if;
  end loop;
  select jsonb_agg(jsonb_build_object('product_id',product_id,'quantity_returned',quantity_returned) order by product_id)
    into v_items from (select (value->>'product_id')::uuid product_id,
      sum((value->>'quantity_returned')::bigint) quantity_returned from jsonb_array_elements(p_items) group by 1) q;
  select * into v_existing from public.stock_returns where created_by=v_user.id and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_items <> v_items or v_existing.notes is distinct from p_notes then
      raise exception 'This confirmation key belongs to a different return.' using errcode='22023'; end if;
    return v_existing.id;
  end if;
  select * into v_source from public.branches where id=v_user.branch_id and is_active and not is_main_branch for share;
  if not found then raise exception 'Your assigned branch is unavailable.' using errcode='42501'; end if;
  select * into v_main from public.branches where is_main_branch and is_active for share;
  if not found then raise exception 'An active Main Branch is required.' using errcode='22023'; end if;
  for v_item in select * from jsonb_to_recordset(v_items) as x(product_id uuid,quantity_returned bigint) order by product_id loop
    select * into v_product from public.products where id=v_item.product_id for share;
    if not found then raise exception 'Product unavailable.' using errcode='22023'; end if;
    select quantity_on_hand into v_stock from public.branch_inventory
      where branch_id=v_source.id and product_id=v_item.product_id for update;
    if coalesce(v_stock,0) < v_item.quantity_returned then
      raise exception 'Insufficient stock. % — Available: %, Requested: %',v_product.name,coalesce(v_stock,0),v_item.quantity_returned using errcode='22023'; end if;
  end loop;
  v_number := nextval('public.return_number_seq')::text;
  insert into public.stock_returns(return_number,from_branch_id,to_branch_id,created_by,returned_by,
    from_branch_name,to_branch_name,returned_by_name,notes,idempotency_key,request_items)
  values('RET-'||lpad(v_number,greatest(6,length(v_number)),'0'),v_source.id,v_main.id,v_user.id,v_user.id,
    v_source.name,v_main.name,v_user.full_name,p_notes,p_idempotency_key,v_items) returning id into v_id;
  for v_item in select * from jsonb_to_recordset(v_items) as x(product_id uuid,quantity_returned bigint) order by product_id loop
    select * into v_product from public.products where id=v_item.product_id;
    insert into public.stock_return_items(stock_return_id,product_id,quantity_returned,product_name,product_sku)
      values(v_id,v_item.product_id,v_item.quantity_returned,v_product.name,v_product.sku);
    update public.branch_inventory set quantity_on_hand=quantity_on_hand-v_item.quantity_returned
      where branch_id=v_source.id and product_id=v_item.product_id;
    insert into public.inventory_movements(branch_id,product_id,movement_type,quantity,reference_type,reference_id,created_by,notes)
      values(v_source.id,v_item.product_id,'return_out',-v_item.quantity_returned,'stock_return',v_id,v_user.id,p_notes);
  end loop;

  return v_id;
end;
$$;

revoke all on function public.create_stock_return(jsonb, text, text) from public, anon;
grant execute on function public.create_stock_return(jsonb, text, text) to authenticated;

create or replace function public.receive_stock_return(
  p_return_id       uuid,
  p_items           jsonb,
  p_notes           text default null,
  p_idempotency_key text default null
) returns public.stock_return_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user            public.profiles%rowtype;
  v_return          public.stock_returns%rowtype;
  v_item            record;
  v_received        bigint;
  v_difference      bigint;
  v_has_discrepancy boolean := false;
  v_final_status    public.stock_return_status;
begin
  if not public.is_main_branch_manager() then
    raise exception 'Unauthorized: Main Branch Manager access is required.' using errcode = '42501';
  end if;

  select * into v_user
  from public.profiles
  where id = auth.uid() and is_active;
  if not found then
    raise exception 'Active profile required.' using errcode = '42501';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 16 and 100 then
    raise exception 'Invalid request key.' using errcode = '22023';
  end if;
  if length(coalesce(p_notes, '')) > 2000 then
    raise exception 'Notes too long (maximum 2000 characters).' using errcode = '22023';
  end if;

  select * into v_return
  from public.stock_returns
  where id = p_return_id
  for update;
  if not found then
    raise exception 'Unable to load return.' using errcode = 'P0002';
  end if;

  perform 1
  from public.branches
  where id = v_return.to_branch_id and is_main_branch and is_active;
  if not found then
    raise exception 'Destination branch is not an active Main Branch.' using errcode = '22023';
  end if;
  if v_user.branch_id is distinct from v_return.to_branch_id then
    raise exception 'Unauthorized: only Main Branch managers can receive returns.' using errcode = '42501';
  end if;
  if v_user.branch_id = v_return.from_branch_id then
    raise exception 'Unauthorized: selling branch manager cannot receive their own return.' using errcode = '42501';
  end if;

  if v_return.receive_idempotency_key = p_idempotency_key and
     v_return.status in ('received', 'received_with_discrepancy') then
    return v_return.status;
  end if;
  if v_return.status <> 'in_transit' then
    raise exception 'Return has already been received or is not in transit.' using errcode = '55000';
  end if;
  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'Actual received quantity is required for every item.' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_array_elements(p_items)) <>
     (select count(distinct value->>'stock_return_item_id') from jsonb_array_elements(p_items)) then
    raise exception 'Each return item may appear only once.' using errcode = '22023';
  end if;
  if (select count(*) from public.stock_return_items where stock_return_id = p_return_id) <>
     jsonb_array_length(p_items) then
    raise exception 'Actual received quantity is required for every item.' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_items) x
    left join public.stock_return_items sri
      on sri.id = (x.value->>'stock_return_item_id')::uuid
     and sri.stock_return_id = p_return_id
    where sri.id is null
  ) then
    raise exception 'Receipt contains an invalid return item.' using errcode = '22023';
  end if;

  for v_item in
    select sri.id, sri.product_id, sri.quantity_returned
    from public.stock_return_items sri
    where sri.stock_return_id = p_return_id
    order by sri.product_id
  loop
    select (value->>'quantity_received')::bigint into v_received
    from jsonb_array_elements(p_items)
    where (value->>'stock_return_item_id')::uuid = v_item.id;

    if v_received is null or v_received < 0 or v_received > 999999 then
      raise exception 'Received quantities must be whole numbers between 0 and 999999.' using errcode = '22023';
    end if;

    update public.stock_return_items
    set quantity_received = v_received,
        updated_at = now()
    where id = v_item.id;

    if v_received > 0 then
      insert into public.branch_inventory(branch_id, product_id, quantity_on_hand)
      values (v_return.to_branch_id, v_item.product_id, v_received)
      on conflict (branch_id, product_id) do update
      set quantity_on_hand = branch_inventory.quantity_on_hand + excluded.quantity_on_hand;

      insert into public.inventory_movements(
        branch_id, product_id, movement_type, quantity,
        reference_type, reference_id, created_by, notes
      ) values (
        v_return.to_branch_id, v_item.product_id, 'return_in', v_received,
        'stock_return', p_return_id, v_user.id, nullif(trim(p_notes), '')
      );
    end if;

    v_difference := v_item.quantity_returned - v_received;
    if v_difference <> 0 then
      v_has_discrepancy := true;
      insert into public.return_discrepancies(
        stock_return_id, stock_return_item_id, product_id,
        quantity_expected, quantity_received, difference,
        discrepancy_type, notes, recorded_by
      ) values (
        p_return_id, v_item.id, v_item.product_id,
        v_item.quantity_returned, v_received, v_difference,
        case when v_difference > 0 then 'missing'::public.transfer_discrepancy_type
             else 'excess'::public.transfer_discrepancy_type end,
        nullif(trim(p_notes), ''), v_user.id
      );
    end if;
  end loop;

  v_final_status := case when v_has_discrepancy
    then 'received_with_discrepancy'::public.stock_return_status
    else 'received'::public.stock_return_status end;

  update public.stock_returns
  set status = v_final_status,
      received_by = v_user.id,
      received_by_name = v_user.full_name,
      received_at = now(),
      receive_idempotency_key = p_idempotency_key,
      updated_at = now()
  where id = p_return_id;

  return v_final_status;
end;
$$;

revoke all on function public.receive_stock_return(uuid, jsonb, text, text) from public, anon;
grant execute on function public.receive_stock_return(uuid, jsonb, text, text) to authenticated;

-- --------------------------------------------------------------------------
-- 6. Cashier / sale RPCs without audit writes (latest hardened behavior)
-- --------------------------------------------------------------------------

drop function if exists public.start_cashier_shift();
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

  perform 1
  from public.branches
  where id = v_branch_id and is_active and not is_main_branch
  for share;
  if not found then
    raise exception 'The assigned branch is inactive or invalid.' using errcode = '22023';
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

  insert into public.shifts(branch_id, cashier_id, status, started_at)
  values (v_branch_id, v_cashier_id, 'open', now())
  returning id into v_shift_id;

  return v_shift_id;
end;
$$;

revoke all on function public.start_cashier_shift() from public, anon;
grant execute on function public.start_cashier_shift() to authenticated;

create or replace function public.end_cashier_shift(p_shift_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id     uuid := auth.uid();
  v_user        public.profiles%rowtype;
  v_shift       public.shifts%rowtype;
  v_branch_name text;
  v_tx_count    bigint;
  v_total_sales numeric(12,2);
  v_was_open    boolean;
begin
  select * into v_user
  from public.profiles
  where id = v_user_id and is_active and role = 'cashier'
  for update;
  if not found then
    raise exception 'Unauthorized: active cashier access required.' using errcode = '42501';
  end if;

  select * into v_shift
  from public.shifts
  where id = p_shift_id
  for update;
  if not found or v_shift.cashier_id <> v_user_id or v_shift.branch_id <> v_user.branch_id then
    raise exception 'Unable to access this shift.' using errcode = '42501';
  end if;

  v_was_open := v_shift.status = 'open';
  if v_was_open then
    update public.shifts
    set status = 'closed', ended_at = now()
    where id = p_shift_id
    returning * into v_shift;
  end if;

  select b.name into v_branch_name from public.branches b where b.id = v_shift.branch_id;
  select count(s.id)::bigint, coalesce(sum(s.total_amount), 0)::numeric(12,2)
    into v_tx_count, v_total_sales
  from public.sales s
  where s.shift_id = p_shift_id and s.status = 'completed';

  return jsonb_build_object(
    'id', v_shift.id,
    'branch_id', v_shift.branch_id,
    'branch_name', v_branch_name,
    'cashier_id', v_shift.cashier_id,
    'cashier_name', v_user.full_name,
    'status', v_shift.status,
    'started_at', v_shift.started_at,
    'ended_at', v_shift.ended_at,
    'completed_transaction_count', v_tx_count,
    'total_sales', v_total_sales
  );
end;
$$;

revoke all on function public.end_cashier_shift(uuid) from public, anon;
grant execute on function public.end_cashier_shift(uuid) to authenticated;

drop function if exists public.confirm_sale(uuid, jsonb, numeric, text);
create function public.confirm_sale(
  p_shift_id        uuid,
  p_items           jsonb,
  p_amount_paid     numeric,
  p_idempotency_key text
)
returns public.sales
language plpgsql security definer set search_path = ''
as $$
declare
  v_user    uuid := auth.uid();
  v_actor   public.profiles%rowtype;
  v_branch  uuid;
  v_shift   public.shifts%rowtype;
  v_sale    public.sales%rowtype;
  v_items   jsonb;
  v_item    record;
  v_product public.products%rowtype;
  v_stock   bigint;
  v_total   numeric := 0;
begin
  select * into v_actor from public.profiles
    where id = v_user and is_active and role = 'cashier' for update;
  if not found then raise exception 'An active Cashier account is required.' using errcode = '42501'; end if;
  v_branch := v_actor.branch_id;
  if p_idempotency_key is null or length(p_idempotency_key) not between 16 and 100 then
    raise exception 'Invalid order confirmation key.' using errcode = '22023'; end if;
  if p_amount_paid is null or p_amount_paid::text in ('NaN','Infinity','-Infinity')
    or p_amount_paid < 0 or p_amount_paid > 9999999999.99 or p_amount_paid <> round(p_amount_paid,2) then
    raise exception 'Enter a valid payment with at most two decimal places.' using errcode = '22023'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'The cart must contain products.' using errcode = '22023'; end if;
  if jsonb_array_length(p_items) not between 1 and 200 then
    raise exception 'The cart must contain 1 to 200 products.' using errcode = '22023'; end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item.value) is distinct from 'object'
      or coalesce(v_item.value->>'quantity','') !~ '^[1-9][0-9]{0,5}$'
      or coalesce(v_item.value->>'product_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Invalid product or quantity.' using errcode = '22023'; end if;
  end loop;
  select jsonb_agg(jsonb_build_object('product_id', product_id, 'quantity', quantity) order by product_id)
    into v_items from (select (value->>'product_id')::uuid product_id,
      sum((value->>'quantity')::bigint) quantity from jsonb_array_elements(p_items) group by 1) q;
  select * into v_sale from public.sales where cashier_id = v_user and idempotency_key = p_idempotency_key;
  if found then
    if v_sale.shift_id <> p_shift_id or v_sale.request_items <> v_items or v_sale.amount_paid <> p_amount_paid then
      raise exception 'This confirmation key belongs to a different order.' using errcode = '22023'; end if;
    return v_sale;
  end if;
  perform 1 from public.branches where id = v_branch and is_active and not is_main_branch for share;
  if not found then raise exception 'Your assigned branch is unavailable.' using errcode = '42501'; end if;
  select * into v_shift from public.shifts where id = p_shift_id for update;
  if not found or v_shift.cashier_id <> v_user or v_shift.branch_id <> v_branch or v_shift.status <> 'open' then
    raise exception 'An open shift belonging to you is required.' using errcode = '42501'; end if;
  for v_item in select * from jsonb_to_recordset(v_items) as x(product_id uuid, quantity bigint) order by product_id loop
    select * into v_product from public.products where id = v_item.product_id for share;
    if not found or not v_product.is_active then
      raise exception 'A selected product is inactive or unavailable.' using errcode = '22023'; end if;
    select quantity_on_hand into v_stock from public.branch_inventory
      where branch_id = v_branch and product_id = v_item.product_id for update;
    if coalesce(v_stock,0) < v_item.quantity then
      raise exception 'Insufficient stock. % — Available: %, Requested: %', v_product.name, coalesce(v_stock,0), v_item.quantity using errcode = '22023'; end if;
    v_total := v_total + v_product.selling_price * v_item.quantity;
  end loop;
  if v_total > 9999999999.99 then raise exception 'Order total exceeds the supported limit.' using errcode = '22023'; end if;
  if p_amount_paid < v_total then
    raise exception 'Insufficient payment. Total: %, Remaining: %', v_total, v_total - p_amount_paid using errcode = '22023'; end if;
  insert into public.sales(sale_number, branch_id, shift_id, cashier_id, subtotal, total_amount, amount_paid, change_amount, idempotency_key, request_items)
    values ('SALE-' || lpad(nextval('public.sale_number_seq')::text, 10, '0'), v_branch, p_shift_id, v_user,
      v_total, v_total, p_amount_paid, p_amount_paid-v_total, p_idempotency_key, v_items) returning * into v_sale;
  for v_item in select * from jsonb_to_recordset(v_items) as x(product_id uuid, quantity bigint) order by product_id loop
    select * into v_product from public.products where id = v_item.product_id;
    insert into public.sale_items(sale_id, product_id, quantity, unit_price, subtotal)
      values(v_sale.id, v_item.product_id, v_item.quantity, v_product.selling_price, v_item.quantity*v_product.selling_price);
    update public.branch_inventory set quantity_on_hand = quantity_on_hand-v_item.quantity
      where branch_id = v_branch and product_id = v_item.product_id;
    insert into public.inventory_movements(branch_id, product_id, movement_type, quantity, reference_type, reference_id, created_by)
      values(v_branch, v_item.product_id, 'sale', -v_item.quantity, 'sale', v_sale.id, v_user);
  end loop;

  return v_sale;
end;
$$;

revoke all on function public.confirm_sale(uuid,jsonb,numeric,text) from public, anon;
grant execute on function public.confirm_sale(uuid,jsonb,numeric,text) to authenticated;

-- --------------------------------------------------------------------------
-- 7. Owner analytics — dashboard + daily product summary
-- --------------------------------------------------------------------------

create or replace function public.get_owner_dashboard_metrics()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_start                  timestamptz;
  v_end                    timestamptz;
  v_today_sales            numeric(12,2);
  v_today_tx               bigint;
  v_today_units            bigint;
  v_active_products        bigint;
  v_pending_transfers      bigint;
  v_in_transit_returns     bigint;
  v_transfer_discrepancies bigint;
  v_return_discrepancies   bigint;
begin
  if not public.is_owner() then
    raise exception 'Unauthorized: Owner access required.' using errcode = '42501';
  end if;

  v_start := (timezone('Asia/Manila', now()))::date::timestamp at time zone 'Asia/Manila';
  v_end := v_start + interval '1 day';

  select
    coalesce(sum(s.total_amount), 0)::numeric(12,2),
    count(s.id)::bigint
  into v_today_sales, v_today_tx
  from public.sales s
  where s.status = 'completed'
    and s.sold_at >= v_start
    and s.sold_at < v_end;

  select coalesce(sum(si.quantity), 0)::bigint
  into v_today_units
  from public.sale_items si
  join public.sales s on s.id = si.sale_id
  where s.status = 'completed'
    and s.sold_at >= v_start
    and s.sold_at < v_end;

  select count(id)::bigint into v_active_products
  from public.products where is_active;

  select count(id)::bigint into v_pending_transfers
  from public.stock_transfers where status = 'pending_receipt';

  select count(id)::bigint into v_in_transit_returns
  from public.stock_returns where status = 'in_transit';

  select count(id)::bigint into v_transfer_discrepancies
  from public.transfer_discrepancies;

  select count(id)::bigint into v_return_discrepancies
  from public.return_discrepancies;

  return jsonb_build_object(
    'today_sales', v_today_sales,
    'today_transactions', v_today_tx,
    'today_units_sold', v_today_units,
    'active_products_count', v_active_products,
    'pending_transfers_count', v_pending_transfers,
    'in_transit_returns_count', v_in_transit_returns,
    'transfer_discrepancies_count', v_transfer_discrepancies,
    'return_discrepancies_count', v_return_discrepancies
  );
end;
$$;

revoke all on function public.get_owner_dashboard_metrics() from public, anon;
grant execute on function public.get_owner_dashboard_metrics() to authenticated;

create or replace function public.get_owner_daily_product_summary()
returns table (
  product_id uuid,
  product_name text,
  quantity_sold bigint,
  quantity_returned bigint,
  revenue numeric,
  returned_declared_qty bigint,
  returned_received_qty bigint,
  return_missing_qty bigint,
  return_excess_qty bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_start timestamptz;
  v_end   timestamptz;
begin
  if not public.is_owner() then
    raise exception 'Unauthorized: Owner access required.' using errcode = '42501';
  end if;

  v_start := (timezone('Asia/Manila', now()))::date::timestamp at time zone 'Asia/Manila';
  v_end := v_start + interval '1 day';

  return query
  with sales_agg as (
    select si.product_id,
           coalesce(sum(si.quantity), 0)::bigint as quantity_sold,
           coalesce(sum(si.subtotal), 0)::numeric(12,2) as revenue
    from public.sale_items si
    join public.sales s on s.id = si.sale_id
    where s.status = 'completed'
      and s.sold_at >= v_start
      and s.sold_at < v_end
    group by si.product_id
  ),
  returns_agg as (
    select sri.product_id,
           coalesce(sum(sri.quantity_returned), 0)::bigint as quantity_returned,
           coalesce(sum(sri.quantity_received), 0)::bigint as quantity_received
    from public.stock_return_items sri
    join public.stock_returns sr on sr.id = sri.stock_return_id
    where sr.returned_at >= v_start
      and sr.returned_at < v_end
    group by sri.product_id
  ),
  return_disc_agg as (
    select rd.product_id,
           coalesce(sum(rd.difference) filter (where rd.discrepancy_type = 'missing'), 0)::bigint as return_missing_qty,
           coalesce(sum(abs(rd.difference)) filter (where rd.discrepancy_type = 'excess'), 0)::bigint as return_excess_qty
    from public.return_discrepancies rd
    join public.stock_returns sr on sr.id = rd.stock_return_id
    where sr.returned_at >= v_start
      and sr.returned_at < v_end
    group by rd.product_id
  )
  select
    p.id,
    p.name,
    coalesce(sa.quantity_sold, 0),
    coalesce(ra.quantity_returned, 0),
    coalesce(sa.revenue, 0)::numeric,
    coalesce(ra.quantity_returned, 0),
    coalesce(ra.quantity_received, 0),
    coalesce(rda.return_missing_qty, 0),
    coalesce(rda.return_excess_qty, 0)
  from public.products p
  left join sales_agg sa on sa.product_id = p.id
  left join returns_agg ra on ra.product_id = p.id
  left join return_disc_agg rda on rda.product_id = p.id
  where sa.product_id is not null or ra.product_id is not null
  order by p.name;
end;
$$;

revoke all on function public.get_owner_daily_product_summary() from public, anon;
grant execute on function public.get_owner_daily_product_summary() to authenticated;

-- --------------------------------------------------------------------------
-- 8. Remove audit / activity log subsystem
-- --------------------------------------------------------------------------

drop trigger if exists products_audit_after_change on public.products;
drop trigger if exists audit_logs_immutable on public.audit_logs;

drop function if exists public.list_audit_logs(int, int, uuid, uuid, text, text, text, timestamptz, timestamptz);
drop function if exists public.get_audit_log_detail(uuid);
drop function if exists public.products_audit_trigger_fn();
drop function if exists public.write_audit_log(uuid, text, text, uuid, text, text, uuid, jsonb);

drop policy if exists audit_logs_select_owner on public.audit_logs;

drop index if exists public.audit_logs_created_at_idx;
drop index if exists public.audit_logs_actor_idx;
drop index if exists public.audit_logs_branch_idx;
drop index if exists public.audit_logs_action_idx;
drop index if exists public.audit_logs_entity_type_idx;
drop index if exists public.audit_logs_entity_id_idx;
drop index if exists public.audit_logs_branch_created_at_idx;

drop table if exists public.audit_logs;

commit;
