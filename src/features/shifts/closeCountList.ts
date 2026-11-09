import { productSearchText } from '@/features/products/listFilters';
import { categoryOf, type CategoryFilter } from '@/features/products/productFilters';
import type { ShiftCloseProductPreview } from '@/types/models';

/**
 * Which products the End Shift / Pending Remittance count shows, in what order, and the "Use n" fill. Free of React so it can be
 * unit-tested. `settled` is the counts as of the last time an input lost focus: ordering and the Counted / Needs count filter use
 * it, so a card never jumps while its number is being typed.
 *
 * Nothing is hidden and nothing is counted for the cashier: every product is listed and every product needs a count. The products
 * that still have stock come first and the ones with no system stock sit in their own section underneath, so the real work is on top.
 */
export type CountFilter = 'all' | 'needs_count' | 'counted';
export type CountSort = 'needs_count' | 'name-asc' | 'name-desc' | 'stock-desc';
export type ProductCounts = Record<string, { actualRemaining: string; wasteQuantity: string }>;

export const isCounted = (counts: ProductCounts, productId: string) => Boolean(counts[productId]?.actualRemaining?.trim());

/** The system balance as the whole number it can be counted against (null when it is not a whole, non-negative piece count). */
export function systemPieces(product: Pick<ShiftCloseProductPreview, 'system_balance_before_waste'>): number | null {
  const value = Number(product.system_balance_before_waste);
  return Number.isInteger(value) && value >= 0 ? value : null;
}

/** No stock in the system for this shift. (A fractional or negative balance is NOT empty: it is stock to count.) */
export const hasNoSystemStock = (product: Pick<ShiftCloseProductPreview, 'system_balance_before_waste'>) => Number(product.system_balance_before_waste) === 0;

/** Every product starts blank: each one has to be counted. */
export function initialCounts(products: ShiftCloseProductPreview[]): ProductCounts {
  return Object.fromEntries(products.map((product) => [product.product_id, { actualRemaining: '', wasteQuantity: '0' }]));
}

export function visibleCountProducts(input: {
  products: ShiftCloseProductPreview[];
  settled: ProductCounts;
  search: string;
  countFilter: CountFilter;
  category: CategoryFilter;
  sort: CountSort;
  /** product id -> saved category (null/undefined until it is known). */
  categories: Map<string, string | null | undefined> | undefined;
}): ShiftCloseProductPreview[] {
  const { products, settled, countFilter, category, sort, categories } = input;
  const term = input.search.trim().toLowerCase();
  const categoryOfProduct = (product: ShiftCloseProductPreview) => categories?.get(product.product_id) ?? null;
  const matching = products.filter((product) => {
    const counted = isCounted(settled, product.product_id);
    if (countFilter === 'needs_count' && counted) return false;
    if (countFilter === 'counted' && !counted) return false;
    if (category !== 'all' && categoryOf({ is_active: true, product_category: categoryOfProduct(product) }) !== category) return false;
    if (!term) return true;
    return productSearchText({
      is_active: true,
      product_category: categoryOfProduct(product),
      name: product.product_name_snapshot,
      sku: product.sku_snapshot ?? '',
    }).includes(term);
  });
  const byName = (a: ShiftCloseProductPreview, b: ShiftCloseProductPreview) => a.product_name_snapshot.localeCompare(b.product_name_snapshot);
  // one flat list: the products with stock, then the ones without; the chosen order inside each of the two
  return [...matching].sort((a, b) => {
    const aEmpty = hasNoSystemStock(a) ? 1 : 0;
    const bEmpty = hasNoSystemStock(b) ? 1 : 0;
    if (aEmpty !== bEmpty) return aEmpty - bEmpty;
    if (sort === 'name-desc') return byName(b, a);
    if (sort === 'name-asc') return byName(a, b);
    if (sort === 'needs_count') {
      const aCounted = isCounted(settled, a.product_id) ? 1 : 0;
      const bCounted = isCounted(settled, b.product_id) ? 1 : 0;
      if (aCounted !== bCounted) return aCounted - bCounted;
      return byName(a, b);
    }
    return Number(b.system_balance_before_waste) - Number(a.system_balance_before_waste) || byName(a, b);
  });
}

/** The two sections of the list (the input order is kept inside each). */
export function splitByStock(shown: ShiftCloseProductPreview[]): { withStock: ShiftCloseProductPreview[]; noStock: ShiftCloseProductPreview[] } {
  return { withStock: shown.filter((product) => !hasNoSystemStock(product)), noStock: shown.filter(hasNoSystemStock) };
}

/** The products (of a section) that are not counted yet and have a whole-piece system balance to copy. */
export function fillableProducts(shown: ShiftCloseProductPreview[], counts: ProductCounts): ShiftCloseProductPreview[] {
  return shown.filter((product) => !isCounted(counts, product.product_id) && systemPieces(product) != null);
}

/** Remaining := the system stock for each given product; Waste is left exactly as it is. Returns a new object. */
export function fillWithSystem(counts: ProductCounts, products: ShiftCloseProductPreview[]): ProductCounts {
  const next = { ...counts };
  for (const product of products) {
    const system = systemPieces(product);
    if (system == null) continue;
    next[product.product_id] = { actualRemaining: String(system), wasteQuantity: next[product.product_id]?.wasteQuantity ?? '0' };
  }
  return next;
}

/** The status line under the progress bar. */
export function closeProgressText(input: { total: number; counted: number; cashEntered: boolean }): string {
  if (input.total > 0 && input.counted < input.total) return `${input.counted} of ${input.total} counted`;
  if (!input.cashEntered) return input.total > 0 ? 'All counted · enter the cash' : 'Enter the cash you counted';
  return 'Ready to complete';
}
