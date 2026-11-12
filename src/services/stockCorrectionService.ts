import { supabase } from '@/lib/supabase';
import type { StockUnitCode } from '@/lib/stockUnits';

export type CorrectionStock = { product_id: string; product_name: string; quantity: number; updated_at: string; stock_unit_code: StockUnitCode | null };
export type CorrectionRequest = { p_shift_id: string; p_product_id: string; p_expected_quantity: number; p_expected_updated_at: string; p_actual_quantity: number; p_reason: string; p_idempotency_key: string };
export type CorrectionHistory = { id: string; created_at: string; product_name: string; stock_unit_code: StockUnitCode | null; branch_name: string; cashier_name: string; details: { action?: 'add'; before: number; after: number; reason: string; shift_id: string } };
export async function listCorrectionStock(): Promise<CorrectionStock[]> {
  const { data, error } = await supabase.rpc('list_cashier_correction_stock');
  if (error) throw error;
  return (data ?? []).map(row => ({ ...row, quantity: Number(row.quantity) }));
}
export async function correctStock(request: CorrectionRequest): Promise<string> {
  const { data, error } = await supabase.rpc('correct_cashier_stock_count', request);
  if (error) throw error;
  if (!data) throw new Error('Unable to confirm the correction. Retry the same request.');
  return data;
}
export async function listCorrections(offset: number): Promise<CorrectionHistory[]> {
  const { data, error } = await supabase.rpc('list_stock_count_corrections', { p_offset: offset });
  if (error) throw error;
  return data as unknown as CorrectionHistory[];
}

export type BranchStockRequest = {
  p_shift_id: string;
  p_product_id: string;
  p_action: 'add' | 'waste';
  p_quantity: number;
  p_expected_available: number;
  p_reason: string;
  p_key: string;
};

export async function recordBranchStockAction(request: BranchStockRequest) {
  const { data, error } = await supabase.rpc('record_branch_stock_action', request);
  if (error) throw error;
  if (!data) throw new Error('Please retry to confirm whether the change was saved.');
  return data;
}
