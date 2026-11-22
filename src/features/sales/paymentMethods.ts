import type { Sale } from '@/services/saleService';
import { toCents } from '@/lib/money';

export type PaymentMethod = 'cash' | 'gcash';
export type PaymentFilter = PaymentMethod | 'all' | 'unrecorded';
export const paymentLabel = (method?: PaymentMethod | 'unrecorded' | null) => method === 'cash' ? 'Cash' : method === 'gcash' ? 'GCash' : 'Unrecorded';
export const PAYMENT_FILTERS: { value: PaymentFilter; label: string }[] = [
  { value: 'all', label: 'All payments' }, { value: 'cash', label: 'Cash' },
  { value: 'gcash', label: 'GCash' },
];

const emptyProgramGroups = { standard: 0, pwd: 0, back_office_guard: 0, employee_meal: 0 };

export type PricingProgramKey = keyof typeof emptyProgramGroups;
export type ShiftPaymentRow = {
  method: string;
  program: string;
  amount: number;
  orders: number;
};

export const PRICING_PROGRAM_LABELS: Record<PricingProgramKey, string> = {
  standard: 'Standard',
  pwd: 'PWD',
  back_office_guard: 'Back office / security',
  employee_meal: 'Employee / guest meals',
};

export function paymentBreakdown(sales: Sale[], method: Exclude<PaymentFilter,'all'>) {
  const groups = { ...emptyProgramGroups };
  let total = 0, orders = 0, employeeMeals = 0;
  for (const sale of sales) {
    if (sale.status !== 'completed' || (sale.payment_method ?? 'unrecorded') !== method) continue;
    const program = (sale.pricing_program ?? 'standard') as PricingProgramKey;
    const cents = toCents(Number(sale.total_amount));
    if (program in groups) groups[program] += cents;
    total += cents;
    orders++;
    if (program === 'employee_meal') employeeMeals += 1;
  }
  return { groups, total, orders, employeeMeals };
}

/** Aggregate manager_shift_payments / manager_today_payments rows for one tender method. Amounts stay in pesos. */
export function shiftPaymentBreakdown(rows: readonly ShiftPaymentRow[], method: Exclude<PaymentFilter, 'all'>) {
  const groups = { ...emptyProgramGroups };
  let total = 0;
  let orders = 0;
  let employeeMeals = 0;
  for (const row of rows) {
    if ((row.method || 'unrecorded') !== method) continue;
    const program = (row.program || 'standard') as PricingProgramKey;
    const amount = Number(row.amount) || 0;
    const count = Math.max(0, Math.trunc(Number(row.orders) || 0));
    if (program in groups) groups[program] += amount;
    total += amount;
    orders += count;
    if (program === 'employee_meal') employeeMeals += count;
  }
  return { groups, total, orders, employeeMeals };
}
