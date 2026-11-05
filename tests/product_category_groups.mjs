// The Products list is grouped by category: fixed group order, the chosen sort inside each group, a heading (icon, name, count)
// before each group, repeated at the top of a page when a group continues, and no headings while one category is picked.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadTs } from './_load_ts.mjs';

const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const g = loadTs('src/features/products/categoryGroups.ts');

const P = (id, name, product_category) => ({ id, name, is_active: true, product_category });
const byName = [
  P('1', 'Beef Curry', 'meals'), P('2', 'Bottled Water', 'drinks'), P('3', 'Cheesestick', 'snacks'), P('4', 'Coke Mismo', 'drinks'),
  P('5', 'Egg', 'supplies'), P('6', 'Extra Rice', 'extras'), P('7', 'Mystery', null), P('8', 'Adobo', 'meals'),
].sort((a, b) => a.name.localeCompare(b.name)); // what the screen's A-Z sort hands over
const names = (list) => list.map((p) => p.name);

// ---------------------------------------------------------------- 1. order
{
  assert.deepEqual(g.GROUP_ORDER, ['meals', 'snacks', 'drinks', 'extras', 'supplies', 'unset'], 'the same order as the categories in the wizard, then Not set');
  const grouped = g.groupByCategory(byName);
  assert.deepEqual(names(grouped), ['Adobo', 'Beef Curry', 'Cheesestick', 'Bottled Water', 'Coke Mismo', 'Extra Rice', 'Egg', 'Mystery'], 'groups in a fixed order, A-Z inside each');
  // the sort the screen chose is kept inside each group (here: Z-A)
  const zToA = [...byName].reverse();
  assert.deepEqual(names(g.groupByCategory(zToA)), ['Beef Curry', 'Adobo', 'Cheesestick', 'Coke Mismo', 'Bottled Water', 'Extra Rice', 'Egg', 'Mystery']);
  assert.deepEqual(names(g.groupByCategory([])), []);
  assert.deepEqual(names(g.groupByCategory([P('9', 'Odd', 'banana')])), ['Odd'], 'an unknown category counts as Not set');
  console.log('1. group order: ok');
}

// ---------------------------------------------------------------- 2. counts and titles
{
  const counts = g.groupCounts(byName);
  assert.deepEqual(counts, { meals: 2, drinks: 2, snacks: 1, supplies: 1, extras: 1, unset: 1 });
  assert.equal(g.groupTitle('meals'), 'Meals & Viands');
  assert.equal(g.groupTitle('supplies'), 'Inventory Supplies');
  assert.equal(g.groupTitle('unset'), 'Not set');
  console.log('2. counts and titles: ok');
}

// ---------------------------------------------------------------- 3. the rows of a page
{
  const grouped = g.groupByCategory(byName);
  const counts = g.groupCounts(grouped);
  const shape = (rows) => rows.map((r) => (r.type === 'header' ? `# ${r.title} ${r.count}` : r.item.name));
  assert.deepEqual(shape(g.buildListRows(grouped.slice(0, 5), counts, true)), ['# Meals & Viands 2', 'Adobo', 'Beef Curry', '# Snacks & Finger Foods 1', 'Cheesestick', '# Drinks 2', 'Bottled Water', 'Coke Mismo']);
  // page 2 starts in the middle of a group: its heading is repeated, with the count of the WHOLE group
  assert.deepEqual(shape(g.buildListRows(grouped.slice(4, 8), counts, true)), ['# Drinks 2', 'Coke Mismo', '# Extras & Sides 1', 'Extra Rice', '# Inventory Supplies 1', 'Egg', '# Not set 1', 'Mystery']);
  // one category picked: no headings
  assert.deepEqual(shape(g.buildListRows(grouped.slice(3, 5), counts, false)), ['Bottled Water', 'Coke Mismo']);
  assert.deepEqual(g.buildListRows([], counts, true), []);
  const keyed = g.buildListRows(grouped.slice(0, 2), counts, true);
  assert.deepEqual(keyed.map((r) => r.key), ['header-meals', '8', '1'], 'stable keys: the heading by group, the product by id');
  console.log('3. page rows: ok');
}

