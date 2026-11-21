import { supabase } from '@/lib/supabase';
import type { VoidLogRow } from '@/features/reports/voidLogs';

const SERVER_PAGE = 50;

/** Walks `list_sale_void_logs` pages. The RPC has no date or branch args. */
export async function listAllVoidLogs(): Promise<VoidLogRow[]> {
  const all: VoidLogRow[] = [];
  let offset = 0;
  for (;;) {
    const result = await supabase.rpc('list_sale_void_logs', { p_offset: offset });
    if (result.error) throw result.error;
    const batch = (result.data ?? []) as VoidLogRow[];
    if (batch.length === 0) break;
    const chunk = batch.length > SERVER_PAGE ? batch.slice(0, SERVER_PAGE) : batch;
    all.push(...chunk);
    if (batch.length <= SERVER_PAGE) break;
    offset += SERVER_PAGE;
  }
  return all;
}
