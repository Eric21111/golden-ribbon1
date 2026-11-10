// End Shift / Pending Remittance count: compact cards (category icon, name, SKU + system stock, "Use n", Remaining and Waste as small
// steppers), count-status pills (All / Needs count / Counted), a funnel with Category, a Sort sheet, a keyboard Next, one scrolling list
// in two sections ("With stock" first, then "No system stock") each with its own one-tap fill, and a pinned progress + submit bar.
// Nothing is hidden and nothing is counted for the cashier. The rules are plain functions and tested for real; the page is rendered;
// what is submitted is checked unchanged.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { loadTs } from './_load_ts.mjs';

const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const require = createRequire(import.meta.url);
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const rnw = require('react-native-web');
const flat = (html) => html.replace(/<[^>]+>/g, '|').replace(/\|+/g, '|');

const P = (id, name, sku, system) => ({
  product_id: id, product_name_snapshot: name, sku_snapshot: sku, closing_stock_behavior: 'record_as_unsold',
  opening_quantity: 0, received_quantity: 0, outgoing_quantity: 0, sold_quantity: 0, adjustment_quantity: 0, system_balance_before_waste: system,
});
// two with no system stock at all (Rice, Beef Kulma), one fractional (Odd Stock)
const products = [P('egg', 'Egg', 'EGG', 50), P('coke', 'Coke Mismo', 'COKE', 12), P('curry', 'Beef Curry', 'BEEF-CURRY', 25), P('water', 'Bottled Water', 'WATER', 30), P('odd', 'Odd Stock', 'ODD', 2.5), P('rice', 'Rice', 'RICE', 0), P('kulma', 'Beef Kulma', 'BEEF-KULMA', 0)];
const categories = new Map([['egg', 'supplies'], ['coke', 'drinks'], ['curry', 'meals'], ['water', 'drinks'], ['odd', 'drinks'], ['rice', 'meals'], ['kulma', 'meals']]);
const m = loadTs('src/features/shifts/closeCountList.ts');
const start = m.initialCounts(products);
const base = { products, settled: start, search: '', countFilter: 'all', category: 'all', sort: 'stock-desc', categories };
const names = (list) => list.map((p) => p.product_name_snapshot);

