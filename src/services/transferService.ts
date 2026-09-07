import { supabase } from '@/lib/supabase';
import type {
  ReceiveTransferInput,
  SendTransferInput,
  StockTransferDetails,
  StockTransferSummary,
  TransferStatus,
} from '@/types/models';

interface TransferFilters {
  branchId?: string;
  status?: TransferStatus | '';
}

export async function listTransfers(filters: TransferFilters = {}): Promise<StockTransferSummary[]> {
  let query = supabase
    .from('stock_transfers')
    .select('*, from_branch:branches!stock_transfers_from_branch_id_fkey(*), to_branch:branches!stock_transfers_to_branch_id_fkey(*), items:stock_transfer_items(id)')
    .order('created_at', { ascending: false })
    .limit(100);
  if (filters.branchId) query = query.eq('to_branch_id', filters.branchId);
  if (filters.status) query = query.eq('status', filters.status);
  const { data, error } = await query;
  if (error) throw error;
  return data as unknown as StockTransferSummary[];
}

export async function getTransfer(id: string): Promise<StockTransferDetails> {
  const { data, error } = await supabase
    .from('stock_transfers')
    .select('*, from_branch:branches!stock_transfers_from_branch_id_fkey(*), to_branch:branches!stock_transfers_to_branch_id_fkey(*), created_by_profile:profiles!stock_transfers_created_by_fkey(id, full_name), sent_by_profile:profiles!stock_transfers_sent_by_fkey(id, full_name), received_by_profile:profiles!stock_transfers_received_by_fkey(id, full_name), items:stock_transfer_items(*, product:products(*)), discrepancies:transfer_discrepancies(*, product:products(*))')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data as unknown as StockTransferDetails;
}

export async function sendTransfer(input: SendTransferInput): Promise<string> {
  const { data, error } = await supabase.rpc('send_stock_transfer', {
    p_to_branch_id: input.destinationBranchId,
    p_items: input.items,
    p_notes: input.notes,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) throw error;
  return data;
}

export async function receiveTransfer(input: ReceiveTransferInput): Promise<TransferStatus> {
  const { data, error } = await supabase.rpc('receive_stock_transfer', {
    p_transfer_id: input.transferId,
    p_items: input.items,
    p_notes: input.notes,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) throw error;
  return data;
}
