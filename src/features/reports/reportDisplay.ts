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
/** Horizontal padding of a compact tile (14 + 14) and of a regular square tile (20 + 20). */
export const COMPACT_H_PAD = 28;
export const SQUARE_H_PAD = 40;
/** The figure size of a stat tile (StatTile `value`). */
const FIGURE_SIZE = 26;
/**
 * A figure may shrink only a little (4%) before its tile stacks. Shrinking is a safety net, not a layout tool: Android does not
 * always apply it, so a figure that does not fit at (nearly) full size gets a full-width tile instead.
 */
const MAX_FIGURE_SHRINK = 0.96;

/**
 * Width in px of a figure such as "₱1,234,567.89" in Inter 700 at `size`. Per-glyph advances come from the app's font
 * (digits are 0.43–0.68em, so the widest digit is used; "," and "." are 0.33em); the ₱ is drawn in the system font at
 * about a digit's width. No kerning, so it is an estimate that errs on the wide side.
 */
export function estimateFigureWidth(text: string, size = FIGURE_SIZE): number {
  let em = 0;
  for (const char of text) {
    if (/\d/.test(char) || char === '₱') em += 0.66;
    else if (char === ',' || char === '.') em += 0.34;
    else if (char === '-') em += 0.47;
    else if (char === ' ') em += 0.24;
    else em += 0.62;
  }
  return em * size;
}

/**
 * A tile's big figure scales with the system font only up to this much (it is already 26px): at 2× it would be 52px and
 * no phone has room for a seven-figure amount at that size. Labels and captions still scale all the way.
 */
export const FIGURE_MAX_FONT_SCALE = 1.3;
/** The label under a figure (StatTile `label`): Inter 500 at 13px. */
const LABEL_SIZE = 13;

/** Does the figure fit `available` px at (nearly) full size at this system font scale? */
export function figureFits(text: string, available: number, fontScale = 1): boolean {
  const figureScale = Math.min(Math.max(fontScale, 1), FIGURE_MAX_FONT_SCALE);
  return estimateFigureWidth(text) * figureScale * MAX_FIGURE_SHRINK <= available;
}

/** Width in px of the longest word in `text` at `size` (a word cannot wrap, so it must fit the tile on its own). */
export function longestWordWidth(text: string, size = LABEL_SIZE): number {
  const longest = text.split(/\s+/).reduce((max, word) => Math.max(max, word.length), 0);
  return longest * 0.6 * size;
}

/**
 * Same rule as shouldStackSummaryKpis, plus the labels: two stat tiles share a row only when both figures fit their half at
 * (nearly) full size and the longest word of each label fits too, at the system font scale. Figures stop growing at
 * FIGURE_MAX_FONT_SCALE; labels do not. `right` may be missing (an odd tile out).
 */
export function shouldStackStatTiles({
  left,
  right,
  width,
  fontScale = 1,
  hPad = COMPACT_H_PAD,
}: {
  left: { value: string; label?: string };
  right?: { value: string; label?: string };
  width: number;
  fontScale?: number;
  hPad?: number;
}): boolean {
  const halfText = (Math.max(0, width) - KPI_COL_GAP) / 2 - hPad;
  if (halfText < 48) return true;
  const scale = Math.max(fontScale, 1);
  return [left, right].some(
    (tile) =>
      tile !== undefined &&
      (!figureFits(tile.value, halfText, scale) || (tile.label !== undefined && longestWordWidth(tile.label) * scale > halfText)),
  );
}

/**
 * Compact 2-column KPIs only when both values stay fully readable on this width
 * at the full 26px figure size (a figure may shrink at most 4%) — no ellipsis, no aggressive shrink.
 * `hPad` is the tile's own left + right padding (compact by default).
 */
export function shouldStackSummaryKpis(
  left: string,
  right: string,
  width: number,
  fontScale = 1,
  hPad = COMPACT_H_PAD,
): boolean {
  const usable = Math.max(0, width) / Math.max(fontScale, 1);
  const halfText = (usable - KPI_COL_GAP) / 2 - hPad;
  if (halfText < 48) return true;
  return estimateFigureWidth(left) * MAX_FIGURE_SHRINK > halfText || estimateFigureWidth(right) * MAX_FIGURE_SHRINK > halfText;
}

/** @deprecated Use shouldStackSummaryKpis — same layout rule for remittance KPIs. */
export const shouldStackRemittanceKpis = shouldStackSummaryKpis;
