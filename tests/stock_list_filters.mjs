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
  assert.equal(only({ category: 'unset' }).length, 1, 'an old product with no category is still reachable under All (and a leftover "unset" value would still match it)');
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
  assert.deepEqual(f.listFilterTags({ category: 'meals', pos: 'all', returns: 'non_returnable' }).map((t) => t.label), ['Meals', 'Stays at branch']);
  assert.deepEqual(f.listFilterTags(f.DEFAULT_LIST_FILTERS), [], 'no filters, no tags');
  // search matches the category name too
  const match = (term) => names(all.filter((p) => f.productSearchText(p).includes(term)));
  assert.deepEqual(match('drinks'), ['Bottled Water', 'Coke Mismo'], 'typing a category finds it');
  assert.deepEqual(match('bottled'), ['Bottled Water']);
  assert.deepEqual(match('rice'), ['Rice'], 'name and SKU still work');
  assert.deepEqual(match('meals'), ['Beef Curry']);
  assert.ok(!f.productSearchText(rice).includes('null') && !f.productSearchText(rice).includes('undefined'), 'no category: nothing is appended');
  assert.deepEqual(Object.keys(f.LIST_FILTER_ROWS), ['category', 'pos', 'returns']);
  assert.deepEqual(f.LIST_FILTER_ROWS.category.options.map((o) => o.value), ['all', 'meals', 'snacks', 'drinks', 'extras', 'supplies'], 'no "Not set" under Category');
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
    if (name === 'Opening stock') {
      // Opening stock is the other way round: Category is the row of pills, the funnel holds only "Stock" (All / Not set / Has stock).
      // "Show in Cashier POS" and "Keep Unsold Stock at Branch" have no use when counting stock.
      assert.ok(src.includes("const SETUP_FILTER_KEYS: ListFilterKey[] = [];"), 'no list-filter row in the funnel');
      assert.doesNotMatch(src, /ALL_LIST_FILTER_KEYS/);
      assert.ok(src.includes("(filter !== 'all' ? 1 : 0)") && src.includes('countListFilters(listFilters, SETUP_FILTER_KEYS) +'), 'the funnel badge counts the Stock row');
      assert.match(src, /<ListFiltersSheet\n\s+visible=\{filtersOpen\}\n\s+filters=\{listFilters\}\n\s+keys=\{SETUP_FILTER_KEYS\}\n\s+extra=\{stockFilter\}/, 'the sheet holds the Stock row only');
      assert.match(src, /<ListFilterSummary[\s\S]*?keys=\{SETUP_FILTER_KEYS\}\s+extra=\{stockFilter\}/, 'tags and Clear all know the Stock row');
      assert.ok(src.includes("title: 'Stock',") && src.includes('options: FILTER_OPTIONS,'));
      assert.deepEqual([...src.matchAll(/\{ label: '([^']+)', value: '(all|not_set|has_stock)' \}/g)].map((m) => m[1]), ['All', 'Not set', 'Has stock'], 'All / Not set / Has stock');
      assert.match(src, /<FilterChipRow\n\s+options=\{CATEGORY_CHIPS\}\n\s+value=\{listFilters\.category\}/, 'the pills are the categories');
      assert.doesNotMatch(src, /<FilterChipRow options=\{FILTER_OPTIONS\}/, 'the Not set / Has stock pills moved into the funnel');
      assert.ok(src.includes('<CategoryIcon category={choice.value} size={18} decorative />'), 'pills carry the category icon like Products');
      // grouped by category like Main Inventory, with a heading in front of each group
      assert.ok(src.includes('return groupByCategory(sorted, (row) => row.item!.product);'), 'category groups, the chosen sort inside each');
      assert.ok(src.includes("buildListRows(pagination.pageItems, groupTotals, listFilters.category === 'all', (row) => row.item!.product)"), 'no headings while one category is picked');
      assert.ok(src.includes('<CategoryGroupHeading key={listRow.key} title={listRow.title} count={listRow.count} />'));
    } else {
      assert.ok(src.includes('<FilterIconButton count={countListFilters(listFilters)} onPress={() => setFiltersOpen(true)} />'), `${name}: funnel button next to Sort`);
      assert.match(src, /<ListFiltersSheet\n\s+visible=\{filtersOpen\}\n\s+filters=\{listFilters\}\n\s+keys=\{ALL_LIST_FILTER_KEYS\}/, `${name}: all three filters`);
    }
    assert.match(src, /matchesListFilters\(row\.item\.product, listFilters\)|matchesListFilters\(item\.product, listFilters\)/, `${name}: the list is filtered`);
    assert.match(src, /productSearchText\(/, `${name}: search matches the category`);
    assert.match(src, /JSON\.stringify\(listFilters\)/, `${name}: changing a filter goes back to page 1`);
    assert.match(src, /<ListFilterSummary/, `${name}: tags and Clear all`);
  }
  // quantities typed on the form screens survive filtering: only the rendered rows are filtered, not the form fields
  const opening = read('src/features/inventory/InventorySetupScreen.tsx');
  assert.match(opening, /const completedCount = counted\.filter/, 'Opening stock totals still count every listed product, filtered or not (products with no stock of their own are never counted)');
  assert.match(opening, /const counted = watchedItems\.filter\(\(item\) => countableIds\.has\(item\.product_id\)\);/);
  assert.match(opening, /\.map\(\(field, index\) => \(\{ field, index, item: itemsById\.get\(field\.product_id\) \}\)\)\n\s+\.filter\(/, 'rows are filtered after the form fields are built');

  const pos = read('app/(cashier)/cashier/pos.tsx');
  // the POS offers the category only, as a row of pills under the search box: no funnel button, no filter sheet
  assert.match(pos, /<FilterChipRow\n\s+options=\{CATEGORY_CHIPS\}\n\s+value=\{listFilters\.category\}\n\s+onChange=\{\(category\) => setListFilters\(\{ \.\.\.listFilters, category \}\)\}\n\s+bleed=\{COLUMN_PADDING\}/, 'category pills');
  assert.ok(pos.includes('<CategoryIcon category={choice.value} size={18} decorative />'), 'pills carry the category icon');
  assert.doesNotMatch(pos, /FilterIconButton|ListFiltersSheet|ListFilterSummary|POS_FILTER_KEYS|filtersOpen/, 'no funnel and no sheet on the POS');
  assert.ok(pos.includes("const filtersOn = listFilters.category !== 'all';"));
  assert.match(pos, /filterPosInventory\(limitedInventory\.filter\(\(item\) => matchesListFilters\(item\.product, listFilters\)\), search\)/, 'category first, then the in-stock / search rule');
  assert.match(read('src/features/products/ProductFilterControls.tsx'), /export function ListFiltersSheet/);
  // each category choice carries the same picture as the product rows and the Products chips; "All" gets a neutral one
  const controls = read('src/features/products/ProductFilterControls.tsx');
  assert.ok(controls.includes("<CategoryIcon category={option.value} size={24} decorative />"));
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
  // Opening stock: no list-filter rows, just its own "Stock" row; the tag + Clear all know about it
  const changes = [];
  const stockRow = (value) => ({ title: 'Stock', options: [{ label: 'All', value: 'all' }, { label: 'Not set', value: 'not_set' }, { label: 'Has stock', value: 'has_stock' }], value, onChange: (v) => changes.push(v) });
  const html = (extra) => renderToStaticMarkup(React.createElement(controls.ListFiltersSheet, { visible: true, filters: f.DEFAULT_LIST_FILTERS, keys: [], extra, onChange() {}, onClose() {} }));
  const off = html(stockRow('all'));
  assert.match(off, /Stock/);
  assert.doesNotMatch(off, /Category|Show in Cashier POS|Keep Unsold Stock at Branch|Reset|Done/, 'only the Stock row: nothing to reset and no Done button');
  assert.doesNotMatch(render(f.DEFAULT_LIST_FILTERS, ['category', 'pos', 'returns']), /Done/, 'no Done button on the three-row sheet either');
  assert.match(html(stockRow('not_set')), /Reset/, 'a Stock choice other than All can be reset');
  const summary = (extra) => renderToStaticMarkup(React.createElement(controls.ListFilterSummary, { countText: '2 of 7 products', filters: f.DEFAULT_LIST_FILTERS, keys: [], extra, onChange() {} }));
  assert.equal(summary(stockRow('all')), '', 'nothing shown while Stock is All');
  assert.match(summary(stockRow('has_stock')), /2 of 7 products[\s\S]*Clear all[\s\S]*Remove filter Has stock/, 'the count, Clear all and a removable tag');
  console.log('5. sheet loads and renders: ok');
}

// ---------------------------------------------------------------- 6. "Not set" is gone from every Category filter, for good
{
  assert.ok(!f.LIST_FILTER_ROWS.category.options.some((o) => o.value === 'unset' || /Not set/i.test(o.label)), 'the sheets');
  const { CATEGORY_CHIP_CHOICES, CATEGORY_FILTER_CHOICES } = loadTs('src/features/products/productFilters.ts');
  assert.ok(![...CATEGORY_CHIP_CHOICES, ...CATEGORY_FILTER_CHOICES].some((c) => c.value === 'unset' || /Not set/i.test(c.label)), 'the Products chips');
  for (const file of ['app/(manager)/manager/inventory/index.tsx', 'src/features/inventory/InventorySetupScreen.tsx', 'src/features/transfers/CreateTransferScreen.tsx', 'app/(cashier)/cashier/pos.tsx', 'app/(manager)/manager/products/index.tsx', 'src/features/products/ProductFilterControls.tsx']) {
    assert.doesNotMatch(read(file), /useUnsetCategoryFilter|showUnsetCategory|hasUnsetCategory/, `${file}: no leftover "hide when none" code`);
  }
  console.log('6. no "Not set" filter: ok');
}

console.log('stock_list_filters: ALL PASS');
