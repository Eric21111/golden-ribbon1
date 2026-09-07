import { supabase } from '@/lib/supabase';
import type { AuditLogEntry, AuditLogFilters, AuditLogsPage } from '@/types/models';

export async function listAuditLogs(
  filters: AuditLogFilters = {},
  page = 0,
  pageSize = 50
): Promise<AuditLogsPage> {
  const { data, error } = await supabase.rpc('list_audit_logs', {
    p_page: page,
    p_page_size: pageSize,
    p_branch_id: filters.branchId || null,
    p_actor_id: filters.actorId || null,
    p_action: filters.action || null,
    p_entity_type: filters.entityType || null,
    p_range_type: filters.rangeType ?? 'all_time',
    p_start_date: filters.startDate || null,
    p_end_date: filters.endDate || null,
  });
  if (error) throw error;
  return data as unknown as AuditLogsPage;
}

export async function getAuditLogDetail(id: string): Promise<AuditLogEntry> {
  const { data, error } = await supabase.rpc('get_audit_log_detail', {
    p_log_id: id,
  });
  if (error) throw error;
  return data as unknown as AuditLogEntry;
}
