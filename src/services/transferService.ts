import { supabase } from '@/lib/supabase';
import type {
  CashierPendingTransfer,
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

export async function listCashierPendingTransfers(): Promise<CashierPendingTransfer[]> {
  const { data, error } = await supabase.rpc('list_cashier_pending_transfers');
  if (error) throw error;
  return ((data ?? []) as CashierPendingTransfer[]).map((row) => ({
    ...row,
    items: (row.items ?? []).map((item) => ({ ...item, quantity_sent: Number(item.quantity_sent) })),
  }));
}

export async function confirmShipmentArrival(
  transferId: string,
  idempotencyKey: string,
): Promise<TransferStatus> {
  const id = String(transferId ?? '').trim();
  const key = String(idempotencyKey ?? '').trim();
  if (!id) throw new Error('Unable to load transfer.');
  if (key.length < 16 || key.length > 100) throw new Error('Invalid request key.');

  try {
    await supabase.auth.refreshSession();
  } catch {
    // keep existing session
  }

  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) throw new Error('Unauthorized: sign in required.');

  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anonKey) throw new Error('Supabase is not configured.');

  // Raw fetch so the exact PostgREST 400 body is visible in the console.
  const response = await fetch(`${url}/rest/v1/rpc/confirm_shipment_arrival`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      p_transfer_id: id,
      p_idempotency_key: key,
    }),
  });

  const rawText = await response.text();
  if (!response.ok) {
    let parsed: { message?: string; details?: string; hint?: string; code?: string } = {};
    try {
      parsed = JSON.parse(rawText) as typeof parsed;
    } catch {
      parsed = { message: rawText };
    }
    console.error('[confirm_shipment_arrival]', {
      status: response.status,
      transferId: id,
      keyLength: key.length,
      body: rawText,
    });
    throw Object.assign(new Error(parsed.message || `Confirm failed (${response.status})`), {
      details: parsed.details,
      hint: parsed.hint,
      code: parsed.code,
    });
  }

  const trimmed = rawText.trim();
  if (!trimmed) return 'received';
  try {
    return JSON.parse(trimmed) as TransferStatus;
  } catch {
    return trimmed.replace(/^"|"$/g, '') as TransferStatus;
  }
}
