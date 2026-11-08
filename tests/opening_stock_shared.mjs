// Opening stock vs products that have no stock of their own. A product whose EVERY sale takes only from other products (Extra Rice ->
// Rice x1) is not listed, not "Not set" and not "remaining" in Opening stock; everything else still counts its own stock. Decided
// from the real deduction rules, never the category. Nothing is deleted or reset: this only changes what is listed.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadTs } from './_load_ts.mjs';

const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const { buildStockSetup } = loadTs('src/features/inventory/sharedStock.ts');

const P = (id, name, extra = {}) => ({ id, name, ...extra });
const use = (product_id, variant_id, ingredient_product_id, quantity = 1) => ({ product_id, variant_id, ingredient_product_id, quantity });
const V = (id, product_id, name, sort_order = 1) => ({ id, product_id, name, sort_order });
const setup = (parts) => buildStockSetup({ products: [], variants: [], stockUses: [], drinkChoices: [], ...parts });
const sharedNames = (s, products) => products.filter((p) => s.shared.has(p.id)).map((p) => p.name).sort();

// ---------------------------------------------------------------- 1. the rule
{
  const rice = P('rice', 'Rice');
  const egg = P('egg', 'Egg');
  const extraRice = P('xr', 'Extra Rice');
  const curry = P('curry', 'Beef Curry');
  const cheese = P('cheese', 'Cheesestick');
  const water = P('water', 'Bottled Water');
  const products = [rice, egg, extraRice, curry, cheese, water];

  // Extra Rice takes Rice x1 and nothing else: shared. Rice, which everything uses, is not.
  let s = setup({ products, stockUses: [use('xr', null, 'rice')] });
  assert.deepEqual(sharedNames(s, products), ['Extra Rice']);
  assert.deepEqual(s.sources.get('xr'), [{ id: 'rice', name: 'Rice' }]);
  // standalone products (no list at all) count their own stock: the default is the product itself x1
  assert.ok(!s.shared.has('water') && !s.shared.has('rice') && !s.shared.has('cheese'));

  // a mixed list (its own stock AND another item) is NOT shared: it deducts its own stock too
  s = setup({ products, stockUses: [use('curry', null, 'curry'), use('curry', null, 'rice')] });
  assert.equal(s.shared.has('curry'), false, 'mixed-stock product keeps its own stock');
  // a snack that deducts its own item x3 is not shared
  s = setup({ products, variants: [V('a', 'cheese', '3 Pcs')], stockUses: [use('cheese', 'a', 'cheese', 3)] });
  assert.equal(s.shared.has('cheese'), false);

  // options: it only counts as shared when EVERY option resolves to other items
  const opts = [V('s', 'xr', 'Small', 1), V('l', 'xr', 'Large', 2)];
  s = setup({ products, variants: opts, stockUses: [use('xr', null, 'rice')] });
  assert.equal(s.shared.has('xr'), true, 'options that inherit the product-level list of other items');
  s = setup({ products, variants: opts, stockUses: [use('xr', 's', 'rice'), use('xr', 'l', 'rice', 2)] });
  assert.equal(s.shared.has('xr'), true, 'each option has its own list of other items');
  s = setup({ products, variants: opts, stockUses: [use('xr', 's', 'rice')] });
  assert.equal(s.shared.has('xr'), false, 'Large has no list and there is no product-level list: it uses the product itself x1');
  s = setup({ products, variants: opts, stockUses: [use('xr', 's', 'rice'), use('xr', 'l', 'xr')] });
  assert.equal(s.shared.has('xr'), false, 'one option lists its own stock');
  s = setup({ products, variants: opts, stockUses: [use('xr', null, 'rice'), use('xr', 'l', 'xr')] });
  assert.equal(s.shared.has('xr'), false, 'an option overriding the product-level list with its own stock');

  // never shared while something else needs its own stock
  s = setup({ products, stockUses: [use('xr', null, 'rice'), use('curry', null, 'xr')] });
  assert.equal(s.shared.has('xr'), false, 'another product lists Extra Rice as an ingredient');
  s = setup({ products, stockUses: [use('xr', null, 'rice')], drinkChoices: [{ product_id: 'curry', variant_id: 'v', drink_product_id: 'xr' }] });
  assert.equal(s.shared.has('xr'), false, 'it is offered as a drink choice');
  // a stock-only product is never shared
  s = setup({ products: [P('sup', 'Supply', { sell_in_pos: false })], stockUses: [use('sup', null, 'rice')] });
  assert.equal(s.shared.size, 0);
  // nothing to go on: nothing is hidden
  assert.equal(setup({ products }).shared.size, 0);
  assert.equal(setup({}).shared.size, 0);
  // a product taking from TWO other items is shared, and lists both; the item another product takes from stays a normal stock item
  s = setup({ products, stockUses: [use('egg', null, 'rice'), use('egg', null, 'xr')] });
  assert.equal(s.shared.has('egg'), true);
  assert.deepEqual(s.sources.get('egg').map((x) => x.name), ['Extra Rice', 'Rice']);
  assert.equal(s.shared.has('xr'), false, 'Extra Rice is needed by the product that takes from it');
  console.log('1. which products are shared: ok');
}

