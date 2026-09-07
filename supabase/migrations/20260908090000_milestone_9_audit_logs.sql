begin;

-- ============================================================================
-- 1. AUDIT LOGS TABLE
-- ============================================================================

create table public.audit_logs (
  id                  uuid primary key default gen_random_uuid(),
  -- actor_user_id is nullable so audit history survives profile deletion.
  -- actor name/role snapshots always preserve who performed the action.
  actor_user_id       uuid references public.profiles(id) on delete set null,
  actor_name_snapshot text not null,
  actor_role_snapshot text not null,
  branch_id           uuid references public.branches(id) on delete set null,
  action              text not null check (action in (
    'employee_created', 'employee_updated', 'employee_deactivated',
    'product_created', 'product_updated', 'product_price_changed',
    'inventory_adjusted',
    'transfer_created', 'transfer_received', 'transfer_discrepancy_detected',
    'shift_started', 'shift_ended',
    'sale_completed',
    'return_created', 'return_received', 'return_discrepancy_detected'
  )),
  entity_type         text not null,
  entity_id           uuid,
  metadata            jsonb,
  created_at          timestamptz not null default now()
);

-- Indexes for common audit queries
create index audit_logs_created_at_idx    on public.audit_logs(created_at desc);
create index audit_logs_actor_idx         on public.audit_logs(actor_user_id);
create index audit_logs_branch_idx        on public.audit_logs(branch_id);
create index audit_logs_action_idx        on public.audit_logs(action);
create index audit_logs_entity_type_idx   on public.audit_logs(entity_type);
create index audit_logs_entity_id_idx     on public.audit_logs(entity_id);

-- Immutable: audit records can never be changed or removed through normal access
create trigger audit_logs_immutable
before update or delete on public.audit_logs
for each row execute function public.block_immutable_record_changes();

-- RLS: Owner-only reads. Zero write access to any role via RLS.
alter table public.audit_logs enable row level security;

create policy audit_logs_select_owner on public.audit_logs
  for select to authenticated
  using (public.is_owner());

-- No INSERT/UPDATE/DELETE policies — all writes are done inside SECURITY DEFINER functions.
-- Grant SELECT only; no write grants.
revoke all on public.audit_logs from public, anon, authenticated;
grant select on public.audit_logs to authenticated;

-- ============================================================================
-- 2. INTERNAL AUDIT WRITE HELPER
-- ============================================================================

