import { supabase } from '@/lib/supabase';
import { isSaleId } from '@/lib/saleErrors';
import type {
  LeftoverReturnRequest,
  ReceiveReturnInput,
  ReturnDiscrepancy,
  ReturnStatus,
  StockReturn,
  StockReturnDetails,
} from '@/types/returns';

export interface ReturnFilters {
  branchId?: string;
  status?: ReturnStatus | '';
  search?: string;
  start?: string;
  end?: string;
  sort?: 'newest' | 'oldest';
}

export async function listReturnStock() {
  const { data, error } = await supabase.rpc('list_return_inventory');
  if (error) throw error;
  return data;
}

export async function listReturnsPage(filters: ReturnFilters = {}, page = 0, pageSize = 50) {
  if (!Number.isInteger(page) || page < 0 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new Error('Invalid return history page.');
  }
  let query = supabase
    .from('stock_returns')
    .select('*, items:stock_return_items(count)', { count: 'exact' })
    .order('returned_at', { ascending: filters.sort === 'oldest' })
    .order('id');

  const groups: string[] = [];
  if (filters.branchId) {
    if (!isSaleId(filters.branchId)) throw new Error('Invalid return branch.');
    groups.push(`or(from_branch_id.eq.${filters.branchId},to_branch_id.eq.${filters.branchId})`);
  }
  if (filters.search?.trim()) {
    // Quote the entire pattern so punctuation cannot become PostgREST filter syntax.
    const pattern = JSON.stringify(`%${filters.search.trim().replace(/[\\%_]/g, '\\$&')}%`);
    groups.push(`or(return_number.ilike.${pattern},from_branch_name.ilike.${pattern},to_branch_name.ilike.${pattern})`);
  }
  if (groups.length) query = query.or(`and(${groups.join(',')})`);
  if (filters.status) {
    query = query.eq('status', filters.status);
  }
  if (filters.start) query = query.gte('returned_at', filters.start);
  if (filters.end) query = query.lt('returned_at', filters.end);

  query = query.range(page * pageSize, page * pageSize + pageSize - 1);

  const { data, error, count } = await query;
  // Receipt/status changes can remove the last page while a manager is viewing it.
  // An empty result with zero pages lets the UI return to page one rather than trapping it on an error.
  if (error?.code === 'PGRST103' && page > 0) return { rows: [], count: 0 };
  if (error) throw error;
  return { rows: (data ?? []) as (StockReturn & { items: [{ count: number }] })[], count: count ?? 0 };
}

/** Compatibility for the shared history pane, whose filters operate on the full list. */
export async function listReturns(filters: ReturnFilters = {}) {
  const rows: (StockReturn & { items: [{ count: number }] })[] = [];
  for (let page = 0; ; page++) {
    const result = await listReturnsPage(filters, page);
    rows.push(...result.rows);
    if (result.rows.length < 50 || rows.length >= result.count) return rows;
  }
}

export async function getReturn(id: string): Promise<StockReturnDetails> {
  const { data, error } = await supabase
    .from('stock_returns')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw error;

  const [itemsRes, discrepanciesRes] = await Promise.all([
    supabase
      .from('stock_return_items')
      .select('*')
      .eq('stock_return_id', id)
      .order('product_name'),
    supabase
      .from('return_discrepancies')
      .select('*, product:products(*)')
      .eq('stock_return_id', id)
      .order('created_at', { ascending: true }),
  ]);

  if (itemsRes.error) throw itemsRes.error;
  if (discrepanciesRes.error) throw discrepanciesRes.error;

  return {
    ...data,
    items: itemsRes.data ?? [],
    discrepancies: (discrepanciesRes.data as unknown as ReturnDiscrepancy[]) ?? [],
  };
}

export async function createStockReturn(request: import('@/types/returns').ReturnRequest): Promise<string> {
  const { data, error } = await supabase.rpc('create_stock_return', request);
  if (error) throw error;
  if (!isSaleId(data)) throw new Error('The return confirmation could not be verified. Retry the saved request.');
  return data;
}

export async function returnLeftoverStock(request: LeftoverReturnRequest): Promise<string> {
  const { data, error } = await supabase.rpc('return_leftover_stock', request);
  if (error) throw error;
  return data;
}

export async function receiveReturn(input: ReceiveReturnInput): Promise<ReturnStatus> {
  const { data, error } = await supabase.rpc('receive_stock_return', {
    p_return_id: input.returnId,
    p_items: input.items,
    p_notes: input.notes,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) throw error;
  return data as ReturnStatus;
}

export async function listReturnDiscrepancies(): Promise<ReturnDiscrepancy[]> {
  const { data, error } = await supabase
    .from('return_discrepancies')
    .select('*, product:products(*), stock_return:stock_returns(*)')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return data as unknown as ReturnDiscrepancy[];
}
