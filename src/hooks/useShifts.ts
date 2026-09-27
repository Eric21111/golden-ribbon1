import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/lib/queryKeys';
import {
  closeCashierShift,
  getActiveShift,
  getMyPendingShiftReconciliation,
  getShiftSummary,
  reconcileClosedShift,
  startCashierShift,
} from '@/services/shiftService';
import { useCartStore } from '@/stores/cartStore';
import { useCheckoutStore } from '@/stores/checkoutStore';
import type { ShiftCloseResult } from '@/types/models';

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

export function useCloseShift(cashierId: string) {
  const client = useQueryClient();
  return useMutation<
    ShiftCloseResult,
    Error,
    { shiftId: string; actualCash: string; waste: Array<{ product_id: string }> }
  >({
    mutationFn: async ({ shiftId, actualCash, waste }) => {
      if (useCheckoutStore.getState().request || useCheckoutStore.getState().pending) {
        throw new Error('Finish the sale confirmation before ending the shift.');
      }
      if (useCartStore.getState().items.length) {
        throw new Error('Clear the unfinished cart before ending the shift.');
      }
      return await closeCashierShift(shiftId, actualCash, waste);
    },
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.activeShift(cashierId) }),
        client.invalidateQueries({ queryKey: ['shifts'] }),
        client.invalidateQueries({ queryKey: ['inventory'] }),
        client.invalidateQueries({ queryKey: ['inventory', 'cashier-pos'] }),
        client.invalidateQueries({ queryKey: ['return-inventory'] }),
        client.invalidateQueries({ queryKey: ['stock-returns'] }),
        client.invalidateQueries({ queryKey: queryKeys.ownerDashboard }),
        client.invalidateQueries({ queryKey: queryKeys.managerDashboard }),
      ]);
    },
  });
}

export function useReconcileClosedShift(cashierId: string) {
  const client = useQueryClient();
  return useMutation<
    ShiftCloseResult,
    Error,
    { shiftId: string; actualCash: string; waste: Array<{ product_id: string }> }
  >({
    mutationFn: ({ shiftId, actualCash, waste }) => reconcileClosedShift(shiftId, actualCash, waste),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['shifts', 'pending', cashierId] });
      await client.invalidateQueries({ queryKey: ['shifts', 'remittances'] });
    },
  });
}

export function usePendingShiftReconciliation(cashierId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['shifts', 'pending', cashierId],
    queryFn: getMyPendingShiftReconciliation,
    enabled: Boolean(cashierId) && enabled,
  });
}

export function useShiftSummary(shiftId: string) {
  return useQuery({
    queryKey: queryKeys.shiftSummary(shiftId),
    queryFn: () => getShiftSummary(shiftId),
    enabled: Boolean(shiftId),
  });
}
