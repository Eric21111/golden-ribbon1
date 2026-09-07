import { supabase } from '@/lib/supabase';
import type {
  ReceiveReturnInput,
  ReturnDiscrepancy,
  ReturnRequest,
  ReturnStatus,
  StockReturn,
  StockReturnDetails,
} from '@/types/returns';

export interface ReturnFilters {
  branchId?: string;
  status?: ReturnStatus | '';
}

export async function listReturnStock() {
  const { data, error } = await supabase.rpc('list_return_inventory');
  if (error) throw error;
  return data;
}

export async function listReturns(filters: ReturnFilters = {}, page = 0) {
  let query = supabase
    .from('stock_returns')
    .select('*, items:stock_return_items(count)')
    .order('returned_at', { ascending: false })
    .order('id');

  if (filters.branchId) {
    query = query.or(`from_branch_id.eq.${filters.branchId},to_branch_id.eq.${filters.branchId}`);
  }
  if (filters.status) {
    query = query.eq('status', filters.status);
  }

  query = query.range(page * 50, page * 50 + 49);

  const { data, error } = await query;
  if (error) throw error;
  return data as (StockReturn & { items: [{ count: number }] })[];
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

export async function createReturn(request: ReturnRequest): Promise<string> {
  const { data, error } = await supabase.rpc('create_stock_return', request);
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
