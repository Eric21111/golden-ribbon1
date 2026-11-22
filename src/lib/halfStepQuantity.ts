import { unitsPerWhole, type StockUnitCode } from '@/lib/stockUnits';

/**
 * Native half-step quantity helpers for Approach A (physical piece_stock).
 *
 * FRACTIONAL_STOCK_USES_ENABLED gates BOTH:
 * - product-wizard fractional recipe UI
 * - ops quantity inputs (transfer / return / waste / close / correction / opening)
 *
 * Keep false until every cashier/manager device runs this build and the owner
 * enables server fractional_piece_ops_enabled (and recipe saving when ready).
 * Display formatters still render 0.5 if a balance already exists.
 *
 * Server recipe saves also require inventory_feature_settings.
 * fractional_recipe_saving_enabled (owner-only, default false).
 */

/** Must stay false until fractional stock is deliberately activated. */
export const FRACTIONAL_STOCK_USES_ENABLED = true;

/** Ops / live piece_stock max (matches parse_inventory_quantity). */
export const PIECE_OPS_MAX = 999999;

export const RECIPE_QTY_MAX = 99;
export const RECIPE_QTY_MIN_INTEGER = 1;
export const RECIPE_QTY_MIN_HALF_STEP = 0.5;

export type RecipeQuantityMode = 'integer' | 'half_step';

export class StockUseValidationError extends Error {
  readonly code = 'invalid_stock_use_quantity';

  constructor(message: string) {
    super(message);
    this.name = 'StockUseValidationError';
  }
}

/**
 * Exact half-step check without coercing via numeric scale rounding.
 * 0.5 and 1 pass; 0.3 / 0.49 / 0.51 fail.
 */
export function isExactHalfStep(value: number): boolean {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  const scaled = value * 2;
  return Math.abs(scaled - Math.round(scaled)) < 1e-9;
}

/** Physical recipe quantity when fractional saving is enabled: 0.5 .. 99 in 0.5 steps. */
export function isValidHalfStepRecipeQuantity(value: number): boolean {
  if (!isExactHalfStep(value)) return false;
  return value >= RECIPE_QTY_MIN_HALF_STEP && value <= RECIPE_QTY_MAX;
}

/** Stored recipe quantity for today's integer path and for portion-coded products. */
export function isValidIntegerRecipeQuantity(value: number): boolean {
  return Number.isInteger(value) && value >= RECIPE_QTY_MIN_INTEGER && value <= RECIPE_QTY_MAX;
}

/**
 * Portion-coded products (half_egg / half_serving / quarter_serving) always use
 * integer internal units. Ordinary piece/null use half-steps only when the gate is on.
 */
export function recipeQuantityModeForStockUnit(
  stockUnitCode?: StockUnitCode | null,
  fractionalEnabled: boolean = FRACTIONAL_STOCK_USES_ENABLED,
): RecipeQuantityMode {
  if (unitsPerWhole(stockUnitCode)) return 'integer';
  return fractionalEnabled ? 'half_step' : 'integer';
}

export function isValidRecipeQuantity(
  value: number,
  stockUnitCode?: StockUnitCode | null,
  fractionalEnabled: boolean = FRACTIONAL_STOCK_USES_ENABLED,
): boolean {
  return recipeQuantityModeForStockUnit(stockUnitCode, fractionalEnabled) === 'half_step'
    ? isValidHalfStepRecipeQuantity(value)
    : isValidIntegerRecipeQuantity(value);
}

/** Payload-level check: gate off → integers only; gate on → half-steps (integers included). */
export function isValidStockUsePayloadQuantity(
  value: number,
  fractionalEnabled: boolean = FRACTIONAL_STOCK_USES_ENABLED,
): boolean {
  return fractionalEnabled ? isValidHalfStepRecipeQuantity(value) : isValidIntegerRecipeQuantity(value);
}

export function assertValidStockUsePayloadQuantity(
  value: number,
  fractionalEnabled: boolean = FRACTIONAL_STOCK_USES_ENABLED,
): void {
  if (isValidStockUsePayloadQuantity(value, fractionalEnabled)) return;
  if (fractionalEnabled) {
    throw new StockUseValidationError(
      `Quantity must be a half-step from ${RECIPE_QTY_MIN_HALF_STEP} to ${RECIPE_QTY_MAX} (got ${String(value)}).`,
    );
  }
  throw new StockUseValidationError(
    `Quantity must be a whole number from ${RECIPE_QTY_MIN_INTEGER} to ${RECIPE_QTY_MAX} (got ${String(value)}).`,
  );
}

export function recipeQuantityStep(mode: RecipeQuantityMode): number {
  return mode === 'half_step' ? RECIPE_QTY_MIN_HALF_STEP : RECIPE_QTY_MIN_INTEGER;
}

export function recipeQuantityMin(mode: RecipeQuantityMode): number {
  return mode === 'half_step' ? RECIPE_QTY_MIN_HALF_STEP : RECIPE_QTY_MIN_INTEGER;
}

