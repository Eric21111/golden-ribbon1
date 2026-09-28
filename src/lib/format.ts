import type { CashReconciliationResult, InventoryMode, InventoryMovementType, TransferStatus } from '@/types/models';
import type { ReturnStatus } from '@/types/returns';

export const formatMoney = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format;

export const INVALID_QUANTITY_LABEL = 'Invalid quantity';
/** Fits 999999.999, matching parse_inventory_quantity. Do not use 6. */
export const KG_QUANTITY_MAX_LENGTH = 10;
export const PIECE_QUANTITY_MAX_LENGTH = 6;

export function inventoryModeLabel(mode: InventoryMode | null | undefined): string {
  return mode === 'kg_meal' ? 'KG-delivered meal' : 'Piece-based stock';
}

function formatPieceQuantity(quantity: number | string | null | undefined): string {
  if (quantity == null || quantity === '') return INVALID_QUANTITY_LABEL;
  const n = Number(quantity);
  // Integer-equivalent only: 24, "24", "24.000" → 24 pcs. Do not trunc/round 24.500.
  if (!Number.isFinite(n) || !Number.isInteger(n)) return INVALID_QUANTITY_LABEL;
  return `${n} pcs`;
}

/** Selling branches do not track KG on-hand. Live KG there is never 0 kg / Out of stock. */
export function formatSellingBranchOnHand(
  quantity: number | string,
  mode: InventoryMode | null | undefined,
): string {
  if (isKgMeal(mode)) return 'Not tracked';
  return formatLiveStock(quantity, mode);
}

export function formatInventoryQuantity(
  value: number | string | null | undefined,
  mode: InventoryMode | null | undefined,
): string {
  if (mode === 'kg_meal') {
    if (value == null || value === '') return 'Unmeasured';
    const n = Number(value);
    if (!Number.isFinite(n)) return INVALID_QUANTITY_LABEL;
    return `${n.toFixed(3)} kg`;
  }
  return formatPieceQuantity(value);
}

export function formatLiveStock(quantity: number | string, mode: InventoryMode | null | undefined): string {
  if (mode === 'kg_meal') {
    const n = Number(quantity);
    if (!Number.isFinite(n)) return INVALID_QUANTITY_LABEL;
    return `${n.toFixed(3)} kg`;
  }
  return formatPieceQuantity(quantity);
}

/** Null KG received weight is unmeasured. It is never shown as 0 kg. */
export function formatSnapshottedQuantity(
  quantity: number | string | null | undefined,
  mode: InventoryMode | null | undefined,
): string {
  if (mode === 'kg_meal') {
    if (quantity == null || quantity === '') return 'Unmeasured';
    const n = Number(quantity);
    if (!Number.isFinite(n)) return INVALID_QUANTITY_LABEL;
    return `${n.toFixed(3)} kg`;
  }
  if (quantity == null || quantity === '') return formatPieceQuantity(0);
  return formatPieceQuantity(quantity);
}

export function formatTransferReceivedQuantity(
  status: TransferStatus,
  quantityReceived: number | string | null | undefined,
  mode: InventoryMode | null | undefined,
): string {
  if (status === 'cancelled') return formatTransferStatus(status);
  if (status === 'draft' || status === 'pending_receipt') return 'Pending';
  if (status === 'received' || status === 'received_with_discrepancy') {
    if (isKgMeal(mode) && (quantityReceived == null || quantityReceived === '')) return 'Unmeasured';
    return formatSnapshottedQuantity(quantityReceived, mode);
  }
  return 'Pending';
}

export function formatTransferLineSummary(
  status: TransferStatus,
  quantitySent: number | string,
  quantityReceived: number | string | null | undefined,
  mode: InventoryMode | null | undefined,
): string {
  return `Sent ${formatSnapshottedQuantity(quantitySent, mode)} · Received ${formatTransferReceivedQuantity(status, quantityReceived, mode)}`;
}

