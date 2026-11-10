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

export function labelStockQuantity(text: string, code?: StockUnitCode | null): string {
  const unit = stockUnit(code);
  return unit ? text.replace(/(-?\d+) pcs\b/g, (_, amount: string) => `${amount} ${Math.abs(Number(amount)) === 1 ? unit.singular : unit.plural}`) : text;
}
