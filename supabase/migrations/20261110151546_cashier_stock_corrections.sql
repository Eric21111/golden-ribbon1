begin;

-- Nullable metadata leaves historical movements untouched and separates corrections
-- from arbitrary free-text notes entered by older inventory operations.
alter table public.inventory_movements add column stock_count_correction jsonb;
create unique index inventory_movements_correction_key
  on public.inventory_movements(created_by, (stock_count_correction->>'key'))
  where stock_count_correction is not null;

-- Reuse the adjustment ledger: no new inventory pool, purchases, or transfers.
create function public.list_cashier_correction_stock()
returns table(product_id uuid, product_name text, quantity numeric, updated_at timestamptz, stock_unit_code text)
language plpgsql stable security definer set search_path = '' as $$
declare v_user public.profiles%rowtype;
begin
  select * into v_user from public.profiles where id=auth.uid() and is_active and role='cashier';
  if not found then raise exception 'Active cashier required.' using errcode='42501'; end if;
  return query select p.id,p.name,i.quantity_on_hand,i.updated_at,p.stock_unit_code
    from public.branch_inventory i join public.products p on p.id=i.product_id
    where i.branch_id=v_user.branch_id and p.inventory_mode='piece_stock' and p.is_active
    order by p.name,p.id;
end $$;

create function public.correct_cashier_stock_count(
  p_shift_id uuid, p_product_id uuid, p_expected_quantity numeric,
  p_expected_updated_at timestamptz, p_actual_quantity numeric,
  p_reason text, p_idempotency_key text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user public.profiles%rowtype; v_stock public.branch_inventory%rowtype;
  v_existing public.inventory_movements%rowtype; v_request jsonb; v_id uuid:=gen_random_uuid();
begin
  select * into v_user from public.profiles where id=auth.uid() and is_active and role='cashier' for update;
  if not found then raise exception 'Active cashier required.' using errcode='42501'; end if;
  if p_idempotency_key is null or p_idempotency_key !~ '^[a-zA-Z0-9_-]{16,100}$'
     or p_actual_quantity is null or p_actual_quantity not between 0 and 999999
     or p_actual_quantity<>trunc(p_actual_quantity) or p_actual_quantity::text in ('NaN','Infinity','-Infinity')
     or p_expected_quantity is null or p_expected_quantity < 0 or p_expected_updated_at is null
     or p_reason is null or p_reason not in ('Incorrect kitchen count','Previous count was incorrect','Physical recount') then
    raise exception 'Enter a valid whole stock count and select a reason.' using errcode='22023';
  end if;
  v_request:=jsonb_build_object('shift_id',p_shift_id,'product_id',p_product_id,
    'before',p_expected_quantity,'updated_at',p_expected_updated_at,'after',p_actual_quantity,'reason',p_reason);
  -- Exact key and payload comparison, including on retries after shift close.
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

create function public.list_stock_count_corrections(p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_user public.profiles%rowtype; v_all boolean; v_result jsonb;
begin
  select * into v_user from public.profiles where id=auth.uid() and is_active;
  if not found or v_user.role not in ('owner','manager','cashier') then
    raise exception 'Active staff required.' using errcode='42501'; end if;
  if p_offset is null or p_offset<0 then raise exception 'Invalid page.' using errcode='22023'; end if;
  v_all:=v_user.role='owner' or (v_user.role='manager' and exists(select 1 from public.branches where id=v_user.branch_id and is_main_branch));
  select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into v_result from (
    select m.id,m.created_at,p.name product_name,p.stock_unit_code,b.name branch_name,u.full_name cashier_name,
      m.stock_count_correction->'request' details
    from public.inventory_movements m join public.products p on p.id=m.product_id
      join public.branches b on b.id=m.branch_id join public.profiles u on u.id=m.created_by
    where m.reference_type='adjustment' and m.stock_count_correction is not null
      and (v_all or m.branch_id=v_user.branch_id)
    order by m.created_at desc,m.id desc limit 50 offset p_offset
  ) r;
  return v_result;
end $$;
revoke all on function public.list_cashier_correction_stock() from public,anon;
revoke all on function public.correct_cashier_stock_count(uuid,uuid,numeric,timestamptz,numeric,text,text) from public,anon;
revoke all on function public.list_stock_count_corrections(integer) from public,anon;
grant execute on function public.list_cashier_correction_stock() to authenticated;
grant execute on function public.correct_cashier_stock_count(uuid,uuid,numeric,timestamptz,numeric,text,text) to authenticated;
grant execute on function public.list_stock_count_corrections(integer) to authenticated;
commit;
