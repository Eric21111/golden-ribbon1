-- Phase 4A: inventory RPC compatibility for exact 0.5 piece_stock quantities.
-- POS cart quantities and money math are not changed.
-- Portion-coded products stay on whole internal units via existing guards.
-- No explicit BEGIN/COMMIT: Supabase CLI wraps each migration file in its own transaction.

-- ---------------------------------------------------------------------------
-- aggregate_shift_product_movements: numeric opening + movement sums
-- ---------------------------------------------------------------------------
drop function if exists public.aggregate_shift_product_movements(public.shifts, uuid, bigint);
drop function if exists public.aggregate_shift_product_movements(public.shifts, uuid, numeric);

create function public.aggregate_shift_product_movements(
  p_shift public.shifts,
  p_product_id uuid,
  p_opening numeric
)
returns table (
  received_quantity numeric,
  outgoing_quantity numeric,
  sold_quantity numeric,
  adjustment_quantity numeric,
  system_balance_before_waste numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_received numeric(14,3) := 0;
  v_outgoing numeric(14,3) := 0;
  v_sold numeric(14,3) := 0;
  v_adjustment numeric(14,3) := 0;
  v_row record;
  v_cutoff timestamptz := coalesce(p_shift.sales_cutoff_at, p_shift.ended_at, now());
begin
  for v_row in
    select m.movement_type, m.quantity
    from public.inventory_movements m
    where m.branch_id = p_shift.branch_id
      and m.product_id = p_product_id
      and m.created_at >= p_shift.started_at
      and m.created_at <= v_cutoff
  loop
    if v_row.movement_type = 'transfer_in' or v_row.movement_type = 'return_in' then
      v_received := v_received + v_row.quantity;
    elsif v_row.movement_type in ('transfer_out', 'return_out') then
      v_outgoing := v_outgoing + abs(v_row.quantity);
    elsif v_row.movement_type = 'sale' then
      v_sold := v_sold + abs(v_row.quantity);
    elsif v_row.movement_type = 'adjustment' then
      v_adjustment := v_adjustment + v_row.quantity;
    elsif v_row.movement_type = 'opening_stock' then
      null;
    elsif v_row.movement_type in ('waste', 'unsold') then
      raise exception 'Unexpected closing movement already present for product during aggregation.'
        using errcode = '55000';
    else
      raise exception 'Unknown inventory movement type during shift close: %', v_row.movement_type
        using errcode = '55000';
    end if;
  end loop;

  received_quantity := v_received;
  outgoing_quantity := v_outgoing;
  sold_quantity := v_sold;
  adjustment_quantity := v_adjustment;
  system_balance_before_waste := coalesce(p_opening, 0) + v_received - v_outgoing - v_sold + v_adjustment;
  return next;
end;
$$;

revoke all on function public.aggregate_shift_product_movements(public.shifts, uuid, numeric)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Patch apply_shift_reconciliation / build_shift_close_preview / start_cashier_shift
-- ---------------------------------------------------------------------------
do $migration$
declare
  def text;
begin
  -- apply_shift_reconciliation (core close path)
  def := pg_get_functiondef('public.apply_shift_reconciliation(uuid,text,jsonb,text,uuid[],jsonb)'::regprocedure);
  def := replace(def, 'v_waste bigint;', 'v_waste numeric(14,3);');
  def := replace(def, 'v_actual_rem bigint;', 'v_actual_rem numeric(14,3);');
  def := replace(def, 'v_expected_rem bigint;', 'v_expected_rem numeric(14,3);');
  def := replace(def, 'v_discrepancy bigint;', 'v_discrepancy numeric(14,3);');
  def := replace(def, 'v_unsold bigint;', 'v_unsold numeric(14,3);');
  def := replace(def, 'v_carried bigint;', 'v_carried numeric(14,3);');
  def := replace(def, 'v_adjust_qty bigint;', 'v_adjust_qty numeric(14,3);');
  def := replace(
    def,
    'public.parse_inventory_quantity(value->>''actual_remaining'', ''piece_stock'', true)::bigint',
    'public.parse_inventory_quantity(value->>''actual_remaining'', ''piece_stock'', true)'
  );
  def := replace(
    def,
    ')::bigint,
        ''discrepancy_note''',
    '),
        ''discrepancy_note'''
  );
  -- waste_quantity parse cast (multiline pattern from source)
  def := replace(
    def,
    'true
        )::bigint',
    'true
        )'
  );
  def := replace(
    def,
    'as x(product_id uuid, actual_remaining bigint, waste_quantity bigint, discrepancy_note text)',
    'as x(product_id uuid, actual_remaining numeric, waste_quantity numeric, discrepancy_note text)'
  );
  def := replace(
    def,
    'Actual remaining and waste must be whole PCS quantities >= 0.',
    'Actual remaining and waste must be whole numbers or exact half-steps >= 0.'
  );
  def := replace(def, 'coalesce(i.quantity_awaiting_return,0)::bigint as held', 'coalesce(i.quantity_awaiting_return,0) as held');
  if position('v_waste numeric(14,3);' in def) = 0 then
    raise exception 'apply_shift_reconciliation half-step patch failed (waste var).';
  end if;
  execute def;

  -- build_shift_close_preview
  def := pg_get_functiondef('public.build_shift_close_preview(public.shifts)'::regprocedure);
  def := replace(def, 'coalesce(i.quantity_awaiting_return,0)::bigint as held', 'coalesce(i.quantity_awaiting_return,0) as held');
  def := replace(def, 'coalesce(i.quantity_awaiting_return, 0)::bigint as held', 'coalesce(i.quantity_awaiting_return, 0) as held');
  execute def;

  -- start_cashier_shift opening snapshot
  def := pg_get_functiondef('public.start_cashier_shift()'::regprocedure);
  def := replace(def, 'coalesce(bi.quantity_on_hand, 0)::bigint', 'coalesce(bi.quantity_on_hand, 0)');
  if position('coalesce(bi.quantity_on_hand, 0)::bigint' in def) > 0 then
    raise exception 'start_cashier_shift still casts opening to bigint.';
  end if;
  execute def;
