begin;

-- Drop blocking check constraints from Milestone 5
alter table public.stock_returns drop constraint if exists stock_returns_status_check;
alter table public.stock_returns drop constraint if exists stock_returns_received_by_check;
alter table public.stock_returns drop constraint if exists stock_returns_received_at_check;
alter table public.stock_return_items drop constraint if exists stock_return_items_quantity_received_check;

-- Add new columns to stock_returns
alter table public.stock_returns add column if not exists receive_idempotency_key text;
alter table public.stock_returns add column if not exists received_by_name text;

-- Add non-negative check on quantity_received
alter table public.stock_return_items add constraint stock_return_items_quantity_received_check
  check (quantity_received is null or quantity_received >= 0);

-- Update inventory_movements check constraint to allow return_in > 0
alter table public.inventory_movements drop constraint if exists inventory_movements_sign_check;
alter table public.inventory_movements add constraint inventory_movements_sign_check check (
  (movement_type in ('opening_stock','transfer_in','return_in') and quantity > 0)
  or (movement_type in ('transfer_out','sale','return_out') and quantity < 0)
  or movement_type = 'adjustment'
);

-- Replace single-movement return index with index including movement_type so return_in is allowed
drop index if exists public.inventory_movements_return_once;
create unique index inventory_movements_return_movement_once
  on public.inventory_movements(reference_id, product_id, movement_type)
  where reference_type = 'stock_return';

-- Create return_discrepancies table
create table public.return_discrepancies (
  id uuid primary key default gen_random_uuid(),
  stock_return_id uuid not null references public.stock_returns(id) on delete restrict,
  stock_return_item_id uuid not null unique references public.stock_return_items(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  quantity_expected bigint not null check (quantity_expected > 0),
  quantity_received bigint not null check (quantity_received >= 0),
  difference bigint not null check (difference <> 0),
  discrepancy_type public.transfer_discrepancy_type not null,
  notes text check (notes is null or char_length(notes) <= 1000),
  recorded_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint return_discrepancy_math_check check (difference = quantity_expected - quantity_received),
  constraint return_discrepancy_type_check check (
    (difference > 0 and discrepancy_type = 'missing')
    or (difference < 0 and discrepancy_type = 'excess')
  )
);

create index return_discrepancies_return_id_idx on public.return_discrepancies(stock_return_id);

create trigger return_discrepancies_immutable
before update or delete on public.return_discrepancies
for each row execute function public.block_immutable_record_changes();

-- RLS for stock_returns: allow Main Branch manager to read returns destined to their branch
drop policy if exists returns_read on public.stock_returns;
create policy returns_read on public.stock_returns for select to authenticated using (
  public.is_owner() or (
    public.current_user_role() = 'manager' and (
      from_branch_id = public.current_user_branch_id() or to_branch_id = public.current_user_branch_id()
    )
  )
);

-- RLS for return_discrepancies
alter table public.return_discrepancies enable row level security;
create policy return_discrepancies_read on public.return_discrepancies for select to authenticated using (
  public.is_owner() or (
    public.current_user_role() = 'manager' and exists (
      select 1 from public.stock_returns r
      where r.id = return_discrepancies.stock_return_id
        and (r.from_branch_id = public.current_user_branch_id() or r.to_branch_id = public.current_user_branch_id())
    )
  )
);

revoke all on public.return_discrepancies from public, anon, authenticated;
grant select on public.return_discrepancies to authenticated;

-- Function: receive_stock_return
create or replace function public.receive_stock_return(
  p_return_id uuid,
  p_items jsonb,
  p_notes text default null,
  p_idempotency_key text default null
) returns public.stock_return_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user public.profiles%rowtype;
  v_role public.user_role;
  v_return public.stock_returns%rowtype;
  v_item record;
  v_received bigint;
  v_difference bigint;
  v_has_discrepancy boolean := false;
  v_final_status public.stock_return_status;
  v_target_branch public.branches%rowtype;
begin
  select * into v_user
  from public.profiles
  where id = auth.uid() and is_active;

  if not found then
    raise exception 'Active profile required.' using errcode = '42501';
  end if;

  v_role := v_user.role;
  if v_role not in ('owner', 'manager') then
    raise exception 'Unauthorized: manager or owner access is required.' using errcode = '42501';
  end if;

  if p_idempotency_key is null or char_length(p_idempotency_key) not between 16 and 100 then
    raise exception 'Invalid request key.' using errcode = '22023';
  end if;

  if length(coalesce(p_notes, '')) > 2000 then
    raise exception 'Notes too long (maximum 2000 characters).' using errcode = '22023';
  end if;

  -- Lock return record
  select * into v_return
  from public.stock_returns
  where id = p_return_id
  for update;

  if not found then
    raise exception 'Unable to load return.' using errcode = 'P0002';
  end if;

  -- Verify destination branch is active Main Branch
  select * into v_target_branch
  from public.branches
  where id = v_return.to_branch_id and is_main_branch and is_active;

  if not found then
    raise exception 'Destination branch is not an active Main Branch.' using errcode = '22023';
  end if;

  -- Authorization check:
  -- Owner can receive any return to Main Branch.
  -- Manager must be assigned to to_branch_id (Main Branch) and cannot be the sender.
  if v_role = 'manager' then
    if v_user.branch_id is distinct from v_return.to_branch_id then
      raise exception 'Unauthorized: only Main Branch managers or owners can receive returns.' using errcode = '42501';
    end if;
    if v_user.branch_id = v_return.from_branch_id then
      raise exception 'Unauthorized: selling branch manager cannot receive their own return.' using errcode = '42501';
    end if;
  end if;

  -- Idempotency check
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

  -- Process items in consistent product_id order
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

commit;
