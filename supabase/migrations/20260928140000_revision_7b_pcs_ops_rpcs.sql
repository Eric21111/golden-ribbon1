begin;

-- Revision 7B: PCS-only operational mutators, lock alignment, former_is_active
-- reactivation, leftover-return waste-only confirmed, 7C freeze insertion docs.
-- Does NOT implement End Shift / sales_cutoff_at / recon close (Revision 7C).

-- ---------------------------------------------------------------------------
-- Internal lock helper — keep non-executable by clients
-- Order: branches FOR UPDATE → open shift FOR UPDATE → inventory by product_id
-- ---------------------------------------------------------------------------
create or replace function public.lock_branch_inventory_gate(p_branch_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shift_id uuid;
begin
  if p_branch_id is null then
    raise exception 'Branch is required for inventory lock.' using errcode = '22023';
  end if;

  perform 1
  from public.branches
  where id = p_branch_id
  for update;
  if not found then
    raise exception 'Branch is missing.' using errcode = '22023';
  end if;

  select s.id
  into v_shift_id
  from public.shifts s
  where s.branch_id = p_branch_id
    and s.status = 'open'
  order by s.started_at, s.id
  limit 1
  for update;

  perform 1
  from public.branch_inventory bi
  where bi.branch_id = p_branch_id
  order by bi.product_id
  for update;
end;
$$;

revoke all on function public.lock_branch_inventory_gate(uuid) from public, anon, authenticated;

comment on function public.lock_branch_inventory_gate(uuid) is
  'Internal inventory lock helper. Invoked only from SECURITY DEFINER mutators. Not granted to clients.';

-- ---------------------------------------------------------------------------
-- Main PCS initialization + former_is_active-gated reactivation
-- ---------------------------------------------------------------------------
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
  v_product        public.products%rowtype;
  v_current_qty    numeric(14,3);
  v_quantity       numeric(14,3);
  v_has_opening    boolean;
  v_adjustment_id  uuid := gen_random_uuid();
  v_former_active  boolean;
  v_has_snapshot   boolean;
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
  if length(coalesce(p_notes, '')) > 1000 then
    raise exception 'Notes too long (maximum 1000 characters).' using errcode = '22023';
  end if;

  select id into v_main_branch_id
  from public.branches
  where is_main_branch and is_active;
  if v_main_branch_id is null then
    raise exception 'No active Main Branch is configured.' using errcode = '22023';
  end if;

  perform public.lock_branch_inventory_gate(v_main_branch_id);

  for v_item in
    select (value->>'product_id')::uuid as product_id,
           value->>'quantity' as quantity_text
    from jsonb_array_elements(p_items)
    order by value->>'product_id'
  loop
    select * into v_product
    from public.products
    where id = v_item.product_id
    for update;
    if not found then
      raise exception 'Product is missing.' using errcode = '22023';
    end if;

    begin
      -- Active ops: whole PCS only (parse rejects kg_meal).
      v_quantity := public.parse_inventory_quantity(v_item.quantity_text, 'piece_stock', false);
    exception when others then
      raise exception 'Opening quantities must be whole numbers between 1 and 999999.'
        using errcode = '22023';
    end;

    insert into public.branch_inventory(branch_id, product_id, quantity_on_hand)
    values (v_main_branch_id, v_item.product_id, 0)
    on conflict (branch_id, product_id) do nothing;

    select quantity_on_hand into v_current_qty
    from public.branch_inventory
    where branch_id = v_main_branch_id and product_id = v_item.product_id
    for update;

    select exists (
      select 1 from public.inventory_movements
      where branch_id = v_main_branch_id
        and product_id = v_item.product_id
        and movement_type = 'opening_stock'
    ) into v_has_opening;

    if not v_has_opening and v_current_qty <> 0 then
      raise exception 'Opening stock has already been initialized for a selected product.'
        using errcode = '55000';
    end if;

    update public.branch_inventory
    set quantity_on_hand = quantity_on_hand + v_quantity
    where branch_id = v_main_branch_id and product_id = v_item.product_id;

    if not v_has_opening then
      insert into public.inventory_movements(
        branch_id, product_id, movement_type, quantity,
        reference_type, reference_id, created_by, notes
      ) values (
        v_main_branch_id, v_item.product_id, 'opening_stock', v_quantity,
        'opening_stock', null, v_user_id, nullif(trim(p_notes), '')
      );
    else
      insert into public.inventory_movements(
        branch_id, product_id, movement_type, quantity,
        reference_type, reference_id, created_by, notes
      ) values (
        v_main_branch_id, v_item.product_id, 'adjustment', v_quantity,
        'adjustment', v_adjustment_id, v_user_id, nullif(trim(p_notes), '')
      );
    end if;

    -- Cutover reactivation: only if no snapshot (new products) OR former_is_active.
    -- former_is_active = false → remain inactive until explicit management activation.
    select exists (
      select 1 from public.pcs_cutover_product_snapshots s
      where s.product_id = v_item.product_id
    ), coalesce((
      select s.former_is_active
      from public.pcs_cutover_product_snapshots s
      where s.product_id = v_item.product_id
    ), true)
    into v_has_snapshot, v_former_active;

    if (not v_has_snapshot or v_former_active) and not v_product.is_active then
      update public.products
      set is_active = true
      where id = v_item.product_id and not is_active;
    end if;
  end loop;
end;
$$;

revoke all on function public.initialize_main_branch_inventory(jsonb, text) from public, anon;
grant execute on function public.initialize_main_branch_inventory(jsonb, text) to authenticated;

comment on function public.initialize_main_branch_inventory(jsonb, text) is
  'Main PCS init/adjustment. Reactivates only when cutover snapshot former_is_active is true (or no snapshot).';

-- ---------------------------------------------------------------------------
-- Send transfer — Main gate + whole PCS
-- ---------------------------------------------------------------------------
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
  v_available numeric(14,3);
  v_quantity numeric(14,3);
  v_product public.products%rowtype;
begin
  if not public.is_main_branch_manager() then
    raise exception 'Unauthorized: Main Branch Manager access is required.'
      using errcode = '42501';
  end if;
  if p_idempotency_key is null
     or char_length(p_idempotency_key) not between 16 and 100 then
    raise exception 'Invalid request key.' using errcode = '22023';
  end if;

  select id into v_transfer_id
  from public.stock_transfers
  where send_idempotency_key = p_idempotency_key;
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
  from public.branches
  where is_main_branch and is_active;
  if v_from_branch_id is null then
    raise exception 'No active Main Branch is configured.' using errcode = '22023';
  end if;

  perform public.lock_branch_inventory_gate(v_from_branch_id);

  perform 1
  from public.branches
  where id = p_to_branch_id and is_active and not is_main_branch
  for share;
  if not found then
    raise exception 'Destination branch is missing, inactive, or is the Main Branch.'
      using errcode = '22023';
  end if;

  for v_item in
    select (value->>'product_id')::uuid as product_id,
           value->>'quantity_sent' as quantity_text
    from jsonb_array_elements(p_items)
    order by value->>'product_id'
  loop
    select * into v_product
    from public.products
    where id = v_item.product_id
    for share;
    if not found or not v_product.is_active then
      raise exception 'Product is missing or inactive.' using errcode = '22023';
    end if;

    v_quantity := public.parse_inventory_quantity(v_item.quantity_text, 'piece_stock', false);
    perform public.seed_branch_catalog(p_to_branch_id, v_item.product_id);

    select quantity_on_hand into v_available
    from public.branch_inventory
    where branch_id = v_from_branch_id and product_id = v_item.product_id
    for update;
    if v_available is null or v_available < v_quantity then
      raise exception 'Insufficient stock. Available: %, requested: %.',
        coalesce(v_available, 0), v_quantity
        using errcode = '22003';
    end if;
  end loop;

  v_transfer_number := 'TR-' || lpad(nextval('public.stock_transfer_number_seq')::text, 6, '0');
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
           value->>'quantity_sent' as quantity_text
    from jsonb_array_elements(p_items)
    order by value->>'product_id'
  loop
    v_quantity := public.parse_inventory_quantity(v_item.quantity_text, 'piece_stock', false);

    insert into public.stock_transfer_items(stock_transfer_id, product_id, quantity_sent)
    values (v_transfer_id, v_item.product_id, v_quantity);

    update public.branch_inventory
    set quantity_on_hand = quantity_on_hand - v_quantity
    where branch_id = v_from_branch_id
      and product_id = v_item.product_id
      and quantity_on_hand >= v_quantity;
    if not found then
      raise exception 'Insufficient stock during transfer processing.' using errcode = '22003';
    end if;

    insert into public.inventory_movements(
      branch_id, product_id, movement_type, quantity,
      reference_type, reference_id, created_by, notes
    ) values (
      v_from_branch_id, v_item.product_id, 'transfer_out',
      -v_quantity, 'stock_transfer', v_transfer_id,
      v_user_id, nullif(trim(p_notes), '')
    );
  end loop;

  return v_transfer_id;
end;
$$;

revoke all on function public.send_stock_transfer(uuid, jsonb, text, text) from public, anon;
grant execute on function public.send_stock_transfer(uuid, jsonb, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Confirm shipment arrival — PCS credit; historical kg_meal lines stay unmeasured
-- 7C freeze: YES (selling-branch stock mutator)
-- ---------------------------------------------------------------------------
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

  -- Revision 7C insertion point (YES): reject when shifts.sales_cutoff_at is set for this branch/shift.
  -- Revision 7C insertion point (YES): reject while inventory_reconciliation_required is pending.

  perform public.lock_branch_inventory_gate(v_user.branch_id);

  select * into v_branch from public.branches where id = v_user.branch_id;
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

    -- Historical kg_meal transfer snapshots remain unmeasured / no selling credit.
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

-- ---------------------------------------------------------------------------
-- Report shipment issue — gate + PCS counted credit; historical kg skip
-- 7C freeze: YES
-- ---------------------------------------------------------------------------
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

  -- Revision 7C insertion point (YES): reject when shifts.sales_cutoff_at is set.
  -- Revision 7C insertion point (YES): reject while inventory_reconciliation_required is pending.

  perform public.lock_branch_inventory_gate(v_user.branch_id);

  select * into v_branch from public.branches where id = v_user.branch_id;
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
      and sti.inventory_mode is distinct from 'kg_meal'
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

-- ---------------------------------------------------------------------------
-- confirm_sale — always deduct PCS; gate; no kg_meal skip
-- 7C freeze: YES
-- ---------------------------------------------------------------------------
create or replace function public.confirm_sale(
  p_shift_id uuid,
  p_items jsonb,
  p_amount_paid numeric,
  p_idempotency_key text
)
returns public.sales
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_actor public.profiles%rowtype;
  v_branch uuid;
  v_shift public.shifts%rowtype;
  v_sale public.sales%rowtype;
  v_items jsonb;
  v_item record;
  v_product public.products%rowtype;
  v_branch_product public.branch_products%rowtype;
  v_variant public.branch_product_variants%rowtype;
  v_price numeric;
  v_variant_name text;
  v_stock bigint;
  v_total numeric := 0;
begin
  select * into v_actor
  from public.profiles
  where id = v_user
    and is_active
    and role = 'cashier'
  for update;
  if not found then
    raise exception 'An active Cashier account is required.'
      using errcode = '42501';
  end if;
  v_branch := v_actor.branch_id;

  if p_idempotency_key is null
     or length(p_idempotency_key) not between 16 and 100 then
    raise exception 'Invalid order confirmation key.'
      using errcode = '22023';
  end if;
  if p_amount_paid is null
     or p_amount_paid::text in ('NaN','Infinity','-Infinity')
     or p_amount_paid < 0
     or p_amount_paid > 9999999999.99
     or p_amount_paid <> round(p_amount_paid, 2) then
    raise exception 'Enter a valid payment with at most two decimal places.'
      using errcode = '22023';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'The cart must contain products.'
      using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) not between 1 and 200 then
    raise exception 'The cart must contain 1 to 200 products.'
      using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item.value) is distinct from 'object'
       or coalesce(v_item.value->>'quantity', '') !~ '^[1-9][0-9]{0,5}$'
       or coalesce(v_item.value->>'product_id', '') !~*
         '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or (
         v_item.value->'variant_id' is not null
         and jsonb_typeof(v_item.value->'variant_id') is distinct from 'null'
         and coalesce(v_item.value->>'variant_id', '') !~*
           '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       ) then
      raise exception 'Invalid product, variant, or quantity.'
        using errcode = '22023';
    end if;
  end loop;

  select jsonb_agg(
    jsonb_build_object('product_id', product_id, 'variant_id', variant_id, 'quantity', quantity)
    order by product_id, variant_id
  )
  into v_items
  from (
    select (value->>'product_id')::uuid as product_id,
           nullif(value->>'variant_id', '')::uuid as variant_id,
           sum((value->>'quantity')::bigint) as quantity
    from jsonb_array_elements(p_items)
    group by 1, 2
  ) normalized;

  select * into v_sale
  from public.sales
  where cashier_id = v_user
    and idempotency_key = p_idempotency_key;
  if found then
    if v_sale.shift_id <> p_shift_id
       or v_sale.request_items <> v_items
       or v_sale.amount_paid <> p_amount_paid then
      raise exception 'This confirmation key belongs to a different order.'
        using errcode = '22023';
    end if;
    return v_sale;
  end if;

  if v_branch is null then
    raise exception 'Your assigned branch is unavailable.'
      using errcode = '42501';
  end if;

  -- Revision 7C insertion point (YES): reject when shifts.sales_cutoff_at is set.
  -- Revision 7C insertion point (YES): reject while inventory_reconciliation_required is pending.

  perform public.lock_branch_inventory_gate(v_branch);

  perform 1
  from public.branches
  where id = v_branch
    and is_active
    and not is_main_branch;
  if not found then
    raise exception 'Your assigned branch is unavailable.'
      using errcode = '42501';
  end if;

  select * into v_shift
  from public.shifts
  where id = p_shift_id;
  if not found
     or v_shift.cashier_id <> v_user
     or v_shift.branch_id <> v_branch
     or v_shift.status <> 'open' then
    raise exception 'An open shift belonging to you is required.'
      using errcode = '42501';
  end if;

  for v_item in
    select product_id, sum(quantity) as quantity
    from jsonb_to_recordset(v_items) as x(product_id uuid, variant_id uuid, quantity bigint)
    group by product_id
    order by product_id
  loop
    select * into v_product
    from public.products
    where id = v_item.product_id
    for share;
    if not found or not v_product.is_active then
      raise exception 'A selected product is inactive or unavailable.'
        using errcode = '22023';
    end if;

    select * into v_branch_product
    from public.branch_products
    where branch_id = v_branch
      and product_id = v_item.product_id
      and is_active
    for share;
    if not found then
      raise exception 'A selected product is not available in this branch catalog.'
        using errcode = '22023';
    end if;

    select quantity_on_hand into v_stock
    from public.branch_inventory
    where branch_id = v_branch
      and product_id = v_item.product_id
    for update;
    if coalesce(v_stock, 0) < v_item.quantity then
      raise exception 'Insufficient stock. % — Available: %, Requested: %',
        v_product.name, coalesce(v_stock, 0), v_item.quantity
        using errcode = '22023';
    end if;
  end loop;

  for v_item in
    select *
    from jsonb_to_recordset(v_items) as x(product_id uuid, variant_id uuid, quantity bigint)
    order by product_id, variant_id
  loop
    if v_item.variant_id is not null then
      select * into v_variant
      from public.branch_product_variants
      where id = v_item.variant_id
        and branch_id = v_branch
        and product_id = v_item.product_id
        and is_active
      for share;
      if not found then
        raise exception 'A selected variant is not available in this branch catalog.'
          using errcode = '22023';
      end if;
      v_price := v_variant.selling_price;
    else
      select * into v_branch_product
      from public.branch_products
      where branch_id = v_branch
        and product_id = v_item.product_id;
      v_price := v_branch_product.selling_price;
    end if;

    v_total := v_total + v_price * v_item.quantity;
  end loop;

  if v_total > 9999999999.99 then
    raise exception 'Order total exceeds the supported limit.'
      using errcode = '22023';
  end if;
  if p_amount_paid < v_total then
    raise exception 'Insufficient payment. Total: %, Remaining: %',
      v_total, v_total - p_amount_paid
      using errcode = '22023';
  end if;

  insert into public.sales(
    sale_number, branch_id, shift_id, cashier_id,
    subtotal, total_amount, amount_paid, change_amount,
    idempotency_key, request_items
  ) values (
    'SALE-' || lpad(nextval('public.sale_number_seq')::text, 10, '0'),
    v_branch, p_shift_id, v_user,
    v_total, v_total, p_amount_paid, p_amount_paid - v_total,
    p_idempotency_key, v_items
  )
  returning * into v_sale;

  for v_item in
    select *
    from jsonb_to_recordset(v_items) as x(product_id uuid, variant_id uuid, quantity bigint)
    order by product_id, variant_id
  loop
    if v_item.variant_id is not null then
      select * into v_variant
      from public.branch_product_variants
      where id = v_item.variant_id;
      v_price := v_variant.selling_price;
      v_variant_name := v_variant.name;
    else
      select * into v_branch_product
      from public.branch_products
      where branch_id = v_branch
        and product_id = v_item.product_id;
      v_price := v_branch_product.selling_price;
      v_variant_name := null;
    end if;

    insert into public.sale_items(
      sale_id, product_id, variant_id, variant_name, quantity, unit_price, subtotal
    ) values (
      v_sale.id,
      v_item.product_id,
      v_item.variant_id,
      v_variant_name,
      v_item.quantity,
      v_price,
      v_item.quantity * v_price
    );
  end loop;

  for v_item in
    select product_id, sum(quantity) as quantity
    from jsonb_to_recordset(v_items) as x(product_id uuid, variant_id uuid, quantity bigint)
    group by product_id
    order by product_id
  loop
    update public.branch_inventory
    set quantity_on_hand = quantity_on_hand - v_item.quantity
    where branch_id = v_branch
      and product_id = v_item.product_id
      and quantity_on_hand >= v_item.quantity;
    if not found then
      raise exception 'Insufficient stock during sale processing.' using errcode = '22023';
    end if;

    insert into public.inventory_movements(
      branch_id, product_id, movement_type, quantity,
      reference_type, reference_id, created_by
    ) values (
      v_branch, v_item.product_id, 'sale', -v_item.quantity,
      'sale', v_sale.id, v_user
    );
  end loop;

  return v_sale;
