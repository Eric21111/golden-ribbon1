import { supabase } from '@/lib/supabase';
import type {
  PendingShiftReconciliation,
  Shift,
  ShiftCloseFinalizeProduct,
  ShiftClosePreview,
  ShiftCloseReportDetail,
  ShiftCloseReportProduct,
  ShiftCloseResult,
  ShiftRemittanceReport,
  ShiftSummary,
  ShiftWasteReport,
} from '@/types/models';

export async function getActiveShift(): Promise<Shift | null> {
  const { data, error } = await supabase
    .from('shifts')
    .select('*')
    .eq('status', 'open')
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function startCashierShift(): Promise<string> {
  const { data, error } = await supabase.rpc('start_cashier_shift');
  if (error) throw error;
  return data;
}

export async function beginCashierShiftClose(shiftId: string): Promise<ShiftClosePreview> {
  const { data, error } = await supabase.rpc('begin_cashier_shift_close', {
    p_shift_id: shiftId,
  });
  if (error) throw error;
  return data as ShiftClosePreview;
}

export async function finalizeCashierShiftReconciliation(
  shiftId: string,
  actualCash: string,
  products: ShiftCloseFinalizeProduct[] = [],
): Promise<ShiftCloseResult> {
  const { data, error } = await supabase.rpc('finalize_cashier_shift_reconciliation', {
    p_shift_id: shiftId,
    p_actual_cash: actualCash,
    p_products: products,
  });
  if (error) throw error;
  return data as ShiftCloseResult;
}

/** Legacy cash-only pending shifts (no PCS close baselines). Prefer finalize for inventory closes. */
export async function reconcileClosedShift(shiftId: string, actualCash: string): Promise<ShiftCloseResult> {
  const { data, error } = await supabase.rpc('reconcile_closed_shift', {
    p_shift_id: shiftId,
    p_actual_cash: actualCash,
  });
  if (error) throw error;
  return data as ShiftCloseResult;
}

export async function getMyPendingShiftReconciliation(): Promise<PendingShiftReconciliation | null> {
  const { data, error } = await supabase.rpc('get_my_pending_shift_reconciliation');
  if (error) throw error;
  return data as PendingShiftReconciliation | null;
}

/**
 * Defensive same-day closed hint from server remittance business dates (Manila).
 * start_cashier_shift remains the final authority if this is stale/unavailable.
 */
export async function hasMyFinalizedCloseToday(branchId: string, cashierId: string): Promise<boolean> {
  if (!branchId || !cashierId) return false;
  const report = await listShiftRemittances(branchId, 'today');
  for (const day of report.days ?? []) {
    for (const shift of day.shifts ?? []) {
      if (shift.cashier_id === cashierId && shift.status === 'reconciled') {
        return true;
      }
    }
  }
  return false;
}

export async function getShiftSummary(shiftId: string): Promise<ShiftSummary> {
  const { data, error } = await supabase.rpc('get_shift_summary', { p_shift_id: shiftId });
  if (error) throw error;
  return data as unknown as ShiftSummary;
}

export async function listShiftRemittances(
  branchId: string | null | undefined,
  rangeType: 'today' | 'custom' | 'all_time' = 'today',
  startDate?: string,
  endDate?: string,
): Promise<ShiftRemittanceReport> {
  const { data, error } = await supabase.rpc('report_branch_shift_remittances', {
    p_branch_id: branchId ?? null,
    p_range_type: rangeType,
    p_start_date: startDate ?? null,
    p_end_date: endDate ?? null,
  });
  if (error) throw error;
  return (data ?? { days: [] }) as ShiftRemittanceReport;
}

/**
 * Enrich waste RPC rows with quantified PCS using stable keys:
 * occurrence id when available, else unique (shift_id, product_id).
 * Never fabricate quantity for legacy null rows.
 */
async function enrichWasteReportQuantities(report: ShiftWasteReport): Promise<ShiftWasteReport> {
  const shiftIds = new Set<string>();
  for (const day of report.days ?? []) {
    for (const shift of day.shifts ?? []) {
      if (shift.waste_status === 'waste_recorded') shiftIds.add(shift.shift_id);
    }
  }
  if (shiftIds.size === 0) return report;

  const { data, error } = await supabase
    .from('shift_waste_occurrences')
    .select('id, shift_id, product_id, quantity, created_at')
    .in('shift_id', [...shiftIds]);
  if (error) throw error;

  const byShiftProduct = new Map<string, { id: string; quantity: number | null }>();
  for (const row of data ?? []) {
    byShiftProduct.set(`${row.shift_id}:${row.product_id}`, {
      id: row.id,
      quantity: row.quantity == null ? null : Number(row.quantity),
    });
  }

  return {
    days: (report.days ?? []).map((day) => ({
      ...day,
      shifts: day.shifts.map((shift) => ({
        ...shift,
        occurrences: shift.occurrences.map((item) => {
          const match = byShiftProduct.get(`${shift.shift_id}:${item.product_id}`);
          if (!match) return item;
          return {
            ...item,
            occurrence_id: match.id,
            quantity: match.quantity,
          };
        }),
      })),
    })),
  };
}

export async function listShiftWaste(
  branchId: string | null | undefined,
  rangeType: 'today' | 'custom' | 'all_time' = 'today',
  startDate?: string,
  endDate?: string,
): Promise<ShiftWasteReport> {
  const { data, error } = await supabase.rpc('report_branch_shift_waste', {
    p_branch_id: branchId ?? null,
    p_range_type: rangeType,
    p_start_date: startDate ?? null,
    p_end_date: endDate ?? null,
  });
  if (error) throw error;
  const report = (data ?? { days: [] }) as ShiftWasteReport;
  return enrichWasteReportQuantities(report);
}

export async function getShiftCloseReportDetail(shiftId: string): Promise<ShiftCloseReportDetail> {
  if (!shiftId) throw new Error('Shift id is required.');

  // Remittance RPC is security-definer (owner / main manager). Direct shifts SELECT is
  // branch-scoped for managers, so identity comes from the remittance report row.
  const remittance = await listShiftRemittances(null, 'all_time');
  let remittanceRow: ShiftRemittanceReport['days'][number]['shifts'][number] | null = null;
  for (const day of remittance.days ?? []) {
    const found = day.shifts.find((row) => row.shift_id === shiftId);
    if (found) {
      remittanceRow = found;
      break;
    }
  }
  if (!remittanceRow) throw new Error('Shift remittance not found.');

  const [{ data: cashRow, error: cashError }, { data: products, error: productsError }, { data: shiftMeta }] =
    await Promise.all([
      supabase
        .from('shift_reconciliations')
        .select('expected_cash, actual_cash, difference, result, reconciled_at')
        .eq('shift_id', shiftId)
        .maybeSingle(),
      supabase
        .from('shift_product_reconciliations')
        .select(
          'id, shift_id, product_id, product_name_snapshot, sku_snapshot, closing_stock_behavior, opening_quantity, received_quantity, outgoing_quantity, sold_quantity, waste_quantity, adjustment_quantity, expected_remaining, actual_remaining, discrepancy, unsold_quantity, carried_quantity, result, reconciled_at',
        )
        .eq('shift_id', shiftId)
        .order('product_name_snapshot'),
      // Optional: owner/same-branch managers may read sales_cutoff_at; others get null.
      supabase
        .from('shifts')
        .select('sales_cutoff_at, inventory_reconciliation_required, reconciliation_required')
        .eq('id', shiftId)
        .maybeSingle(),
    ]);

  if (cashError) throw cashError;
  if (productsError) throw productsError;

  const productRows: ShiftCloseReportProduct[] = (products ?? []).map((row) => ({
    id: row.id,
    shift_id: row.shift_id,
    product_id: row.product_id,
    product_name_snapshot: row.product_name_snapshot,
    sku_snapshot: row.sku_snapshot,
    closing_stock_behavior: row.closing_stock_behavior,
    opening_quantity: Number(row.opening_quantity),
    received_quantity: Number(row.received_quantity),
    outgoing_quantity: Number(row.outgoing_quantity),
    sold_quantity: Number(row.sold_quantity),
    waste_quantity: Number(row.waste_quantity),
    adjustment_quantity: Number(row.adjustment_quantity),
    expected_remaining: Number(row.expected_remaining),
    actual_remaining: Number(row.actual_remaining),
    discrepancy: Number(row.discrepancy),
    unsold_quantity: Number(row.unsold_quantity),
    carried_quantity: Number(row.carried_quantity),
    result: row.result,
    reconciled_at: row.reconciled_at,
  }));

  const cashStatus: 'pending' | 'reconciled' =
    (cashRow != null || remittanceRow.status === 'reconciled') ? 'reconciled' : 'pending';
  const inventoryRequired =
    shiftMeta?.inventory_reconciliation_required ?? productRows.length > 0;

  return {
    shift_id: remittanceRow.shift_id,
    branch_id: remittanceRow.branch_id,
    branch_name: remittanceRow.branch_name,
    cashier_id: remittanceRow.cashier_id,
    cashier_name: remittanceRow.cashier_name,
    started_at: remittanceRow.started_at,
    ended_at: remittanceRow.ended_at,
    sales_cutoff_at: shiftMeta?.sales_cutoff_at ?? null,
    inventory_reconciliation_required: Boolean(inventoryRequired),
    reconciliation_required: Boolean(shiftMeta?.reconciliation_required ?? remittanceRow.status === 'pending'),
    cash_status: cashStatus,
    expected_cash: cashRow ? Number(cashRow.expected_cash) : Number(remittanceRow.expected_cash),
    actual_cash: cashRow
      ? Number(cashRow.actual_cash)
      : remittanceRow.actual_cash == null
        ? null
        : Number(remittanceRow.actual_cash),
    difference: cashRow
      ? Number(cashRow.difference)
      : remittanceRow.difference == null
        ? null
        : Number(remittanceRow.difference),
    cash_result: cashRow?.result ?? remittanceRow.result,
    reconciled_at: cashRow?.reconciled_at ?? remittanceRow.reconciled_at,
    products: productRows,
  };
}
