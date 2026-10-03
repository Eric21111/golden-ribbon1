import { formatDateShort, formatLiveStock, formatMoney } from '@/lib/format';
import type {
  CashReconciliationResult,
  ShiftCloseReportProduct,
  ShiftProductReconResult,
} from '@/types/models';

const timeFormatter = new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit' });

/** A shift's day is already the section header above every row, so repeating the full date on
 * both ends of a same-day shift (as formatDateShort would) just makes the row wrap. Time-only
 * here, falling back to a dated label only when the shift actually spans into another day. */
export function formatShiftTimeRange(startedAt: string, endedAt: string | null) {
  const start = new Date(startedAt);
  const end = endedAt ? new Date(endedAt) : null;
  const sameDay = !end || start.toDateString() === end.toDateString();
  if (sameDay) {
    return `${timeFormatter.format(start)} – ${end ? timeFormatter.format(end) : 'In progress'}`;
  }
  return `${formatDateShort(startedAt)} – ${endedAt ? formatDateShort(endedAt) : 'In progress'}`;
}

/** Cash semantics from server: difference = expected - actual. */
export function formatRemittanceCashResult(
  status: 'pending' | 'reconciled',
  result: CashReconciliationResult | null,
  difference: number | null,
): string {
  if (status === 'pending') return 'Pending reconciliation';
  if (result === 'exact') return 'Exact';
  if (result == null || difference == null) return 'Reconciled';
  const magnitude = Math.abs(Number(difference));
  if (result === 'shortage') return `${formatMoney(magnitude)} shortage`;
  if (result === 'excess') return `${formatMoney(magnitude)} excess`;
  return 'Reconciled';
}

/** Inventory semantics from persisted result + |discrepancy| (actual - expected stored). */
export function formatPersistedInventoryResult(
  result: ShiftProductReconResult,
  discrepancy: number,
): string {
  if (result === 'exact') return 'Exact';
  const magnitude = Math.abs(Number(discrepancy));
  if (result === 'shortage') {
    return `${magnitude} pc${magnitude === 1 ? '' : 's'} shortage`;
  }
  return `${magnitude} pc${magnitude === 1 ? '' : 's'} excess`;
}

export function formatPcsQty(quantity: number | null | undefined): string {
  if (quantity == null || !Number.isFinite(Number(quantity))) return '—';
  return formatLiveStock(quantity);
}

export function closingDispositionLabel(product: ShiftCloseReportProduct): string {
  if (product.closing_stock_behavior === 'record_as_unsold') {
    return `Unsold at close: ${formatPcsQty(product.unsold_quantity)}`;
  }
  return `Carried to next day: ${formatPcsQty(product.carried_quantity)}`;
}
