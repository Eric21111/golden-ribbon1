import type { InventoryItem, ProfileWithBranch, Shift } from '@/types/models';

/** Shift branch wins. Profile branch is only a fallback before a shift exists. */
export function authoritativePosBranchId(
  shift: Pick<Shift, 'branch_id'> | null | undefined,
  profile: Pick<ProfileWithBranch, 'branch_id' | 'branch'> | null | undefined,
): string | null {
  if (shift?.branch_id) return shift.branch_id;
  return profile?.branch_id ?? profile?.branch?.id ?? null;
}

/**
 * Old POS gate merged every active product with RLS-hidden balances as qty 0.
 * That looks like "all out of stock" even when the branch has inventory.
 * POS may open when any active product actually has quantity_on_hand > 0.
 */
export function mergeCatalogWithBalances(
  products: Array<InventoryItem['product']>,
  balances: Array<{ product_id: string; quantity_on_hand: number }>,
  branch: InventoryItem['branch'],
): InventoryItem[] {
  const qty = new Map(balances.map((row) => [row.product_id, row.quantity_on_hand]));
  return products.map((product) => ({
    branch,
    product,
    quantity_on_hand: qty.get(product.id) ?? 0,
    updated_at: null,
  }));
}

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