/** Display value for the middle quantity field (no trailing .0). */
export function formatRecipeQuantityInput(value: number): string {
  if (!Number.isFinite(value) || value === 0) return '';
  return Number.isInteger(value) ? String(value) : String(value);
}

export type ParseRecipeQuantityResult =
  | { kind: 'empty' }
  | { kind: 'draft'; text: string }
  | { kind: 'ok'; value: number }
  | { kind: 'error'; message: string };

/**
 * Parse typed text for ordinary (non-portion) Stock Used quantities.
 * Portion-coded items keep portionsToUnits in the UI — do not route them here.
 */
export function parseOrdinaryRecipeQuantityText(
  text: string,
  mode: RecipeQuantityMode,
): ParseRecipeQuantityResult {
  if (text === '') return { kind: 'empty' };

  if (mode === 'integer') {
    if (!/^\d{0,2}$/.test(text)) {
      return {
        kind: 'error',
        message: 'Enter whole stock units. For half portions, use a half-unit stock item.',
      };
    }
    return { kind: 'ok', value: Number(text) };
  }

  if (!/^\d{0,2}(\.\d{0,2})?$/.test(text)) {
    return {
      kind: 'error',
      message: `Quantity must be a half-step from ${RECIPE_QTY_MIN_HALF_STEP} to ${RECIPE_QTY_MAX} (for example 0.5, 1, 1.5).`,
    };
  }
  if (text.endsWith('.')) return { kind: 'draft', text };
  const value = Number(text);
  if (!isValidHalfStepRecipeQuantity(value)) {
    return {
      kind: 'error',
      message: `Quantity must be a half-step from ${RECIPE_QTY_MIN_HALF_STEP} to ${RECIPE_QTY_MAX} (for example 0.5, 1, 1.5).`,
    };
  }
  return { kind: 'ok', value };
}

/** +/- for the existing stepper; clamps to mode min..max. */
export function nudgeRecipeQuantity(
  current: number,
  direction: 1 | -1,
  mode: RecipeQuantityMode,
): number {
  const step = recipeQuantityStep(mode);
  const min = recipeQuantityMin(mode);
  const next = Math.round((current + direction * step) * 2) / 2;
  return Math.max(min, Math.min(RECIPE_QTY_MAX, next));
}

/**
 * Ops screens (transfer / return / waste / close / correction / opening):
 * portion codes → integer internal units always.
 * Ordinary piece/null → 0.5 steps only when FRACTIONAL_STOCK_USES_ENABLED.
 */
export function pieceOpsStep(
  stockUnitCode?: StockUnitCode | null,
  fractionalOps: boolean = FRACTIONAL_STOCK_USES_ENABLED,
): number {
  if (unitsPerWhole(stockUnitCode) || !fractionalOps) return 1;
  return 0.5;
}

export function formatHalfStepDisplay(value: number): string {
  if (!Number.isFinite(value)) return '';
  return Number.isInteger(value) ? String(value) : String(value);
}

export function isValidPieceOpsQuantity(
  value: number,
  options?: {
    allowZero?: boolean;
    stockUnitCode?: StockUnitCode | null;
    fractionalOps?: boolean;
  },
): boolean {
  if (!Number.isFinite(value) || value > PIECE_OPS_MAX) return false;
  if (options?.allowZero ? value < 0 : value <= 0) return false;
  if (unitsPerWhole(options?.stockUnitCode)) return Number.isInteger(value);
  const fractionalOps = options?.fractionalOps ?? FRACTIONAL_STOCK_USES_ENABLED;
  return fractionalOps ? isExactHalfStep(value) : Number.isInteger(value);
}

/**
 * Typing filter for ops quantity boxes. Allows empty and drafts like "12.".
 * Portion-coded rows stay digits-only. Ordinary half-steps require the client gate.
 */
export function acceptsPieceOpsQuantityText(
  text: string,
  stockUnitCode?: StockUnitCode | null,
  fractionalOps: boolean = FRACTIONAL_STOCK_USES_ENABLED,
): boolean {
  if (text === '') return true;
  if (unitsPerWhole(stockUnitCode) || !fractionalOps) return /^\d{0,6}$/.test(text);
  if (!/^\d{0,6}(\.5?)?$/.test(text)) return false;
  if (text.endsWith('.')) return true;
  const n = Number(text);
  return Number.isFinite(n) && n <= PIECE_OPS_MAX && isExactHalfStep(n);
}

export function nudgePieceOpsQuantity(
  current: number,
  direction: 1 | -1,
  stockUnitCode?: StockUnitCode | null,
  min = 0,
  max = PIECE_OPS_MAX,
  fractionalOps: boolean = FRACTIONAL_STOCK_USES_ENABLED,
): number {
  const step = pieceOpsStep(stockUnitCode, fractionalOps);
  const next = Math.round((current + direction * step) * 2) / 2;
  return Math.max(min, Math.min(max, next));
}
