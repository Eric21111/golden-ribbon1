import { closingStockBehaviorLabel } from '@/lib/format';
import type { ClosingStockBehavior } from '@/types/models';

import { PRODUCT_CATEGORIES, type ProductCategory } from './productCategoryPreview';

export type ProductFilter = 'all' | 'active' | 'inactive';

export const PRODUCT_FILTER_CHOICES: Array<{ label: string; value: ProductFilter }> = [
  { label: 'All', value: 'all' },
  { label: 'Enabled', value: 'active' },
  { label: 'Disabled', value: 'inactive' },
];

export function matchesProductFilter(isActive: boolean, filter: ProductFilter): boolean {
  switch (filter) {
    case 'active':
      return isActive;
    case 'inactive':
      return !isActive;
    default:
      return true;
  }
}

// ---- the four product list filters: Category, Enable Product, Show in Cashier POS, Keep Unsold Stock at Branch

export type CategoryFilter = 'all' | ProductCategory | 'unset';
export type PosFilter = 'all' | 'pos' | 'stock_only';
export type ReturnFilter = 'all' | 'non_returnable' | 'returnable';

export type ProductListFilters = {
  status: ProductFilter;
  category: CategoryFilter;
  pos: PosFilter;
  returns: ReturnFilter;
};

export const DEFAULT_PRODUCT_FILTERS: ProductListFilters = {
  status: 'all',
  category: 'all',
  pos: 'all',
  returns: 'all',
};

export const CATEGORY_FILTER_CHOICES: Array<{ label: string; value: CategoryFilter }> = [
  { label: 'All', value: 'all' },
  ...PRODUCT_CATEGORIES.map((category) => ({ label: category.label, value: category.id as CategoryFilter })),
  { label: 'Not set', value: 'unset' },
];

/** Short names for the quick chips on the Products screen (the full names are used everywhere else). */
const CATEGORY_CHIP_LABELS: Record<ProductCategory, string> = {
  meals: 'Meals',
  snacks: 'Snacks',
  drinks: 'Drinks',
  extras: 'Extras',
  supplies: 'Supplies',
};

export const CATEGORY_CHIP_CHOICES: Array<{ label: string; value: CategoryFilter }> = [
  { label: 'All', value: 'all' },
  ...PRODUCT_CATEGORIES.map((category) => ({ label: CATEGORY_CHIP_LABELS[category.id], value: category.id as CategoryFilter })),
  { label: 'Not set', value: 'unset' },
];

export const POS_FILTER_CHOICES: Array<{ label: string; value: PosFilter }> = [
  { label: 'All', value: 'all' },
  { label: 'Show in POS', value: 'pos' },
  { label: 'Stock only', value: 'stock_only' },
];

export const RETURN_FILTER_CHOICES: Array<{ label: string; value: ReturnFilter }> = [
  { label: 'All', value: 'all' },
  { label: 'Stays at branch', value: 'non_returnable' },
  { label: 'Can return to Main', value: 'returnable' },
];

/** The fields of a product the filters read. Missing flags mean what they always meant (sold in POS, returnable). */
export type FilterableProduct = {
  is_active: boolean;
  product_category?: string | null;
  sell_in_pos?: boolean | null;
  is_non_returnable?: boolean | null;
};

const CATEGORY_IDS: readonly string[] = PRODUCT_CATEGORIES.map((category) => category.id);

/** A product with no saved category (or one this app does not know) counts as "Not set". */
export function categoryOf(product: FilterableProduct): ProductCategory | 'unset' {
  const value = product.product_category;
  return value != null && CATEGORY_IDS.includes(value) ? (value as ProductCategory) : 'unset';
}

export function categoryLabelOf(product: FilterableProduct): string | null {
  const category = categoryOf(product);
  return category === 'unset' ? null : PRODUCT_CATEGORIES.find((entry) => entry.id === category)?.label ?? null;
}

export function matchesProductFilters(product: FilterableProduct, filters: ProductListFilters): boolean {
  if (!matchesProductFilter(product.is_active, filters.status)) return false;
  if (filters.category !== 'all' && categoryOf(product) !== filters.category) return false;
  if (filters.pos !== 'all') {
    const sold = product.sell_in_pos !== false;
    if ((filters.pos === 'pos') !== sold) return false;
  }
  if (filters.returns !== 'all') {
    const nonReturnable = product.is_non_returnable === true;
    if ((filters.returns === 'non_returnable') !== nonReturnable) return false;
  }
  return true;
}

/** How many of ALL four filters are set to something other than "All". */
export function countActiveFilters(filters: ProductListFilters): number {
  return (Object.keys(DEFAULT_PRODUCT_FILTERS) as Array<keyof ProductListFilters>).filter(
    (key) => filters[key] !== DEFAULT_PRODUCT_FILTERS[key],
  ).length;
}

