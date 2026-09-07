begin;

-- Milestone 10: surgical database hardening. Historical migrations remain intact.

-- --------------------------------------------------------------------------
-- Critical lifecycle and historical-integrity constraints
-- --------------------------------------------------------------------------

alter table public.stock_returns
  add constraint stock_returns_idempotency_key_length_check
  check (char_length(idempotency_key) between 16 and 100),
  add constraint stock_returns_receive_key_length_check
  check (receive_idempotency_key is null or char_length(receive_idempotency_key) between 16 and 100),
  add constraint stock_returns_notes_length_check
  check (notes is null or char_length(notes) <= 2000),
  add constraint stock_returns_lifecycle_fields_check
  check (
    (status = 'draft' and returned_at is null and received_by is null and received_at is null and receive_idempotency_key is null)
    or (status in ('in_transit', 'cancelled') and received_by is null and received_at is null and receive_idempotency_key is null)
    or (status in ('received', 'received_with_discrepancy')
        and received_by is not null and received_at is not null and receive_idempotency_key is not null)
  );

alter table public.inventory_movements
  add constraint inventory_movements_type_reference_match_check
  check (
    (movement_type = 'opening_stock' and reference_type = 'opening_stock' and reference_id is null)
    or (movement_type in ('transfer_out', 'transfer_in') and reference_type = 'stock_transfer' and reference_id is not null)
    or (movement_type = 'adjustment' and reference_type = 'adjustment' and reference_id is not null)
    or (movement_type = 'sale' and reference_type = 'sale' and reference_id is not null)
    or (movement_type in ('return_out', 'return_in') and reference_type = 'stock_return' and reference_id is not null)
  );

create or replace function public.enforce_stock_return_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.from_branch_id is distinct from old.from_branch_id
     or new.to_branch_id is distinct from old.to_branch_id
     or new.created_by is distinct from old.created_by
     or new.returned_by is distinct from old.returned_by
     or new.returned_at is distinct from old.returned_at
     or new.idempotency_key is distinct from old.idempotency_key
     or new.request_items is distinct from old.request_items
     or new.return_number is distinct from old.return_number then
    raise exception 'Return identity and request details are immutable.' using errcode = '55000';
  end if;

  if new.status is distinct from old.status and not (
    (old.status = 'draft' and new.status in ('in_transit', 'cancelled'))
    or (old.status = 'in_transit' and new.status in ('received', 'received_with_discrepancy'))
  ) then
    raise exception 'Invalid stock return status transition.' using errcode = '22023';
  end if;

  if old.status in ('received', 'received_with_discrepancy', 'cancelled') then
    raise exception 'Completed returns are immutable.' using errcode = '55000';
  end if;

  return new;
end;
$$;

create trigger stock_returns_enforce_transition
before update on public.stock_returns
for each row execute function public.enforce_stock_return_transition();

create or replace function public.protect_stock_return_items()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_status public.stock_return_status;
begin
  select sr.status into v_status
  from public.stock_returns sr
  where sr.id = case when tg_op = 'DELETE' then old.stock_return_id else new.stock_return_id end;

  if tg_op = 'DELETE' then
    if v_status <> 'draft' then
      raise exception 'Sent or completed return items are immutable.' using errcode = '55000';
    end if;
    return old;
  end if;

  if v_status = 'in_transit' then
    if new.stock_return_id is distinct from old.stock_return_id
       or new.product_id is distinct from old.product_id
       or new.quantity_returned is distinct from old.quantity_returned
       or new.product_name is distinct from old.product_name
       or new.product_sku is distinct from old.product_sku
       or old.quantity_received is not null
       or new.quantity_received is null then
      raise exception 'Only the one-time received quantity may be recorded for an in-transit return item.' using errcode = '55000';
    end if;
  elsif v_status <> 'draft' then
    raise exception 'Completed return items are immutable.' using errcode = '55000';
  end if;

  return new;
end;
$$;

create trigger stock_return_items_protect_lifecycle
before update or delete on public.stock_return_items
for each row execute function public.protect_stock_return_items();

create or replace function public.protect_sale_history()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Completed sale history is immutable.' using errcode = '55000';
end;
$$;

create trigger sales_immutable
before update or delete on public.sales
for each row execute function public.protect_sale_history();

create trigger sale_items_immutable
before update or delete on public.sale_items
for each row execute function public.protect_sale_history();

revoke all on function public.enforce_stock_return_transition() from public, anon, authenticated;
revoke all on function public.protect_stock_return_items() from public, anon, authenticated;
revoke all on function public.protect_sale_history() from public, anon, authenticated;

-- --------------------------------------------------------------------------
-- Audit actor handling: authenticated writes keep auth.uid(); trusted seed and
-- migration writes with no JWT are explicitly recorded as System, never Unknown.
-- --------------------------------------------------------------------------

