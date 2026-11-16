begin;

-- Manager Main Inventory: write off existing sellable Main stock (spoiled / damaged / etc.).
-- Deducts Main quantity_on_hand once. Does not change transfer or return accounting.
-- Returned leftovers are already waste-accountability via receive_stock_return and never
-- restock Main — they are not deducted here. Auditable via inventory_movements
-- .branch_stock_action (scope=main, action=waste) for future Waste History (no shift_id).

create or replace function public.record_main_inventory_waste(
  p_product_id uuid,
  p_quantity integer,
  p_expected_on_hand numeric,
  p_reason text,
  p_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  staff public.profiles%rowtype;
  main_branch public.branches%rowtype;
  stock public.branch_inventory%rowtype;
  prior public.inventory_movements%rowtype;
  product public.products%rowtype;
  request jsonb;
  receipt uuid := gen_random_uuid();
begin
  if not public.is_main_branch_manager() then
    raise exception 'Unauthorized: Main Branch Manager access is required.' using errcode = '42501';
  end if;

  select * into staff
  from public.profiles
  where id = auth.uid() and is_active and role = 'manager'
  for update;
  if not found then
    raise exception 'Unauthorized: Main Branch Manager access is required.' using errcode = '42501';
  end if;

  if p_product_id is null
     or p_quantity is null or p_quantity not between 1 and 999999
     or p_expected_on_hand is null or p_expected_on_hand < 0
     or p_expected_on_hand <> trunc(p_expected_on_hand)
     or p_key is null or p_key !~ '^[a-zA-Z0-9_-]{16,100}$'
     or p_reason is null or length(btrim(p_reason)) not between 1 and 300 then
    raise exception 'Enter a whole quantity and a reason.' using errcode = '22023';
  end if;

  select * into main_branch
  from public.branches
  where is_main_branch and is_active
  limit 1
  for update;
  if not found then
    raise exception 'Main branch is missing.' using errcode = '55000';
  end if;

  request := jsonb_build_object(
    'scope', 'main',
    'action', 'waste',
    'branch_id', main_branch.id,
    'product_id', p_product_id,
    'quantity', p_quantity,
    'available', p_expected_on_hand,
    'reason', btrim(p_reason)
  );

  select * into prior
  from public.inventory_movements
  where created_by = staff.id
    and branch_stock_action is not null
    and branch_stock_action->>'key' = p_key
  limit 1;
  if found then
    if prior.branch_stock_action->'request' is distinct from request then
      raise exception 'Confirmation details changed.' using errcode = '22023';
    end if;
    return prior.reference_id;
  end if;

  -- Main has no selling-shift freeze; still serialize inventory writes.
  perform public.lock_branch_inventory_gate(main_branch.id, false);

  select * into product
  from public.products
  where id = p_product_id
  for share;
  if not found then
    raise exception 'Product is missing.' using errcode = '22023';
  end if;
  if product.inventory_mode is distinct from 'piece_stock' then
    raise exception 'Only piece or portion stock can be written off at Main.' using errcode = '22023';
  end if;

  select * into stock
  from public.branch_inventory
  where branch_id = main_branch.id and product_id = p_product_id
  for update;
  if not found or stock.updated_at is null then
    raise exception 'Set opening stock before recording waste.' using errcode = '22023';
  end if;
  if stock.quantity_on_hand <> p_expected_on_hand then
    raise exception 'Stock changed. Review the new on-hand quantity.' using errcode = '40001';
  end if;
  if p_quantity > stock.quantity_on_hand then
    raise exception 'Waste exceeds Main stock on hand.' using errcode = '22023';
  end if;

  update public.branch_inventory
  set quantity_on_hand = quantity_on_hand - p_quantity
  where id = stock.id
    and quantity_on_hand >= p_quantity;
  if not found then
    raise exception 'Waste exceeds Main stock on hand.' using errcode = '22023';
  end if;

  -- Same ledger shape as cashier branch waste (adjustment + branch_stock_action),
  -- not shift_product_reconciliation waste rows.
  insert into public.inventory_movements(
    branch_id, product_id, movement_type, quantity,
    reference_type, reference_id, created_by, notes, branch_stock_action
  ) values (
    main_branch.id,
    p_product_id,
    'adjustment',
    -p_quantity,
    'adjustment',
    receipt,
    staff.id,
    'Main inventory waste: ' || btrim(p_reason),
    jsonb_build_object('key', p_key, 'request', request)
  );

  return receipt;
end;
$$;

revoke all on function public.record_main_inventory_waste(uuid, integer, numeric, text, text)
  from public, anon;
grant execute on function public.record_main_inventory_waste(uuid, integer, numeric, text, text)
  to authenticated;

comment on function public.record_main_inventory_waste(uuid, integer, numeric, text, text) is
  'Main Branch Manager: deduct existing Main piece_stock once as waste. Idempotent by p_key. Does not alter transfers/returns or leftover receive accounting.';

commit;
