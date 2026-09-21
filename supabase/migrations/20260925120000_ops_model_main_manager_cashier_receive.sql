-- Milestone 12.7: One Main Manager, cashier-only selling receive/returns,
-- activate products on opening stock.

-- --------------------------------------------------------------------------
-- 1. Managers may only be assigned to the Main Branch
-- --------------------------------------------------------------------------
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
      where b.id = p_branch_id and b.is_active and b.is_main_branch
    )
    else false
  end
$$;

revoke all on function public.employee_assignment_is_valid(public.user_role, uuid) from public, anon;
grant execute on function public.employee_assignment_is_valid(public.user_role, uuid) to authenticated;

-- Existing selling-branch managers keep login but cannot be reassigned as managers
-- to selling branches. Owner should reassign them to cashier or Main.
create or replace function public.validate_profile_branch()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_main_branch_id uuid;
begin
  if new.role = 'owner' then
    insert into public.branches (name, code, is_main_branch, is_active)
    select 'Main Branch', 'MAIN', true, true
    where not exists (select 1 from public.branches where is_main_branch);

    select id into v_main_branch_id from public.branches where is_main_branch limit 1;
    if v_main_branch_id is null then
      raise exception 'The Main Branch must be configured before an Owner account can be created.' using errcode = '55000';
    end if;
    new.branch_id := v_main_branch_id;
  elsif new.role = 'cashier' then
    if not exists (
      select 1 from public.branches b
      where b.id = new.branch_id and not b.is_main_branch
    ) then
      raise exception 'Cashiers must be assigned to a selling branch.';
    end if;
  elsif new.role = 'manager' then
    -- App create/update paths enforce Main-only via employee_assignment_is_valid.
    -- Keep the trigger permissive so legacy selling-manager rows can still exist
    -- until the Owner reassigns them; the manager app locks those accounts out.
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

-- --------------------------------------------------------------------------
-- 2. Selling branches always use cashier confirmation
-- --------------------------------------------------------------------------
update public.branches
set receiving_mode = 'cashier_confirm'
where not is_main_branch;

alter table public.branches
  alter column receiving_mode set default 'cashier_confirm';

create or replace function public.set_branch_receiving_mode(
  p_branch_id uuid,
  p_receiving_mode public.branch_receiving_mode
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_main_branch_manager() and not public.is_owner() then
    raise exception 'Unauthorized: Main Branch Manager or Owner access is required.' using errcode = '42501';
  end if;

  if exists (select 1 from public.branches where id = p_branch_id and is_main_branch) then
    raise exception 'The Main Branch does not use a receiving mode.' using errcode = '22023';
  end if;

  -- Selling branches are cashier-confirm only.
  if p_receiving_mode is distinct from 'cashier_confirm' then
    raise exception 'Selling branches must use cashier confirmation.' using errcode = '22023';
  end if;

  update public.branches
  set receiving_mode = 'cashier_confirm'
  where id = p_branch_id and is_active and not is_main_branch;

  if not found then
    raise exception 'Select an active selling branch.' using errcode = '22023';
  end if;
end;
$$;

-- Counted manager receive is retired: selling branches are cashier_confirm only.
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
  v_transfer public.stock_transfers%rowtype;
  v_dest     public.branches%rowtype;
begin
  select * into v_transfer from public.stock_transfers where id = p_transfer_id;
  if found then
    select * into v_dest from public.branches where id = v_transfer.to_branch_id;
    if found and v_dest.receiving_mode = 'cashier_confirm' then
      raise exception 'This branch uses cashier confirmation. Ask the assigned cashier to confirm arrival.'
        using errcode = '42501';
    end if;
  end if;

  raise exception 'Counted manager receive is no longer supported. Use cashier confirmation.'
    using errcode = '42501';
end;
$$;

revoke all on function public.receive_stock_transfer(uuid, jsonb, text, text) from public, anon;
grant execute on function public.receive_stock_transfer(uuid, jsonb, text, text) to authenticated;

-- --------------------------------------------------------------------------
-- 3. Cashiers may create returns from their selling branch
-- --------------------------------------------------------------------------
create or replace function public.list_return_inventory()
returns table(product_id uuid, product_name text, product_sku text, is_active boolean, quantity_on_hand bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.name, p.sku, p.is_active, i.quantity_on_hand
  from public.branch_inventory i
  join public.products p on p.id = i.product_id
  where public.current_user_role() in ('manager', 'cashier')
    and i.branch_id = public.current_user_branch_id()
    and i.quantity_on_hand > 0
  order by p.name, p.id;
$$;

revoke all on function public.list_return_inventory() from public, anon;
grant execute on function public.list_return_inventory() to authenticated;

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

drop policy if exists returns_read on public.stock_returns;
create policy returns_read on public.stock_returns for select to authenticated using (
  public.is_owner()
  or (
    public.current_user_role() = 'manager' and (
      from_branch_id = public.current_user_branch_id()
      or to_branch_id = public.current_user_branch_id()
    )
  )
  or (
    public.current_user_role() = 'cashier'
    and from_branch_id = public.current_user_branch_id()
  )
);

-- --------------------------------------------------------------------------
-- 4. Opening stock may activate inactive products
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
  v_product_id     uuid;
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

    select id into v_product_id
    from public.products
    where id = v_item.product_id
    for update;
    if v_product_id is null then
      raise exception 'Product is missing.' using errcode = '22023';
    end if;

    -- Opening stock activates the product for Main / transfer / POS use.
    update public.products
    set is_active = true
    where id = v_item.product_id and not is_active;

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