create or replace function public.products_audit_trigger_fn()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_name text;
  v_actor_role text;
begin
  if v_actor_id is null then
    v_actor_name := 'System';
    v_actor_role := 'system';
  else
    select p.full_name, p.role::text
      into v_actor_name, v_actor_role
    from public.profiles p
    where p.id = v_actor_id and p.is_active;

    if not found then
      raise exception 'Active profile required for product changes.' using errcode = '42501';
    end if;
  end if;

  if tg_op = 'INSERT' then
    perform public.write_audit_log(
      v_actor_id, v_actor_name, v_actor_role, null,
      'product_created', 'product', new.id,
      jsonb_build_object('name', new.name, 'sku', new.sku, 'selling_price', new.selling_price)
    );
  elsif new.selling_price is distinct from old.selling_price then
    perform public.write_audit_log(
      v_actor_id, v_actor_name, v_actor_role, null,
      'product_price_changed', 'product', new.id,
      jsonb_build_object('old_price', old.selling_price, 'new_price', new.selling_price)
    );
  elsif new.name is distinct from old.name
     or new.sku is distinct from old.sku
     or new.description is distinct from old.description
     or new.is_active is distinct from old.is_active then
    perform public.write_audit_log(
      v_actor_id, v_actor_name, v_actor_role, null,
      'product_updated', 'product', new.id,
      jsonb_build_object('name', new.name, 'sku', new.sku, 'is_active', new.is_active)
    );
  end if;

  return new;
end;
$$;

revoke all on function public.products_audit_trigger_fn() from public, anon, authenticated;

-- --------------------------------------------------------------------------
-- Financial reporting correction. The former sale/item join summed a sale's
-- total once per line item. Aggregate sale money separately from item quantity.
-- --------------------------------------------------------------------------

create or replace function public.report_branch_performance(
  p_range_type text default 'today',
  p_start_date timestamptz default null,
  p_end_date timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_start timestamptz;
  v_end timestamptz;
  v_result jsonb;
begin
  if not public.is_owner() then
    raise exception 'Unauthorized: Owner access required.' using errcode = '42501';
  end if;

  if p_range_type = 'today' then
    v_start := (timezone('Asia/Manila', now()))::date::timestamp at time zone 'Asia/Manila';
    v_end := v_start + interval '1 day';
  elsif p_range_type = 'custom' then
    if p_start_date is null or p_end_date is null or p_start_date >= p_end_date then
      raise exception 'Valid half-open start and end timestamps are required.' using errcode = '22023';
    end if;
    v_start := p_start_date;
    v_end := p_end_date;
  elsif p_range_type = 'all_time' then
    v_start := null;
    v_end := null;
  else
    raise exception 'Invalid range type. Expected today, custom, or all_time.' using errcode = '22023';
  end if;

  with filtered_sales as (
    select s.id, s.branch_id, s.total_amount
    from public.sales s
    where s.status = 'completed'
      and (v_start is null or (s.sold_at >= v_start and s.sold_at < v_end))
  ),
  sales_agg as (
    select fs.branch_id,
           count(*)::bigint as tx_count,
           coalesce(sum(fs.total_amount), 0)::numeric(12,2) as total_sales
    from filtered_sales fs
    group by fs.branch_id
  ),
  item_agg as (
    select fs.branch_id, coalesce(sum(si.quantity), 0)::bigint as quantity_sold
    from filtered_sales fs
    join public.sale_items si on si.sale_id = fs.id
    group by fs.branch_id
  ),
  transfer_disc_agg as (
    select st.to_branch_id as branch_id,
      coalesce(sum(td.difference) filter (where td.discrepancy_type = 'missing'), 0)::bigint as transfer_missing_qty,
      coalesce(sum(abs(td.difference)) filter (where td.discrepancy_type = 'excess'), 0)::bigint as transfer_excess_qty
    from public.transfer_discrepancies td
    join public.stock_transfers st on st.id = td.stock_transfer_id
    where v_start is null or (td.created_at >= v_start and td.created_at < v_end)
    group by st.to_branch_id
  ),
  return_disc_agg as (
    select sr.from_branch_id as branch_id,
      coalesce(sum(rd.difference) filter (where rd.discrepancy_type = 'missing'), 0)::bigint as return_missing_qty,
      coalesce(sum(abs(rd.difference)) filter (where rd.discrepancy_type = 'excess'), 0)::bigint as return_excess_qty
    from public.return_discrepancies rd
    join public.stock_returns sr on sr.id = rd.stock_return_id
    where v_start is null or (rd.created_at >= v_start and rd.created_at < v_end)
    group by sr.from_branch_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'branch_id', b.id,
    'branch_name', b.name,
    'transaction_count', coalesce(sa.tx_count, 0),
    'total_sales', coalesce(sa.total_sales, 0),
    'quantity_sold', coalesce(ia.quantity_sold, 0),
    'transfer_missing_qty', coalesce(tda.transfer_missing_qty, 0),
    'transfer_excess_qty', coalesce(tda.transfer_excess_qty, 0),
    'return_missing_qty', coalesce(rda.return_missing_qty, 0),
    'return_excess_qty', coalesce(rda.return_excess_qty, 0),
    'total_missing_qty', coalesce(tda.transfer_missing_qty, 0) + coalesce(rda.return_missing_qty, 0),
    'total_excess_qty', coalesce(tda.transfer_excess_qty, 0) + coalesce(rda.return_excess_qty, 0)
  ) order by b.name), '[]'::jsonb)
  into v_result
  from public.branches b
  left join sales_agg sa on sa.branch_id = b.id
  left join item_agg ia on ia.branch_id = b.id
  left join transfer_disc_agg tda on tda.branch_id = b.id
  left join return_disc_agg rda on rda.branch_id = b.id
  where b.is_active and not b.is_main_branch;

  return v_result;
