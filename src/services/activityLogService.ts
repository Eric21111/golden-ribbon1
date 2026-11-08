import { supabase } from '@/lib/supabase';
import type { OwnerTodayActivityLog } from '@/types/models';

function isMissingFunction(error: unknown): boolean {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
  const message = String((error as { message?: unknown })?.message ?? '');
  return code === 'PGRST202' || /could not find the function public\.get_owner_today_activity_log/i.test(message);
}

/** Owner-only: today's (Asia/Manila) employee activity across all branches, newest first. */
export async function getOwnerTodayActivityLog(): Promise<OwnerTodayActivityLog> {
  const { data, error } = await supabase.rpc('get_owner_today_activity_log');
  if (error && isMissingFunction(error)) {
    throw new Error('Today Log is not available yet. The database update for it has not been applied.');
  }
  if (error) throw error;
  const result = (data ?? {}) as Partial<OwnerTodayActivityLog>;
  return {
    business_date: result.business_date ?? '',
    total_count: Number(result.total_count ?? 0),
    truncated: Boolean(result.truncated),
    activities: result.activities ?? [],
  };
}
