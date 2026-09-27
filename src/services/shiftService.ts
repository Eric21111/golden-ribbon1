import { supabase } from '@/lib/supabase';
import type { PendingShiftReconciliation, Shift, ShiftCloseResult, ShiftRemittanceRow, ShiftSummary } from '@/types/models';

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

export async function closeCashierShift(
  shiftId: string,
  actualCash: string,
  waste: Array<{ product_id: string; note?: string | null }>,
): Promise<ShiftCloseResult> {
  const { data, error } = await supabase.rpc('close_cashier_shift', {
    p_shift_id: shiftId,
    p_actual_cash: actualCash,
    p_waste: waste,
  });
  if (error) throw error;
  return data;
}

export async function reconcileClosedShift(
  shiftId: string,
  actualCash: string,
  waste: Array<{ product_id: string; note?: string | null }>,
): Promise<ShiftCloseResult> {
  const { data, error } = await supabase.rpc('reconcile_closed_shift', {
    p_shift_id: shiftId,
    p_actual_cash: actualCash,
    p_waste: waste,
  });
  if (error) throw error;
  return data;
}

export async function getMyPendingShiftReconciliation(): Promise<PendingShiftReconciliation | null> {
  const { data, error } = await supabase.rpc('get_my_pending_shift_reconciliation');
  if (error) throw error;
  return data;
}

export async function getShiftSummary(shiftId: string): Promise<ShiftSummary> {
  const { data, error } = await supabase.rpc('get_shift_summary', { p_shift_id: shiftId });
  if (error) throw error;
  return data as unknown as ShiftSummary;
}

export async function listShiftRemittances(branchId?: string | null): Promise<ShiftRemittanceRow[]> {
  const { data, error } = await supabase.rpc('report_branch_shift_remittances', {
    p_branch_id: branchId ?? null,
  });
  if (error) throw error;
  return (data ?? []) as ShiftRemittanceRow[];
}