end;
$$;

revoke all on function public.report_branch_performance(text, timestamptz, timestamptz) from public, anon;
grant execute on function public.report_branch_performance(text, timestamptz, timestamptz) to authenticated;

-- Reconciliation is company-wide and now includes the Main Branch, whose
-- transfer-out and return-in movements are financially and operationally vital.
create or replace function public.report_inventory_reconciliation(p_branch_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not public.is_owner() then
    raise exception 'Unauthorized: Owner access required.' using errcode = '42501';
  end if;

  with active_branches as (
    select b.id, b.name
    from public.branches b
    where b.is_active and (p_branch_id is null or b.id = p_branch_id)
  ),
  branch_product_pairs as (
    select b.id as branch_id, b.name as branch_name,
           p.id as product_id, p.name as product_name, p.sku as product_sku
    from active_branches b
    cross join public.products p
    where p.is_active
       or exists (select 1 from public.branch_inventory bi where bi.branch_id = b.id and bi.product_id = p.id)
       or exists (select 1 from public.inventory_movements im where im.branch_id = b.id and im.product_id = p.id)
  ),
  movements_agg as (
    select im.branch_id, im.product_id,
      coalesce(sum(im.quantity) filter (where im.movement_type = 'opening_stock'), 0)::bigint as opening_stock,
      coalesce(abs(sum(im.quantity) filter (where im.movement_type = 'transfer_out')), 0)::bigint as transfer_out,
      coalesce(sum(im.quantity) filter (where im.movement_type = 'transfer_in'), 0)::bigint as transfer_in,
      coalesce(abs(sum(im.quantity) filter (where im.movement_type = 'sale')), 0)::bigint as sale,
      coalesce(abs(sum(im.quantity) filter (where im.movement_type = 'return_out')), 0)::bigint as return_out,
      coalesce(sum(im.quantity) filter (where im.movement_type = 'return_in'), 0)::bigint as return_in,
      coalesce(sum(im.quantity) filter (where im.movement_type = 'adjustment'), 0)::bigint as adjustment,
      coalesce(sum(im.quantity), 0)::bigint as calculated_stock
    from public.inventory_movements im
    group by im.branch_id, im.product_id
  ),
  transfer_disc_agg as (
    select st.to_branch_id as branch_id, td.product_id,
      coalesce(sum(td.difference) filter (where td.discrepancy_type = 'missing'), 0)::bigint as transfer_missing_qty,
      coalesce(sum(abs(td.difference)) filter (where td.discrepancy_type = 'excess'), 0)::bigint as transfer_excess_qty
    from public.transfer_discrepancies td
    join public.stock_transfers st on st.id = td.stock_transfer_id
    group by st.to_branch_id, td.product_id
  ),
  return_disc_agg as (
    select sr.from_branch_id as branch_id, rd.product_id,
      coalesce(sum(rd.difference) filter (where rd.discrepancy_type = 'missing'), 0)::bigint as return_missing_qty,
      coalesce(sum(abs(rd.difference)) filter (where rd.discrepancy_type = 'excess'), 0)::bigint as return_excess_qty
    from public.return_discrepancies rd
    join public.stock_returns sr on sr.id = rd.stock_return_id
    group by sr.from_branch_id, rd.product_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'branch_id', bp.branch_id,
    'branch_name', bp.branch_name,
    'product_id', bp.product_id,
    'product_name', bp.product_name,
    'product_sku', bp.product_sku,
    'opening_stock', coalesce(ma.opening_stock, 0),
    'transfer_out', coalesce(ma.transfer_out, 0),
    'transfer_in', coalesce(ma.transfer_in, 0),
    'sale', coalesce(ma.sale, 0),
    'return_out', coalesce(ma.return_out, 0),
    'return_in', coalesce(ma.return_in, 0),
    'adjustment', coalesce(ma.adjustment, 0),
    'calculated_stock', coalesce(ma.calculated_stock, 0),
    'current_stock', coalesce(bi.quantity_on_hand, 0),
    'variance', coalesce(bi.quantity_on_hand, 0) - coalesce(ma.calculated_stock, 0),
    'has_reconciliation_issue', coalesce(bi.quantity_on_hand, 0) <> coalesce(ma.calculated_stock, 0),
    'transfer_missing_qty', coalesce(tda.transfer_missing_qty, 0),
    'transfer_excess_qty', coalesce(tda.transfer_excess_qty, 0),
    'return_missing_qty', coalesce(rda.return_missing_qty, 0),
    'return_excess_qty', coalesce(rda.return_excess_qty, 0)
  ) order by bp.branch_name, bp.product_name), '[]'::jsonb)
  into v_result
  from branch_product_pairs bp
  left join movements_agg ma on ma.branch_id = bp.branch_id and ma.product_id = bp.product_id
  left join public.branch_inventory bi on bi.branch_id = bp.branch_id and bi.product_id = bp.product_id
  left join transfer_disc_agg tda on tda.branch_id = bp.branch_id and tda.product_id = bp.product_id
  left join return_disc_agg rda on rda.branch_id = bp.branch_id and rda.product_id = bp.product_id;

  return v_result;