end;
$$;

revoke all on function public.confirm_sale(uuid, jsonb, numeric, text) from public, anon;
grant execute on function public.confirm_sale(uuid, jsonb, numeric, text) to authenticated;

-- ---------------------------------------------------------------------------
-- create_stock_return — PCS only; gate; no kg reject path
-- 7C freeze: YES
-- ---------------------------------------------------------------------------
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

  if v_user.branch_id is null then
    raise exception 'Your assigned branch is unavailable.' using errcode = '42501';
  end if;

  -- Revision 7C insertion point (YES): reject when shifts.sales_cutoff_at is set.
  -- Revision 7C insertion point (YES): reject while inventory_reconciliation_required is pending.

  perform public.lock_branch_inventory_gate(v_user.branch_id);

  select * into v_source
  from public.branches
  where id = v_user.branch_id and is_active and not is_main_branch;
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
    where branch_id = v_source.id
      and product_id = v_item.product_id
      and quantity_on_hand >= v_item.quantity_returned;
    if not found then
      raise exception 'Insufficient stock during return processing.' using errcode = '22023';
    end if;
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

-- ---------------------------------------------------------------------------
-- apply_leftover_return — PCS leftover sweep; gate
-- 7C freeze: YES
-- ---------------------------------------------------------------------------
create or replace function public.apply_leftover_return(
  p_cashier_id      uuid,
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
  if p_cashier_id is null then
    return null;
  end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 16 and 100
    or length(coalesce(p_notes, '')) > 2000 then
    raise exception 'Invalid confirmation key or notes.' using errcode = '22023';
  end if;

  select * into v_user
  from public.profiles
  where id = p_cashier_id and role = 'cashier'
  for update;
  if not found or v_user.branch_id is null then
    return null;
  end if;

  -- Revision 7C insertion point (YES): reject when shifts.sales_cutoff_at is set.
  -- Revision 7C insertion point (YES): reject while inventory_reconciliation_required is pending.

  perform public.lock_branch_inventory_gate(v_user.branch_id);

  select * into v_source
  from public.branches
  where id = v_user.branch_id and not is_main_branch;
  if not found then
    return null;
  end if;

  select * into v_main
  from public.branches
  where is_main_branch and is_active
  for share;
  if not found then
    return null;
  end if;

  select * into v_existing
  from public.stock_returns
  where created_by = v_user.id
    and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.notes is distinct from p_notes then
      raise exception 'This confirmation key belongs to a different return.' using errcode = '22023';
    end if;
    return v_existing.id;
  end if;

  select jsonb_agg(
           jsonb_build_object(
             'product_id', q.product_id,
             'quantity_returned', q.quantity_returned
           )
           order by q.product_id
         )
    into v_items
  from (
    select i.product_id, trunc(i.quantity_on_hand)::bigint as quantity_returned
    from public.branch_inventory i
    where i.branch_id = v_source.id
      and i.quantity_on_hand > 0
      and i.quantity_on_hand = trunc(i.quantity_on_hand)
  ) q;

  if v_items is null or jsonb_array_length(v_items) = 0 then
    return null;
  end if;
  if jsonb_array_length(v_items) > 200 then
    raise exception 'Too many leftover products to return at once.' using errcode = '22023';
  end if;

  for v_item in
    select * from jsonb_to_recordset(v_items) as x(product_id uuid, quantity_returned bigint)
    order by product_id
  loop
    if v_item.quantity_returned is null or v_item.quantity_returned <= 0 then
      raise exception 'Leftover quantities must be whole numbers.' using errcode = '22023';
    end if;
    select * into v_product from public.products where id = v_item.product_id for share;
    if not found then
      raise exception 'Product unavailable.' using errcode = '22023';
    end if;
    select quantity_on_hand::bigint into v_stock
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
    where branch_id = v_source.id
      and product_id = v_item.product_id
      and quantity_on_hand >= v_item.quantity_returned;
    if not found then
      raise exception 'Insufficient stock during leftover return processing.' using errcode = '22023';
    end if;
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

revoke all on function public.apply_leftover_return(uuid, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- receive_stock_return — CONFIRMED waste/accountability; PCS count; NO Main restock
-- ---------------------------------------------------------------------------
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
  v_raw             text;
  v_received        numeric(14,3);
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
    raise exception 'This return is no longer available for receiving.' using errcode = 'P0002';
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
    raise exception 'This return has already been received.' using errcode = '55000';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'Enter a valid received quantity.' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_array_elements(p_items)) <>
     (select count(distinct value->>'stock_return_item_id') from jsonb_array_elements(p_items)) then
    raise exception 'Each return item may appear only once.' using errcode = '22023';
  end if;
  if (select count(*) from public.stock_return_items where stock_return_id = p_return_id) <>
     jsonb_array_length(p_items) then
    raise exception 'Enter a valid received quantity.' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_items) x
    left join public.stock_return_items sri
      on sri.id = case
        when coalesce(x.value->>'stock_return_item_id', '')
          ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then (x.value->>'stock_return_item_id')::uuid
        else null
      end
     and sri.stock_return_id = p_return_id
    where sri.id is null
  ) then
    raise exception 'This return is no longer available for receiving.' using errcode = '22023';
  end if;

  for v_item in
    select sri.id, sri.product_id, sri.quantity_returned
    from public.stock_return_items sri
    where sri.stock_return_id = p_return_id
    order by sri.product_id
  loop
    select btrim(coalesce(x.value->>'quantity_received', ''))
    into v_raw
    from jsonb_array_elements(p_items) x
    where (x.value->>'stock_return_item_id')::uuid = v_item.id;

    -- Whole PCS count (allow zero). Does NOT restock Main usable inventory.
    if v_raw is null or v_raw = '' then
      raise exception 'Enter a valid received quantity.' using errcode = '22023';
    end if;
    if left(v_raw, 1) = '-' then
      raise exception 'Received quantity cannot be negative.' using errcode = '22023';
    end if;
    begin
      v_received := public.parse_inventory_quantity(v_raw, 'piece_stock', true);
    exception when others then
      raise exception 'Enter a valid received quantity.' using errcode = '22023';
    end;

    update public.stock_return_items
    set quantity_received = v_received::bigint,
        updated_at = now()
    where id = v_item.id;

    -- Intentionally no branch_inventory increase and no return_in movement.
    v_difference := v_item.quantity_returned - v_received::bigint;
    if v_difference <> 0 then
      v_has_discrepancy := true;
      insert into public.return_discrepancies(
        stock_return_id, stock_return_item_id, product_id,
        quantity_expected, quantity_received, difference,
        discrepancy_type, notes, recorded_by
      ) values (
        p_return_id, v_item.id, v_item.product_id,
        v_item.quantity_returned, v_received::bigint, v_difference,
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

revoke all on function public.receive_stock_return(uuid, jsonb, text, text)
  from public, anon;
grant execute on function public.receive_stock_return(uuid, jsonb, text, text)
  to authenticated;

comment on function public.receive_stock_return(uuid, jsonb, text, text) is
  'Main Manager counts leftover waste in PCS. Records received qty and discrepancy. Does not increase sellable Main inventory or write return_in.';

-- ---------------------------------------------------------------------------
-- POS list — real PCS on-hand for every active assigned product
-- ---------------------------------------------------------------------------
create or replace function public.list_cashier_pos_inventory()
returns table (
  branch_id uuid,
  branch_name text,
  product_id uuid,
  product_name text,
  product_sku text,
  selling_price numeric,
  quantity_on_hand numeric,
  updated_at timestamptz,
  variants jsonb,
  inventory_mode public.inventory_mode
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user public.profiles%rowtype;
  v_branch_id uuid;
begin
  select * into v_user from public.profiles where id = auth.uid() and is_active;
  if not found or v_user.role is distinct from 'cashier' then
    raise exception 'Unauthorized: cashier access is required.' using errcode = '42501';
  end if;

  select s.branch_id into v_branch_id
  from public.shifts s
  where s.cashier_id = v_user.id and s.status = 'open'
  order by s.started_at desc
  limit 1;
  if v_branch_id is null then
    v_branch_id := v_user.branch_id;
  end if;
  if v_branch_id is null or v_branch_id is distinct from v_user.branch_id then
    raise exception 'No authorized branch is assigned to this cashier.' using errcode = '42501';
  end if;

  return query
  select
    b.id,
    b.name,
    p.id,
    p.name,
    p.sku,
    bp.selling_price,
    coalesce(bi.quantity_on_hand, 0),
    coalesce(bi.updated_at, bp.updated_at),
    coalesce((
      select jsonb_agg(jsonb_build_object('id', bpv.id, 'name', bpv.name, 'selling_price', bpv.selling_price) order by bpv.name)
      from public.branch_product_variants bpv
      where bpv.branch_id = bp.branch_id and bpv.product_id = bp.product_id and bpv.is_active
    ), '[]'::jsonb),
    p.inventory_mode
  from public.branch_products bp
  join public.products p on p.id = bp.product_id
  join public.branches b on b.id = bp.branch_id
  left join public.branch_inventory bi
    on bi.product_id = bp.product_id and bi.branch_id = bp.branch_id
  where bp.branch_id = v_branch_id
    and bp.is_active
    and p.is_active
    and b.is_active
    and not b.is_main_branch
  order by p.name, p.id;
end;
$$;

revoke all on function public.list_cashier_pos_inventory() from public, anon;
grant execute on function public.list_cashier_pos_inventory() to authenticated;

-- Return inventory list — all positive PCS on-hand (no kg filter)
create or replace function public.list_return_inventory()
returns table(product_id uuid, product_name text, product_sku text, is_active boolean, quantity_on_hand bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.name, p.sku, p.is_active, i.quantity_on_hand::bigint
  from public.branch_inventory i
  join public.products p on p.id = i.product_id
  where public.current_user_role() in ('manager', 'cashier')
    and i.branch_id = public.current_user_branch_id()
    and i.quantity_on_hand > 0
    and i.quantity_on_hand = trunc(i.quantity_on_hand)
  order by p.name, p.id;
$$;

revoke all on function public.list_return_inventory() from public, anon;
grant execute on function public.list_return_inventory() to authenticated;

commit;
