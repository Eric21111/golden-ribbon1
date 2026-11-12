export type StockUnitCode = 'piece' | 'half_egg' | 'half_serving' | 'quarter_serving';

export const STOCK_UNITS = {
  piece: { singular: 'pc', plural: 'pcs', hint: '1 unit = 1 piece' },
  half_egg: { singular: 'half-egg unit', plural: 'half-egg units', hint: '2 units = 1 whole egg. Enter 60 units for 30 eggs.' },
  half_serving: { singular: 'half-serving unit', plural: 'half-serving units', hint: '2 units = 1 full serving. Confirm the serving size before use.' },
  quarter_serving: { singular: 'quarter-serving unit', plural: 'quarter-serving units', hint: '4 units = 1 full serving. Confirm the serving size before use.' },
} as const;

export function stockUnit(code?: StockUnitCode | null) {
  return code ? STOCK_UNITS[code] : null;
}

/**
 * Portion units are whole fractions of one physical item. The database only ever stores the whole-number count of
 * these units (product_stock_uses.quantity is an integer 1..99); a "portion" such as 0.5 egg exists only on screen.
 */
const PORTION_UNITS = {
  half_egg: { perWhole: 2, whole: 'whole egg' },
  half_serving: { perWhole: 2, whole: 'full serving' },
  quarter_serving: { perWhole: 4, whole: 'full serving' },
} as const;

/** How many stored units make one whole physical item, or null for pieces and legacy stock (no portion display). */
export function unitsPerWhole(code?: StockUnitCode | null): number | null {
  return code && code in PORTION_UNITS ? PORTION_UNITS[code as keyof typeof PORTION_UNITS].perWhole : null;
}

/** "2 units = 1 whole egg" (null for pieces and legacy stock). */
export function portionRatioNote(code?: StockUnitCode | null): string | null {
  const per = unitsPerWhole(code);
  return per && code ? `${per} units = 1 ${PORTION_UNITS[code as keyof typeof PORTION_UNITS].whole}` : null;
}

/** Stored units -> physical portions (1 half-egg unit -> 0.5). Only meaningful when unitsPerWhole(code) is set. */
export function unitsToPortions(units: number, code?: StockUnitCode | null): number {
  const per = unitsPerWhole(code);
  return per ? units / per : units;
}

/**
 * Physical portions -> stored whole units, or null when the amount is not an exact whole number of units (0.3 egg,
 * for example), is not finite, or is outside the saved range 1..99. Nothing is ever rounded.
 */
export function portionsToUnits(portions: number, code?: StockUnitCode | null): number | null {
  const per = unitsPerWhole(code);
  if (!per || !Number.isFinite(portions)) return null;
  const units = portions * per;
  return Number.isInteger(units) && units >= 1 && units <= 99 ? units : null;
}

/** 0.5, 1, 1.5, 0.25 (never "0.50" or "1.0"). */
export function formatPortions(portions: number): string {
  return String(Number(portions.toFixed(2)));
}

export type PortionChoice = { units: number; portions: number; label: string };

/**
 * The amounts offered in the picker: every exact step from one stored unit up to `maxUnits`, plus the saved amount
 * when it is larger, so an existing line is never hidden or changed just by opening the list.
 */
export function portionChoices(code: StockUnitCode | null | undefined, current: number, maxUnits = 24): PortionChoice[] {
  if (!unitsPerWhole(code)) return [];
  const top = Math.max(maxUnits, Number.isInteger(current) && current <= 99 ? current : 0);
  const choices: PortionChoice[] = [];
  for (let units = 1; units <= top; units++) {
    if (units > maxUnits && units !== current) continue;
    const portions = unitsToPortions(units, code);
    choices.push({ units, portions, label: formatPortions(portions) });
  }
  return choices;
}

export function labelStockQuantity(text: string, code?: StockUnitCode | null): string {
  const unit = stockUnit(code);
  return unit ? text.replace(/(-?\d+) pcs\b/g, (_, amount: string) => `${amount} ${Math.abs(Number(amount)) === 1 ? unit.singular : unit.plural}`) : text;
}
