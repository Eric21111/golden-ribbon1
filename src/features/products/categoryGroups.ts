import { categoryOf, type FilterableProduct } from './productFilters';
import { PRODUCT_CATEGORIES } from './productCategoryPreview';

/**
 * Lists of products grouped by category (Products, Main Inventory, the cashier POS): a fixed order (the order of the categories
 * in the wizard, then "Not set"), the screen's own sort kept inside each group, and a heading in front of each group.
 * Free of React so it can be unit-tested. `productOf` reads the product out of a list item (a stock row holds its product).
 */
export type GroupKey = ReturnType<typeof categoryOf>;

export const GROUP_ORDER: GroupKey[] = [...PRODUCT_CATEGORIES.map((category) => category.id as GroupKey), 'unset'];

const rankOf = (key: GroupKey) => GROUP_ORDER.indexOf(key);
const itself = <T>(item: T) => item as unknown as FilterableProduct;

/** Items in group order. The order they came in (the chosen sort) is kept inside each group. */
export function groupByCategory<T>(items: T[], productOf: (item: T) => FilterableProduct = itself): T[] {
  return items
    .map((item, index) => ({ item, index, rank: rankOf(categoryOf(productOf(item))) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.item);
}

/** How many items each group has in the whole (filtered) list, not just on the page being shown. */
export function groupCounts<T>(items: T[], productOf: (item: T) => FilterableProduct = itself): Partial<Record<GroupKey, number>> {
  const counts: Partial<Record<GroupKey, number>> = {};
  for (const item of items) {
    const key = categoryOf(productOf(item));
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

export function groupTitle(key: GroupKey): string {
  return key === 'unset' ? 'Not set' : PRODUCT_CATEGORIES.find((category) => category.id === key)?.label ?? 'Not set';
}

export type ListRow<T> =
  | { type: 'header'; key: string; group: GroupKey; title: string; count: number }
  | { type: 'product'; key: string; item: T };

/**
 * The rows of one page: a heading before the first item of each group. A group that continues from the previous page gets its
 * heading again at the top, so a page never starts in the middle of nowhere. With `showHeadings` false (one category is
 * picked, so the heading would be the same everywhere) there are no headings.
 */
export function buildListRows<T>(
  pageItems: T[],
  counts: Partial<Record<GroupKey, number>>,
  showHeadings: boolean,
  productOf: (item: T) => FilterableProduct & { id: string } = itself as (item: T) => FilterableProduct & { id: string },
): Array<ListRow<T>> {
  const rows: Array<ListRow<T>> = [];
  let current: GroupKey | null = null;
  for (const item of pageItems) {
    const product = productOf(item);
    const key = categoryOf(product);
    if (showHeadings && key !== current) {
      rows.push({ type: 'header', key: `header-${key}`, group: key, title: groupTitle(key), count: counts[key] ?? 0 });
    }
    current = key;
    rows.push({ type: 'product', key: product.id, item });
  }
  return rows;
}