end;
$migration$;

-- ---------------------------------------------------------------------------
-- Leftover return + create_stock_return half-step quantities
-- ---------------------------------------------------------------------------
do $migration$
declare
  def text;
begin
  def := pg_get_functiondef('public.apply_leftover_return(uuid,text,text)'::regprocedure);
  def := replace(
    def,
    'select i.product_id, trunc(i.quantity_on_hand)::bigint as quantity_returned
    from public.branch_inventory i
    join public.products p on p.id = i.product_id
    where i.branch_id = v_source.id
      and i.quantity_on_hand > 0
      and i.quantity_on_hand = trunc(i.quantity_on_hand)
      and not p.is_non_returnable
      and p.inventory_mode = ''piece_stock''',
    'select i.product_id, i.quantity_on_hand as quantity_returned
    from public.branch_inventory i
    join public.products p on p.id = i.product_id
    where i.branch_id = v_source.id
      and i.quantity_on_hand > 0
      and public.is_piece_half_step(i.quantity_on_hand)
      and (
        p.stock_unit_code is null
        or p.stock_unit_code not in (''half_egg'', ''half_serving'', ''quarter_serving'')
        or i.quantity_on_hand = trunc(i.quantity_on_hand)
      )
      and not p.is_non_returnable
      and p.inventory_mode = ''piece_stock'''
  );
  def := replace(
    def,
    'as x(product_id uuid, quantity_returned bigint)',
    'as x(product_id uuid, quantity_returned numeric)'
  );
  execute def;
end;
$migration$;

do $migration$
declare
  def text := pg_get_functiondef('public.create_stock_return(jsonb,text,text)'::regprocedure);
begin
  -- Keep INPUT validation whole-number here. Half-step return entry is enabled later by
  -- 20261123150000 behind fractional_piece_ops_enabled (default OFF). Storage/casts still
  -- widen to numeric so leftover/sales-created .5 balances can move without bigint trunc.
  def := replace(
    def,
    'sum((value->>''quantity_returned'')::bigint) quantity_returned',
    'sum((value->>''quantity_returned'')::numeric) quantity_returned'
  );
  def := replace(def, 'v_stock    bigint;', 'v_stock    numeric(14,3);');
  def := replace(
    def,
    'as x(product_id uuid, quantity_returned bigint)',
    'as x(product_id uuid, quantity_returned numeric)'
  );
  def := replace(def, 'select quantity_on_hand::bigint into v_stock', 'select quantity_on_hand into v_stock');
  if position('quantity_returned'')::bigint' in def) > 0 then
    raise exception 'create_stock_return still uses bigint quantity casts.';
  end if;
  execute def;
end;
$migration$;

