// Cashier -> Current Shift Sales: a Discount filter (Standard, Employee / guest meal, PWD, Back office / guard) in the same funnel +
// sheet + tag pattern as the other screens. The programs are the ones the POS sells under (pricingPrograms.ts); a sale with no
// program saved was sold at the standard price. Pure logic, then wiring.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadTs } from './_load_ts.mjs';

const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const f = loadTs('src/features/sales/saleFilters.ts');
const programs = loadTs('src/features/pos/pricingPrograms.ts');

// ---------------------------------------------------------------- 1. the options and the matching
{
  assert.deepEqual(f.SALE_DISCOUNT_OPTIONS.map((o) => o.label), ['All', 'Standard', 'Employee / guest meal', 'PWD', 'Back office / guard']);
  assert.deepEqual(
    f.SALE_DISCOUNT_OPTIONS.slice(1).map((o) => o.value),
    programs.PRICING_PROGRAM_OPTIONS.map((o) => o.value),
    'exactly the programs the POS can sell under, in the same order (so a new program cannot be missed silently)',
  );
  const sales = [
    { n: 'S1', pricing_program: 'standard' },
    { n: 'S2', pricing_program: null },
    { n: 'S3' },
    { n: 'S4', pricing_program: 'employee_meal' },
    { n: 'S5', pricing_program: 'pwd' },
    { n: 'S6', pricing_program: 'back_office_guard' },
    { n: 'S7', pricing_program: 'pwd' },
  ];
  const pick = (value) => sales.filter((s) => f.matchesSaleDiscount(s, value)).map((s) => s.n);
  assert.deepEqual(pick('all'), ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7'], 'All shows every sale');
  assert.deepEqual(pick('standard'), ['S1', 'S2', 'S3'], 'no program saved = standard');
  assert.deepEqual(pick('employee_meal'), ['S4']);
  assert.deepEqual(pick('pwd'), ['S5', 'S7']);
  assert.deepEqual(pick('back_office_guard'), ['S6']);
  console.log('1. options and matching: ok');
}

// ---------------------------------------------------------------- 2. the screen
{
  const src = read('app/(cashier)/cashier/sales.tsx');
  // the same funnel button next to the search box, the shared sheet, and the shared tag + Clear all
  assert.ok(src.includes("<FilterIconButton count={discount !== 'all' ? 1 : 0} onPress={() => setFiltersOpen(true)} />"), 'funnel next to search, badge when on');
  assert.match(src, /<ListFiltersSheet\n\s+visible=\{filtersOpen\}\n\s+filters=\{DEFAULT_LIST_FILTERS\}\n\s+keys=\{NO_LIST_FILTERS\}\n\s+extra=\{discountFilter\}/, 'the shared sheet, with only the Discount row');
  assert.match(src, /<ListFilterSummary\n\s+countText=[^\n]*\n\s+filters=\{DEFAULT_LIST_FILTERS\}\n\s+keys=\{NO_LIST_FILTERS\}\n\s+extra=\{discountFilter\}/, 'tag and Clear all');
  assert.ok(src.includes("title: 'Discount',") && src.includes('options: SALE_DISCOUNT_OPTIONS,'));
  // search and the filter combine
  assert.ok(src.includes('matchesSaleDiscount(sale, discount) && (!term || sale.sale_number.toLowerCase().includes(term))'));
  assert.ok(src.includes("'Try another sale number or change the filter.'"), 'the empty state mentions the filter');
  // it is the list header, so the phone and the tablet split both get it
  assert.ok(src.indexOf('const listHeader') < src.indexOf('<FilterIconButton'), 'inside the list header');
  assert.equal((src.match(/<ListFiltersSheet/g) ?? []).length, 1, 'one sheet for both layouts');
  // nothing about what is loaded or shown for a sale changed
  assert.ok(src.includes('listShiftSales(shift.data!.id)'));
  console.log('2. screen: ok');
}

console.log('sales_discount_filter: ALL PASS');
