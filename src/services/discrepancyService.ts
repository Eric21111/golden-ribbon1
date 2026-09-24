import { supabase } from '@/lib/supabase';
import type { DiscrepancyResolutionReason, TransferDiscrepancy } from '@/types/models';
import type { ReturnDiscrepancy } from '@/types/returns';
import type { StockTransfer } from '@/types/models';

export type DiscrepancyKind = 'return' | 'transfer';

export async function getReturnDiscrepancy(id: string): Promise<ReturnDiscrepancy> {
  const { data, error } = await supabase
    .from('return_discrepancies')
    .select('*, product:products(*), stock_return:stock_returns(*)')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data as ReturnDiscrepancy;
}

export async function getTransferDiscrepancy(id: string): Promise<
  TransferDiscrepancy & {
    product?: { name: string; sku: string } | null;
    stock_transfer?:
      | (StockTransfer & { from_branch?: { name: string } | null; to_branch?: { name: string } | null })
      | null;
  }
> {
  const { data, error } = await supabase
    .from('transfer_discrepancies')
    .select('*, product:products(name, sku), stock_transfer:stock_transfers(*, from_branch:branches!stock_transfers_from_branch_id_fkey(name), to_branch:branches!stock_transfers_to_branch_id_fkey(name))')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data as TransferDiscrepancy & {
    product?: { name: string; sku: string } | null;
    stock_transfer?:
      | (StockTransfer & { from_branch?: { name: string } | null; to_branch?: { name: string } | null })
      | null;
  };
}

export async function resolveReturnDiscrepancy(
  id: string,
  reason: DiscrepancyResolutionReason,
  note: string | null,
) {
  const { data, error } = await supabase.rpc('resolve_return_discrepancy', {
    p_id: id,
    p_reason: reason,
    p_note: note,
  });
  if (error) throw error;
  return data;
}

export async function resolveTransferDiscrepancy(
  id: string,
  reason: DiscrepancyResolutionReason,
  note: string | null,
) {
  const { data, error } = await supabase.rpc('resolve_transfer_discrepancy', {
    p_id: id,
    p_reason: reason,
    p_note: note,
  });
  if (error) throw error;
  return data;
}

