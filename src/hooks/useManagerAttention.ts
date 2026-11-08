import { useQuery } from '@tanstack/react-query';

import { countUnresolved } from '@/features/reports/managerAttention';
import { queryKeys } from '@/lib/queryKeys';
import { reportReturnDiscrepancies, reportTransferDiscrepancies } from '@/services/reconciliationService';
import { countPendingOutgoingTransfers } from '@/services/transferService';

/**
 * Main Branch Manager alerts beyond the dashboard metrics. Pass null to disable (other managers are not
 * authorized for these sources). The discrepancy queries share the report screens' default cache entries
 * (all branches, all types, all time), so receiving stock or resolving a discrepancy refreshes both.
 */
export function useManagerAttention(mainBranchId: string | null) {
  const enabled = Boolean(mainBranchId);
  const pendingOutgoing = useQuery({
    queryKey: queryKeys.pendingOutgoingTransfersCount(mainBranchId ?? ''),
    queryFn: () => countPendingOutgoingTransfers(mainBranchId as string),
    enabled,
  });
  const transferDiscrepancies = useQuery({
    queryKey: queryKeys.transferDiscrepanciesReport(undefined, 'all', 'all_time'),
    queryFn: () => reportTransferDiscrepancies(undefined, 'all', 'all_time'),
    select: countUnresolved,
    enabled,
  });
  const returnDiscrepancies = useQuery({
    queryKey: queryKeys.returnDiscrepanciesReport(undefined, 'all', 'all_time'),
    queryFn: () => reportReturnDiscrepancies(undefined, 'all', 'all_time'),
    select: countUnresolved,
    enabled,
  });

  const queries = [pendingOutgoing, transferDiscrepancies, returnDiscrepancies];
  const failed = queries.filter((query) => query.error);
  return {
    enabled,
    pendingOutgoing: pendingOutgoing.data,
    transferDiscrepancies: transferDiscrepancies.data,
    returnDiscrepancies: returnDiscrepancies.data,
    loading: enabled && queries.some((query) => query.isLoading),
    error: failed[0]?.error ?? null,
    retrying: failed.some((query) => query.isFetching),
    isRefetching: queries.some((query) => query.isRefetching),
    retry: () => {
      for (const query of failed) void query.refetch();
    },
    refetch: () => {
      if (enabled) for (const query of queries) void query.refetch();
    },
  };
}