// ---------------------------------------------------------------- 1. the rules
{
  // nothing is counted for the cashier: every product starts blank, the ones with no stock too
  assert.ok(products.every((p) => start[p.product_id].actualRemaining === '' && start[p.product_id].wasteQuantity === '0'));
  assert.equal(m.hasNoSystemStock({ system_balance_before_waste: 0 }), true);
  assert.equal(m.hasNoSystemStock({ system_balance_before_waste: '0' }), true);
  assert.equal(m.hasNoSystemStock({ system_balance_before_waste: -3 }), false, 'a negative balance is not "empty"');
  assert.equal(m.hasNoSystemStock({ system_balance_before_waste: 2.5 }), false);

  // EVERY product is listed: the ones with stock first (most first), the ones with none after
  assert.deepEqual(names(m.visibleCountProducts(base)), ['Egg', 'Bottled Water', 'Beef Curry', 'Coke Mismo', 'Odd Stock', 'Beef Kulma', 'Rice'], 'nothing hidden; stock first; then no stock (A-Z)');
  assert.deepEqual(names(m.visibleCountProducts({ ...base, sort: 'name-asc' })), ['Beef Curry', 'Bottled Water', 'Coke Mismo', 'Egg', 'Odd Stock', 'Beef Kulma', 'Rice'], 'the chosen order applies inside each of the two sections');
  assert.deepEqual(names(m.visibleCountProducts({ ...base, sort: 'name-desc' })), ['Odd Stock', 'Egg', 'Coke Mismo', 'Bottled Water', 'Beef Curry', 'Rice', 'Beef Kulma']);
  const split = m.splitByStock(m.visibleCountProducts(base));
  assert.deepEqual(names(split.withStock), ['Egg', 'Bottled Water', 'Beef Curry', 'Coke Mismo', 'Odd Stock']);
  assert.deepEqual(names(split.noStock), ['Beef Kulma', 'Rice']);
  // category (from the funnel) and search
  assert.deepEqual(names(m.visibleCountProducts({ ...base, category: 'meals' })), ['Beef Curry', 'Beef Kulma', 'Rice']);
  assert.deepEqual(names(m.visibleCountProducts({ ...base, search: 'beef-kulma' })), ['Beef Kulma'], 'a product with no stock is found');
  assert.equal(m.visibleCountProducts({ ...base, categories: undefined }).length, 7, 'categories not loaded yet: nothing is lost');

  // Needs count / Counted and "Needs count first" follow the SETTLED counts
  const settled = { ...start, curry: { actualRemaining: '20', wasteQuantity: '0' }, egg: { actualRemaining: '0', wasteQuantity: '0' } };
  assert.deepEqual(names(m.visibleCountProducts({ ...base, settled, countFilter: 'needs_count' })), ['Bottled Water', 'Coke Mismo', 'Odd Stock', 'Beef Kulma', 'Rice']);
  assert.deepEqual(names(m.visibleCountProducts({ ...base, settled, countFilter: 'counted' })), ['Egg', 'Beef Curry'], 'a counted 0 is counted (a blank is not)');
  assert.deepEqual(names(m.visibleCountProducts({ ...base, settled, sort: 'needs_count' })), ['Bottled Water', 'Coke Mismo', 'Odd Stock', 'Beef Curry', 'Egg', 'Beef Kulma', 'Rice']);

  // each section fills on its own: only uncounted products with a whole system balance; waste untouched; the input is not changed
  const counts = { ...start, coke: { actualRemaining: '10', wasteQuantity: '2' }, curry: { actualRemaining: '', wasteQuantity: '3' }, rice: { actualRemaining: '1', wasteQuantity: '0' } };
  assert.deepEqual(m.fillableProducts(split.withStock, counts).map((p) => p.product_id), ['egg', 'water', 'curry'], 'with stock: not Coke (counted), not Odd Stock (2.5 is not a whole count)');
  assert.deepEqual(m.fillableProducts(split.noStock, counts).map((p) => p.product_id), ['kulma'], 'no stock: not Rice, which was counted 1');
  const zeros = m.fillWithSystem(counts, m.fillableProducts(split.noStock, counts));
  assert.deepEqual(zeros.kulma, { actualRemaining: '0', wasteQuantity: '0' }, '"Set all to 0"');
  assert.deepEqual(zeros.rice, { actualRemaining: '1', wasteQuantity: '0' }, 'a counted product is never overwritten');
  assert.deepEqual(zeros.egg, { actualRemaining: '', wasteQuantity: '0' }, 'the other section is untouched');
  const stock = m.fillWithSystem(counts, m.fillableProducts(split.withStock, counts));
  assert.deepEqual(stock.curry, { actualRemaining: '25', wasteQuantity: '3' }, 'Remaining = system, Waste kept');
  assert.deepEqual(stock.kulma, { actualRemaining: '', wasteQuantity: '0' }, 'the "with stock" fill never touches the no-stock products');
  assert.equal(counts.curry.actualRemaining, '', 'the original is untouched');

  // progress: nothing counted yet, every product needs a count
  assert.equal(m.closeProgressText({ total: 7, counted: 0, cashEntered: false }), '0 of 7 counted');
  assert.equal(m.closeProgressText({ total: 17, counted: 17, cashEntered: false }), 'All counted · enter the cash');
  assert.equal(m.closeProgressText({ total: 17, counted: 17, cashEntered: true }), 'Ready to complete');
  assert.equal(m.closeProgressText({ total: 0, counted: 0, cashEntered: false }), 'Enter the cash you counted');
  console.log('1. rules: ok');
}

