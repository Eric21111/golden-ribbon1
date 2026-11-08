import type { GlyphName } from '@/components/GlyphIcon';
import type { StatChipColor } from '@/components/dashboard/theme';

import { PRODUCT_CATEGORIES, type ProductCategory } from './productCategoryPreview';

/**
 * The one place that decides which icon and colour stand for a product category. Screens pass the SAVED category
 * (products.product_category), never a guess from the product name. A product with no saved category gets the neutral
 * "not set" indicator, so list rows stay aligned and nothing is invented.
 *
 * Colours are chosen to stay clear of the status colours: green = Active / in stock, amber = low stock, red = out of
 * stock. Category indicators are small tinted squares, status badges are filled pills.
 */
export type CategoryIndicator = {
  icon: GlyphName;
  /** A key of statChipColors (soft tint + icon colour). */
  color: StatChipColor;
  /** Full category name, e.g. "Meals & Viands". Used as the accessibility label. */
  label: string;
};

const INDICATORS: Record<ProductCategory, Omit<CategoryIndicator, 'label'>> = {
  meals: { icon: 'restaurant-outline', color: 'orange' },
  snacks: { icon: 'bbq-stick', color: 'pink' }, // drawn by GlyphIcon: Ionicons has no skewer
  drinks: { icon: 'cafe-outline', color: 'blue' },
  extras: { icon: 'add-circle-outline', color: 'violet' },
  supplies: { icon: 'cube-outline', color: 'gray' },
};

const NOT_SET: CategoryIndicator = { icon: 'help-circle-outline', color: 'gray', label: 'Category not set' };

export function isProductCategory(value: unknown): value is ProductCategory {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(INDICATORS, value);
}

/** `icon` / `iconColor` / `iconLabel` props for ListRowCard, from a saved category. */
export function categoryRowProps(category: string | null | undefined) {
  const indicator = getCategoryIndicator(category);
  return { icon: indicator.icon, iconColor: indicator.color, iconLabel: indicator.label };
}

/** Indicator for a saved category. Anything else (null, undefined, an unknown value) is "Category not set". */
export function getCategoryIndicator(category: string | null | undefined): CategoryIndicator {
  if (!isProductCategory(category)) return NOT_SET;
  const label = PRODUCT_CATEGORIES.find((entry) => entry.id === category)?.label ?? NOT_SET.label;
  return { ...INDICATORS[category], label };
}
