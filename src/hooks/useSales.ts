import { useQuery } from '@tanstack/react-query';

import { isReportRangeReady } from '@/lib/format';
import { queryKeys } from '@/lib/queryKeys';
import {
  getManagerDashboardMetrics,
  getOwnerDailyProductSummary,
  getOwnerDashboardMetrics,
  getSale,
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

export function useManagerDashboardMetrics() {
  return useQuery({
    queryKey: queryKeys.managerDashboard,
    queryFn: getManagerDashboardMetrics,
  });
}
