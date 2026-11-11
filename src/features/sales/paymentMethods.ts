import type { Sale } from '@/services/saleService';
import { toCents } from '@/lib/money';

export type PaymentMethod = 'cash' | 'gcash';
export type PaymentFilter = PaymentMethod | 'all' | 'unrecorded';
export const paymentLabel = (method?: PaymentMethod | 'unrecorded' | null) => method === 'cash' ? 'Cash' : method === 'gcash' ? 'GCash' : 'Unrecorded';
export const PAYMENT_FILTERS: { value: PaymentFilter; label: string }[] = [
  { value: 'all', label: 'All payments' }, { value: 'cash', label: 'Cash' },
  { value: 'gcash', label: 'GCash' }, { value: 'unrecorded', label: 'Unrecorded' },
];

export function paymentBreakdown(sales: Sale[], method: Exclude<PaymentFilter,'all'>) {
  const groups = { standard: 0, pwd: 0, back_office_guard: 0, employee_meal: 0 };
  let total = 0, orders = 0, employeeMeals = 0;
  for (const sale of sales) {
    if (sale.status !== 'completed' || (sale.payment_method ?? 'unrecorded') !== method) continue;
    const program = sale.pricing_program ?? 'standard';
    const cents = toCents(Number(sale.total_amount));
    groups[program] += cents;
    total += cents;
    orders++;
    if (program === 'employee_meal') employeeMeals++;
  }
  return { groups, total, orders, employeeMeals };
}
