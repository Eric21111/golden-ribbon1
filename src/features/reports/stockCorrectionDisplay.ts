import { stockUnit, type StockUnitCode } from '@/lib/stockUnits';

/** Corrections come from the server 50 at a time. */
export const CORRECTIONS_PAGE_SIZE = 50;

export type CorrectionDirection = 'increase' | 'decrease' | 'none';

export function correctionChange(details: { before: number; after: number }): number {
  return Number(details.after) - Number(details.before);
}

export function correctionDirection(change: number): CorrectionDirection {
  return change > 0 ? 'increase' : change < 0 ? 'decrease' : 'none';
}

/** "+3", "−2" (a real minus sign), "0". */
export function formatCorrectionChange(change: number): string {
  return change > 0 ? `+${change}` : change < 0 ? `−${Math.abs(change)}` : '0';
}

/** "5 → 8 pcs" / "10 → 1 half-egg unit": the count the cashier replaced and the verified one, in the item's own unit. */
export function correctionQuantityLine(details: { before: number; after: number }, code: StockUnitCode | null | undefined): string {
  const unit = stockUnit(code);
  const after = Number(details.after);
  const label = unit ? (after === 1 ? unit.singular : unit.plural) : after === 1 ? 'pc' : 'pcs';
  return `${Number(details.before)} → ${after} ${label}`;
}

/**
 * The server returns a page of corrections without a total, so the pager only knows the pages it has seen plus one more when the
 * current page is full.
 */
export function correctionPageCount(page: number, rowsOnPage: number): number {
  return page + 1 + (rowsOnPage >= CORRECTIONS_PAGE_SIZE ? 1 : 0);
}

/** "Nov 11, 3:20 PM", in Manila time like every other report. */
export function formatCorrectionTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
