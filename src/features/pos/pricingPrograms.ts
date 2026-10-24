import { toCents } from '@/lib/money';

/** Order-level POS pricing programs (server-authoritative). */
export type SalePricingProgram =
  | 'standard'
  | 'employee_meal'
  | 'pwd'
  | 'back_office_guard';

export type SalePricingProgramSetting = {
  program: SalePricingProgram;
  discount_percent: number | null;
  pricing_mode: 'fixed_unit_price' | 'amount_off' | null;
  fixed_amount: number | null;
  label: string;
};

/**
 * BUSINESS RULE FLAG: back office / security guard is ₱13 OFF each eligible unit (amount_off).
 * Not a fixed unit price. sale_pricing_program_settings.fixed_amount is the deduction.
 */
export const BACK_OFFICE_GUARD_AMOUNT_OFF = 13;
/** @deprecated Use BACK_OFFICE_GUARD_AMOUNT_OFF. Kept so older imports still compile. */
export const BACK_OFFICE_GUARD_FIXED_UNIT_PRICE = BACK_OFFICE_GUARD_AMOUNT_OFF;
export const PWD_DISCOUNT_PERCENT_DEFAULT = 25;

export const PRICING_PROGRAM_OPTIONS: Array<{
  value: SalePricingProgram;
  label: string;
  hint: string;
}> = [
  { value: 'standard', label: 'Standard', hint: 'Full catalog price' },
  {
    value: 'employee_meal',
    label: 'Employee / guest meal',
    hint: '₱0 charged · stock still deducted · not counted as revenue',
  },
  {
    value: 'pwd',
    label: `PWD (${PWD_DISCOUNT_PERCENT_DEFAULT}% off)`,
    hint: `${PWD_DISCOUNT_PERCENT_DEFAULT}% discount on catalog prices`,
  },
  {
    value: 'back_office_guard',
    label: 'Back office / guard',
    hint: `₱${BACK_OFFICE_GUARD_AMOUNT_OFF} off each item`,
  },
];

/** Preferred meal option names (price variants on one inventory SKU). */
export const STANDARD_MEAL_VARIANT_NAMES = ['Ulam Only', 'With Rice', 'With Drinks'] as const;

export function pricingProgramLabel(program: SalePricingProgram | string | null | undefined): string {
  const match = PRICING_PROGRAM_OPTIONS.find((option) => option.value === program);
  return match?.label ?? 'Standard';
}

/** Mirrors public.apply_sale_pricing_program (settings-aware). */
export function chargedUnitPrice(
  catalogUnitPrice: number,
  program: SalePricingProgram,
  settings?: Partial<Record<SalePricingProgram, SalePricingProgramSetting>> | null,
): number {
  if (program === 'employee_meal') return 0;
  if (program === 'standard') return catalogUnitPrice;

  const row = settings?.[program];
  if (program === 'pwd') {
    const pct = row?.discount_percent ?? PWD_DISCOUNT_PERCENT_DEFAULT;
    const charged = (toCents(catalogUnitPrice) * (100 - pct)) / 100;
    return Math.round(charged) / 100;
  }

  // back_office_guard — ₱13 off catalog unless settings explicitly use a fixed unit price.
  const amount = row?.fixed_amount ?? BACK_OFFICE_GUARD_AMOUNT_OFF;
  if (row?.pricing_mode === 'fixed_unit_price') return amount;
  return Math.max(0, toCents(catalogUnitPrice) - toCents(amount)) / 100;
}

export function previewOrderTotals(
  lines: Array<{ unit_price: number; quantity: number }>,
  program: SalePricingProgram,
  settings?: Partial<Record<SalePricingProgram, SalePricingProgramSetting>> | null,
): { catalogSubtotal: number; discountAmount: number; chargedTotal: number } {
  let catalogCents = 0;
  let chargedCents = 0;
  for (const line of lines) {
    const catalog = toCents(line.unit_price) * line.quantity;
    const charged = toCents(chargedUnitPrice(line.unit_price, program, settings)) * line.quantity;
    catalogCents += catalog;
    chargedCents += charged;
  }
  return {
    catalogSubtotal: catalogCents / 100,
    discountAmount: Math.max(0, catalogCents - chargedCents) / 100,
    chargedTotal: chargedCents / 100,
  };
}

/** Stable sort: standard meal names first (Ulam → Rice → Drinks), then alpha. */
export function sortMealVariants<T extends { name: string }>(variants: T[]): T[] {
  const rank = new Map<string, number>(
    STANDARD_MEAL_VARIANT_NAMES.map((name, index) => [name.toLowerCase(), index]),
  );
  return [...variants].sort((a, b) => {
    const ra = rank.get(a.name.trim().toLowerCase()) ?? 1000;
    const rb = rank.get(b.name.trim().toLowerCase()) ?? 1000;
    if (ra !== rb) return ra - rb;
    return a.name.localeCompare(b.name);
  });
}
