import { supabase } from '@/lib/supabase';
import { STOCK_UNITS, type StockUnitCode } from '@/lib/stockUnits';

/** Add immutable unit metadata to existing authorized query results, without changing quantities/names. */
export async function withStockUnits<T>(data: T): Promise<T> {
  const ids = new Set<string>();
  function visit(value: unknown, apply?: Map<string, StockUnitCode | null>) {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(v => visit(v, apply)); return; }
    const row = value as Record<string, unknown>;
    const id = typeof row.product_id === 'string' ? row.product_id
      : typeof row.id === 'string' && typeof row.sku === 'string' && typeof row.name === 'string' ? row.id : null;
    if (id) {
      ids.add(id);
      if (apply?.has(id)) row.stock_unit_code = apply.get(id);
    }
    Object.values(row).forEach(v => visit(v, apply));
  }
  visit(data);
  if (!ids.size) return data;
  const units = new Map<string, StockUnitCode | null>();
  const all = [...ids];
  for (let offset = 0; offset < all.length; offset += 500) {
    const { data: rows, error } = await supabase.rpc('get_stock_unit_codes', { p_product_ids: all.slice(offset, offset + 500) });
    // Do not display a portion quantity as pieces if metadata cannot be verified.
    if (error) throw error;
    for (const row of rows ?? []) {
      if (row.stock_unit_code !== null && !Object.hasOwn(STOCK_UNITS, row.stock_unit_code)) {
        throw new Error('The stock counting unit could not be verified. Refresh before continuing.');
      }
      units.set(row.product_id, row.stock_unit_code);
    }
  }
  if (all.some(id => !units.has(id))) throw new Error('A stock item could not be verified. Refresh before continuing.');
  visit(data, units);
  return data;
}
