-- Part 4A: shipment arrival/issue wait on product FOR SHARE, then reject
-- snapshot vs live inventory_mode mismatch. Matching piece/kg receipt is unchanged.
-- Do not convert quantities. Do not rewrite transfer snapshots.

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
  v_product_id uuid;
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

  for v_product_id in
    select distinct sti.product_id
    from public.stock_transfer_items sti
    where sti.stock_transfer_id = v_transfer.id
    order by sti.product_id
  loop
    perform 1
    from public.products p
    where p.id = v_product_id
    for share;
  end loop;

  if exists (
    select 1
    from public.stock_transfer_items sti
    join public.products p on p.id = sti.product_id
    where sti.stock_transfer_id = v_transfer.id
      and sti.inventory_mode is distinct from p.inventory_mode
  ) then
    raise exception 'Product inventory type changed while this shipment was in transit.'
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
  v_product_id uuid;
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

  for v_product_id in
    select distinct sti.product_id
    from public.stock_transfer_items sti
    where sti.stock_transfer_id = v_transfer.id
    order by sti.product_id
  loop
    perform 1
    from public.products p
    where p.id = v_product_id
    for share;
  end loop;

  if exists (
    select 1
    from public.stock_transfer_items sti
    join public.products p on p.id = sti.product_id
    where sti.stock_transfer_id = v_transfer.id
      and sti.inventory_mode is distinct from p.inventory_mode
  ) then
    raise exception 'Product inventory type changed while this shipment was in transit.'
      using errcode = '22023';
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
