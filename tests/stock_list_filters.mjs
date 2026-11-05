// Category / Show in Cashier POS / Keep Unsold Stock at Branch filters on the stock screens (Main Inventory, Opening stock, Send
// stock, cashier POS), behind a funnel button next to Sort. Pure logic is tested directly; the screens are checked as wiring.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { loadTs } from './_load_ts.mjs';

const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const f = loadTs('src/features/products/listFilters.ts');
const { filterPosInventory } = loadTs('src/features/pos/posInventory.ts');

const P = (name, sku, extra = {}) => ({ name, sku, is_active: true, ...extra });
const curry = P('Beef Curry', 'BEEF-CURRY', { product_category: 'meals' });
const water = P('Bottled Water', 'BOTTLED-WATER', { product_category: 'drinks', is_non_returnable: true });
const coke = P('Coke Mismo', 'COKE-MISMO', { product_category: 'drinks' });
const egg = P('Egg', 'EGG', { product_category: 'supplies', sell_in_pos: false });
const rice = P('Rice', 'RICE'); // no category saved
const all = [curry, water, coke, egg, rice];
const names = (list) => list.map((p) => p.name);
const only = (patch) => names(all.filter((p) => f.matchesListFilters(p, { ...f.DEFAULT_LIST_FILTERS, ...patch })));

// ---------------------------------------------------------------- 1. the filters
{
  assert.deepEqual(only({}), names(all), 'nothing set: everything shows');
  assert.deepEqual(only({ category: 'drinks' }), ['Bottled Water', 'Coke Mismo']);
  assert.deepEqual(only({ category: 'meals' }), ['Beef Curry']);
  assert.deepEqual(only({ category: 'supplies' }), ['Egg']);
  assert.deepEqual(only({ category: 'unset' }), ['Rice'], 'a product with no saved category is "Not set"');
  assert.deepEqual(only({ pos: 'stock_only' }), ['Egg']);
  assert.deepEqual(only({ pos: 'pos' }), ['Beef Curry', 'Bottled Water', 'Coke Mismo', 'Rice'], 'a missing flag means sold in POS, as everywhere else');
  assert.deepEqual(only({ returns: 'non_returnable' }), ['Bottled Water']);
  assert.deepEqual(only({ returns: 'returnable' }), ['Beef Curry', 'Coke Mismo', 'Egg', 'Rice']);
  assert.deepEqual(only({ category: 'drinks', returns: 'returnable' }), ['Coke Mismo'], 'filters combine');
  assert.deepEqual(only({ category: 'meals', pos: 'stock_only' }), [], 'a combination that matches nothing');
  console.log('1. filters: ok');
}

// ---------------------------------------------------------------- 2. badge, tags, search
{
  assert.equal(f.countListFilters(f.DEFAULT_LIST_FILTERS), 0);
  assert.equal(f.countListFilters({ category: 'drinks', pos: 'all', returns: 'non_returnable' }), 2);
  assert.equal(f.countListFilters({ category: 'drinks', pos: 'pos', returns: 'non_returnable' }, ['category']), 1, 'only the rows a screen offers count');
  assert.deepEqual(f.listFilterTags({ category: 'drinks', pos: 'stock_only', returns: 'all' }), [{ key: 'category', label: 'Drinks' }, { key: 'pos', label: 'Stock only' }]);
  assert.deepEqual(f.listFilterTags({ category: 'unset', pos: 'all', returns: 'non_returnable' }).map((t) => t.label), ['Not set', 'Stays at branch']);
  assert.deepEqual(f.listFilterTags(f.DEFAULT_LIST_FILTERS), [], 'no filters, no tags');
  // search matches the category name too
  const match = (term) => names(all.filter((p) => f.productSearchText(p).includes(term)));
  assert.deepEqual(match('drinks'), ['Bottled Water', 'Coke Mismo'], 'typing a category finds it');
  assert.deepEqual(match('bottled'), ['Bottled Water']);
  assert.deepEqual(match('rice'), ['Rice'], 'name and SKU still work');
  assert.deepEqual(match('meals'), ['Beef Curry']);
  assert.ok(!f.productSearchText(rice).includes('null') && !f.productSearchText(rice).includes('undefined'), 'no category: nothing is appended');
  assert.deepEqual(Object.keys(f.LIST_FILTER_ROWS), ['category', 'pos', 'returns']);
  assert.deepEqual(f.LIST_FILTER_ROWS.category.options.map((o) => o.value), ['all', 'meals', 'snacks', 'drinks', 'extras', 'supplies', 'unset'].filter((v) => f.LIST_FILTER_ROWS.category.options.some((o) => o.value === v)));
  assert.match(f.listFilterEmptyMessage(false).title, /No products match these filters/);
  assert.match(f.listFilterEmptyMessage(true).message, /clear the filters/);
  console.log('2. badge, tags, search: ok');
}

// ---------------------------------------------------------------- 3. the cashier POS keeps its own rules
{
  const item = (product, quantity_on_hand) => ({ product, quantity_on_hand });
  const stock = [item(curry, 5), item(water, 0), item(coke, 3)];
  // default list: in-stock only; the category filter is applied before it
  const drinks = stock.filter((entry) => f.matchesListFilters(entry.product, { ...f.DEFAULT_LIST_FILTERS, category: 'drinks' }));
  assert.deepEqual(names(filterPosInventory(drinks, '').map((e) => e.product)), ['Coke Mismo'], 'drinks, in stock only');
  // a search still reaches out-of-stock products (sorted last), and now also matches the category name
  assert.deepEqual(names(filterPosInventory(stock, 'drinks').map((e) => e.product)), ['Coke Mismo', 'Bottled Water']);
  assert.deepEqual(names(filterPosInventory(stock, 'coke').map((e) => e.product)), ['Coke Mismo']);
  console.log('3. cashier POS: ok');
}

