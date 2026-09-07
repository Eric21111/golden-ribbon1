import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/lib/queryKeys';
import {
  endCashierShift,
  getActiveShift,
  getShiftSummary,
  listShiftSummaries,
  startCashierShift,
  type ShiftFilters,
} from '@/services/shiftService';
import { useCartStore } from '@/stores/cartStore';
import { useCheckoutStore } from '@/stores/checkoutStore';
import type { ShiftSummary } from '@/types/models';

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
        client.invalidateQueries({ queryKey: ['shifts'] }),
      ]);
    },
  });
}

export function useEndShift(cashierId: string) {
  const client = useQueryClient();
  return useMutation<ShiftSummary, Error, string>({
    mutationFn: async (shiftId: string) => {
      if (useCheckoutStore.getState().request || useCheckoutStore.getState().pending) {
        throw new Error('Finish the sale confirmation before ending the shift.');
      }
      if (useCartStore.getState().items.length) {
        throw new Error('Clear the unfinished cart before ending the shift.');
      }
      return await endCashierShift(shiftId);
    },
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.activeShift(cashierId) }),
        client.invalidateQueries({ queryKey: ['shifts'] }),
        client.invalidateQueries({ queryKey: queryKeys.ownerDashboard }),
        client.invalidateQueries({ queryKey: queryKeys.managerDashboard }),
      ]);
    },
  });
}

export function useShiftSummary(shiftId: string) {
  return useQuery({
    queryKey: queryKeys.shiftSummary(shiftId),
    queryFn: () => getShiftSummary(shiftId),
    enabled: Boolean(shiftId),
  });
}

export function useShiftHistory(filters: ShiftFilters = {}, page = 0) {
  return useQuery({
    queryKey: queryKeys.shiftSummaries({ ...filters, page }),
    queryFn: () => listShiftSummaries(filters, page),
  });
}
