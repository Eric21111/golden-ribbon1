import { formatLiveStock, formatMoney } from '@/lib/format';
import type {
  CashReconciliationResult,
  ShiftCloseReportProduct,
  ShiftProductReconResult,
} from '@/types/models';

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
