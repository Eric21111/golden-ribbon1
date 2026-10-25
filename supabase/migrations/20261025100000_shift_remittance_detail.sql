-- Read one closed shift remittance by id.
-- Does not change sales, stock, reconciliations, or historical totals.

begin;

create or replace function public.get_shift_remittance_detail(p_shift_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if p_shift_id is null then
    raise exception 'Shift id is required.' using errcode = '22023';
  end if;
  if not (public.is_owner() or public.is_main_branch_manager()) then
    raise exception 'Unauthorized: Owner or Main Branch Manager access is required.'
      using errcode = '42501';
  end if;

  select jsonb_build_object(
    'shift_id', s.id,
    'branch_id', s.branch_id,
    'branch_name', b.name,
    'cashier_id', s.cashier_id,
    'cashier_name', cashier.full_name,
    'started_at', s.started_at,
    'ended_at', s.ended_at,
    'sales_cutoff_at', s.sales_cutoff_at,
    'inventory_reconciliation_required', s.inventory_reconciliation_required,
    'reconciliation_required', s.reconciliation_required,
    'cash_status', case when r.id is null then 'pending' else 'reconciled' end,
    'expected_cash', coalesce(r.expected_cash, (
      select coalesce(sum(sales.total_amount), 0)::numeric(12,2)
      from public.sales
      where sales.shift_id = s.id and sales.status = 'completed'
    )),
    'actual_cash', r.actual_cash,
    'difference', r.difference,
    'cash_result', r.result,
    'reconciled_at', r.reconciled_at,
    'products', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', pr.id,
          'shift_id', pr.shift_id,
          'product_id', pr.product_id,
          'product_name_snapshot', pr.product_name_snapshot,
          'sku_snapshot', pr.sku_snapshot,
          'closing_stock_behavior', pr.closing_stock_behavior,
          'opening_quantity', pr.opening_quantity,
          'received_quantity', pr.received_quantity,
          'outgoing_quantity', pr.outgoing_quantity,
          'sold_quantity', pr.sold_quantity,
          'waste_quantity', pr.waste_quantity,
          'adjustment_quantity', pr.adjustment_quantity,
          'expected_remaining', pr.expected_remaining,
          'actual_remaining', pr.actual_remaining,
          'discrepancy', pr.discrepancy,
          'unsold_quantity', pr.unsold_quantity,
          'carried_quantity', pr.carried_quantity,
          'result', pr.result,
          'discrepancy_note', pr.discrepancy_note,
          'reconciled_at', pr.reconciled_at
        )
        order by pr.product_name_snapshot
      )
      from public.shift_product_reconciliations pr
      where pr.shift_id = s.id
    ), '[]'::jsonb)
  )
  into v_result
  from public.shifts s
  join public.branches b on b.id = s.branch_id
  join public.profiles cashier on cashier.id = s.cashier_id
  left join public.shift_reconciliations r on r.shift_id = s.id
  where s.id = p_shift_id
    and s.status = 'closed'
    and not b.is_main_branch
    and (r.id is not null or s.reconciliation_required);

  if v_result is null then
    raise exception 'Shift remittance not found.' using errcode = '22023';
  end if;
  return v_result;
end;
$$;

revoke all on function public.get_shift_remittance_detail(uuid) from public, anon;
grant execute on function public.get_shift_remittance_detail(uuid) to authenticated;

comment on function public.get_shift_remittance_detail(uuid) is
  'Owner or Main Branch Manager read of one closed shift remittance. Does not change the remittance.';

commit;
