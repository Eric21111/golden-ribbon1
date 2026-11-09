import type { SalePricingProgram } from '@/features/pos/pricingPrograms';

/**
 * The Discount filter on the cashier's Current Shift Sales: which pricing program the order was sold under. Free of React so it
 * can be unit-tested. A sale with no program saved was sold at the standard price.
 */
export type SaleDiscountFilter = 'all' | SalePricingProgram;

export const SALE_DISCOUNT_OPTIONS: Array<{ label: string; value: SaleDiscountFilter }> = [
  { label: 'All', value: 'all' },
  { label: 'Standard', value: 'standard' },
  { label: 'Employee / guest meal', value: 'employee_meal' },
  { label: 'PWD', value: 'pwd' },
  { label: 'Back office / guard', value: 'back_office_guard' },
];

export function matchesSaleDiscount(sale: { pricing_program?: string | null }, filter: SaleDiscountFilter): boolean {
  return filter === 'all' || (sale.pricing_program ?? 'standard') === filter;
}
