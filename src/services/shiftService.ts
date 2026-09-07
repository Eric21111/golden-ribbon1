import { supabase } from '@/lib/supabase';
import type { Shift, ShiftSummary } from '@/types/models';

export interface ShiftFilters {
  branchId?: string;
  cashierId?: string;
}

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

export async function endCashierShift(shiftId: string): Promise<ShiftSummary> {
  const { data, error } = await supabase.rpc('end_cashier_shift', { p_shift_id: shiftId });
  if (error) throw error;
  return data as unknown as ShiftSummary;
}

export async function getShiftSummary(shiftId: string): Promise<ShiftSummary> {
  const { data, error } = await supabase.rpc('get_shift_summary', { p_shift_id: shiftId });
  if (error) throw error;
  return data as unknown as ShiftSummary;
}

export async function listShiftSummaries(
  filters: ShiftFilters = {},
  page = 0
): Promise<ShiftSummary[]> {
  const { data, error } = await supabase.rpc('list_shift_summaries', {
    p_page: page,
    p_page_size: 50,
    p_branch_id: filters.branchId || null,
    p_cashier_id: filters.cashierId || null,
  });
  if (error) throw error;
  return (data as unknown as ShiftSummary[]) ?? [];
}