export function formatTransferDifference(
  status: TransferStatus,
  quantitySent: number | string,
  quantityReceived: number | string | null | undefined,
  mode: InventoryMode | null | undefined,
): string {
  if (status === 'cancelled') return formatTransferStatus(status);
  if (status === 'draft' || status === 'pending_receipt') return 'Pending';
  if (status === 'received' || status === 'received_with_discrepancy') {
    if (isKgMeal(mode)) return 'Unmeasured';
    if (quantityReceived == null || quantityReceived === '') return 'Pending';
    const sent = Number(quantitySent);
    const received = Number(quantityReceived);
    if (!Number.isFinite(sent) || !Number.isFinite(received)) return INVALID_QUANTITY_LABEL;
    return formatSnapshottedQuantity(sent - received, mode);
  }
  return 'Pending';
}

export function isKgMeal(mode: InventoryMode | null | undefined): boolean {
  return mode === 'kg_meal';
}

const PIECE_QTY = /^\d{1,6}$/;
const KG_QTY = /^\d{1,6}(\.\d{1,3})?$/;

export function isValidInventoryQuantity(raw: string, mode: InventoryMode | null | undefined): boolean {
  const text = raw.trim();
  if (!text || Number(text) <= 0) return false;
  return mode === 'kg_meal' ? KG_QTY.test(text) : PIECE_QTY.test(text);
}

export function previewCashResult(expected: number, actualRaw: string): CashReconciliationResult | null {
  const text = actualRaw.trim();
  if (!/^[0-9]+(\.[0-9]{1,2})?$/.test(text)) return null;
  const actual = Number(text);
  if (!Number.isFinite(actual) || actual > 9999999999.99) return null;
  const difference = Math.round((expected - actual) * 100) / 100;
  if (difference === 0) return 'exact';
  if (difference > 0) return 'shortage';
  return 'excess';
}

/** Catalog RPC prices must be plain decimal text with at most two places. */
export function formatCatalogPrice(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '0.00';
  return (Math.round(value * 100) / 100).toFixed(2);
}

/** First letter of first and last name, e.g. "Alshaik Reyes" → "AR". Falls back to the first 1-2 letters for a single-word name. */
export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0] + parts[parts.length - 1]![0]).toUpperCase();
}

export function formatDate(value: string | null): string {
  if (!value) return 'Pending';
  return new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

/** YYYY-MM-DD (Manila business date) without a clock time. */
export function formatManilaDate(dateStr: string): string {
  const parts = dateStr.trim().split('-');
  if (parts.length !== 3) return dateStr;
  const [y, m, d] = parts.map(Number);
  if (!y || !m || !d) return dateStr;
  return new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium' }).format(new Date(Date.UTC(y, m - 1, d, 12)));
}

/** Compact date + time for tight list-row meta text — drops the year to avoid wrapping next to a badge. */
export function formatDateShort(value: string | null): string {
  if (!value) return 'Pending';
  return new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(
    new Date(value),
  );
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

/** Today's calendar date in Asia/Manila (UTC+8), as Y/M/D — no timezone database needed since PH has no DST. */
function manilaTodayParts(): { y: number; m: number; d: number } {
  const shifted = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return { y: shifted.getUTCFullYear(), m: shifted.getUTCMonth() + 1, d: shifted.getUTCDate() };
}

function dateString(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * "This week so far" in Asia/Manila: from the most recent Monday 00:00 through the end of
 * today (mirrors how "Today" already runs through end-of-day rather than the exact instant).
 */
export function getThisWeekRangeManila(): { start: string; end: string } {
  const { y, m, d } = manilaTodayParts();
  const today = new Date(Date.UTC(y, m - 1, d));
  const daysSinceMonday = (today.getUTCDay() + 6) % 7;
  const monday = new Date(Date.UTC(y, m - 1, d - daysSinceMonday));
  const start = toStartOfDayManila(dateString(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate()))!;
  const end = toNextDayStartManila(dateString(y, m, d))!;
  return { start, end };
}

/** Today's calendar day in Asia/Manila: 00:00 through the start of tomorrow. */
export function getTodayRangeManila(): { start: string; end: string } {
  const { y, m, d } = manilaTodayParts();
  return {
    start: toStartOfDayManila(dateString(y, m, d))!,
    end: toNextDayStartManila(dateString(y, m, d))!,
  };
}

/** "This month so far" in Asia/Manila: from the 1st 00:00 through the end of today. */
export function getThisMonthRangeManila(): { start: string; end: string } {
  const { y, m, d } = manilaTodayParts();
  const start = toStartOfDayManila(dateString(y, m, 1))!;
  const end = toNextDayStartManila(dateString(y, m, d))!;
  return { start, end };
}

