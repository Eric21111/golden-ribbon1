import type { CartItem } from '@/types/models';

/** "Chicken Curry (With Rice) · Coke": the meal, its option and the drink chosen with it (if any). */
export function cartLineLabel(item: Pick<CartItem, 'product_name' | 'variant_name' | 'drink_name'>): string {
  const base = item.variant_name ? `${item.product_name} (${item.variant_name})` : item.product_name;
  return item.drink_name ? `${base} · ${item.drink_name}` : base;
}