// ---------------------------------------------------------------- 2. the screen
{
  const src = read('src/features/inventory/InventorySetupScreen.tsx');
  assert.ok(src.includes('const countableItems = useMemo(() => (inventory.data ?? []).filter((item) => !setup?.shared.has(item.product.id)), [inventory.data, setup]);'));
  assert.ok(src.includes('const map = new Map(countableItems.map((item) => [item.product.id, item]));'), 'only countable products are listed (so filters, search and sort only see them)');
  assert.ok(src.includes('const totalCount = countableItems.length;'), '"remaining" and "N of M" count only what can be counted');
  assert.ok(src.includes('setupData.isLoading'), 'nothing is listed until it is known which products are shared (no flash of rows that then vanish)');
  assert.doesNotMatch(src, /so it is not listed|so they are not listed|sharedNote|sharedItems/, 'no sentence about the products that are left out: they simply are not there');
  assert.doesNotMatch(src, /styles\.badge|badgeLabel/, 'a never-counted product shows "No stock yet" once, not also a "Not set" badge');
  assert.ok(src.includes('No stock yet'), 'the one state label that stays');
  // the form still holds a field for every product, so nothing typed or saved is touched; only the list is narrower
  assert.ok(src.includes('items: inventory.data.map((item) => ({ product_id: item.product.id, quantity: \'\' })),'), 'the form fields are unchanged');
  assert.ok(src.includes('const completedCount = counted.filter((item) => Number(item.quantity) > 0).length;'), 'completed counts typed quantities of the products that are listed');
  // review and validation are unchanged: at least one product with a quantity, whole pieces only
  assert.ok(src.includes("message: 'Enter an opening quantity for at least one product.'"));
  assert.ok(src.includes('isValidPieceQuantity(item.quantity)'));
  // coming from Stock details
  assert.ok(src.includes('const { product: preselectId } = useLocalSearchParams<{ product?: string }>();'));
  assert.ok(src.includes('if (target) setSearch(target.product.name);'), 'preselecting is a search the user can clear; a shared product is not found, so nothing is preselected');
  assert.ok(src.includes('preselected.current = true;'), 'only once, so clearing the search is not undone');
  // nothing is written for the hidden products: the saved payload comes only from the review list
  assert.ok(src.includes('items: selectedItems.map((item) => ({'));

  const svc = read('src/services/productService.ts');
  assert.ok(svc.includes('.order(\'id\').range(from, from + SETUP_PAGE - 1)'), 'every row is read, in pages (a cut list could hide a product that needs stock)');
  assert.ok(svc.includes("'product_variants', 'id, product_id, name, sort_order'"));
  assert.doesNotMatch(svc.slice(svc.indexOf('listStockSetupData')), /\.(insert|update|delete|upsert|rpc)\(/, 'read only');

  const main = read('app/(manager)/manager/inventory/index.tsx');
  assert.ok(main.includes("{ label: 'Shared stock', tone: 'neutral' }"), 'Main Inventory: not "Not set" either');
  assert.ok(main.includes("if (filter === 'not_set' && stockSetup?.shared.has(item.product.id)) return false;"), 'and not in the "Not set" filter');
  assert.ok(main.includes('sharedSources={stockSetup?.sources.get(selected.product.id) ?? null}'), 'the Stock details sheet uses the same rule');
  assert.ok(main.includes("router.push({ pathname: '/manager/inventory/setup', params: { product: productId } } as never);"));
  console.log('2. Opening stock screen: ok');
}

console.log('opening_stock_shared: ALL PASS');
