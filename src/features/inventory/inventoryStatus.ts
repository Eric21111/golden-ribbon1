import type { InventoryItem } from '@/types/models';

export const LOW_STOCK_THRESHOLD = 5;

export type StockFilter = 'all' | 'in_stock' | 'low' | 'out' | 'not_set';

export type StockStatus = Exclude<StockFilter, 'all'>;

export function getStockStatus(item: InventoryItem): StockStatus {
  if (item.updated_at == null) return 'not_set';
  if (item.quantity_on_hand <= 0) return 'out';
  if (item.quantity_on_hand <= LOW_STOCK_THRESHOLD) return 'low';
  return 'in_stock';
}

export function matchesStockFilter(item: InventoryItem, filter: StockFilter): boolean {
  if (filter === 'all') return true;
  return getStockStatus(item) === filter;
}

export function stockStatusLabel(status: StockStatus): string {
  switch (status) {
    case 'in_stock':
      return 'In stock';
    case 'low':
      return 'Low';
    case 'out':
      return 'Out';
    case 'not_set':
      return 'Not set';
  }
}

export function filterEmptyMessage(filter: StockFilter, hasSearch: boolean): { title: string; message: string } {
  if (hasSearch) {
    return { title: 'No matches', message: 'Try another name or SKU.' };
  }
  switch (filter) {
    case 'in_stock':
      return { title: 'No items in stock', message: 'Nothing currently has quantity on hand.' };
    case 'low':
      return { title: 'No low-stock items', message: `Nothing is at or below ${LOW_STOCK_THRESHOLD} units.` };
    case 'out':
      return { title: 'No out-of-stock items', message: 'Nothing is at zero quantity.' };
    case 'not_set':
      return { title: 'All products initialized', message: 'Every product already has opening stock.' };
    default:
      return { title: 'No inventory found', message: 'Create active products, then initialize opening stock.' };
  }
}
