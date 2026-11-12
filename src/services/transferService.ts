import { withStockUnits } from './stockUnitService';
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
  const transfers: StockTransferSummary[] = [];
  const pageSize = 100;
  let cursor: Pick<StockTransferSummary, 'created_at' | 'id'> | undefined;
  while (true) {
    let query = supabase
      .from('stock_transfers')
      .select('*, from_branch:branches!stock_transfers_from_branch_id_fkey(*), to_branch:branches!stock_transfers_to_branch_id_fkey(*), items:stock_transfer_items(id)')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false });
    if (filters.branchId) query = query.eq('to_branch_id', filters.branchId);
    if (filters.status) query = query.eq('status', filters.status);
    if (cursor) {
      query = query.or(`created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`);
    }
    const { data, error } = await query.limit(pageSize);
    if (error) throw error;
    const page = (data ?? []) as unknown as StockTransferSummary[];
    transfers.push(...page);
    if (page.length < pageSize) return transfers;
    cursor = page[page.length - 1];
  }
}

/** Exact count of transfers this branch sent that the receiving branch has not yet received. */
export async function countPendingOutgoingTransfers(fromBranchId: string): Promise<number> {
  const { count, error } = await supabase
    .from('stock_transfers')
    .select('id', { count: 'exact', head: true })
    .eq('from_branch_id', fromBranchId)
    .eq('status', 'pending_receipt');
  if (error) throw error;
  return count ?? 0;
}

async function readGetTransfer(id: string): Promise<StockTransferDetails> {
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

async function readListCashierPendingTransfers(): Promise<CashierPendingTransfer[]> {
  const { data, error } = await supabase.rpc('list_cashier_pending_transfers');
  if (error) throw error;
  return ((data ?? []) as CashierPendingTransfer[]).map((row) => ({
    ...row,
    items: (row.items ?? []).map((item) => ({
      ...item,
      stock_transfer_item_id: String(item.stock_transfer_item_id),
      quantity_sent: Number(item.quantity_sent),
    })),
  }));
}

export async function reportShipmentIssue(input: ReceiveTransferInput): Promise<TransferStatus> {
  const { data, error } = await supabase.rpc('report_shipment_issue', {
    p_transfer_id: input.transferId,
    p_items: input.items,
    p_notes: input.notes ?? '',
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) throw error;
  return data;
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

export async function getTransfer(...args: Parameters<typeof readGetTransfer>) {
  return withStockUnits(await readGetTransfer(...args));
}

export async function listCashierPendingTransfers(...args: Parameters<typeof readListCashierPendingTransfers>) {
  return withStockUnits(await readListCashierPendingTransfers(...args));
}
