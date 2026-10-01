import { formatMoney } from '@/lib/format';
import type {
  CashReconciliationResult,
  ShiftCloseProductPreview,
  ShiftCloseProductSummary,
  ShiftCloseResult,
  ShiftProductReconResult,
} from '@/types/models';

/** Whole PCS including 0. Blank is invalid (not coerced to zero). */
export function isValidClosePieceQuantity(raw: string): boolean {
  const text = raw.trim();
  if (!text) return false;
  if (!/^\d{1,6}$/.test(text)) return false;
  return Number(text) >= 0;
}

export function parseClosePieceQuantity(raw: string): number | null {
  if (!isValidClosePieceQuantity(raw)) return null;
  return Number(raw.trim());
}

/** expected_remaining = system_stock - waste (may be negative; never clamped). */
export function expectedRemainingBeforeActual(systemStock: number, wasteRaw: string): number | null {
  const waste = parseClosePieceQuantity(wasteRaw.trim() === '' ? '0' : wasteRaw);
  if (waste == null) return null;
  return Number(systemStock) - waste;
}

/**
 * Display-only inventory result. Blank actual → incomplete (null).
 * Semantic: Exact / shortage / excess from expected vs actual (not raw DB sign).
 */
export function previewInventoryResult(
  systemStock: number,
  actualRaw: string,
  wasteRaw: string,
): { expectedRemaining: number; result: ShiftProductReconResult; magnitude: number } | null {
  const actualText = actualRaw.trim();
  if (!actualText) return null;
  const actual = parseClosePieceQuantity(actualText);
  const expected = expectedRemainingBeforeActual(systemStock, wasteRaw);
  if (actual == null || expected == null) return null;
  const magnitude = Math.abs(actual - expected);
  if (actual === expected) return { expectedRemaining: expected, result: 'exact', magnitude: 0 };
  if (actual < expected) return { expectedRemaining: expected, result: 'shortage', magnitude };
  return { expectedRemaining: expected, result: 'excess', magnitude };
}

export function formatInventoryResultLabel(
  preview: { result: ShiftProductReconResult; magnitude: number } | null,
): string {
  if (!preview) return '—';
  if (preview.result === 'exact') return 'Exact';
  if (preview.result === 'shortage') {
    return `${preview.magnitude} pc${preview.magnitude === 1 ? '' : 's'} shortage`;
  }
  return `${preview.magnitude} pc${preview.magnitude === 1 ? '' : 's'} excess`;
}

/** Hide confusing negative expected remaining; still compute semantic result. */
export function formatExpectedRemainingLabel(expectedRemaining: number | null, hasActual: boolean): string {
  if (!hasActual || expectedRemaining == null) return '—';
  if (expectedRemaining < 0) return 'See inventory result';
  return `${expectedRemaining} pc${expectedRemaining === 1 ? '' : 's'}`;
}

export function formatCashResultLabel(
  expected: number,
  actualRaw: string,
  result: CashReconciliationResult | null,
): string {
  if (!actualRaw.trim() || result == null) return '—';
  if (result === 'exact') return 'Exact';
  const actual = Number(actualRaw.trim());
  if (!Number.isFinite(actual)) return '—';
  const magnitude = Math.abs(Math.round((expected - actual) * 100) / 100);
  if (result === 'shortage') return `${formatMoney(magnitude)} shortage`;
  return `${formatMoney(magnitude)} excess`;
}

export function formatCloseSuccessSummary(result: ShiftCloseResult): string {
  const cash =
    result.result === 'exact'
      ? 'Cash: Exact'
      : result.result === 'shortage'
        ? `Cash: ${formatMoney(Math.abs(Number(result.difference)))} shortage`
        : `Cash: ${formatMoney(Math.abs(Number(result.difference)))} excess`;

  const products = result.products ?? [];
  if (products.length === 0) {
    return `End Shift Complete\n\n${cash}`;
  }

  let exact = 0;
  let shortage = 0;
  let excess = 0;
  for (const row of products as ShiftCloseProductSummary[]) {
    if (row.result === 'exact') exact += 1;
    else if (row.result === 'shortage') shortage += 1;
    else excess += 1;
  }

  return [
    'End Shift Complete',
    '',
    cash,
    '',
    'Inventory:',
    `${exact} exact`,
    `${shortage} shortage`,
    `${excess} excess`,
  ].join('\n');
}

export function incompleteProductCount(
  products: ShiftCloseProductPreview[],
  counts: Record<string, { actualRemaining: string }>,
): number {
  return products.filter((p) => !counts[p.product_id]?.actualRemaining?.trim()).length;
}

export const ACTUAL_REMAINING_HELPER =
  'Count usable items left at the booth. Do not include waste.';

export const WASTE_HELPER = 'Damaged, spoiled, dropped, broken, or otherwise unusable pieces.';

export const BEGIN_CLOSE_CONFIRM_MESSAGE =
  'Once you start End Shift:\n' +
  '- Sales and stock transactions for this booth will stop for today\n' +
  '- You will need to count remaining stock and cash before finishing\n\n' +
  "You cannot reopen today's selling session after this starts.";

export const FINALIZE_CONFIRM_MESSAGE =
  "This will finalize today's cash and inventory counts.\n" +
  'You will not be able to change this closing record afterward.';

export function isNetworkishError(error: unknown): boolean {
  const message =
    typeof error === 'object' && error && 'message' in error
      ? String((error as { message: unknown }).message).toLowerCase()
      : String(error ?? '').toLowerCase();
  return (
    message.includes('network')
    || message.includes('fetch')
    || message.includes('timeout')
    || message.includes('timed out')
    || message.includes('failed to fetch')
    || message.includes('abort')
  );
}
