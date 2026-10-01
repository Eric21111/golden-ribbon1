import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/lib/queryKeys';
import { isReportRangeReady } from '@/lib/format';
import {
  beginCashierShiftClose,
  finalizeCashierShiftReconciliation,
  getActiveShift,
  getMyPendingShiftReconciliation,
  getShiftCloseReportDetail,
  getShiftSummary,
  hasMyFinalizedCloseToday,
  listShiftRemittances,
  listShiftWaste,
  reconcileClosedShift,
  startCashierShift,
} from '@/services/shiftService';
import { useCartStore } from '@/stores/cartStore';
import { useCheckoutStore } from '@/stores/checkoutStore';
import type { ShiftCloseBeginResult, ShiftCloseFinalizeProduct, ShiftCloseResult } from '@/types/models';

function assertShiftCloseAllowed() {
  if (useCheckoutStore.getState().request || useCheckoutStore.getState().pending) {
    throw new Error('Finish the sale confirmation before ending the shift.');
  }
  if (useCartStore.getState().items.length) {
    throw new Error('Clear the unfinished cart before ending the shift.');
  }
}

async function invalidateAfterShiftClose(client: ReturnType<typeof useQueryClient>, cashierId: string) {
  await Promise.all([
    client.invalidateQueries({ queryKey: queryKeys.activeShift(cashierId) }),
    client.invalidateQueries({ queryKey: ['shifts', 'pending', cashierId] }),
    client.invalidateQueries({ queryKey: ['shifts', 'finalized-today', cashierId] }),
    client.invalidateQueries({ queryKey: ['shifts'] }),
    client.invalidateQueries({ queryKey: ['inventory'] }),
    client.invalidateQueries({ queryKey: ['inventory', 'cashier-pos'] }),
    client.invalidateQueries({ queryKey: ['return-inventory'] }),
    client.invalidateQueries({ queryKey: ['stock-returns'] }),
    client.invalidateQueries({ queryKey: queryKeys.ownerDashboard }),
    client.invalidateQueries({ queryKey: queryKeys.managerDashboard }),
    client.invalidateQueries({ queryKey: ['reports', 'shift-remittances'] }),
    client.invalidateQueries({ queryKey: ['reports', 'shift-waste'] }),
  ]);
}

export function useActiveShift(cashierId: string) {
  return useQuery({
    queryKey: queryKeys.activeShift(cashierId),
    queryFn: getActiveShift,
    enabled: Boolean(cashierId),
  });
}

export function useStartShift(cashierId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: startCashierShift,
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.profile(cashierId) }),
        client.invalidateQueries({ queryKey: queryKeys.activeShift(cashierId) }),
        client.invalidateQueries({ queryKey: ['inventory'] }),
        client.invalidateQueries({ queryKey: ['inventory', 'cashier-pos'] }),
        client.invalidateQueries({ queryKey: ['shifts'] }),
      ]);
    },
  });
}

export function useBeginCashierShiftClose(cashierId: string) {
  const client = useQueryClient();
  return useMutation<ShiftCloseBeginResult, Error, string>({
    mutationFn: async (shiftId) => {
      assertShiftCloseAllowed();
      return beginCashierShiftClose(shiftId);
    },
    onSuccess: async () => {
      await invalidateAfterShiftClose(client, cashierId);
    },
  });
}

export function useFinalizeCashierShiftReconciliation(cashierId: string) {
  const client = useQueryClient();
  return useMutation<
    ShiftCloseResult,
    Error,
    { shiftId: string; actualCash: string; products?: ShiftCloseFinalizeProduct[] }
  >({
    mutationFn: ({ shiftId, actualCash, products }) =>
      finalizeCashierShiftReconciliation(shiftId, actualCash, products ?? []),
    onSuccess: async () => {
      await invalidateAfterShiftClose(client, cashierId);
    },
  });
}

/** Legacy cash-only pending reconciliation (no inventory baselines). */
export function useReconcileClosedShift(cashierId: string) {
  const client = useQueryClient();
  return useMutation<ShiftCloseResult, Error, { shiftId: string; actualCash: string }>({
    mutationFn: ({ shiftId, actualCash }) => reconcileClosedShift(shiftId, actualCash),
    onSuccess: async () => {
      await invalidateAfterShiftClose(client, cashierId);
    },
  });
}

export function useShiftRemittances(
  rangeType: 'today' | 'custom' | 'all_time' = 'today',
  startDate?: string,
  endDate?: string,
  branchId?: string | null,
) {
  return useQuery({
    queryKey: queryKeys.shiftRemittances(rangeType, startDate, endDate, branchId ?? ''),
    queryFn: () => listShiftRemittances(branchId ?? null, rangeType, startDate, endDate),
    enabled: isReportRangeReady(rangeType, startDate, endDate),
  });
}

export function useShiftWaste(
  rangeType: 'today' | 'custom' | 'all_time' = 'today',
  startDate?: string,
  endDate?: string,
  branchId?: string | null,
) {
  return useQuery({
    queryKey: queryKeys.shiftWaste(rangeType, startDate, endDate, branchId ?? ''),
    queryFn: () => listShiftWaste(branchId ?? null, rangeType, startDate, endDate),
    enabled: isReportRangeReady(rangeType, startDate, endDate),
  });
}

export function usePendingShiftReconciliation(cashierId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['shifts', 'pending', cashierId],
    queryFn: getMyPendingShiftReconciliation,
    enabled: Boolean(cashierId) && enabled,
  });
}

/** UI hint only — server start_cashier_shift same-day guard is authoritative. */
export function useMyFinalizedCloseToday(
  cashierId: string,
  branchId: string | null | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ['shifts', 'finalized-today', cashierId, branchId ?? ''],
    queryFn: () => hasMyFinalizedCloseToday(branchId!, cashierId),
    enabled: Boolean(cashierId && branchId) && enabled,
  });
}

export function useShiftSummary(shiftId: string) {
  return useQuery({
    queryKey: queryKeys.shiftSummary(shiftId),
    queryFn: () => getShiftSummary(shiftId),
    enabled: Boolean(shiftId),
  });
}

export function useShiftCloseReportDetail(shiftId: string) {
  return useQuery({
    queryKey: ['shifts', 'close-report-detail', shiftId],
    queryFn: () => getShiftCloseReportDetail(shiftId),
    enabled: Boolean(shiftId),
  });
}
