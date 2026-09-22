-- Harden cashier shipment confirmation:
-- 1) Clearer exception prefixes so the app can map them
-- 2) Ensure destination branch_products (+ default variants) exist on confirm
--    (covers transfers sent before send_stock_transfer started seeding catalog rows)

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
  v_product public.products%rowtype;
  v_branch_product public.branch_products%rowtype;
begin
  if v_user_id is null then
    raise exception 'Unauthorized: sign in required.'
      using errcode = '42501';
  end if;

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
  if v_user.branch_id is null then
    raise exception 'Unauthorized: no authorized branch is assigned to this cashier.'
      using errcode = '42501';
  end if;

  select * into v_branch
  from public.branches
  where id = v_user.branch_id
  for share;
  if not found or v_branch.receiving_mode is distinct from 'cashier_confirm' then
    raise exception 'Unauthorized: this branch does not use cashier shipment confirmation.'
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
    select * into v_product
    from public.products
    where id = v_item.product_id
    for share;
    if not found then
      raise exception 'Product is missing or inactive.'
        using errcode = '22023';
    end if;

    -- Mirror send_stock_transfer catalog seeding so older pending transfers
    -- become sellable immediately after cashier confirm.
    select * into v_branch_product
    from public.branch_products
    where branch_id = v_transfer.to_branch_id
      and product_id = v_item.product_id
    for update;

    if not found then
      insert into public.branch_products(branch_id, product_id, selling_price, is_active)
      values (v_transfer.to_branch_id, v_item.product_id, v_product.selling_price, true);

      insert into public.branch_product_variants(
        branch_id, product_id, name, selling_price, is_active
      )
      select v_transfer.to_branch_id, v_item.product_id, pv.name, pv.default_price, true
      from public.product_variants pv
      where pv.product_id = v_item.product_id
        and pv.is_active
      on conflict (branch_id, product_id, name) do nothing;
    elsif not v_branch_product.is_active then
      update public.branch_products
      set is_active = true
      where branch_id = v_transfer.to_branch_id
        and product_id = v_item.product_id;
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

revoke all on function public.confirm_shipment_arrival(uuid, text)
  from public, anon;
grant execute on function public.confirm_shipment_arrival(uuid, text)
  to authenticated;
