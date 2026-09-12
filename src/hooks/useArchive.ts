import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/lib/queryKeys';
import {
  cleanupArchivedSales,
  dismissArchiveReminder,
  getArchiveExport,
  getArchiveStatus,
  prepareSalesArchive,
  verifySalesArchive,
} from '@/services/archiveService';

function invalidateArchiveQueries(client: ReturnType<typeof useQueryClient>) {
  void client.invalidateQueries({ queryKey: queryKeys.archiveStatus });
  void client.invalidateQueries({ queryKey: queryKeys.ownerDashboard });
  void client.invalidateQueries({ queryKey: queryKeys.ownerDailyProductSummary });
  void client.invalidateQueries({ queryKey: ['reports'] });
}

export function useArchiveStatus() {
  return useQuery({
    queryKey: queryKeys.archiveStatus,
    queryFn: getArchiveStatus,
  });
}

export function useDismissArchiveReminder() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: dismissArchiveReminder,
    onSuccess: (data) => client.setQueryData(queryKeys.archiveStatus, data),
  });
}

export function usePrepareSalesArchive() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: prepareSalesArchive,
    onSuccess: () => invalidateArchiveQueries(client),
  });
}

export function useArchiveExport() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: getArchiveExport,
    onSuccess: () => invalidateArchiveQueries(client),
  });
}

export function useVerifySalesArchive() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: verifySalesArchive,
    onSuccess: () => invalidateArchiveQueries(client),
  });
}

export function useCleanupArchivedSales() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ archiveId, confirmation }: { archiveId: string; confirmation: string }) =>
      cleanupArchivedSales(archiveId, confirmation),
    onSuccess: () => invalidateArchiveQueries(client),
  });
}