/** The filters that live in the Filters sheet (Category has its own chips on the screen). This is the button's badge. */
export function countSheetFilters(filters: ProductListFilters): number {
  return countActiveFilters({ ...filters, category: 'all' });
}

export type ActiveFilterTag = { key: 'status' | 'pos' | 'returns'; label: string };

/** Removable tags for the filters set in the sheet. Category is not tagged: its chip on the screen shows it. */
export function activeFilterTags(filters: ProductListFilters): ActiveFilterTag[] {
  const tags: ActiveFilterTag[] = [];
  if (filters.status !== 'all') {
    tags.push({ key: 'status', label: PRODUCT_FILTER_CHOICES.find((choice) => choice.value === filters.status)?.label ?? 'Enable Product' });
  }
  if (filters.pos !== 'all') {
    tags.push({ key: 'pos', label: POS_FILTER_CHOICES.find((choice) => choice.value === filters.pos)?.label ?? 'Cashier POS' });
  }
  if (filters.returns !== 'all') {
    tags.push({ key: 'returns', label: RETURN_FILTER_CHOICES.find((choice) => choice.value === filters.returns)?.label ?? 'Unsold stock' });
  }
  return tags;
}

export function productFilterEmptyMessage(
  filter: ProductFilter,
  hasSearch: boolean,
  canCreate: boolean,
  hasOtherFilters = false,
): { title: string; message: string } {
  if (hasSearch) {
    return { title: 'No matches', message: hasOtherFilters ? 'Try another name or SKU, or clear the filters.' : 'Try another name or SKU.' };
  }
  if (hasOtherFilters) {
    return { title: 'No products match these filters', message: 'Change or clear the filters to see more products.' };
  }
  switch (filter) {
    case 'active':
      return { title: 'No enabled products', message: 'Enable a product or switch to All.' };
    case 'inactive':
      return { title: 'No disabled products', message: 'Products you turn off with Enable Product appear here.' };
    default:
      return {
        title: 'No products yet',
        message: canCreate ? 'Create the first product to get started.' : 'Ask an owner to add products.',
      };
  }
}

// ---- the lines of a product card on the Products screen

export type ProductRowSource = FilterableProduct & {
  name: string;
  sku: string;
  closing_stock_behavior?: ClosingStockBehavior | null;
};

export type ProductRowText = {
  /** The SKU, shown as its own small tag. */
  sku: string;
  /** What the product is: "Inventory Supplies", or "Category not set". */
  category: string;
  /** Whether cashiers can sell it: "Shown in POS" or "Stock only". Its own fact, not part of the category. */
  pos: string;
  /** True when it is not shown in the POS (stock only), for the icon. */
  stockOnly: boolean;
  /** What happens to its remaining stock when a shift closes. A separate fact so it is never read as a category or POS fact. */
  closing: string;
  /** The whole card read out loud. */
  spoken: string;
};

/**
 * Three separate facts, each in its own place on the card: category, POS visibility and shift-close behavior. They come from
 * three different fields (product_category, sell_in_pos, and is_non_returnable / closing_stock_behavior) and are never merged
 * into one string. A product with the "Keep Unsold Stock at Branch" switch on always carries over (the database forces it), so
 * it reads "Stays at branch"; the other two readings are the close setting alone.
 */
export function productRowText(product: ProductRowSource & { is_active: boolean }): ProductRowText {
  const category = categoryLabelOf(product) ?? 'Category not set';
  const pos = product.sell_in_pos === false ? 'Stock only' : 'Shown in POS';
  const closing = product.is_non_returnable ? 'Stays at branch' : closingStockBehaviorLabel(product.closing_stock_behavior);
  const closingSpoken = product.is_non_returnable
    ? 'stays at the branch and cannot be returned to Main'
    : product.closing_stock_behavior === 'record_as_unsold'
      ? 'remaining stock is recorded as unsold'
      : 'remaining stock carries to the next day';
  return {
    sku: product.sku,
    category,
    pos,
    stockOnly: pos === 'Stock only',
    closing,
    spoken: `${product.name}, ${category}, ${pos === 'Stock only' ? 'stock only, not shown in the cashier POS' : 'shown in the cashier POS'}, at shift close ${closingSpoken}, ${product.is_active ? 'enabled' : 'disabled'}`,
  };
}

/** "3 of 12 products" while some are filtered out, "12 products" when all of them show. */
export function resultCountText(resultCount: number, totalCount?: number): string {
  const filteredOut = totalCount != null && totalCount > resultCount;
  const noun = (filteredOut ? totalCount : resultCount) === 1 ? 'product' : 'products';
  return filteredOut ? `${resultCount} of ${totalCount} ${noun}` : `${resultCount} ${noun}`;
}