// ---------------------------------------------------------------- 4. wiring
{
  const screens = [
    ['Main Inventory', 'app/(manager)/manager/inventory/index.tsx'],
    ['Opening stock', 'src/features/inventory/InventorySetupScreen.tsx'],
    ['Send stock', 'src/features/transfers/CreateTransferScreen.tsx'],
  ];
  for (const [name, file] of screens) {
    const src = read(file);
    assert.match(src, /<FilterIconButton count=\{countListFilters\(listFilters\)\} onPress=\{\(\) => setFiltersOpen\(true\)\} \/>/, `${name}: funnel button next to Sort`);
    assert.match(src, /<ListFiltersSheet\n\s+visible=\{filtersOpen\}\n\s+filters=\{listFilters\}\n\s+keys=\{ALL_LIST_FILTER_KEYS\}/, `${name}: all three filters`);
    assert.match(src, /matchesListFilters\(row\.item\.product, listFilters\)|matchesListFilters\(item\.product, listFilters\)/, `${name}: the list is filtered`);
    assert.match(src, /productSearchText\(/, `${name}: search matches the category`);
    assert.match(src, /JSON\.stringify\(listFilters\)/, `${name}: changing a filter goes back to page 1`);
    assert.match(src, /<ListFilterSummary/, `${name}: tags and Clear all`);
  }
  // quantities typed on the form screens survive filtering: only the rendered rows are filtered, not the form fields
  const opening = read('src/features/inventory/InventorySetupScreen.tsx');
  assert.match(opening, /const completedCount = watchedItems\.filter/, 'Opening stock totals still count every product, filtered or not');
  assert.match(opening, /\.map\(\(field, index\) => \(\{ field, index, item: itemsById\.get\(field\.product_id\) \}\)\)\n\s+\.filter\(/, 'rows are filtered after the form fields are built');

  const pos = read('app/(cashier)/cashier/pos.tsx');
  assert.match(pos, /const POS_FILTER_KEYS: ListFilterKey\[\] = \['category'\];/, 'the POS offers the category only');
  assert.match(pos, /<FilterIconButton count=\{countListFilters\(listFilters, POS_FILTER_KEYS\)\}/);
  assert.match(pos, /filterPosInventory\(limitedInventory\.filter\(\(item\) => matchesListFilters\(item\.product, listFilters\)\), search\)/, 'category first, then the in-stock / search rule');
  assert.match(pos, /<ListFiltersSheet\n\s+visible=\{filtersOpen\}\n\s+filters=\{listFilters\}\n\s+keys=\{POS_FILTER_KEYS\}/);
  assert.match(read('src/features/products/ProductFilterControls.tsx'), /export function ListFiltersSheet/);
  // each category choice carries the same picture as the product rows and the Products chips; "All" gets a neutral one
  const controls = read('src/features/products/ProductFilterControls.tsx');
  assert.ok(controls.includes("<CategoryIcon category={option.value === 'unset' ? null : option.value} size={24} decorative />"));
  assert.ok(controls.includes('name="apps-outline"'));
  assert.ok(controls.includes("options={key === 'category' ? categoryOptions : LIST_FILTER_ROWS[key].options}"), 'only the Category row has pictures');
  assert.ok(controls.includes('{option.leading ?? null}'));
  console.log('4. wiring: ok');
}

// ---------------------------------------------------------------- 5. the sheet really loads and renders (a source-text check missed a load-time error)
{
  const require = createRequire(import.meta.url);
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const rnw = require('react-native-web');
  const controls = loadTs('src/features/products/ProductFilterControls.tsx', {
    'react-native': rnw,
    '@react-native-vector-icons/ionicons': { __esModule: true, default: (props) => React.createElement('i', { 'data-icon': props.name }) },
    '@/components/GlyphIcon': { GlyphIcon: (props) => React.createElement('i', { 'data-glyph': props.name }) },
    '@/components/dashboard/ManagerActionButton': { ManagerActionButton: (props) => React.createElement('b', null, props.label) },
    '@/components/dashboard/ManagerBottomSheet': { ManagerBottomSheet: (props) => React.createElement('section', null, props.children) },
  });
  assert.equal(typeof controls.ListFiltersSheet, 'function', 'the module loads');
  const render = (filters, keys) => renderToStaticMarkup(React.createElement(controls.ListFiltersSheet, { visible: true, filters, keys, onChange() {}, onClose() {} }));
  const closed = render(f.DEFAULT_LIST_FILTERS, ['category', 'pos', 'returns']);
  assert.match(closed, /Category/);
  assert.match(closed, /Show in Cashier POS/);
  assert.match(closed, /Keep Unsold Stock at Branch/);
  // the Category choices (shown when the row is opened) each render with a picture; "All" has the neutral one
  const options = controls.categoryOptionsWithIcons();
  assert.deepEqual(options.map((o) => o.value), f.LIST_FILTER_ROWS.category.options.map((o) => o.value));
  options.forEach((option) => {
    const html = renderToStaticMarkup(option.leading);
    assert.match(html, option.value === 'all' ? /data-icon="apps-outline"/ : /data-glyph="/, `${option.label}: has an icon`);
  });
  console.log('5. sheet loads and renders: ok');
}

console.log('stock_list_filters: ALL PASS');
