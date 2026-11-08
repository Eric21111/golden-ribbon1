import { useQuery } from '@tanstack/react-query';

import { isReportRangeReady } from '@/lib/format';
import { queryKeys } from '@/lib/queryKeys';
import {
  getManagerDashboardMetrics,
  getManagerRecentSales,
  getOwnerDailyProductSummary,
  getOwnerDashboardMetrics,
  getOwnerTodayBranchSales,
  getSale,
  listBranchSalesLog,
  reportBranchDailySales,
  reportProductSales,
  reportSalesByBranch,
} from '@/services/saleService';

export function useSale(id: string) {
  return useQuery({
    queryKey: queryKeys.sale(id),
    queryFn: () => getSale(id),
    enabled: Boolean(id),
  });
}

export function useSalesByBranch(
  rangeType: 'today' | 'custom' | 'all_time' = 'today',
  startDate?: string,
  endDate?: string
) {
  return useQuery({
    queryKey: queryKeys.salesByBranch(rangeType, startDate, endDate),
    queryFn: () => reportSalesByBranch(rangeType, startDate, endDate),
    enabled: isReportRangeReady(rangeType, startDate, endDate),
  });
}

export function useBranchSalesLog(
  branchId: string,
  rangeType: 'today' | 'custom' | 'all_time' = 'today',
  startDate?: string,
  endDate?: string,
) {
  return useQuery({
    queryKey: queryKeys.branchSalesLog(branchId, rangeType, startDate, endDate),
    queryFn: () => listBranchSalesLog(branchId, rangeType, startDate, endDate),
    enabled: Boolean(branchId) && isReportRangeReady(rangeType, startDate, endDate),
  });
}

export function useBranchDailySales(
  branchId: string,
  rangeType: 'today' | 'custom' | 'all_time' = 'all_time',
  startDate?: string,
  endDate?: string,
) {
  return useQuery({
    queryKey: queryKeys.branchDailySales(branchId, rangeType, startDate, endDate),
    queryFn: () => reportBranchDailySales(branchId, rangeType, startDate, endDate),
    enabled: Boolean(branchId) && isReportRangeReady(rangeType, startDate, endDate),
  });
}

export function useProductSales(
  rangeType: 'today' | 'custom' | 'all_time' = 'today',
  branchId?: string,
  startDate?: string,
  endDate?: string
) {
  return useQuery({
    queryKey: queryKeys.productSales(rangeType, branchId, startDate, endDate),
    queryFn: () => reportProductSales(rangeType, branchId, startDate, endDate),
    enabled: isReportRangeReady(rangeType, startDate, endDate),
  });
}

export function useOwnerDashboardMetrics() {
  return useQuery({
    queryKey: queryKeys.ownerDashboard,
    queryFn: getOwnerDashboardMetrics,
  });
}

export function useOwnerDailyProductSummary() {
  return useQuery({
    queryKey: queryKeys.ownerDailyProductSummary,
    queryFn: getOwnerDailyProductSummary,
  });
}

/** Today's per-branch sales for the owner dashboard. Keyed under the owner dashboard so a completed
 * sale (which invalidates that prefix) refreshes it with the other dashboard numbers. */
export function useOwnerTodayBranchSales() {
  return useQuery({
    queryKey: queryKeys.ownerTodayBranchSales,
    queryFn: getOwnerTodayBranchSales,
  });
}

export function useManagerDashboardMetrics() {
  return useQuery({
    queryKey: queryKeys.managerDashboard,
    queryFn: getManagerDashboardMetrics,
  });
}

export function useManagerRecentSales(limit = 5) {
  return useQuery({
    queryKey: queryKeys.managerRecentSales(limit),
    queryFn: () => getManagerRecentSales(limit),
  });
}
