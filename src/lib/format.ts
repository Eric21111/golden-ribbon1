import type { InventoryMovementType, TransferStatus } from '@/types/models';
import type { ReturnStatus } from '@/types/returns';

export const formatMoney = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format;

export function formatDate(value: string | null): string {
  if (!value) return 'Pending';
  return new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export function formatTransferStatus(status: TransferStatus): string {
  return {
    draft: 'Draft',
    pending_receipt: 'Pending Receipt',
    received: 'Received',
    received_with_discrepancy: 'Received With Discrepancy',
    cancelled: 'Cancelled',
  }[status];
}

export function formatReturnStatus(status: ReturnStatus): string {
  return {
    draft: 'Draft',
    in_transit: 'In Transit',
    received: 'Received',
    received_with_discrepancy: 'Received With Discrepancy',
    cancelled: 'Cancelled',
  }[status];
}

export function formatMovementType(type: InventoryMovementType): string {
  return {
    opening_stock: 'Opening Stock',
    transfer_out: 'Transfer Out',
    transfer_in: 'Transfer In',
    adjustment: 'Adjustment',
    sale: 'Sale',
    return_out: 'Return Out',
    return_in: 'Return In',
  }[type];
}

export function makeIdempotencyKey(scope: string): string {
  return `${scope}-${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Converts a YYYY-MM-DD date string to start of day in Asia/Manila (UTC+8).
 * Example: '2026-09-01' -> '2026-09-01T00:00:00+08:00'
 */
export function toStartOfDayManila(dateStr: string): string | undefined {
  const trimmed = dateStr.trim();
  if (!trimmed) return undefined;
  const parts = trimmed.split('-');
  if (parts.length !== 3) return undefined;
  const [y, m, d] = parts.map(Number);
  if (!y || !m || !d || isNaN(y) || isNaN(m) || isNaN(d)) return undefined;
  return `${trimmed}T00:00:00+08:00`;
}

/**
 * Converts a YYYY-MM-DD date string to the start of the following day in Asia/Manila (UTC+8)
 * for half-open [start, end) interval filtering.
 * Example: '2026-09-06' -> '2026-09-07T00:00:00+08:00'
 */
export function toNextDayStartManila(dateStr: string): string | undefined {
  const trimmed = dateStr.trim();
  if (!trimmed) return undefined;
  const parts = trimmed.split('-');
  if (parts.length !== 3) return undefined;
  const [y, m, d] = parts.map(Number);
  if (!y || !m || !d || isNaN(y) || isNaN(m) || isNaN(d)) return undefined;
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const yy = next.getUTCFullYear();
  const mm = String(next.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(next.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}T00:00:00+08:00`;
}

/** Custom reports must not run until both exclusive-end bounds exist. Today / All Time always run. */
export function isReportRangeReady(
  rangeType: 'today' | 'custom' | 'all_time',
  startDate?: string,
  endDate?: string
): boolean {
  if (rangeType !== 'custom') return true;
  return Boolean(startDate && endDate);
}