-- receive_stock_return / report_shipment_issue: drop ::bigint on discrepancy writes
do $migration$
declare
  def text;
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'receive_stock_return'
  loop
    def := pg_get_functiondef(r.sig);
    def := replace(def, 'v_difference      bigint;', 'v_difference      numeric(14,3);');
    def := replace(def, 'v_difference bigint;', 'v_difference numeric(14,3);');
    def := replace(def, 'v_received::bigint', 'v_received');
    def := replace(def, 'quantity_received = v_received::bigint', 'quantity_received = v_received');
    execute def;
  end loop;

  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'report_shipment_issue'
  loop
    def := pg_get_functiondef(r.sig);
    def := replace(def, 'v_item.quantity_sent::bigint, v_received::bigint, v_difference::bigint',
                         'v_item.quantity_sent, v_received, v_difference');
    def := replace(def, 'quantity_sent::bigint, v_received::bigint, v_difference::bigint',
                         'quantity_sent, v_received, v_difference');
    execute def;
  end loop;
end;
$migration$;

-- ---------------------------------------------------------------------------
-- Corrections / waste / branch stock actions
-- ---------------------------------------------------------------------------
-- Interim assert: reject half-step OPS inputs until 20261123150000 installs the
-- owner gate (fractional_piece_ops_enabled). Prevents unsafe 302→500 windows.
create or replace function public.assert_piece_ops_quantity(
  p_quantity numeric,
  p_allow_zero boolean default false
)
returns numeric
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_quantity is null
     or p_quantity::text in ('NaN', 'Infinity', '-Infinity')
     or p_quantity < 0
     or p_quantity > 999999
     or not public.is_piece_half_step(p_quantity)
  then
    raise exception 'Piece quantities must be whole numbers or exact half-steps (n.0 / n.5).'
      using errcode = '22023';
  end if;
  if not p_allow_zero and p_quantity = 0 then
    raise exception 'Quantity is out of range.' using errcode = '22023';
  end if;
  if p_quantity <> trunc(p_quantity) then
    raise exception
      'Half-step inventory quantities are not enabled yet. Use whole numbers, or ask an owner to enable half-step stock ops after all devices are updated.'
      using errcode = '22023';
  end if;
  return p_quantity;
end;
$$;

revoke all on function public.assert_piece_ops_quantity(numeric, boolean) from public, anon, authenticated;