// ---------------------------------------------------------------- 2. the rendered page
{
  const form = loadTs('src/features/shifts/CashierShiftCloseForm.tsx', {
    'react-native': rnw,
    '@react-native-vector-icons/ionicons': { __esModule: true, default: (p) => React.createElement('i', { 'data-icon': p.name }) },
    '@tanstack/react-query': { useQuery: () => ({ data: categories }) },
    '@/components/FormField': { FormField: (p) => React.createElement('label', null, p.label, React.createElement('input', { value: p.value, readOnly: true })) },
    '@/components/dashboard/ManagerActionButton': { ManagerActionButton: (p) => React.createElement('button', { disabled: p.disabled }, p.label) },
    '@/components/dashboard/ManagerBottomSheet': { ManagerBottomSheet: () => null },
    '@/components/dashboard/ToolbarIconButtons': { FilterIconButton: (p) => React.createElement('span', { 'data-filter': String(p.count) }), SortIconButton: (p) => React.createElement('span', { 'data-sort': String(p.currentLabel) }) },
    '@/features/products/CategoryIcon': { CategoryIcon: (p) => React.createElement('i', { 'data-category': String(p.category) }) },
    '@/features/products/ProductFilterControls': { ListFilterSummary: () => null, ListFiltersSheet: () => null },
    '@/lib/confirmAction': { confirmAction() {} },
    '@/services/inventoryService': { listCashierProductCategories: async () => categories },
  });
  const preview = { shift_id: 's', branch_id: 'b', started_at: '2026-11-09T00:00:00Z', ended_at: null, sales_cutoff_at: '2026-11-08T23:39:00Z', inventory_reconciliation_required: true, reconciliation_required: true, mode: 'pcs_inventory_cash', expected_cash: 500, products };
  const html = renderToStaticMarkup(React.createElement(form.CashierShiftCloseForm, { preview, branchName: 'SM 1', title: 'Complete Pending Remittance', onSubmit() {} }));
  const text = flat(html);

  assert.match(text, /Sales closed for today\|SM 1 · Cutoff 7:39 AM\|/);
  assert.match(html, /placeholder="Search name or SKU"/);
  assert.match(text, /\|All\|Needs count\|Counted\|/, 'the pills are the count status');
  assert.doesNotMatch(text, /Meals\|Snacks|Extras\|Supplies/, 'no category pills: Category is in the funnel');
  assert.match(html, /data-filter="0"/);
  assert.match(html, /data-sort="System stock \(high to low\)"/, 'most stock first is the default');
  // no note, no big "fill everything" button
  assert.doesNotMatch(text, /count as 0|Fill \d+ uncounted|have no system stock and/, 'nothing hidden, so nothing to explain; no all-in-one fill button');
  // two sections, each with its own action, and EVERY product on the page
  assert.match(text, /WITH STOCK \|5\|Use system stock for all\|Egg\|EGG · System 50\|Use 50\|Remaining[^]*Bottled Water[^]*Beef Curry[^]*Coke Mismo[^]*Odd Stock\|ODD · System 2\.5\|Remaining/, 'products with stock first, most first');
  assert.match(text, /NO SYSTEM STOCK \|2\|Set all to 0\|Beef Kulma\|BEEF-KULMA · System 0\|Use 0\|Remaining[^]*Rice\|RICE · System 0\|Use 0\|Remaining/, 'the ones with no stock are there, in their own section');
  assert.ok(text.indexOf('WITH STOCK') < text.indexOf('Egg') && text.indexOf('Odd Stock') < text.indexOf('NO SYSTEM STOCK'));
  assert.equal((html.match(/aria-label="Actual remaining for /g) ?? []).length, 7, 'all seven are listed');
  assert.equal((html.match(/aria-label="Set remaining to the system stock of /g) ?? []).length, 6, 'a "Use n" button on every product with a whole system balance (not 2.5)');
  assert.doesNotMatch(text, /Meals &amp; Viands|Inventory Supplies/, 'no category headings');
  assert.match(text, /0 of 7 counted\|0%\|Complete End Shift\|$/, 'nothing is counted for the cashier');
  assert.match(html, /disabled=""[^>]*>Complete End Shift/);
  assert.match(text, /Cash Remittance\|Expected cash ₱500\.00\|Actual cash\|Difference: /);
  // only products with stock: one section; only products without: one section
  const onlyStock = flat(renderToStaticMarkup(React.createElement(form.CashierShiftCloseForm, { preview: { ...preview, products: products.filter((p) => p.system_balance_before_waste > 0) }, onSubmit() {} })));
  assert.match(onlyStock, /WITH STOCK \|5\|/);
  assert.doesNotMatch(onlyStock, /NO SYSTEM STOCK/);
  const onlyNone = flat(renderToStaticMarkup(React.createElement(form.CashierShiftCloseForm, { preview: { ...preview, products: products.filter((p) => p.system_balance_before_waste === 0) }, onSubmit() {} })));
  assert.match(onlyNone, /NO SYSTEM STOCK \|2\|Set all to 0/);
  assert.doesNotMatch(onlyNone, /WITH STOCK/);
  // Updated previews omit only server-certified idle rows. Sold-out activity still needs a count.
  const updatedProducts = products.map(p => p.product_id === 'rice' ? { ...p, requires_count: false }
    : p.product_id === 'kulma' ? { ...p, requires_count: true, received_quantity: 2, sold_quantity: 2 } : p);
  const updated = renderToStaticMarkup(React.createElement(form.CashierShiftCloseForm, {
    preview: { ...preview, products: updatedProducts }, onSubmit() {},
  }));
  assert.doesNotMatch(updated, /aria-label="Actual remaining for Rice"/);
  assert.match(updated, /aria-label="Actual remaining for Beef Kulma"/);
  assert.match(flat(updated), /0 of 6 counted/);
  const idleOnly = renderToStaticMarkup(React.createElement(form.CashierShiftCloseForm, {
    preview: { ...preview, products: products.filter(p => p.system_balance_before_waste === 0).map(p => ({ ...p, requires_count: false })) }, onSubmit() {},
  }));
  assert.doesNotMatch(idleOnly, /Actual remaining for|NO SYSTEM STOCK/);
  assert.match(flat(idleOnly), /Enter the cash you counted/);
  // legacy, retry slot
  const legacy = renderToStaticMarkup(React.createElement(form.CashierShiftCloseForm, { preview: { ...preview, mode: 'legacy_cash_only', inventory_reconciliation_required: false, products: [] }, onSubmit() {} }));
  assert.match(flat(legacy), /This historical shift only needs cash reconciliation\.\|Cash Remittance\|/);
  assert.match(flat(renderToStaticMarkup(React.createElement(form.CashierShiftCloseForm, { preview, footerExtra: React.createElement('b', null, 'RETRY'), onSubmit() {} }))), /RETRY\|0 of 7 counted/);
  console.log('2. rendered page: ok');
}

// ---------------------------------------------------------------- 3. wiring
{
  const src = read('src/features/shifts/CashierShiftCloseForm.tsx');
  assert.ok(src.includes("const COUNT_LIST_FILTERS: ListFilterKey[] = ['category'];"));
  assert.ok(src.includes('<FilterChipRow options={COUNT_FILTER_OPTIONS} value={countFilter} onChange={setCountFilter} />'));
  assert.match(src, /<ListFiltersSheet\n\s+visible=\{filtersOpen\}\n\s+filters=\{listFilters\}\n\s+keys=\{COUNT_LIST_FILTERS\}\n\s+onChange=\{setListFilters\}/, 'the funnel holds the Category only');
  assert.doesNotMatch(src, /ShowMode|SHOW_OPTIONS|showMode|showEmpty|noStockCount|CATEGORY_CHIPS|CategoryGroupHeading|buildListRows|groupCounts/, 'nothing is hidden, no category pills or groups');
  assert.ok(src.includes('useState<ProductCounts>(() => initialCounts(products))'));
  // each section fills on its own, and asks first
  assert.ok(src.includes("kind === 'none' ? `Set ${targets.length} ${noun} to 0?`") && src.includes("{ confirm: kind === 'none' ? 'Set to 0' : 'Fill', tone: 'warning' },"));
  assert.ok(src.includes("action: 'Set all to 0'") && src.includes("action: 'Use system stock for all'"));
  // what is submitted and when: unchanged
  const payloadSource = read('src/features/shifts/remittanceProducts.ts');
  assert.ok(payloadSource.includes("const waste = (row?.wasteQuantity ?? '0').trim() || '0';") && payloadSource.includes("...(waste !== '0' ? { waste_quantity: waste } : {}),"));
  assert.ok(src.includes('const canSubmit = cashResult != null && productsValid && incomplete === 0;'));
  assert.ok(src.includes('onSubmit(actualCash.trim(), buildFinalizePayload(allProducts, counts));'));
  assert.ok(src.includes('disabled={!canSubmit || loading}'));
  // earlier behaviour kept
  assert.ok(src.includes("onChangeText={(text) => onChange(text.replace(/[^\\d]/g, '').slice(0, 6))}"));
  assert.ok(src.includes('const settle = () => setSettled(countsRef.current);'));
  assert.ok(src.includes('returnKeyType="next"') && src.includes('else Keyboard.dismiss();'));
  assert.doesNotMatch(src, /useClientPagination|Pagination/);
  assert.doesNotMatch(src, /unsold_quantity|carried_quantity|ClosingStockBehaviorField|keep_at_branch|record_as_unsold/, 'the closing setting is still not shown to the cashier');
  assert.ok(src.includes("'View stock details'") && src.includes('Sales closed for today') && src.includes('Use {system}'));

  const dash = read('app/(cashier)/cashier/dashboard.tsx');
  assert.match(dash, /if \(pendingPreview && !\(shiftQuery\.isLoading && !shiftQuery\.data\) && !shiftQuery\.error\) \{/);
  assert.ok(dash.includes('onSubmit={(actualCash, products) => requestFinalize(pendingPreview, actualCash, products)}'));
  console.log('3. wiring: ok');
}

console.log('close_count_screen: ALL PASS');
