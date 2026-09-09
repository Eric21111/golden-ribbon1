import type { InventoryItem } from '@/types/models';

export function isOutOfStock(item: InventoryItem): boolean {
  return item.quantity_on_hand <= 0;
}

/** Default: in-stock only. Search: matches including OOS, with OOS sorted last. */
export function filterPosInventory(items: InventoryItem[], search: string): InventoryItem[] {
  const term = search.trim().toLowerCase();
  const matched = term
    ? items.filter(
        (item) =>
          item.product.name.toLowerCase().includes(term) ||
          item.product.sku.toLowerCase().includes(term),
      )
    : items.filter((item) => !isOutOfStock(item));

  return [...matched].sort((a, b) => {
    const aOut = isOutOfStock(a) ? 1 : 0;
    const bOut = isOutOfStock(b) ? 1 : 0;
    if (aOut !== bOut) return aOut - bOut;
    return a.product.name.localeCompare(b.product.name);
  });
}

export function outOfStockProductNames(items: InventoryItem[]): string[] {
  return items.filter(isOutOfStock).map((item) => item.product.name);
}

export function hasSellableStock(items: InventoryItem[]): boolean {
  return items.some((item) => !isOutOfStock(item));
}

export function formatOutOfStockWarning(names: string[], limit = 15): string {
  if (names.length === 0) return '';
  const shown = names.slice(0, limit);
  const extra = names.length - shown.length;
  const list = shown.join('\n');
  return extra > 0 ? `${list}\n…and ${extra} more` : list;
}
