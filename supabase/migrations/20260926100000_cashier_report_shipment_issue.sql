-- Cashier incoming can report a short/over shipment instead of full arrival.
-- Credits only the counted quantity and writes transfer_discrepancies for admin.

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
            'stock_transfer_item_id', sti.id,
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
  v_received bigint;
  v_difference bigint;
  v_has_discrepancy boolean := false;
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
  if char_length(trim(coalesce(p_notes, ''))) < 3 then
    raise exception 'Describe what is wrong with the shipment.'
      using errcode = '22023';
  end if;
  if length(coalesce(p_notes, '')) > 1000 then
    raise exception 'Notes too long (maximum 1000 characters).'
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
  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'Actual received quantity is required for every item.'
      using errcode = '22023';
  end if;
  if (select count(*) from jsonb_array_elements(p_items)) <>
     (select count(distinct value->>'stock_transfer_item_id') from jsonb_array_elements(p_items)) then
    raise exception 'Each transfer item may appear only once.'
      using errcode = '22023';
  end if;
  if (select count(*) from public.stock_transfer_items where stock_transfer_id = p_transfer_id) <>
     jsonb_array_length(p_items) then
    raise exception 'Actual received quantity is required for every item.'
      using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_items) x
    left join public.stock_transfer_items sti
      on sti.id = (x.value->>'stock_transfer_item_id')::uuid
     and sti.stock_transfer_id = p_transfer_id
    where sti.id is null
  ) then
    raise exception 'Receipt contains an invalid transfer item.'
      using errcode = '22023';
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

    if v_received is null or v_received < 0 or v_received > 999999 then
      raise exception 'Received quantities must be whole numbers between 0 and 999999.'
        using errcode = '22023';
    end if;

    v_difference := v_item.quantity_sent - v_received;
    if v_difference <> 0 then
      v_has_discrepancy := true;
    end if;
  end loop;

  if not v_has_discrepancy then
    raise exception 'Enter a different quantity than sent, or confirm the shipment arrived as sent.'
      using errcode = '22023';
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

    select * into v_product
    from public.products
    where id = v_item.product_id
    for share;
    if not found then
      raise exception 'Product is missing or inactive.'
        using errcode = '22023';
    end if;

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
        v_item.quantity_sent, v_received, v_difference,
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

revoke all on function public.report_shipment_issue(uuid, jsonb, text, text)
  from public, anon;
grant execute on function public.report_shipment_issue(uuid, jsonb, text, text)
  to authenticated;