end;
$$;

revoke all on function public.report_inventory_reconciliation(uuid) from public, anon;
grant execute on function public.report_inventory_reconciliation(uuid) to authenticated;

-- End Shift retries return the authoritative closed summary without adding a
-- second audit row. The shift row lock serializes close attempts.
create or replace function public.end_cashier_shift(p_shift_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_user public.profiles%rowtype;
  v_shift public.shifts%rowtype;
  v_branch_name text;
  v_tx_count bigint;
  v_total_sales numeric(12,2);
  v_was_open boolean;
begin
  select * into v_user
  from public.profiles
  where id = v_user_id and is_active and role = 'cashier'
  for update;
  if not found then
    raise exception 'Unauthorized: active cashier access required.' using errcode = '42501';
  end if;

  select * into v_shift
  from public.shifts
  where id = p_shift_id
  for update;
  if not found or v_shift.cashier_id <> v_user_id or v_shift.branch_id <> v_user.branch_id then
    raise exception 'Unable to access this shift.' using errcode = '42501';
  end if;

  v_was_open := v_shift.status = 'open';
  if v_was_open then
    update public.shifts
    set status = 'closed', ended_at = now()
    where id = p_shift_id
    returning * into v_shift;
  end if;

  select b.name into v_branch_name from public.branches b where b.id = v_shift.branch_id;
  select count(s.id)::bigint, coalesce(sum(s.total_amount), 0)::numeric(12,2)
    into v_tx_count, v_total_sales
  from public.sales s
  where s.shift_id = p_shift_id and s.status = 'completed';

  if v_was_open then
    perform public.write_audit_log(
      v_user_id, v_user.full_name, 'cashier', v_shift.branch_id,
      'shift_ended', 'shift', p_shift_id,
      jsonb_build_object('total_sales', v_total_sales, 'transaction_count', v_tx_count)
    );
  end if;

  return jsonb_build_object(
    'id', v_shift.id,
    'branch_id', v_shift.branch_id,
    'branch_name', v_branch_name,
    'cashier_id', v_shift.cashier_id,
    'cashier_name', v_user.full_name,
    'status', v_shift.status,
    'started_at', v_shift.started_at,
    'ended_at', v_shift.ended_at,
    'completed_transaction_count', v_tx_count,
    'total_sales', v_total_sales
  );
end;
$$;

revoke all on function public.end_cashier_shift(uuid) from public, anon;
grant execute on function public.end_cashier_shift(uuid) to authenticated;

-- --------------------------------------------------------------------------
-- Common authorization, dashboard, reporting, and ledger access paths
-- --------------------------------------------------------------------------

create index if not exists sales_branch_status_sold_at_idx
  on public.sales(branch_id, status, sold_at desc);
create index if not exists sales_cashier_sold_at_idx
  on public.sales(cashier_id, sold_at desc);
create index if not exists inventory_movements_branch_product_idx
  on public.inventory_movements(branch_id, product_id);
create index if not exists stock_transfers_from_branch_status_idx
  on public.stock_transfers(from_branch_id, status);
create index if not exists stock_returns_to_branch_status_idx
  on public.stock_returns(to_branch_id, status, returned_at desc);
create index if not exists audit_logs_branch_created_at_idx
  on public.audit_logs(branch_id, created_at desc);
create index if not exists audit_logs_actor_created_at_idx
  on public.audit_logs(actor_user_id, created_at desc);

commit;
