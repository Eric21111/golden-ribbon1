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

export function productFilterEmptyMessage(
  filter: ProductFilter,
  hasSearch: boolean,
  canCreate: boolean
): { title: string; message: string } {
  if (hasSearch) {
    return { title: 'No matches', message: 'Try another name or SKU.' };
  }
  switch (filter) {
    case 'active':
      return { title: 'No enabled products', message: 'Enable a product or switch to All.' };
    case 'inactive':
      return { title: 'No disabled products', message: 'Disabled products remain for history.' };
    default:
      return {
        title: 'No products yet',
        message: canCreate ? 'Create the first product to get started.' : 'Ask an owner to add products.',
      };
  }
}
