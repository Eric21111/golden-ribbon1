begin;

-- ============================================================================
-- Milestone 12.3 — Cashier shipment arrival confirmation
-- ============================================================================
-- Adds an alternate, cashier-facing receiving flow for selling branches that
-- opt into it. Manager receiving/counting (receive_stock_transfer) is
-- untouched; branches default to 'counted' so existing behavior is unchanged
-- unless a Main Branch Manager opts a branch into 'cashier_confirm'.

create type public.branch_receiving_mode as enum ('counted', 'cashier_confirm');

alter table public.branches
  add column receiving_mode public.branch_receiving_mode not null default 'counted';

comment on column public.branches.receiving_mode is
  'How this selling branch receives stock transfers: counted (Manager enters received quantities) or cashier_confirm (assigned cashier confirms full arrival, no quantity entry).';

-- Main Branch Managers are the only operational administrators allowed to
-- change a selling branch's receiving mode.
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
  if not public.is_main_branch_manager() then
    raise exception 'Unauthorized: Main Branch Manager access is required.'
      using errcode = '42501';
  end if;

  update public.branches
  set receiving_mode = p_receiving_mode
  where id = p_branch_id
    and is_active
    and not is_main_branch;

  if not found then
    raise exception 'Catalog branch is missing, inactive, or is the Main Branch.'
      using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.set_branch_receiving_mode(uuid, public.branch_receiving_mode)
  from public, anon;
grant execute on function public.set_branch_receiving_mode(uuid, public.branch_receiving_mode)
  to authenticated;

-- Read-only list of pending incoming shipments for a cashier_confirm branch's
-- assigned cashier. Sent items/quantities only — no receiving input here.
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
  -- Table-qualified: this function's `id` OUT parameter would otherwise
  -- shadow profiles.id and make the where clause ambiguous.
  select * into v_user
  from public.profiles p
  where p.id = auth.uid() and p.is_active;
  if not found or v_user.role is distinct from 'cashier' then
    raise exception 'Unauthorized: cashier access is required.'
      using errcode = '42501';
  end if;
  if v_user.branch_id is null then
    raise exception 'No authorized branch is assigned to this cashier.'
      using errcode = '42501';
  end if;

  select b.receiving_mode into v_mode
  from public.branches b
  where b.id = v_user.branch_id;
  if v_mode is distinct from 'cashier_confirm' then
    raise exception 'This branch does not use cashier shipment confirmation.'
      using errcode = '42501';
  end if;

  return query
  select
    st.id,
    st.transfer_number,
    st.from_branch_id,
    fb.name,
    st.sent_at,
    st.notes,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'product_id', sti.product_id,
            'product_name', p.name,
            'product_sku', p.sku,
            'quantity_sent', sti.quantity_sent
          )
          order by p.name
        )
        from public.stock_transfer_items sti
        join public.products p on p.id = sti.product_id
        where sti.stock_transfer_id = st.id
      ),
      '[]'::jsonb
    )
  from public.stock_transfers st
  join public.branches fb on fb.id = st.from_branch_id
  where st.to_branch_id = v_user.branch_id
    and st.status = 'pending_receipt'
  order by st.sent_at asc;
end;
$$;

revoke all on function public.list_cashier_pending_transfers()
  from public, anon;
grant execute on function public.list_cashier_pending_transfers()
  to authenticated;

-- "Shipment Arrived": the assigned cashier confirms full receipt of every
-- item exactly as sent. No quantity entry, no discrepancies are possible.
-- Mirrors receive_stock_transfer's locking/idempotency shape but is a
-- separate function so Manager counted-mode receiving stays untouched.
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
  select * into v_user
  from public.profiles
  where id = v_user_id and is_active;
  if not found or v_user.role is distinct from 'cashier' then
    raise exception 'Unauthorized: cashier access is required.'
      using errcode = '42501';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 16 and 100 then
    raise exception 'Invalid request key.'
      using errcode = '22023';
  end if;

  select * into v_branch
  from public.branches
  where id = v_user.branch_id
  for share;
  if not found or v_branch.receiving_mode is distinct from 'cashier_confirm' then
    raise exception 'This branch does not use cashier shipment confirmation.'
      using errcode = '42501';
  end if;

  select * into v_transfer
  from public.stock_transfers
  where id = p_transfer_id
  for update;
  if not found then
    raise exception 'Unable to load transfer.' using errcode = 'P0002';
  end if;
  if v_transfer.to_branch_id <> v_user.branch_id then
    raise exception 'Unauthorized: this transfer belongs to another branch.'
      using errcode = '42501';
  end if;
  if v_transfer.receive_idempotency_key = p_idempotency_key
     and v_transfer.status in ('received', 'received_with_discrepancy') then
    return v_transfer.status;
  end if;
  if v_transfer.status <> 'pending_receipt' then
    raise exception 'Transfer has already been received or is not pending receipt.'
      using errcode = '55000';
  end if;

  for v_item in
    select sti.id, sti.product_id, sti.quantity_sent
    from public.stock_transfer_items sti
    where sti.stock_transfer_id = p_transfer_id
    order by sti.product_id
  loop
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

revoke all on function public.confirm_shipment_arrival(uuid, text)
  from public, anon;
grant execute on function public.confirm_shipment_arrival(uuid, text)
  to authenticated;

commit;
