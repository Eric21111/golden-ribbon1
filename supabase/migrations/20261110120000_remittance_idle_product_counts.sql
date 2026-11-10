begin;

-- Additive preview metadata only. Preserve existing baselines, reconciliation history,
-- finalization validation/atomicity, stock rules and all caller authorization.
-- Net-zero adjustments are still activity: test ledger existence, not just summed totals.
create or replace function public.build_shift_close_preview(p_shift public.shifts)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_expected_cash numeric(12,2);
  v_products jsonb := '[]'::jsonb;
  v_base record;
  v_agg record;
  v_requires_count boolean;
  v_cutoff timestamptz := coalesce(p_shift.sales_cutoff_at, p_shift.ended_at, now());
begin
  select coalesce(sum(s.total_amount), 0)::numeric(12,2) into v_expected_cash
  from public.sales s
  where s.shift_id = p_shift.id and s.status = 'completed';

  for v_base in
    select * from public.shift_product_close_baselines b
    where b.shift_id = p_shift.id
    order by b.product_name_snapshot, b.product_id
  loop
    select * into v_agg
    from public.aggregate_shift_product_movements(p_shift, v_base.product_id, v_base.opening_quantity);

    v_requires_count := v_base.opening_quantity <> 0
      or v_agg.system_balance_before_waste <> 0
      or exists (
        select 1 from public.inventory_movements m
        where m.branch_id = p_shift.branch_id and m.product_id = v_base.product_id
          and m.created_at >= p_shift.started_at and m.created_at <= v_cutoff
      )
      or exists (
        select 1 from public.branch_inventory bi
        where bi.branch_id = p_shift.branch_id and bi.product_id = v_base.product_id
          and bi.quantity_on_hand <> 0
      );

    v_products := v_products || jsonb_build_array(jsonb_build_object(
      'product_id', v_base.product_id,
      'product_name_snapshot', v_base.product_name_snapshot,
      'sku_snapshot', v_base.sku_snapshot,
      'closing_stock_behavior', v_base.closing_stock_behavior,
      'opening_quantity', v_base.opening_quantity,
      'received_quantity', v_agg.received_quantity,
      'outgoing_quantity', v_agg.outgoing_quantity,
      'sold_quantity', v_agg.sold_quantity,
      'adjustment_quantity', v_agg.adjustment_quantity,
      'system_balance_before_waste', v_agg.system_balance_before_waste,
      'requires_count', v_requires_count
    ));
  end loop;

  return jsonb_build_object(
    'shift_id', p_shift.id, 'branch_id', p_shift.branch_id,
    'started_at', p_shift.started_at, 'ended_at', p_shift.ended_at,
    'sales_cutoff_at', p_shift.sales_cutoff_at,
    'inventory_reconciliation_required', p_shift.inventory_reconciliation_required,
    'reconciliation_required', p_shift.reconciliation_required,
    'mode', case when p_shift.inventory_reconciliation_required
      or exists (select 1 from public.shift_product_close_baselines b where b.shift_id = p_shift.id)
      then 'pcs_inventory_cash' else 'legacy_cash_only' end,
    'expected_cash', v_expected_cash, 'products', v_products, 'status', 'pending'
  );
end;
$$;

revoke all on function public.build_shift_close_preview(public.shifts) from public, anon, authenticated;

commit;
