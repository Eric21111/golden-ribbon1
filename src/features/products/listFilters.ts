import {
  CATEGORY_CHIP_CHOICES,
  CATEGORY_FILTER_CHOICES,
  POS_FILTER_CHOICES,
  RETURN_FILTER_CHOICES,
  categoryLabelOf,
  matchesProductFilters,
  type CategoryFilter,
  type FilterableProduct,
  type PosFilter,
  type ReturnFilter,
} from './productFilters';

/**
 * The product filters the stock screens share (Main Inventory, Opening stock, Send stock, the cashier POS): Category, Show in
 * Cashier POS and Keep Unsold Stock at Branch. Same meaning as on the Products screen, so a product reads the same everywhere.
 * Each screen offers the rows that make sense for the data it has (the cashier POS only has categories).
 */
export type ListFilters = { category: CategoryFilter; pos: PosFilter; returns: ReturnFilter };
export type ListFilterKey = keyof ListFilters;

export const DEFAULT_LIST_FILTERS: ListFilters = { category: 'all', pos: 'all', returns: 'all' };
export const ALL_LIST_FILTER_KEYS: ListFilterKey[] = ['category', 'pos', 'returns'];

export function matchesListFilters(product: FilterableProduct, filters: ListFilters): boolean {
  return matchesProductFilters(product, { status: 'all', ...filters });
}

/** How many of the offered filters are set to something other than "All" (the filter button's badge). */
export function countListFilters(filters: ListFilters, keys: ListFilterKey[] = ALL_LIST_FILTER_KEYS): number {
  return keys.filter((key) => filters[key] !== DEFAULT_LIST_FILTERS[key]).length;
}

export type ListFilterTag = { key: ListFilterKey; label: string };

/** One removable tag per filter that is on, in the order of the sheet. */
export function listFilterTags(filters: ListFilters, keys: ListFilterKey[] = ALL_LIST_FILTER_KEYS): ListFilterTag[] {
  const tags: ListFilterTag[] = [];
  for (const key of keys) {
    if (filters[key] === DEFAULT_LIST_FILTERS[key]) continue;
    const choices: Array<{ label: string; value: string }> =
      key === 'category' ? CATEGORY_CHIP_CHOICES : key === 'pos' ? POS_FILTER_CHOICES : RETURN_FILTER_CHOICES;
    tags.push({ key, label: choices.find((choice) => choice.value === filters[key])?.label ?? 'Filter' });
  }
  return tags;
}

export const LIST_FILTER_ROWS: Record<ListFilterKey, { title: string; options: Array<{ label: string; value: string }> }> = {
  category: { title: 'Category', options: CATEGORY_FILTER_CHOICES },
  pos: { title: 'Show in Cashier POS', options: POS_FILTER_CHOICES },
  returns: { title: 'Keep Unsold Stock at Branch', options: RETURN_FILTER_CHOICES },
};

/** What a search is matched against: name, SKU and the category name (typing "drinks" finds the drinks). */
export function productSearchText(product: FilterableProduct & { name: string; sku: string }): string {
  return `${product.name} ${product.sku} ${categoryLabelOf(product) ?? ''}`.toLowerCase();
}

export function listFilterEmptyMessage(hasSearch: boolean): { title: string; message: string } {
  return hasSearch
    ? { title: 'No matches', message: 'Try another name, SKU or category, or clear the filters.' }
    : { title: 'No products match these filters', message: 'Change or clear the filters to see more products.' };
}
