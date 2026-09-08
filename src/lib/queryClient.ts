import { QueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/lib/queryKeys';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
    mutations: { retry: 0 },
  },
});

/** Refetch only datasets a completed sale changes. Does not invalidate unrelated reports. */
export function invalidateCompletedSaleQueries(client: QueryClient) {
  return Promise.all([
    client.invalidateQueries({ queryKey: ['inventory'] }),
    client.invalidateQueries({ queryKey: ['inventory-movements'] }),
    client.invalidateQueries({ queryKey: ['shift-sales'] }),
    client.invalidateQueries({ queryKey: ['sales'] }),
    client.invalidateQueries({ queryKey: ['shifts'] }),
    client.invalidateQueries({ queryKey: queryKeys.ownerDashboard }),
    client.invalidateQueries({ queryKey: queryKeys.managerDashboard }),
    client.invalidateQueries({ queryKey: queryKeys.managerRecentSales }),
  ]);
}
