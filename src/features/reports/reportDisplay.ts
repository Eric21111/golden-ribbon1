import { formatDateShort, formatLiveStock, formatMoney } from '@/lib/format';
import type {
  CashReconciliationResult,
  ShiftCloseReportProduct,
  ShiftProductReconResult,
  ShiftRemittanceReport,
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

/**
 * How the GCash received compares with what was expected, in the same shape as the cash result: a shortage (received less) or an
 * excess (received more), both 0 for an exact match. Null while the GCash has not been remitted yet (actual is null).
 */
export function gcashResult(
  expected: number | string | null | undefined,
  actual: number | string | null | undefined,
): { shortage: number; excess: number } | null {
  if (expected == null || actual == null) return null;
  const difference = Math.round((Number(actual) - Number(expected)) * 100) / 100;
  if (!Number.isFinite(difference)) return null;
  return { shortage: difference < 0 ? -difference : 0, excess: difference > 0 ? difference : 0 };
}

export function formatPcsQty(quantity: number | null | undefined, code?: import('@/lib/stockUnits').StockUnitCode | null): string {
  if (quantity == null || !Number.isFinite(Number(quantity))) return '—';
  return formatLiveStock(quantity, undefined, code);
}

export function closesAsUnsold(product: ShiftCloseReportProduct): boolean {
  return product.closing_stock_behavior === 'record_as_unsold';
}

export function closingDispositionLabel(product: ShiftCloseReportProduct): string {
  if (closesAsUnsold(product)) {
    return `Unsold at close: ${formatPcsQty(product.unsold_quantity, product.stock_unit_code)}`;
  }
  return `Carried to next day: ${formatPcsQty(product.carried_quantity, product.stock_unit_code)}`;
}

export function closingDispositionQty(product: ShiftCloseReportProduct): number {
  return closesAsUnsold(product) ? Number(product.unsold_quantity) : Number(product.carried_quantity);
}

/** Display-only Cash/GCash totals from already-loaded remittance days. Null means nothing recorded. */
export function remittanceTenderTotals(report: ShiftRemittanceReport | undefined) {
  let cash: number | null = null;
  let gcash: number | null = null;
  let hasGcash = false;
  for (const day of report?.days ?? []) {
    if (day.expected_gcash != null) hasGcash = true;
    if (day.actual_remitted != null) cash = (cash ?? 0) + Number(day.actual_remitted);
    if (day.actual_gcash != null) gcash = (gcash ?? 0) + Number(day.actual_gcash);
  }
  return { cash, gcash, hasGcash };
}

export const NO_REMITTANCE_RECORDED = 'No remittance recorded';

/** Display label for a remitted amount. Null is a data gap — never shown as ₱0.00. */
export function remittanceAmountLabel(
  amount: number | null | undefined,
  state: 'ready' | 'loading' | 'error' = 'ready',
): string {
  if (state !== 'ready') return '—';
  if (amount == null) return NO_REMITTANCE_RECORDED;
  return formatMoney(amount);
}

/**
 * Summary KPI display only. Missing amounts render as ₱0.00; null vs 0 stays
 * distinct in remittanceTenderTotals and other callers.
 */
export function remittanceSummaryAmountLabel(
  amount: number | null | undefined,
  state: 'ready' | 'loading' | 'error' = 'ready',
): string {
  if (state !== 'ready') return '—';
  return formatMoney(amount ?? 0);
}

const KPI_COL_GAP = 10;
const COMPACT_H_PAD = 28;
/** Inter 700 at 26px is ~0.62em per glyph. Do not rely on Android font shrinking. */
const MIN_AMOUNT_CHAR_PX = 16;

/**
 * Compact 2-column KPIs only when both values stay fully readable on this width
 * at the full 26px figure size — no ellipsis, no aggressive shrink.
 */
export function shouldStackSummaryKpis(
  left: string,
  right: string,
  width: number,
  fontScale = 1,
): boolean {
  const usable = Math.max(0, width) / Math.max(fontScale, 1);
  const halfText = (usable - KPI_COL_GAP) / 2 - COMPACT_H_PAD;
  if (halfText < 48) return true;
  const maxChars = Math.floor(halfText / MIN_AMOUNT_CHAR_PX);
  return left.length > maxChars || right.length > maxChars;
}

/** @deprecated Use shouldStackSummaryKpis — same layout rule for remittance KPIs. */
export const shouldStackRemittanceKpis = shouldStackSummaryKpis;
