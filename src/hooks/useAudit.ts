import { useQuery } from '@tanstack/react-query';
import { getAuditLogDetail, listAuditLogs } from '@/services/auditService';
import { isReportRangeReady } from '@/lib/format';
import { queryKeys } from '@/lib/queryKeys';
import type { AuditLogFilters } from '@/types/models';

export function useAuditLogs(filters: AuditLogFilters = {}, page = 0, pageSize = 50) {
  return useQuery({
    queryKey: queryKeys.auditLogs({ ...filters, page, pageSize }),
    queryFn: () => listAuditLogs(filters, page, pageSize),
    enabled: isReportRangeReady(filters.rangeType ?? 'all_time', filters.startDate, filters.endDate),
    staleTime: 30_000,
  });
}

export function useAuditLogDetail(id: string) {
  return useQuery({
    queryKey: queryKeys.auditLogDetail(id),
    queryFn: () => getAuditLogDetail(id),
    enabled: !!id,
    staleTime: 60_000,
  });
}
