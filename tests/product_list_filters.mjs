// Products list filters: Category, Enable Product, Show in Cashier POS and Keep Unsold Stock at Branch (pure logic + source pins).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadTs } from './_load_ts.mjs';

const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const F = loadTs('src/features/products/productFilters.ts');
const {
  DEFAULT_PRODUCT_FILTERS, CATEGORY_FILTER_CHOICES, CATEGORY_CHIP_CHOICES, POS_FILTER_CHOICES, RETURN_FILTER_CHOICES, PRODUCT_FILTER_CHOICES,
  matchesProductFilters, countActiveFilters, countSheetFilters, activeFilterTags, categoryOf, categoryLabelOf, productFilterEmptyMessage,
} = F;

const p = (name, o = {}) => ({ name, is_active: true, product_category: null, sell_in_pos: true, is_non_returnable: false, ...o });
const products = [
  p('Chicken Curry', { product_category: 'meals' }),
  p('BBQ', { product_category: 'snacks', is_non_returnable: true }),
  p('Coke', { product_category: 'drinks', is_non_returnable: true }),
  p('Royal', { product_category: 'drinks', is_active: false }),
  p('Extra Rice', { product_category: 'extras' }),
  p('rice', { product_category: 'supplies', sell_in_pos: false }),
  p('Egg', { product_category: 'supplies', sell_in_pos: false, is_active: false }),
  p('Old Product'),                                                              // never categorised
  { name: 'Legacy', is_active: true },                                           // flags missing entirely (older rows)
  p('Odd', { product_category: 'something-new' }),                               // a value this app does not know
];
const names = (filters) => products.filter((x) => matchesProductFilters(x, filters)).map((x) => x.name);
const only = (patch) => ({ ...DEFAULT_PRODUCT_FILTERS, ...patch });

// ---- defaults show everything
assert.equal(names(DEFAULT_PRODUCT_FILTERS).length, products.length);
assert.equal(countActiveFilters(DEFAULT_PRODUCT_FILTERS), 0);
assert.deepEqual(activeFilterTags(DEFAULT_PRODUCT_FILTERS), []);

// ---- category
for (const [category, expected] of [
  ['meals', ['Chicken Curry']],
  ['snacks', ['BBQ']],
  ['drinks', ['Coke', 'Royal']],
  ['extras', ['Extra Rice']],
  ['supplies', ['rice', 'Egg']],
]) assert.deepEqual(names(only({ category })), expected, `category ${category}`);
assert.deepEqual(CATEGORY_FILTER_CHOICES.map((c) => c.value), ['all', 'meals', 'snacks', 'drinks', 'extras', 'supplies'], 'no "Not set" filter: every new product has a category');
assert.deepEqual(CATEGORY_FILTER_CHOICES.map((c) => c.label), ['All', 'Meals & Viands', 'Snacks & Finger Foods', 'Drinks', 'Extras & Sides', 'Inventory Supplies']);
assert.equal(categoryOf(p('x', { product_category: 'something-new' })), 'unset', 'an unknown value counts as Not set');
assert.equal(categoryLabelOf(p('x', { product_category: 'supplies' })), 'Inventory Supplies');
assert.equal(categoryLabelOf(p('x')), null);

// ---- product status
assert.deepEqual(names(only({ status: 'active' })), ['Chicken Curry', 'BBQ', 'Coke', 'Extra Rice', 'rice', 'Old Product', 'Legacy', 'Odd']);
assert.deepEqual(names(only({ status: 'inactive' })), ['Royal', 'Egg']);

// ---- sell in POS (a missing flag has always meant "sold in POS")
assert.deepEqual(names(only({ pos: 'stock_only' })), ['rice', 'Egg']);
assert.deepEqual(names(only({ pos: 'pos' })), ['Chicken Curry', 'BBQ', 'Coke', 'Royal', 'Extra Rice', 'Old Product', 'Legacy', 'Odd']);
assert.equal(matchesProductFilters({ is_active: true, sell_in_pos: null }, only({ pos: 'pos' })), true);

// ---- returns (a missing flag means returnable)
assert.deepEqual(names(only({ returns: 'non_returnable' })), ['BBQ', 'Coke']);
assert.equal(names(only({ returns: 'returnable' })).length, products.length - 2);
assert.equal(matchesProductFilters({ is_active: true }, only({ returns: 'returnable' })), true);
assert.equal(matchesProductFilters({ is_active: true, is_non_returnable: null }, only({ returns: 'non_returnable' })), false);

// ---- combinations narrow, they never widen
assert.deepEqual(names(only({ category: 'drinks', status: 'active' })), ['Coke']);
assert.deepEqual(names(only({ category: 'drinks', returns: 'non_returnable', status: 'active', pos: 'pos' })), ['Coke']);
assert.deepEqual(names(only({ category: 'supplies', pos: 'stock_only', status: 'inactive' })), ['Egg']);
assert.deepEqual(names(only({ category: 'meals', returns: 'non_returnable' })), []);
assert.equal(countActiveFilters(only({ category: 'drinks', pos: 'pos', status: 'active', returns: 'returnable' })), 4);

// ---- the badge counts the SHEET filters (Enable Product, Show in Cashier POS, Keep Unsold Stock at Branch); Category has its own chips on the screen
assert.equal(countSheetFilters(only({ category: 'drinks' })), 0);
assert.equal(countSheetFilters(only({ category: 'drinks', status: 'inactive' })), 1);
assert.equal(countSheetFilters(only({ status: 'active', pos: 'pos', returns: 'returnable', category: 'meals' })), 3);

