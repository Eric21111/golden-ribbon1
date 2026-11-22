import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '@/features/auth/AuthProvider';
import { SCAN_MAX_PAGES, canLoadOlder, extendScan, scanCorrections, type CorrectionScan } from '@/features/reports/stockCorrectionFilters';
import { listCorrections } from '@/services/stockCorrectionService';

/**
 * Stock corrections, newest first, loaded page by page with the server's own offset pages (the server cannot filter).
 * The newest 500 load first; `loadOlder` adds the next 500 (and again, up to the ceiling), appending the older pages to the same list
 * without duplicates. Shared by the All branches overview and every branch history, so older corrections loaded in one are there in
 * the other, and opening a branch does not load them again (fresh for 30 seconds; pull to refresh reloads, keeping how far back the
 * list reached). The key starts with "stock-corrections" so a new correction refreshes it.
 */
export function useStockCorrectionScan() {
  const { profile } = useAuth();
  const client = useQueryClient();
  const key = ['stock-corrections', 'scan', profile?.id];

  const query = useQuery({
    queryKey: key,
    // a reload keeps how far back the list already reached, so older corrections do not vanish on refresh
    queryFn: () => scanCorrections(listCorrections, Math.max(SCAN_MAX_PAGES, client.getQueryData<CorrectionScan>(key)?.pages ?? 0)),
    enabled: !!profile,
    staleTime: 30_000,
  });

  const older = useMutation({
    mutationFn: async () => {
      const current = client.getQueryData<CorrectionScan>(key);
      if (!current || !canLoadOlder(current)) return current;
      return extendScan(listCorrections, current);
    },
    onSuccess: (next) => {
      if (next) client.setQueryData(key, next);
    },
  });

  return {
    ...query,
    /** Add the next page group of older corrections to the list. A failure keeps what is already loaded. */
    loadOlder: () => older.mutate(),
    loadingOlder: older.isPending,
    olderError: older.error,
  };
}