-- This function is SECURITY DEFINER so it can INSERT into audit_logs
-- even though authenticated users have no INSERT grant.
-- No execute grant is issued to public/anon/authenticated.
-- Called only by peer SECURITY DEFINER functions and the product trigger.
create or replace function public.write_audit_log(
  p_actor_user_id     uuid,
  p_actor_name        text,
  p_actor_role        text,
  p_branch_id         uuid,
  p_action            text,
  p_entity_type       text,
  p_entity_id         uuid,
  p_metadata          jsonb default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_logs(
    actor_user_id, actor_name_snapshot, actor_role_snapshot,
    branch_id, action, entity_type, entity_id, metadata
  ) values (
    p_actor_user_id,
    coalesce(p_actor_name, 'Unknown'),
    coalesce(p_actor_role, 'unknown'),
    p_branch_id,
    p_action,
    p_entity_type,
    p_entity_id,
    p_metadata
  );
end;
$$;

-- No execute grants — internal use only.
revoke all on function public.write_audit_log(uuid, text, text, uuid, text, text, uuid, jsonb) from public, anon, authenticated;

-- ============================================================================
-- 3. PRODUCT AUDIT TRIGGER
-- ============================================================================

-- SECURITY DEFINER so the trigger can call write_audit_log without any
-- execute grant being needed on the calling session.
create or replace function public.products_audit_trigger_fn()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id   uuid;
  v_actor_name text;
  v_actor_role text;
begin
  -- Resolve actor from auth context (safe: trigger runs inside the same transaction)
  v_actor_id := auth.uid();
  select full_name, role::text
  into v_actor_name, v_actor_role
  from public.profiles
  where id = v_actor_id;

  if tg_op = 'INSERT' then
    -- Product created
    perform public.write_audit_log(
      v_actor_id, v_actor_name, v_actor_role,
      null,       -- products have no branch
      'product_created',
      'product',
      new.id,
      jsonb_build_object('name', new.name, 'sku', new.sku, 'selling_price', new.selling_price)
    );

  elsif tg_op = 'UPDATE' then
    if new.selling_price is distinct from old.selling_price then
      -- Price change — highest-priority UPDATE branch
      perform public.write_audit_log(
        v_actor_id, v_actor_name, v_actor_role,
        null,
        'product_price_changed',
        'product',
        new.id,
        jsonb_build_object('old_price', old.selling_price, 'new_price', new.selling_price)
      );
    elsif (new.name        is distinct from old.name)
       or (new.sku         is distinct from old.sku)
       or (new.description is distinct from old.description)
       or (new.is_active   is distinct from old.is_active) then
      -- Other meaningful field changed
      perform public.write_audit_log(
        v_actor_id, v_actor_name, v_actor_role,
        null,
        'product_updated',
        'product',
        new.id,
        jsonb_build_object(
          'name',        new.name,
          'sku',         new.sku,
          'is_active',   new.is_active
        )
      );
    -- else: only updated_at changed or truly no meaningful change → no audit event
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.products_audit_trigger_fn() from public, anon, authenticated;

create trigger products_audit_after_change
after insert or update on public.products
for each row execute function public.products_audit_trigger_fn();

-- ============================================================================
-- 4. MODIFIED RPCs — AUDIT ENTRIES ADDED IN SAME TRANSACTION
-- ============================================================================

-- 4a. create_employee_profile_from_server
-- Adds employee_created audit event. Re-validates p_requester_id in PostgreSQL.
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
declare
  v_requester_name text;
begin
  -- Re-validate in PostgreSQL — do not trust Edge Function validation alone.
  select full_name into v_requester_name
  from public.profiles
  where id = p_requester_id and role = 'owner' and is_active;
  if not found then
    raise exception 'Unauthorized: owner access is required.' using errcode = '42501';
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
  if not exists (
    select 1 from public.branches
    where id = p_branch_id and is_active and not is_main_branch
  ) then
    raise exception 'Select an active selling branch.' using errcode = '22023';
  end if;

  insert into public.profiles(id, full_name, role, branch_id, is_active)
  values (p_employee_id, trim(p_full_name), p_role, p_branch_id, p_is_active);

  -- Audit: employee_created (actor = requester, branch = assigned branch)
  perform public.write_audit_log(
    p_requester_id,
    v_requester_name,
    'owner',
    p_branch_id,
    'employee_created',
    'employee',
    p_employee_id,
    jsonb_build_object(
      'full_name', trim(p_full_name),
      'role',      p_role,
      'is_active', p_is_active
    )
  );
end;
$$;

revoke all on function public.create_employee_profile_from_server(uuid, uuid, text, public.user_role, uuid, boolean) from public, anon, authenticated;
grant execute on function public.create_employee_profile_from_server(uuid, uuid, text, public.user_role, uuid, boolean) to service_role;

comment on function public.create_employee_profile_from_server(uuid, uuid, text, public.user_role, uuid, boolean)
is 'Privileged Edge Function entry point that creates the profile paired with a new Auth user.';

-- 4b. owner_update_employee — adds employee_updated / employee_deactivated audit
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
  v_actor_id       uuid := auth.uid();
  v_actor_name     text;
  v_existing_role  public.user_role;
  v_was_active     boolean;
  v_audit_action   text;
begin
  -- Validate owner
  select full_name into v_actor_name
  from public.profiles
  where id = v_actor_id and role = 'owner' and is_active;
  if not found then
    raise exception 'Unauthorized: owner access is required.' using errcode = '42501';
  end if;
  if p_employee_id = v_actor_id then
    raise exception 'The owner account cannot be edited as an employee.' using errcode = '42501';
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

  perform 1
  from public.branches
  where id = p_branch_id and is_active and not is_main_branch
  for share;
  if not found then
    raise exception 'Select an active selling branch.' using errcode = '22023';
  end if;

  select role, is_active into v_existing_role, v_was_active
  from public.profiles
  where id = p_employee_id
  for update;
  if not found or v_existing_role not in ('manager', 'cashier') then
    raise exception 'Employee account was not found.' using errcode = 'P0002';
  end if;

  update public.profiles
  set full_name = trim(p_full_name),
      role      = p_role,
      branch_id = p_branch_id,
      is_active = p_is_active
  where id = p_employee_id;

  -- Audit: deactivation is a distinct action; otherwise general update
  v_audit_action := case
    when v_was_active and not p_is_active then 'employee_deactivated'
    else 'employee_updated'
  end;

  perform public.write_audit_log(
    v_actor_id,
    v_actor_name,
    'owner',
    p_branch_id,
    v_audit_action,
    'employee',
    p_employee_id,
    jsonb_build_object(
      'full_name', trim(p_full_name),
      'role',      p_role,
      'is_active', p_is_active
    )
  );
end;
$$;

revoke all on function public.owner_update_employee(uuid, text, public.user_role, uuid, boolean) from public, anon;
grant execute on function public.owner_update_employee(uuid, text, public.user_role, uuid, boolean) to authenticated;

-- 4c. initialize_main_branch_inventory — adds inventory_adjusted per product
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
  v_actor_name     text;
  v_main_branch_id uuid;
  v_item           record;
  v_current_qty    bigint;
  v_product_active boolean;
begin
  select full_name into v_actor_name
  from public.profiles
  where id = v_user_id and role = 'owner' and is_active;
  if not found then
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

    -- Audit per product
    perform public.write_audit_log(
      v_user_id, v_actor_name, 'owner',
      v_main_branch_id,
      'inventory_adjusted',
      'product',
      v_item.product_id,
      jsonb_build_object(
        'adjustment',     v_item.quantity,
        'new_quantity',   v_item.quantity,
        'reason',         'Opening stock initialization',
        'notes',          p_notes
      )
    );
  end loop;
end;
$$;

revoke all on function public.initialize_main_branch_inventory(jsonb, text) from public, anon;
grant execute on function public.initialize_main_branch_inventory(jsonb, text) to authenticated;

-- 4d. send_stock_transfer — adds transfer_created audit
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
  v_user_id        uuid := auth.uid();
  v_actor_name     text;
  v_from_branch_id uuid;
  v_transfer_id    uuid;
  v_transfer_number text;
  v_item           record;
  v_available      bigint;
  v_product_active boolean;
begin
  select full_name into v_actor_name
  from public.profiles
  where id = v_user_id and role = 'owner' and is_active;
  if not found then
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

  -- Audit: transfer_created
  perform public.write_audit_log(
    v_user_id, v_actor_name, 'owner',
    v_from_branch_id,
    'transfer_created',
    'stock_transfer',
    v_transfer_id,
    jsonb_build_object(
      'transfer_number', v_transfer_number,
      'to_branch_id',    p_to_branch_id,
      'notes',           p_notes
    )
  );

  return v_transfer_id;
end;
$$;

revoke all on function public.send_stock_transfer(uuid, jsonb, text, text) from public, anon;
grant execute on function public.send_stock_transfer(uuid, jsonb, text, text) to authenticated;

-- 4e. receive_stock_transfer — adds transfer_received + transfer_discrepancy_detected
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
  v_user_id        uuid := auth.uid();
  v_user           public.profiles%rowtype;
  v_transfer       public.stock_transfers%rowtype;
  v_item           record;
  v_received       bigint;
  v_difference     bigint;
  v_has_discrepancy boolean := false;
  v_final_status   public.stock_transfer_status;
begin
  select * into v_user
  from public.profiles
  where id = v_user_id and is_active;
  if not found or v_user.role not in ('owner', 'manager') then
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
  if v_user.role = 'manager' and v_transfer.to_branch_id <> v_user.branch_id then
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

      -- Audit: discrepancy detected per item
      perform public.write_audit_log(
        v_user_id, v_user.full_name, v_user.role::text,
        v_transfer.to_branch_id,
        'transfer_discrepancy_detected',
        'stock_transfer',
        p_transfer_id,
        jsonb_build_object(
          'product_id',       v_item.product_id,
          'expected',         v_item.quantity_sent,
          'received',         v_received,
          'difference',       v_difference,
          'type',             case when v_difference > 0 then 'missing' else 'excess' end
        )
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

  -- Audit: transfer_received
  perform public.write_audit_log(
    v_user_id, v_user.full_name, v_user.role::text,
    v_transfer.to_branch_id,
    'transfer_received',
    'stock_transfer',
    p_transfer_id,
    jsonb_build_object(
      'status',     v_final_status,
      'notes',      p_notes
    )
  );

  return v_final_status;
end;
$$;

revoke all on function public.receive_stock_transfer(uuid, jsonb, text, text) from public, anon;
grant execute on function public.receive_stock_transfer(uuid, jsonb, text, text) to authenticated;

-- 4f. create_stock_return — adds return_created audit
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
  v_user   public.profiles%rowtype;
  v_source public.branches%rowtype;
  v_main   public.branches%rowtype;
  v_existing public.stock_returns%rowtype;
  v_items  jsonb;
  v_item   record;
  v_product public.products%rowtype;
  v_stock  bigint;
  v_id     uuid;
  v_number text;
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

  -- Audit: return_created
  perform public.write_audit_log(
    v_user.id, v_user.full_name, v_user.role::text,
    v_source.id,
    'return_created',
    'stock_return',
    v_id,
    jsonb_build_object('notes', p_notes)
  );

  return v_id;
end;
$$;
revoke all on function public.create_stock_return(jsonb,text,text) from public,anon;
grant execute on function public.create_stock_return(jsonb,text,text) to authenticated;

-- 4g. receive_stock_return — adds return_received + return_discrepancy_detected
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
  v_user           public.profiles%rowtype;
  v_return         public.stock_returns%rowtype;
  v_item           record;
  v_received       bigint;
  v_difference     bigint;
  v_has_discrepancy boolean := false;
  v_final_status   public.stock_return_status;
  v_target_branch  public.branches%rowtype;
begin
  select * into v_user
  from public.profiles
  where id = auth.uid() and is_active;
  if not found then
    raise exception 'Active profile required.' using errcode = '42501';
  end if;
  if v_user.role not in ('owner', 'manager') then
    raise exception 'Unauthorized: manager or owner access is required.' using errcode = '42501';
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

  select * into v_target_branch
  from public.branches
  where id = v_return.to_branch_id and is_main_branch and is_active;
  if not found then
    raise exception 'Destination branch is not an active Main Branch.' using errcode = '22023';
  end if;

  if v_user.role = 'manager' then
    if v_user.branch_id is distinct from v_return.to_branch_id then
      raise exception 'Unauthorized: only Main Branch managers or owners can receive returns.' using errcode = '42501';
    end if;
    if v_user.branch_id = v_return.from_branch_id then
      raise exception 'Unauthorized: selling branch manager cannot receive their own return.' using errcode = '42501';
    end if;
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

      -- Audit: discrepancy per item
      perform public.write_audit_log(
        v_user.id, v_user.full_name, v_user.role::text,
        v_return.to_branch_id,
        'return_discrepancy_detected',
        'stock_return',
        p_return_id,
        jsonb_build_object(
          'product_id', v_item.product_id,
          'expected',   v_item.quantity_returned,
          'received',   v_received,
          'difference', v_difference,
          'type',       case when v_difference > 0 then 'missing' else 'excess' end
        )
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

  -- Audit: return_received
  perform public.write_audit_log(
    v_user.id, v_user.full_name, v_user.role::text,
    v_return.to_branch_id,
    'return_received',
    'stock_return',
    p_return_id,
    jsonb_build_object('status', v_final_status, 'notes', p_notes)
  );

  return v_final_status;
end;
$$;

revoke all on function public.receive_stock_return(uuid, jsonb, text, text) from public, anon;
grant execute on function public.receive_stock_return(uuid, jsonb, text, text) to authenticated;

-- 4h. start_cashier_shift — adds shift_started audit (new shift only)
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
  v_is_new_shift       boolean := false;
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
    -- Idempotent: return existing shift, no duplicate audit
    return v_shift_id;
  end if;

  insert into public.shifts(branch_id, cashier_id, status, started_at)
  values (v_branch_id, v_cashier_id, 'open', now())
  returning id into v_shift_id;
  v_is_new_shift := true;

  if v_is_new_shift then
    perform public.write_audit_log(
      v_cashier_id, v_user.full_name, 'cashier',
      v_branch_id,
      'shift_started',
      'shift',
      v_shift_id,
      null
    );
  end if;

  return v_shift_id;
end;
$$;

revoke all on function public.start_cashier_shift() from public, anon;
grant execute on function public.start_cashier_shift() to authenticated;

-- 4i. end_cashier_shift — adds shift_ended audit
drop function if exists public.end_cashier_shift(uuid);
create or replace function public.end_cashier_shift(p_shift_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id    uuid := auth.uid();
  v_user       public.profiles%rowtype;
  v_shift      public.shifts%rowtype;
  v_branch_name text;
  v_tx_count   bigint;
  v_total_sales numeric(12,2);
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
  if v_shift.status = 'closed' then
    raise exception 'This shift is already closed.' using errcode = '55000';
  end if;

  update public.shifts
  set status = 'closed', ended_at = now()
  where id = p_shift_id
  returning * into v_shift;

  select name into v_branch_name
  from public.branches
  where id = v_shift.branch_id;

  select
    count(id)::bigint,
    coalesce(sum(total_amount), 0)::numeric(12,2)
  into v_tx_count, v_total_sales
  from public.sales
  where shift_id = p_shift_id and status = 'completed';

  -- Audit: shift_ended
  perform public.write_audit_log(
    v_user_id, v_user.full_name, 'cashier',
    v_shift.branch_id,
    'shift_ended',
    'shift',
    p_shift_id,
    jsonb_build_object(
      'total_sales',         v_total_sales,
      'transaction_count',   v_tx_count
    )
  );

  return jsonb_build_object(
    'id',                          v_shift.id,
    'branch_id',                   v_shift.branch_id,
    'branch_name',                 v_branch_name,
    'cashier_id',                  v_shift.cashier_id,
    'cashier_name',                v_user.full_name,
    'status',                      v_shift.status,
    'started_at',                  v_shift.started_at,
    'ended_at',                    v_shift.ended_at,
    'completed_transaction_count', v_tx_count,
    'total_sales',                 v_total_sales
  );
end;
$$;

revoke all on function public.end_cashier_shift(uuid) from public, anon;
grant execute on function public.end_cashier_shift(uuid) to authenticated;

-- 4j. confirm_sale — adds sale_completed audit (new sale only)
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
  v_user     uuid := auth.uid();
  v_actor    public.profiles%rowtype;
  v_branch   uuid;
  v_shift    public.shifts%rowtype;
  v_sale     public.sales%rowtype;
  v_items    jsonb;
  v_item     record;
  v_product  public.products%rowtype;
  v_stock    bigint;
  v_total    numeric := 0;
  v_is_new   boolean := false;
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
  v_is_new := true;
  for v_item in select * from jsonb_to_recordset(v_items) as x(product_id uuid, quantity bigint) order by product_id loop
    select * into v_product from public.products where id = v_item.product_id;
    insert into public.sale_items(sale_id, product_id, quantity, unit_price, subtotal)
      values(v_sale.id, v_item.product_id, v_item.quantity, v_product.selling_price, v_item.quantity*v_product.selling_price);
    update public.branch_inventory set quantity_on_hand = quantity_on_hand-v_item.quantity
      where branch_id = v_branch and product_id = v_item.product_id;
    insert into public.inventory_movements(branch_id, product_id, movement_type, quantity, reference_type, reference_id, created_by)
      values(v_branch, v_item.product_id, 'sale', -v_item.quantity, 'sale', v_sale.id, v_user);
  end loop;

  -- Audit: sale_completed (new sale only)
  if v_is_new then
    perform public.write_audit_log(
      v_user, v_actor.full_name, 'cashier',
      v_branch,
      'sale_completed',
      'sale',
      v_sale.id,
      jsonb_build_object(
        'sale_number',  v_sale.sale_number,
        'total_amount', v_sale.total_amount
      )
    );
  end if;

  return v_sale;
end;
$$;
revoke all on function public.confirm_sale(uuid,jsonb,numeric,text) from public, anon;
grant execute on function public.confirm_sale(uuid,jsonb,numeric,text) to authenticated;

-- ============================================================================
-- 5. AUDIT QUERY RPCs
-- ============================================================================

-- list_audit_logs — Owner-only, server-side filtering + pagination
create or replace function public.list_audit_logs(
  p_page        int default 0,
  p_page_size   int default 50,
  p_branch_id   uuid default null,
  p_actor_id    uuid default null,
  p_action      text default null,
  p_entity_type text default null,
  p_range_type  text default 'all_time',
  p_start_date  timestamptz default null,
  p_end_date    timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_start      timestamptz := null;
  v_end        timestamptz := null;
  v_limit      int := greatest(1, least(coalesce(p_page_size, 50), 100));
  v_offset     int := greatest(0, coalesce(p_page, 0)) * v_limit;
  v_items      jsonb;
  v_has_more   boolean;
  v_count      bigint;
begin
  if not public.is_owner() then
    raise exception 'Unauthorized: Owner access required.' using errcode = '42501';
  end if;

  -- Date range resolution (same semantics as other milestone RPCs)
  if p_range_type = 'today' then
    v_start := (timezone('Asia/Manila', now()))::date::timestamp at time zone 'Asia/Manila';
    v_end   := v_start + interval '1 day';
  elsif p_range_type = 'custom' then
    if p_start_date is null or p_end_date is null or p_start_date >= p_end_date then
      raise exception 'Valid start and end dates required for custom range.' using errcode = '22023';
    end if;
    v_start := p_start_date;
    v_end   := p_end_date;
  elsif p_range_type = 'all_time' then
    v_start := null;
    v_end   := null;
  else
    raise exception 'Invalid range type. Expected today, custom, or all_time.' using errcode = '22023';
  end if;

  -- Fetch one extra row to determine has_more
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',                  al.id,
        'actor_user_id',       al.actor_user_id,
        'actor_name_snapshot', al.actor_name_snapshot,
        'actor_role_snapshot', al.actor_role_snapshot,
        'branch_id',           al.branch_id,
        'branch_name',         b.name,
        'action',              al.action,
        'entity_type',         al.entity_type,
        'entity_id',           al.entity_id,
        'metadata',            al.metadata,
        'created_at',          al.created_at
      ) order by al.created_at desc
    ),
    '[]'::jsonb
  ) into v_items
  from (
    select al.*, row_number() over (order by al.created_at desc) as rn
    from public.audit_logs al
    where (p_branch_id   is null or al.branch_id     = p_branch_id)
      and (p_actor_id    is null or al.actor_user_id = p_actor_id)
      and (p_action      is null or al.action        = p_action)
      and (p_entity_type is null or al.entity_type   = p_entity_type)
      and (v_start       is null or al.created_at   >= v_start)
      and (v_end         is null or al.created_at    < v_end)
    order by al.created_at desc
    limit v_limit + 1
    offset v_offset
  ) al
  left join public.branches b on b.id = al.branch_id
  where al.rn <= v_limit;

  -- Check if there are more rows (fetched v_limit+1 earlier)
  select count(*) into v_count
  from public.audit_logs al
  where (p_branch_id   is null or al.branch_id     = p_branch_id)
    and (p_actor_id    is null or al.actor_user_id = p_actor_id)
    and (p_action      is null or al.action        = p_action)
    and (p_entity_type is null or al.entity_type   = p_entity_type)
    and (v_start       is null or al.created_at   >= v_start)
    and (v_end         is null or al.created_at    < v_end);

  v_has_more := v_count > (v_offset + v_limit);

  return jsonb_build_object(
    'items',     coalesce(v_items, '[]'::jsonb),
    'page',      coalesce(p_page, 0),
    'page_size', v_limit,
    'has_more',  v_has_more,
    'total',     v_count
  );
end;
$$;

revoke all on function public.list_audit_logs(int, int, uuid, uuid, text, text, text, timestamptz, timestamptz) from public, anon;
grant execute on function public.list_audit_logs(int, int, uuid, uuid, text, text, text, timestamptz, timestamptz) to authenticated;

-- get_audit_log_detail — Owner-only, returns single entry
create or replace function public.get_audit_log_detail(p_log_id uuid)
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

  select jsonb_build_object(
    'id',                  al.id,
    'actor_user_id',       al.actor_user_id,
    'actor_name_snapshot', al.actor_name_snapshot,
    'actor_role_snapshot', al.actor_role_snapshot,
    'branch_id',           al.branch_id,
    'branch_name',         b.name,
    'action',              al.action,
    'entity_type',         al.entity_type,
    'entity_id',           al.entity_id,
    'metadata',            al.metadata,
    'created_at',          al.created_at
  ) into v_result
  from public.audit_logs al
  left join public.branches b on b.id = al.branch_id
  where al.id = p_log_id;

  if v_result is null then
    raise exception 'Audit log entry not found.' using errcode = 'P0002';
  end if;

  return v_result;
end;
$$;

revoke all on function public.get_audit_log_detail(uuid) from public, anon;
grant execute on function public.get_audit_log_detail(uuid) to authenticated;

commit;
