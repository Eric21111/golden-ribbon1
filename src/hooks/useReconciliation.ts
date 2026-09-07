import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/lib/queryKeys';
import {
  getBranchPerformanceDetails,
  reportBranchPerformance,
  reportInventoryReconciliation,
  reportReturnDiscrepancies,
  reportTransferDiscrepancies,
} from '@/services/reconciliationService';

export function useBranchPerformance(
  rangeType: 'today' | 'custom' | 'all_time' = 'today',
  startDate?: string,
  endDate?: string
) {
  return useQuery({
    queryKey: queryKeys.branchPerformance(rangeType, startDate, endDate),
    queryFn: () => reportBranchPerformance(rangeType, startDate, endDate),
  });
}

export function useBranchPerformanceDetails(
  branchId: string,
  rangeType: 'today' | 'custom' | 'all_time' = 'today',
  startDate?: string,
  endDate?: string
) {
  return useQuery({
    queryKey: queryKeys.branchPerformanceDetails(branchId, rangeType, startDate, endDate),
    queryFn: () => getBranchPerformanceDetails(branchId, rangeType, startDate, endDate),
    enabled: Boolean(branchId),
  });
}

export function useTransferDiscrepanciesReport(
  branchId?: string,
  discrepancyType?: 'all' | 'missing' | 'excess',
  rangeType: 'today' | 'custom' | 'all_time' = 'today',
  startDate?: string,
  endDate?: string
) {
  return useQuery({
    queryKey: queryKeys.transferDiscrepanciesReport(
      branchId,
      discrepancyType,
      rangeType,
      startDate,
      endDate
    ),
    queryFn: () =>
      reportTransferDiscrepancies(branchId, discrepancyType, rangeType, startDate, endDate),
  });
}

export function useReturnDiscrepanciesReport(
  branchId?: string,
  discrepancyType?: 'all' | 'missing' | 'excess',
  rangeType: 'today' | 'custom' | 'all_time' = 'today',
  startDate?: string,
  endDate?: string
) {
  return useQuery({
    queryKey: queryKeys.returnDiscrepanciesReport(
      branchId,
      discrepancyType,
      rangeType,
      startDate,
      endDate
    ),
    queryFn: () =>
      reportReturnDiscrepancies(branchId, discrepancyType, rangeType, startDate, endDate),
  });
}

export function useInventoryReconciliation(branchId?: string) {
  return useQuery({
    queryKey: queryKeys.inventoryReconciliation(branchId),
    queryFn: () => reportInventoryReconciliation(branchId),
  });
}