create or replace function public.correct_cashier_stock_count(
  p_shift_id uuid, p_product_id uuid, p_expected_quantity numeric,
  p_expected_updated_at timestamptz, p_actual_quantity numeric,
  p_reason text, p_idempotency_key text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user public.profiles%rowtype; v_stock public.branch_inventory%rowtype;
  v_existing public.inventory_movements%rowtype; v_request jsonb; v_id uuid:=gen_random_uuid();
  v_unit text;
begin
  select * into v_user from public.profiles where id=auth.uid() and is_active and role='cashier' for update;
  if not found then raise exception 'Active cashier required.' using errcode='42501'; end if;
  if p_idempotency_key is null or p_idempotency_key !~ '^[a-zA-Z0-9_-]{16,100}$'
     or p_actual_quantity is null or p_actual_quantity not between 0 and 999999
     or p_actual_quantity::text in ('NaN','Infinity','-Infinity')
     or not public.is_piece_half_step(p_actual_quantity)
     or p_expected_quantity is null or p_expected_quantity < 0 or p_expected_updated_at is null
     or p_reason is null or p_reason not in ('Incorrect kitchen count','Previous count was incorrect','Physical recount') then
    raise exception 'Enter a valid stock count (whole or exact half-step) and select a reason.' using errcode='22023';
  end if;
  perform public.assert_piece_ops_quantity(p_actual_quantity, true);
  perform public.assert_piece_ops_quantity(p_expected_quantity, true);
  select stock_unit_code into v_unit from public.products where id = p_product_id;
  if v_unit in ('half_egg','half_serving','quarter_serving') and p_actual_quantity <> trunc(p_actual_quantity) then
    raise exception 'Portion-unit counts must be whole numbers.' using errcode='22023';
  end if;
  v_request:=jsonb_build_object('shift_id',p_shift_id,'product_id',p_product_id,
    'before',p_expected_quantity,'updated_at',p_expected_updated_at,'after',p_actual_quantity,'reason',p_reason);
  select * into v_existing from public.inventory_movements m
    where m.created_by=v_user.id and m.reference_type='adjustment'
      and m.stock_count_correction is not null
      and m.stock_count_correction->>'key'=p_idempotency_key limit 1;
  if found then
    if v_existing.stock_count_correction->'request' is distinct from v_request then
      raise exception 'This confirmation belongs to a different correction.' using errcode='22023';
    end if;
    return v_existing.reference_id;
  end if;
  perform public.lock_branch_inventory_gate(v_user.branch_id);
  perform 1 from public.branches where id=v_user.branch_id and is_active and not is_main_branch;
  if not found then raise exception 'An active selling branch is required.' using errcode='42501'; end if;
  perform 1 from public.shifts where id=p_shift_id and cashier_id=v_user.id and branch_id=v_user.branch_id
    and status='open' and sales_cutoff_at is null and not inventory_reconciliation_required;
  if not found then raise exception 'An active shift is required. Complete pending remittance first.' using errcode='55000'; end if;
  perform 1 from public.products where id=p_product_id and is_active and inventory_mode='piece_stock' for share;
  if not found then raise exception 'Select an active piece or portion stock item.' using errcode='22023'; end if;
  select * into v_stock from public.branch_inventory where branch_id=v_user.branch_id and product_id=p_product_id for update;
  if not found then raise exception 'This stock item does not belong to your branch inventory.' using errcode='42501'; end if;
  if v_stock.quantity_on_hand<>p_expected_quantity or v_stock.updated_at<>p_expected_updated_at then
    raise exception 'Stock changed while you were counting. Refresh and check the remaining stock again.' using errcode='40001';
  end if;
  if p_actual_quantity=p_expected_quantity then
    raise exception 'The count is unchanged; no correction is needed.' using errcode='22023';
  end if;
  update public.branch_inventory set quantity_on_hand=p_actual_quantity where id=v_stock.id;
  insert into public.inventory_movements(branch_id,product_id,movement_type,quantity,reference_type,reference_id,created_by,notes,stock_count_correction)
    values(v_user.branch_id,p_product_id,'adjustment',p_actual_quantity-p_expected_quantity,'adjustment',v_id,v_user.id,
      'Stock count correction: '||p_expected_quantity||' -> '||p_actual_quantity||'. '||p_reason,
      jsonb_build_object('key',p_idempotency_key,'request',v_request));
  return v_id;
end $$;

drop function if exists public.record_branch_stock_action(uuid, uuid, text, integer, numeric, text, text);
create function public.record_branch_stock_action(p_shift_id uuid, p_product_id uuid, p_action text,
  p_quantity numeric, p_expected_available numeric, p_reason text, p_key text)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  staff public.profiles%rowtype;
  stock public.branch_inventory%rowtype;
  prior public.inventory_movements%rowtype;
  request jsonb;
  delta numeric(14,3);
  receipt uuid := gen_random_uuid();
  v_unit text;
begin
  select * into staff from public.profiles where id=auth.uid() and is_active and role='cashier' for update;
  if not found then raise exception 'Active cashier required.' using errcode='42501'; end if;
  if p_action is null or p_action not in ('add','waste')
    or p_quantity is null or p_quantity < 0.5 or p_quantity > 999999
    or not public.is_piece_half_step(p_quantity)
    or p_expected_available is null or p_key is null or p_key !~ '^[a-zA-Z0-9_-]{16,100}$'
    or p_reason is null or length(btrim(p_reason)) not between 1 and 300 then
    raise exception 'Enter a quantity and a reason.' using errcode='22023';
  end if;
  perform public.assert_piece_ops_quantity(p_quantity, false);
  perform public.assert_piece_ops_quantity(p_expected_available, true);
  select stock_unit_code into v_unit from public.products where id = p_product_id;
  if v_unit in ('half_egg','half_serving','quarter_serving') and p_quantity <> trunc(p_quantity) then
    raise exception 'Portion-unit quantities must be whole numbers.' using errcode='22023';
  end if;
  request := jsonb_build_object('shift_id',p_shift_id,'branch_id',staff.branch_id,'product_id',p_product_id,
    'action',p_action,'quantity',p_quantity,'available',p_expected_available,'reason',btrim(p_reason));
  select * into prior from public.inventory_movements where created_by=staff.id and branch_stock_action is not null
    and branch_stock_action->>'key'=p_key::text;
  if found then
    if prior.branch_stock_action->'request' is distinct from request then
      raise exception 'Confirmation details changed.' using errcode='22023';
    end if;
    return prior.reference_id;
  end if;
  perform public.lock_branch_inventory_gate(staff.branch_id);
  perform 1 from public.shifts s join public.branches b on b.id=s.branch_id
    where s.id=p_shift_id and s.branch_id=staff.branch_id and s.cashier_id=staff.id and s.status='open'
      and s.sales_cutoff_at is null and not s.inventory_reconciliation_required and b.is_active and not b.is_main_branch
    for update of s;
  if not found then raise exception 'An open selling shift is required.' using errcode='55000'; end if;
  select i.* into stock from public.branch_inventory i join public.products p on p.id=i.product_id
    where i.branch_id=staff.branch_id and i.product_id=p_product_id and p.is_active and p.inventory_mode='piece_stock' for update of i;
  if not found then raise exception 'Select an active stock item in your branch.' using errcode='42501'; end if;
  if stock.quantity_on_hand-stock.quantity_awaiting_return <> p_expected_available then
    raise exception 'Stock changed. Review the new available quantity.' using errcode='40001';
  end if;
  delta := case when p_action='add' then p_quantity else -p_quantity end;
  if p_expected_available+delta < 0 then raise exception 'Waste exceeds available stock.' using errcode='22023'; end if;
  update public.branch_inventory set quantity_on_hand=quantity_on_hand+delta where id=stock.id;
  insert into public.inventory_movements(branch_id,product_id,movement_type,quantity,reference_type,reference_id,created_by,
    notes,branch_stock_action,stock_count_correction)
  values(staff.branch_id,p_product_id,'adjustment',delta,'adjustment',receipt,staff.id,
    (case when p_action='add' then 'Added stock: ' else 'Recorded waste: ' end)||btrim(p_reason),
    jsonb_build_object('key',p_key,'request',request),
    case when p_action='add' then jsonb_build_object('request',request||jsonb_build_object(
      'before',stock.quantity_on_hand,'after',stock.quantity_on_hand+delta)) end);
  return receipt;
end $$;
revoke all on function public.record_branch_stock_action(uuid,uuid,text,numeric,numeric,text,text) from public,anon;
grant execute on function public.record_branch_stock_action(uuid,uuid,text,numeric,numeric,text,text) to authenticated;

drop function if exists public.record_main_inventory_waste(uuid, integer, numeric, text, text);
create function public.record_main_inventory_waste(
  p_product_id uuid,
  p_quantity numeric,
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
     or p_quantity is null or p_quantity < 0.5 or p_quantity > 999999
     or not public.is_piece_half_step(p_quantity)
     or p_expected_on_hand is null or p_expected_on_hand < 0
     or not public.is_piece_half_step(p_expected_on_hand)
     or p_key is null or p_key !~ '^[a-zA-Z0-9_-]{16,100}$'
     or p_reason is null or length(btrim(p_reason)) not between 1 and 300 then
    raise exception 'Enter a whole or exact half-step quantity and a reason.' using errcode = '22023';
  end if;
  perform public.assert_piece_ops_quantity(p_quantity, false);
  perform public.assert_piece_ops_quantity(p_expected_on_hand, true);

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
  if product.stock_unit_code in ('half_egg','half_serving','quarter_serving')
     and (p_quantity <> trunc(p_quantity) or p_expected_on_hand <> trunc(p_expected_on_hand)) then
    raise exception 'Portion-unit quantities must be whole numbers.' using errcode = '22023';
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

revoke all on function public.record_main_inventory_waste(uuid, numeric, numeric, text, text)
  from public, anon;
grant execute on function public.record_main_inventory_waste(uuid, numeric, numeric, text, text)
  to authenticated;

-- close_shift_with_returns may still use bigint locals for waste; patch held casts if present
do $migration$
declare
  def text;
begin
  begin
    def := pg_get_functiondef('public.close_shift_with_returns(uuid,text,text,uuid[],jsonb)'::regprocedure);
  exception when undefined_function then
    return;
  end;
  def := replace(def, 'wasted bigint;', 'wasted numeric(14,3);');
  def := replace(def, 'remaining bigint;', 'remaining numeric(14,3);');
  def := replace(def, 'quantity_awaiting_return=h.value::bigint', 'quantity_awaiting_return=h.value::numeric');
  def := replace(def, '(p_waste->>row_data.product_id::text)::bigint', '(p_waste->>row_data.product_id::text)::numeric');
  execute def;
end;
$migration$;
