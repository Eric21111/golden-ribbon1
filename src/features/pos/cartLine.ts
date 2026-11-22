import type { CartItem } from '@/types/models';

/**
 * The line split for display: the product name on its own, and the option / drink as small tags. A variant that just repeats the
 * product ("Beef Kulma" + "Beef Kulma Only") is shortened to what is new ("Only"); the full text is still in cartLineLabel.
 */
export function cartLineParts(item: Pick<CartItem, 'product_name' | 'variant_name' | 'drink_name'>): { name: string; option: string | null; drink: string | null } {
  const variant = item.variant_name?.trim() ?? '';
  let option: string | null = variant || null;
  const prefix = item.product_name.trim().toLowerCase() + ' ';
  if (variant && variant.toLowerCase().startsWith(prefix)) {
    const rest = variant.slice(prefix.length).trim();
    option = rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : null;
  }
  return { name: item.product_name, option, drink: item.drink_name?.trim() || null };
}

/** "Chicken Curry (With Rice) · Coke": the meal, its option and the drink chosen with it (if any). */
export function cartLineLabel(item: Pick<CartItem, 'product_name' | 'variant_name' | 'drink_name'>): string {
  const base = item.variant_name ? `${item.product_name} (${item.variant_name})` : item.product_name;
  return item.drink_name ? `${base} · ${item.drink_name}` : base;
}