// ---------------------------------------------------------------- 4. wiring
{
  const screen = read('app/(manager)/manager/products/index.tsx');
  assert.match(screen, /return groupByCategory\(sorted\);/, 'the sort is applied first, then the grouping');
  assert.match(screen, /buildListRows\(pagination\.pageItems, counts, filters\.category === 'all'\)/, 'headings only while no single category is picked');
  assert.match(screen, /data=\{rows\}\n\s+keyExtractor=\{\(row\) => row\.key\}/);
  // the heading is one shared component: plain text, gray, in capitals, no icon (the rows already carry the category icon)
  assert.ok(screen.includes('return <CategoryGroupHeading title={row.title} count={row.count} />;'));
  const heading = read('src/features/products/CategoryGroupHeading.tsx');
  assert.doesNotMatch(heading, /CategoryIcon|Ionicons/, 'no icon in the heading');
  assert.match(heading, /title: \{ color: managerColors\.subtext,[^}]*textTransform: 'uppercase' \}/, 'gray, in capitals');
  assert.match(heading, /accessibilityRole="header"/);
  assert.match(screen, /useClientPagination\(\n\s+filtered,/, 'paging still works on the grouped list');
  // no "Not set" chip (every new product has a category); an old product without one still shows, under its own heading
  assert.ok(screen.includes('options={CATEGORY_CHIPS}'));
  assert.doesNotMatch(screen, /hasUnsetCategory|categoryChips/);
  console.log('4. wiring: ok');
}

// ---------------------------------------------------------------- 5. Main Inventory and the cashier POS use the same grouping
{
  // stock rows hold their product: the accessors read it out
  const row = (id, name, category, qty) => ({ product: P(id, name, category), quantity_on_hand: qty });
  const stock = [row('1', 'Beef Curry', 'meals', 5), row('2', 'Bottled Water', 'drinks', 0), row('3', 'Coke Mismo', 'drinks', 3), row('4', 'Adobo', 'meals', 1)];
  const productOf = (r) => r.product;
  const grouped = g.groupByCategory(stock, productOf);
  assert.deepEqual(grouped.map((r) => r.product.name), ['Beef Curry', 'Adobo', 'Bottled Water', 'Coke Mismo'], 'groups in order, the incoming order kept inside each');
  const counts = g.groupCounts(stock, productOf);
  assert.deepEqual(counts, { meals: 2, drinks: 2 });
  const rows = g.buildListRows(grouped, counts, true, productOf);
  assert.deepEqual(rows.map((r) => (r.type === 'header' ? '# ' + r.title + ' ' + r.count : r.key)), ['# Meals & Viands 2', '1', '4', '# Drinks 2', '2', '3'], 'headings by group, products keyed by their product id');
  assert.deepEqual(g.buildListRows(grouped, counts, false, productOf).map((r) => r.type), ['product', 'product', 'product', 'product'], 'no headings while one category is picked');

  const inventory = read('app/(manager)/manager/inventory/index.tsx');
  assert.ok(inventory.includes('return groupByCategory(sorted, (item) => item.product);'), 'Main Inventory: the chosen sort, then the grouping');
  assert.ok(inventory.includes("buildListRows(pagination.pageItems, counts, listFilters.category === 'all', (item) => item.product)"));
  assert.match(inventory, /data=\{listRows\}\n\s+keyExtractor=\{\(row\) => row\.key\}/);
  assert.ok(inventory.includes("if (row.type === 'header') return <CategoryGroupHeading title={row.title} count={row.count} />;"));

  const pos = read('app/(cashier)/cashier/pos.tsx');
  assert.ok(pos.includes('groupByCategory(filterPosInventory(limitedInventory.filter((item) => matchesListFilters(item.product, listFilters)), search), (item) => item.product)'), 'POS: the in-stock / search order, then the grouping');
  assert.ok(pos.includes("buildListRows(pagination.pageItems, groupSizes, listFilters.category === 'all', (item) => item.product)"));
  assert.match(pos, /data=\{listRows\}\n\s+keyExtractor=\{\(row\) => row\.key\}/);
  assert.ok(pos.includes("if (row.type === 'header') return <CategoryGroupHeading title={row.title} count={row.count} />;"));
  assert.match(pos, /useClientPagination\(filteredInventory,/, 'paging counts products, not headings');
  console.log('5. Main Inventory and POS: ok');
}

console.log('product_category_groups: ALL PASS');
