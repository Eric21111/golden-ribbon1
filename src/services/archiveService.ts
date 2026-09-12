import { supabase } from '@/lib/supabase';
import type { ArchiveExportPackage, ArchiveStatus, DataArchiveRecord } from '@/types/models';

export async function getArchiveStatus(): Promise<ArchiveStatus> {
  const { data, error } = await supabase.rpc('get_archive_status');
  if (error) throw error;
  return data as unknown as ArchiveStatus;
}

export async function dismissArchiveReminder(): Promise<ArchiveStatus> {
  const { data, error } = await supabase.rpc('dismiss_archive_reminder');
  if (error) throw error;
  return data as unknown as ArchiveStatus;
}

export async function prepareSalesArchive(): Promise<DataArchiveRecord> {
  const { data, error } = await supabase.rpc('prepare_sales_archive');
  if (error) throw error;
  return data as unknown as DataArchiveRecord;
}

export async function getArchiveExport(archiveId: string): Promise<ArchiveExportPackage> {
  const { data, error } = await supabase.rpc('get_archive_export', { p_archive_id: archiveId });
  if (error) throw error;
  return data as unknown as ArchiveExportPackage;
}

export async function verifySalesArchive(archiveId: string): Promise<DataArchiveRecord> {
  const { data, error } = await supabase.rpc('verify_sales_archive', { p_archive_id: archiveId });
  if (error) throw error;
  return data as unknown as DataArchiveRecord;
}

export async function cleanupArchivedSales(
  archiveId: string,
  confirmation: string,
): Promise<DataArchiveRecord> {
  const { data, error } = await supabase.rpc('cleanup_archived_sales', {
    p_archive_id: archiveId,
    p_confirmation: confirmation,
  });
  if (error) throw error;
  return data as unknown as DataArchiveRecord;
}