// ---- removable tags: Enable Product, Show in Cashier POS, Keep Unsold Stock at Branch (never Category: its chip shows it)
assert.deepEqual(activeFilterTags(only({ category: 'extras', pos: 'stock_only', returns: 'non_returnable', status: 'active' })),
  [{ key: 'status', label: 'Enabled' }, { key: 'pos', label: 'Stock only' }, { key: 'returns', label: 'Stays at branch' }]);
assert.deepEqual(activeFilterTags(only({ status: 'inactive' })), [{ key: 'status', label: 'Disabled' }]);
assert.deepEqual(activeFilterTags(only({ category: 'drinks' })), []);

// ---- choices
assert.deepEqual(CATEGORY_CHIP_CHOICES.map((c) => c.value), CATEGORY_FILTER_CHOICES.map((c) => c.value), 'same choices as the full list');
assert.deepEqual(CATEGORY_CHIP_CHOICES.map((c) => c.label), ['All', 'Meals', 'Snacks', 'Drinks', 'Extras', 'Supplies'], 'short names on the chips');
assert.deepEqual(PRODUCT_FILTER_CHOICES.map((c) => c.value), ['all', 'active', 'inactive']);
assert.deepEqual(POS_FILTER_CHOICES.map((c) => c.value), ['all', 'pos', 'stock_only']);
assert.deepEqual(RETURN_FILTER_CHOICES.map((c) => c.value), ['all', 'non_returnable', 'returnable']);

// ---- empty states
assert.equal(productFilterEmptyMessage('all', false, true).title, 'No products yet');
assert.equal(productFilterEmptyMessage('active', false, true).title, 'No enabled products');
assert.equal(productFilterEmptyMessage('all', false, true, true).title, 'No products match these filters');
assert.equal(productFilterEmptyMessage('all', true, true).title, 'No matches');
assert.match(productFilterEmptyMessage('all', true, true, true).message, /clear the filters/);

// ---- the screen is wired to it
const screen = read('app/(manager)/manager/products/index.tsx');
assert.match(screen, /matchesProductFilters\(product, filters\)/, 'the list uses all four filters');
assert.match(screen, /<ProductFilterButton count=\{countSheetFilters\(filters\)\}/);
assert.match(screen, /options=\{CATEGORY_CHIPS\}\s+bleed=\{COLUMN_PADDING\}\s+keepSelectedVisible\s+value=\{filters\.category\}/, 'Category chips are on the screen, run to the screen edges and keep the selected chip in view');
assert.match(screen, /const CATEGORY_CHIPS = CATEGORY_CHIP_CHOICES\.map\(/, 'the chips are the same category choices, with an icon added');
assert.doesNotMatch(screen, /statusChoices|statusCounts/, 'the status chips are gone from the screen (status lives in the sheet)');
assert.doesNotMatch(screen, /label="Clear filters"/, 'no button in the empty result; "Clear all" in the count line is the way out');
assert.match(screen, /onClearAll=\{clearAll\}/);
assert.match(screen, /ListEmptyComponent=\{<EmptyState title=\{empty\.title\} message=\{empty\.message\} \/>\}/);
assert.match(screen, /<ProductFiltersSheet/);
assert.match(screen, /<ProductFilterSummary/);
assert.match(screen, /<SortIconButton/, 'Sort uses the shared toolbar button');
assert.match(read('src/components/dashboard/ToolbarIconButtons.tsx'), /icon="swap-vertical-outline"/, 'Sort has its own icon, so it is not mistaken for Filters');
assert.match(screen, /setFilters\(\{ \.\.\.DEFAULT_PRODUCT_FILTERS, status: active \? 'all' : 'inactive' \}\)/, 'a new product is never hidden by an old filter');
assert.match(screen, /setFilters\(DEFAULT_PRODUCT_FILTERS\);\n\s+setSearch\(values\.sku\)/);
assert.match(screen, /const text = productRowText\(item\);/, 'the card text comes from one helper');
assert.doesNotMatch(screen, /setFilter\(/, 'no leftover single-filter setter');

// ---- the Filters sheet: three rows with their current value, Reset only while a filter is on (no Done), no descriptions, no count in the button
const controls = read('src/features/products/ProductFilterControls.tsx');
assert.match(controls, /\{ key: 'status', title: 'Enable Product'/);
assert.match(controls, /\{ key: 'pos', title: 'Show in Cashier POS'/);
assert.match(controls, /\{ key: 'returns', title: 'Keep Unsold Stock at Branch'/);
assert.doesNotMatch(controls, /label="Done"/, 'no Done button: a pick applies straight away and the sheet has its Close link, like Sort');
assert.ok(controls.includes('if (rowCount === 1) onClose();'), 'a sheet with a single row closes when its choice is made, like Sort');
assert.match(controls, /label="Reset"/);
assert.doesNotMatch(controls, /ingredients and are not sold|stay at the branch|groupHint|Show \$\{/, 'no description text and no "Show N products" button');
assert.doesNotMatch(screen, /<ProductFiltersSheet[^>]*resultCount/, 'the sheet takes no product count');

console.log('product_list_filters: ALL PASS');
