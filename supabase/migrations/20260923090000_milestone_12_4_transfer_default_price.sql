begin;

-- ============================================================================
-- Milestone 12.4 — Simplify transfer pricing for new branch products
-- ============================================================================
-- The Main Branch Manager no longer enters a destination price while sending
-- a transfer. Introducing a product to a branch for the first time now
-- auto-creates its branch_products row using the product's base
-- selling_price; the Manager can reprice it afterward in the existing branch
-- catalog/pricing flow (configure_branch_products). Everything else about
-- transfer-driven branch availability (auto-create/reactivate, no price
-- copied between branches for an already-active entry, stock only sellable
-- after receipt) is unchanged.
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
  v_product public.products%rowtype;
  v_branch_product public.branch_products%rowtype;
begin
  if not public.is_main_branch_manager() then
    raise exception 'Unauthorized: Main Branch Manager access is required.'
      using errcode = '42501';
  end if;
  if p_idempotency_key is null
     or char_length(p_idempotency_key) not between 16 and 100 then
    raise exception 'Invalid request key.'
      using errcode = '22023';
  end if;

  select id into v_transfer_id
  from public.stock_transfers
  where send_idempotency_key = p_idempotency_key;
  if v_transfer_id is not null then
    return v_transfer_id;
  end if;

  if jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'Select at least one product to send.'
      using errcode = '22023';
  end if;
  if (select count(*) from jsonb_array_elements(p_items)) <>
     (select count(distinct value->>'product_id') from jsonb_array_elements(p_items)) then
    raise exception 'Each product may appear only once.'
      using errcode = '22023';
  end if;

  select id into v_from_branch_id
  from public.branches
  where is_main_branch and is_active
  for share;
  if v_from_branch_id is null then
    raise exception 'No active Main Branch is configured.'
      using errcode = '22023';
  end if;

  perform 1
  from public.branches
  where id = p_to_branch_id
    and is_active
    and not is_main_branch
  for share;
  if not found then
    raise exception 'Destination branch is missing, inactive, or is the Main Branch.'
      using errcode = '22023';
  end if;

  for v_item in
    select (value->>'product_id')::uuid as product_id,
           (value->>'quantity_sent')::bigint as quantity_sent
    from jsonb_array_elements(p_items)
    order by value->>'product_id'
  loop
    if v_item.quantity_sent <= 0 then
      raise exception 'Transfer quantities must be positive.'
        using errcode = '22023';
    end if;

    select * into v_product
    from public.products
    where id = v_item.product_id
    for share;
    if not found or not v_product.is_active then
      raise exception 'Product is missing or inactive.'
        using errcode = '22023';
    end if;

    -- A product no longer needs a pre-existing branch catalog row to be
    -- transferred, and the Manager no longer enters a price to send it: a
    -- missing entry is created at the product's base selling_price, and an
    -- inactive entry is reactivated at its existing price. An already-active
    -- entry's price is never altered by a transfer — reprice afterward via
    -- configure_branch_products.
    select * into v_branch_product
    from public.branch_products
    where branch_id = p_to_branch_id
      and product_id = v_item.product_id
    for update;

    if not found then
      insert into public.branch_products(branch_id, product_id, selling_price, is_active)
      values (p_to_branch_id, v_item.product_id, v_product.selling_price, true);
    elsif not v_branch_product.is_active then
      update public.branch_products
      set is_active = true
      where branch_id = p_to_branch_id
        and product_id = v_item.product_id;
    end if;

    select quantity_on_hand into v_available
    from public.branch_inventory
    where branch_id = v_from_branch_id
      and product_id = v_item.product_id
    for update;

    if v_available is null or v_available < v_item.quantity_sent then
      raise exception 'Insufficient stock. Available: %, requested: %.',
        coalesce(v_available, 0), v_item.quantity_sent
        using errcode = '22003';
    end if;
  end loop;

  v_transfer_number :=
    'TR-' || lpad(nextval('public.stock_transfer_number_seq')::text, 6, '0');

  insert into public.stock_transfers(
    transfer_number, from_branch_id, to_branch_id, status,
    created_by, sent_by, sent_at, notes, send_idempotency_key
  ) values (
    v_transfer_number, v_from_branch_id, p_to_branch_id, 'pending_receipt',
    v_user_id, v_user_id, now(), nullif(trim(p_notes), ''), p_idempotency_key
  )
  returning id into v_transfer_id;

  for v_item in
    select (value->>'product_id')::uuid as product_id,
           (value->>'quantity_sent')::bigint as quantity_sent
    from jsonb_array_elements(p_items)
    order by value->>'product_id'
  loop
    insert into public.stock_transfer_items(
      stock_transfer_id, product_id, quantity_sent
    ) values (
      v_transfer_id, v_item.product_id, v_item.quantity_sent
    );

    update public.branch_inventory
    set quantity_on_hand = quantity_on_hand - v_item.quantity_sent
    where branch_id = v_from_branch_id
      and product_id = v_item.product_id
      and quantity_on_hand >= v_item.quantity_sent;

    if not found then
      raise exception 'Insufficient stock during transfer processing.'
        using errcode = '22003';
    end if;

    insert into public.inventory_movements(
      branch_id, product_id, movement_type, quantity,
      reference_type, reference_id, created_by, notes
    ) values (
      v_from_branch_id, v_item.product_id, 'transfer_out',
      -v_item.quantity_sent, 'stock_transfer', v_transfer_id,
      v_user_id, nullif(trim(p_notes), '')
    );
  end loop;

  return v_transfer_id;
end;
$$;

revoke all on function public.send_stock_transfer(uuid, jsonb, text, text)
  from public, anon;
grant execute on function public.send_stock_transfer(uuid, jsonb, text, text)
  to authenticated;

commit;
