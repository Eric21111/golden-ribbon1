import { supabase } from '@/lib/supabase';
import type {
  BranchPerformanceDetails,
  BranchPerformanceItem,
  InventoryReconciliationItem,
  ReturnDiscrepancyReportItem,
  TransferDiscrepancyReportItem,
} from '@/types/models';

export async function reportBranchPerformance(
  rangeType: 'today' | 'custom' | 'all_time' = 'today',
  startDate?: string,
  endDate?: string
): Promise<BranchPerformanceItem[]> {
  const { data, error } = await supabase.rpc('report_branch_performance', {
    p_range_type: rangeType,
    p_start_date: startDate || null,
    p_end_date: endDate || null,
  });
  if (error) throw error;
  return (data as unknown as BranchPerformanceItem[]) ?? [];
}

export async function getBranchPerformanceDetails(
  branchId: string,
  rangeType: 'today' | 'custom' | 'all_time' = 'today',
  startDate?: string,
  endDate?: string
): Promise<BranchPerformanceDetails> {
  const { data, error } = await supabase.rpc('get_branch_performance_details', {
    p_branch_id: branchId,
    p_range_type: rangeType,
    p_start_date: startDate || null,
    p_end_date: endDate || null,
  });
  if (error) throw error;
  return data as unknown as BranchPerformanceDetails;
}

export async function reportTransferDiscrepancies(
  branchId?: string,
  discrepancyType?: 'all' | 'missing' | 'excess',
  rangeType: 'today' | 'custom' | 'all_time' = 'today',
  startDate?: string,
  endDate?: string
): Promise<TransferDiscrepancyReportItem[]> {
  const { data, error } = await supabase.rpc('report_transfer_discrepancies', {
    p_branch_id: branchId || null,
    p_discrepancy_type: discrepancyType || null,
    p_range_type: rangeType,
    p_start_date: startDate || null,
    p_end_date: endDate || null,
  });
  if (error) throw error;
  return (data as unknown as TransferDiscrepancyReportItem[]) ?? [];
}

export async function reportReturnDiscrepancies(
  branchId?: string,
  discrepancyType?: 'all' | 'missing' | 'excess',
  rangeType: 'today' | 'custom' | 'all_time' = 'today',
  startDate?: string,
  endDate?: string
): Promise<ReturnDiscrepancyReportItem[]> {
  const { data, error } = await supabase.rpc('report_return_discrepancies', {
    p_branch_id: branchId || null,
    p_discrepancy_type: discrepancyType || null,
    p_range_type: rangeType,
    p_start_date: startDate || null,
    p_end_date: endDate || null,
  });
  if (error) throw error;
  return (data as unknown as ReturnDiscrepancyReportItem[]) ?? [];
}

export async function reportInventoryReconciliation(
  branchId?: string
): Promise<InventoryReconciliationItem[]> {
  const { data, error } = await supabase.rpc('report_inventory_reconciliation', {
    p_branch_id: branchId || null,
  });
  if (error) throw error;
  return (data as unknown as InventoryReconciliationItem[]) ?? [];
}
