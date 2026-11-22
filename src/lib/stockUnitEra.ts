import { formatLiveStock, INVALID_QUANTITY_LABEL } from '@/lib/format';
import { labelStockQuantity, type StockUnitCode } from '@/lib/stockUnits';

/**
 * Egg Approach C′ era helpers.
 *
 * Before cutover, Egg stored whole eggs (stock_unit_code NULL): quantity 1 = 1 egg.
 * After cutover, Egg stores half-egg units: quantity 1 = 0.5 egg.
 * Never apply the live half_egg code to pre-cutover movement quantities.
 */

export type StockQuantityEra = 'pre_cutover' | 'post_cutover' | 'live' | 'unit_conversion';

function asTime(value: string | Date | null | undefined): number | null {
  if (value == null || value === '') return null;
  const t = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(t) ? t : null;
}

/** Live half_egg + cutover → pre-cutover rows use legacy whole-egg meaning (null code). */
export function stockUnitCodeAt(
  liveCode: StockUnitCode | null | undefined,
  occurredAt: string | Date | null | undefined,
  cutoverAt: string | Date | null | undefined,
): StockUnitCode | null | undefined {
  if (liveCode !== 'half_egg') return liveCode;
  const cutover = asTime(cutoverAt);
  if (cutover == null) return liveCode;
  const at = asTime(occurredAt);
  if (at == null) return liveCode;
  return at < cutover ? null : 'half_egg';
}

export function stockQuantityEra(
  liveCode: StockUnitCode | null | undefined,
  occurredAt: string | Date | null | undefined,
  cutoverAt: string | Date | null | undefined,
): StockQuantityEra {
  if (liveCode !== 'half_egg' || asTime(cutoverAt) == null) return 'live';
  const code = stockUnitCodeAt(liveCode, occurredAt, cutoverAt);
  return code === null ? 'pre_cutover' : 'post_cutover';
}

/** Pre-cutover Egg quantities are already whole eggs. */
function formatWholeEggs(quantity: number | string | null | undefined): string {
  if (quantity == null || quantity === '') return INVALID_QUANTITY_LABEL;
  const n = Number(quantity);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return INVALID_QUANTITY_LABEL;
  return `${n} ${Math.abs(n) === 1 ? 'egg' : 'eggs'}`;
}

function formatStoredHalfEggUnits(quantity: number | string | null | undefined): string {
  if (quantity == null || quantity === '') return INVALID_QUANTITY_LABEL;
  const n = Number(quantity);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return INVALID_QUANTITY_LABEL;
  return labelStockQuantity(`${n} pcs`, 'half_egg');
}

/**
 * Format a stored quantity using cutover era.
 * unit_conversion: show half-egg units explicitly (scale row, not a purchase/add).
 *
 * Pass cutoverKnown:false when egg_half_unit_cutover_at failed/pending so half_egg
 * rows are not silently converted to physical eggs (which mislabels pre-cutover history).
 */
export function formatEraStockQuantity(
  quantity: number | string | null | undefined,
  liveCode: StockUnitCode | null | undefined,
  options?: {
    occurredAt?: string | Date | null;
    cutoverAt?: string | Date | null;
    era?: StockQuantityEra;
    /** false = cutover metadata unavailable; default true when omitted. */
    cutoverKnown?: boolean;
  },
): string {
  if (liveCode === 'half_egg' && options?.cutoverKnown === false) {
    return formatStoredHalfEggUnits(quantity);
  }

  const era =
    options?.era ??
    stockQuantityEra(liveCode, options?.occurredAt ?? null, options?.cutoverAt ?? null);

  if (era === 'unit_conversion') {
    return formatStoredHalfEggUnits(quantity);
  }

  if (era === 'pre_cutover' && liveCode === 'half_egg') {
    return formatWholeEggs(quantity);
  }

  const code =
    era === 'post_cutover' || era === 'live'
      ? liveCode
      : stockUnitCodeAt(liveCode, options?.occurredAt, options?.cutoverAt);

  return formatLiveStock(quantity as number | string, undefined, code);
}

/** List-row meta for transfer/return discrepancy overviews. */
export function discrepancyQuantityMeta(args: {
  branchName: string;
  stockUnitCode?: StockUnitCode | null;
  leftQty: number;
  rightQty: number;
  leftVerb: 'Sent' | 'Returned';
  occurredAt: string;
  cutoverAt: string | null;
  cutoverKnown: boolean;
}): string {
  const opts = {
    occurredAt: args.occurredAt,
    cutoverAt: args.cutoverAt,
    cutoverKnown: args.cutoverKnown,
  };
  const left = formatEraStockQuantity(args.leftQty, args.stockUnitCode, opts);
  const right = formatEraStockQuantity(args.rightQty, args.stockUnitCode, opts);
  return `${args.branchName} · ${args.leftVerb} ${left} → Received ${right}`;
}

export function discrepancyDiffBadgeLabel(args: {
  difference: number;
  discrepancyType: 'missing' | 'excess';
  stockUnitCode?: StockUnitCode | null;
  occurredAt: string;
  cutoverAt: string | null;
  cutoverKnown: boolean;
}): string {
  const abs = Math.abs(Number(args.difference));
  const qty = formatEraStockQuantity(abs, args.stockUnitCode, {
    occurredAt: args.occurredAt,
    cutoverAt: args.cutoverAt,
    cutoverKnown: args.cutoverKnown,
  });
  return args.discrepancyType === 'missing' ? `${qty} missing` : `${qty} excess`;
}

/** Physical egg count for display math (never used for unit_conversion rows). */
export function physicalEggAmount(
  stored: number,
  era: Exclude<StockQuantityEra, 'unit_conversion'>,
  liveCode: StockUnitCode | null | undefined,
): number {
  if (liveCode !== 'half_egg') return stored;
  if (era === 'pre_cutover') return stored;
  return stored / 2;
}
