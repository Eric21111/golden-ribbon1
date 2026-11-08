// Main Inventory -> Stock details. Main holds ONE stock balance per product; options have no stock of their own. The sheet says what
// Main has (and what "Not set", zero and unavailable mean), what each selling branch charges, what a sale takes from stock, and
// only offers "Send stock" when the database would accept it.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { loadTs } from './_load_ts.mjs';

const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const d = loadTs('src/features/inventory/stockDetails.ts');
const SM1 = { id: 'sm1', name: 'SM 1' };
const SM2 = { id: 'sm2', name: 'SM 2' };

// ---------------------------------------------------------------- 1. the stock card
{
  const at = (updated_at, quantity_on_hand) => d.stockDisplay({ updated_at, quantity_on_hand });
  const notSet = at(null, 0);
  assert.deepEqual([notSet.value, notSet.tone, notSet.updated], ['Not set', 'muted', 'Never'], 'never counted: not a zero');
  assert.equal(notSet.note, null, 'no explanatory line: the value and the button say it');
  const zero = at('2026-11-01T08:00:00Z', 0);
  assert.deepEqual([zero.value, zero.tone, zero.note], ['0 pcs', 'danger', null], 'counted, none left: a real zero');
  assert.notEqual(zero.updated, 'Never');
  assert.deepEqual([at('2026-11-01T08:00:00Z', 3).value, at('2026-11-01T08:00:00Z', 3).tone, at('2026-11-01T08:00:00Z', 3).note], ['3 pcs', 'warning', null]);
  assert.deepEqual([at('2026-11-01T08:00:00Z', 5).tone, at('2026-11-01T08:00:00Z', 6).tone], ['warning', 'normal'], 'low is 5 or fewer, like the list');
  assert.equal(at('2026-11-01T08:00:00Z', 6).note, null);
  const odd = at('2026-11-01T08:00:00Z', 2.5);
  assert.deepEqual([odd.value, odd.tone], ['Unavailable', 'danger'], 'a quantity that is not whole pieces is never shown as a number');
  assert.match(odd.note, /not a whole number/);
  console.log('1. stock card: ok');
}

// ---------------------------------------------------------------- 2. Send stock
{
  const item = (patch) => ({ updated_at: '2026-11-01T08:00:00Z', quantity_on_hand: 10, product: { is_active: true }, ...patch });
  assert.equal(d.sendAction(item({})).kind, 'send');
  assert.deepEqual(d.sendAction(item({ updated_at: null, quantity_on_hand: 0 })), { kind: 'opening', label: 'Set opening stock', hint: null }, 'never counted: the next step is opening stock');
  const none = d.sendAction(item({ quantity_on_hand: 0 }));
  assert.equal(none.kind, 'blocked');
  assert.match(none.hint, /none left/);
  const off = d.sendAction(item({ product: { is_active: false } }));
  assert.equal(off.kind, 'blocked');
  assert.match(off.hint, /disabled product can't be sent/);
  assert.equal(d.sendAction(item({ product: { is_active: false }, updated_at: null })).kind, 'blocked', 'a disabled product is refused whatever its stock');
  assert.equal(d.sendAction(item({ quantity_on_hand: 1 })).kind, 'send');
  console.log('2. send action: ok');
}

// ---------------------------------------------------------------- 3. prices
{
  const variants = [
    { id: 'v2', name: 'Large', default_price: 50, is_active: true, sort_order: 2 },
    { id: 'v1', name: 'Small', default_price: 30, is_active: true, sort_order: 1 },
    { id: 'v3', name: 'Old', default_price: 20, is_active: false, sort_order: 3 },
  ];
  const s = d.buildPriceSummary({
    product: { selling_price: 30, sell_in_pos: true },
    variants,
    branchProducts: [{ branch_id: 'sm1', selling_price: 30, is_active: true }, { branch_id: 'sm2', selling_price: 32, is_active: false }],
    branchVariants: [
      { branch_id: 'sm1', name: 'Small', selling_price: 31, is_active: true },
      { branch_id: 'sm1', name: 'Large', selling_price: 50, is_active: false },
      { branch_id: 'sm2', name: 'Small', selling_price: 32, is_active: true },
    ],
    branches: [SM1, SM2],
  });
  assert.equal(s.hasOptions, true);
  assert.deepEqual(s.options.map((o) => o.name), ['Small', 'Large', 'Old'], 'in the order they were set up');
  const small = s.options[0];
  assert.deepEqual(small.branches.map((b) => [b.branchName, b.state, b.price]), [['SM 1', 'priced', 31], ['SM 2', 'off', 32]], 'SM 2 has the whole product switched off, so its options are off too');
  assert.deepEqual(s.options[1].branches.map((b) => [b.state, b.price]), [['off', 50], ['not_added', null]], 'one option switched off at SM 1; no row at SM 2');
  assert.deepEqual([s.options[0].defaultPrice, s.options[2].retired, s.options[0].retired], [30, true, false], 'the master price is a starting point, not a branch price');
  assert.equal(s.productDefault, 30);
  // no options: one price per branch
  const plain = d.buildPriceSummary({ product: { selling_price: 40, sell_in_pos: true }, variants: [], branchProducts: [{ branch_id: 'sm1', selling_price: 40, is_active: true }], branchVariants: [], branches: [SM1, SM2] });
  assert.equal(plain.hasOptions, false);
  assert.deepEqual(plain.product.map((b) => [b.branchName, b.state, b.price]), [['SM 1', 'priced', 40], ['SM 2', 'not_added', null]]);
  // stock only
  assert.equal(d.buildPriceSummary({ product: { selling_price: null, sell_in_pos: false }, variants: [], branchProducts: [], branchVariants: [], branches: [SM1] }).stockOnly, true);
  assert.equal(d.buildPriceSummary({ product: { selling_price: null }, variants: [], branchProducts: [], branchVariants: [], branches: [] }).productDefault, null);
  assert.equal(d.compactPrices, undefined, 'the collapsed one-line summaries are gone (the sections are always open)');
  console.log('3. prices: ok');
}

// ---------------------------------------------------------------- 4. what a sale takes from stock
{
  const names = { rice: 'Rice', egg: 'Egg', water: 'Bottled Water', coke: 'Coke Mismo', curry: 'Beef Curry', 'extra-rice': 'Extra Rice' };
  const nameOf = (id) => names[id] ?? 'Unknown item';
  const meal = { id: 'curry', name: 'Beef Curry' };
  const variants = [{ id: 'v1', name: 'Ulam Only', sort_order: 1 }, { id: 'v2', name: 'With Rice', sort_order: 2 }, { id: 'v3', name: 'Plain', sort_order: 3 }];
  const uses = [
    { variant_id: 'v1', ingredient_product_id: 'curry', quantity: 1 },
    { variant_id: 'v2', ingredient_product_id: 'curry', quantity: 1 },
    { variant_id: 'v2', ingredient_product_id: 'rice', quantity: 1 },
    { variant_id: 'v2', ingredient_product_id: 'egg', quantity: 2 },
  ];
  const drinks = [
    { variant_id: 'v2', drink_product_id: 'water' },
    { variant_id: 'v2', drink_product_id: 'coke' },
    { variant_id: 'v1', drink_product_id: 'coke' },
  ];
  const r = d.buildUseRows({ product: meal, variants, stockUses: uses, drinkChoices: drinks, nameOf });
  assert.deepEqual(r.rows.map((x) => x.title), ['Ulam Only', 'With Rice', 'Plain']);
  assert.deepEqual(r.rows[0].items, ['Beef Curry ×1'], 'the product\'s own stock carries the product\'s name');
  assert.deepEqual(r.rows[1].items, ['Beef Curry ×1', 'Rice ×1', 'Egg ×2']);
  assert.deepEqual(r.rows[1].drinks, ['Bottled Water', 'Coke Mismo'], 'the drinks to pick from, alphabetical');
  assert.deepEqual(r.rows[0].drinks, ['Coke Mismo']);
  assert.deepEqual(r.rows[2].items, ['Beef Curry ×1'], 'no list anywhere: the product itself x1, as the database does');
  assert.equal(r.ownStockUsed, true);
  // an option with no list of its own uses the product-level list
  const inherits = d.buildUseRows({ product: meal, variants: [{ id: 'v1', name: 'A', sort_order: 1 }], stockUses: [{ variant_id: null, ingredient_product_id: 'rice', quantity: 1 }], drinkChoices: [], nameOf });
  assert.deepEqual(inherits.rows[0].items, ['Rice ×1']);
  assert.equal(inherits.ownStockUsed, false);
  // Extras & Sides taking from other items: its own stock is not used at all
  const extra = d.buildUseRows({ product: { id: 'extra-rice', name: 'Extra Rice' }, variants: [], stockUses: [{ variant_id: null, ingredient_product_id: 'rice', quantity: 1 }], drinkChoices: [], nameOf });
  assert.deepEqual(extra.rows, [{ key: 'product', title: 'Each sale', items: ['Rice ×1'], drinks: [], usesOwnStock: false }]);
  assert.equal(extra.ownStockUsed, false);
  // a snack: quantity of its own item
  const snack = d.buildUseRows({ product: { id: 'cheese', name: 'Cheesestick' }, variants: [{ id: 'a', name: '3 Pcs', sort_order: 1 }], stockUses: [{ variant_id: 'a', ingredient_product_id: 'cheese', quantity: 3 }], drinkChoices: [], nameOf });
  assert.deepEqual(snack.rows[0].items, ['Cheesestick ×3']);
  // nothing invented: no variants means no per-option row; an unknown product name is said plainly
  assert.deepEqual(d.buildUseRows({ product: meal, variants: [], stockUses: [], drinkChoices: [], nameOf }).rows.map((x) => x.title), ['Each sale']);
  assert.equal(d.buildUseRows({ product: meal, variants: [], stockUses: [{ variant_id: null, ingredient_product_id: 'gone', quantity: 1 }], drinkChoices: [], nameOf }).rows[0].items[0], 'Unknown item ×1');
  assert.deepEqual(r.sources.map((x) => x.name), ['Rice', 'Egg'].sort(), 'the OTHER products a sale takes from (not the product itself)');
  assert.deepEqual(extra.sources, [{ id: 'rice', name: 'Rice' }]);
  assert.deepEqual(snack.sources, []);
  console.log('4. recipes: ok');
}

// ---------------------------------------------------------------- 5. the real sheet body, rendered, for all five categories
{
  const require = createRequire(import.meta.url);
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const rnw = require('react-native-web');
  const ready = (data) => ({ data, error: null });
  let state;
  const mod = loadTs('src/features/inventory/MainStockDetails.tsx', {
    'react-native': rnw,
    '@react-native-vector-icons/ionicons': { __esModule: true, default: () => null },
    '@/components/dashboard/ManagerActionButton': { ManagerActionButton: (p) => React.createElement('button', { disabled: p.disabled }, p.label) },
    '@/hooks/useBranchProducts': { useProductBranchPrices: () => ready(state.branchProducts), useProductBranchVariantPrices: () => ready(state.branchVariants) },
    '@/hooks/useProducts': { useProductVariants: () => ready(state.variants), useProductStockUses: () => ready(state.uses), useProductDrinkChoices: () => ready(state.drinks) },
  });
  const names = { rice: 'Rice', egg: 'Egg', water: 'Bottled Water', coke: 'Coke Mismo' };
  const render = (item, props = {}) => renderToStaticMarkup(React.createElement(mod.MainStockDetails, {
    item, sellingBranches: [SM1, SM2], nameOf: (id) => names[id] ?? 'x', onSend() {}, onOpening() {}, onOpenProduct() {}, sharedSources: null, setupReady: true, ...props,
  })).replace(/<[^>]+>/g, '|').replace(/\|+/g, '|');
  const row = (id, name, patch = {}) => ({ product: { id, name, is_active: true, sell_in_pos: true, selling_price: 30, ...patch.product }, quantity_on_hand: patch.quantity_on_hand ?? 0, updated_at: patch.updated_at ?? null });
  const COUNTED = '2026-11-01T08:00:00Z';

  // ---- Meals & Viands: options, drinks, never counted
  state = {
    variants: [{ id: 'v1', name: 'With Rice', default_price: 30, is_active: true, sort_order: 1 }, { id: 'v2', name: 'Ulam Only', default_price: 25, is_active: true, sort_order: 2 }],
    branchProducts: [{ branch_id: 'sm1', selling_price: 30, is_active: true }],
    branchVariants: [{ branch_id: 'sm1', name: 'With Rice', selling_price: 35, is_active: true }, { branch_id: 'sm1', name: 'Ulam Only', selling_price: 28, is_active: true }],
    uses: [{ variant_id: 'v1', ingredient_product_id: 'curry', quantity: 1 }, { variant_id: 'v1', ingredient_product_id: 'rice', quantity: 1 }],
    drinks: [{ variant_id: 'v1', drink_product_id: 'water' }, { variant_id: 'v1', drink_product_id: 'coke' }],
  };
  const meal = row('curry', 'Beef Curry');
  const open = render(meal);
  assert.match(open, /STOCK AT MAIN\|On hand\|Not set\|Updated\|Never\|/, 'two tiles: never counted reads "Not set", not 0');
  assert.ok(open.indexOf('Set opening stock') > 0 && open.indexOf('Set opening stock') < open.indexOf('SOLD AS'), 'the action comes before the long sections');
  // always open, one card per option: the option name, then SM 1 / SM 2 label-left, price-right
  assert.match(open, /SOLD AS\|With Rice\|SM 1\|₱35\.00\|SM 2\|Not added\|Beef Curry\|Rice\|Bottled Water or Coke Mismo\|Ulam Only\|SM 1\|₱28\.00\|SM 2\|Not added\|Beef Curry\|$/, 'one card, one block per option: name, full-width price rows, then what it takes as chips (the drink choices in one chip, "or")');
  assert.doesNotMatch(open, /Takes:|Drink:/, 'no sentences: chips only');
  const body = read('src/features/inventory/MainStockDetails.tsx');
  assert.equal(body.split('<SoldAsCard').length - 1, 2, 'one card for the options (and one for a product with a single price), never a card per option');
  assert.doesNotMatch(body, /OptionCard/);
  assert.ok(body.includes('styles.priceRows') && body.includes('styles.chips'), 'full-width price rows, then chips: nothing sits side by side with the prices');
  assert.doesNotMatch(body, /blockLeft|blockRight/, 'the old two-column block is gone');
  assert.doesNotMatch(open, /TAKES FROM STOCK/, 'no separate section any more');
  assert.doesNotMatch(open, /No opening stock has been entered|Nothing can be sent|Main(?:'|&#x27;)s own stock only/, 'the three notes are gone');
  assert.doesNotMatch(open, /Default|Each selling branch sets|Options have no stock of their own|WHAT A SALE TAKES|Last updated/, 'no default price, no explanation paragraphs');
  assert.doesNotMatch(open, /Base price|Not assigned|Not initialized|New branches start at/, 'old labels are gone');

  // ---- counted with stock: Send stock
  const counted = render(row('curry', 'Beef Curry', { quantity_on_hand: 12, updated_at: COUNTED }));
  assert.match(counted, /On hand\|12 pcs/);
  assert.match(counted, /\|Send stock\|/);
  // zero on hand / disabled: blocked with the reason
  assert.match(render(row('curry', 'Beef Curry', { quantity_on_hand: 0, updated_at: COUNTED })), /Send stock\|Main has none left to send\./);
  assert.match(render(row('curry', 'Beef Curry', { product: { is_active: false }, quantity_on_hand: 9, updated_at: COUNTED })), /Send stock\|A disabled product can(?:'|&#x27;)t be sent/);

  // ---- Snacks: quantity of its own item
  state = { ...state, variants: [{ id: 'a', name: '3 Pcs', default_price: 30, is_active: true, sort_order: 1 }], branchVariants: [{ branch_id: 'sm1', name: '3 Pcs', selling_price: 30, is_active: true }], uses: [{ variant_id: 'a', ingredient_product_id: 'cheese', quantity: 3 }], drinks: [] };
  const snack = render(row('cheese', 'Cheesestick', { quantity_on_hand: 40, updated_at: COUNTED }));
  assert.match(snack, /SOLD AS\|3 Pcs\|SM 1\|₱30\.00\|SM 2\|Not added\|Cheesestick ×3\|$/, 'a quantity other than 1 is kept');
  assert.match(snack, /\|Send stock\|/, 'a snack counts and sends its own stock');

  // ---- Drinks: no options, its own stock
  state = { variants: [], branchProducts: [{ branch_id: 'sm1', selling_price: 20, is_active: true }, { branch_id: 'sm2', selling_price: 22, is_active: false }], branchVariants: [], uses: [], drinks: [] };
  const drink = render(row('water', 'Bottled Water', { quantity_on_hand: 4, updated_at: COUNTED }));
  assert.match(drink, /On hand\|4 pcs\|Updated\|/);
  assert.match(drink, /SELLING PRICES\|SM 1\|₱20\.00\|SM 2\|₱22\.00 · Off\|$/);
  assert.doesNotMatch(drink, /Takes:|TAKES FROM STOCK/, 'a product with no options that just takes itself has nothing to add');
  assert.doesNotMatch(drink, /Each sale|Running low|Default/, 'a product with no options has no "Each sale" heading');

  // ---- Extras & Sides taking from Rice: no own opening stock, no transfer; points at Rice
  state = { variants: [], branchProducts: [{ branch_id: 'sm1', selling_price: 10, is_active: true }], branchVariants: [], uses: [{ variant_id: null, ingredient_product_id: 'rice', quantity: 1 }], drinks: [] };
  const opened = [];
  const riceSource = [{ id: 'rice', name: 'Rice' }];
  const extra = render(row('extra-rice', 'Extra Rice', { product: { selling_price: 10 } }), { sharedSources: riceSource, onOpenProduct: (id) => opened.push(id) });
  assert.match(extra, /STOCK\|Uses stock from\|Rice\|/);
  assert.doesNotMatch(extra, /has no stock of its own|Takes stock from/, 'the long sentence is gone');
  assert.match(extra, /View Rice stock/);
  assert.doesNotMatch(extra, /TAKES FROM STOCK|Takes:/, 'the "Rice ×1" recipe is not repeated under the source card');
  assert.match(extra, /SELLING PRICES\|SM 1\|₱10\.00/, 'its prices are still there');
  assert.doesNotMatch(extra, /Set opening stock\|Nothing can be sent|\|Send stock\||On hand|Not set/, 'it never asks for its own opening stock or a transfer');
  const extraSent = render(row('extra-rice', 'Extra Rice', { product: { selling_price: 10 }, quantity_on_hand: 3, updated_at: COUNTED }), { sharedSources: riceSource });
  assert.match(extraSent, /Own balance\|3 pcs · not used by sales/, 'a leftover own balance is shown, labelled as unused');
  assert.doesNotMatch(extraSent, /\|Send stock\|/);
  // Extra Egg the same way, with two sources it lists both
  state = { ...state, uses: [{ variant_id: null, ingredient_product_id: 'egg', quantity: 1 }, { variant_id: null, ingredient_product_id: 'rice', quantity: 1 }] };
  assert.match(render(row('extra-egg', 'Extra Egg'), { sharedSources: [{ id: 'egg', name: 'Egg' }, { id: 'rice', name: 'Rice' }] }), /Uses stock from\|Egg, Rice/);
  // while the setup is still being worked out nothing is offered (no flash of "Set opening stock")
  assert.match(render(row('extra-rice', 'Extra Rice'), { setupReady: false }), /Checking stock setup…/);
  assert.doesNotMatch(render(row('extra-rice', 'Extra Rice'), { setupReady: false }), /Set opening stock|\|Send stock\|/);
  // a product that mixes its own stock with other items is NOT shared: it counts its own
  assert.match(render(row('extra-rice', 'Extra Rice')), /Set opening stock/);

  // ---- Inventory Supplies: stock only, counts and sends its own stock, no prices or recipes
  state = { variants: [], branchProducts: [], branchVariants: [], uses: [], drinks: [] };
  const supply = render(row('egg', 'Egg', { product: { sell_in_pos: false, selling_price: null }, quantity_on_hand: 40, updated_at: COUNTED }));
  assert.match(supply, /On hand\|40 pcs/);
  assert.match(supply, /\|Send stock\|/);
  assert.match(supply, /SELLING PRICES\|Not sold in the POS/, 'same card style as the other sections, no sentence');
  assert.doesNotMatch(supply, /TAKES FROM STOCK|Takes:|Default|has no price/);
  const supplyNew = render(row('egg', 'Egg', { product: { sell_in_pos: false, selling_price: null } }));
  assert.match(supplyNew, /Set opening stock/, 'a supply never counted is asked for opening stock');
  assert.doesNotMatch(supplyNew, /Nothing can be sent/);
  console.log('5. rendered sheet, five categories: ok');
}

// ---------------------------------------------------------------- 6. wiring and navigation
{
  const screen = read('app/(manager)/manager/inventory/index.tsx');
  assert.ok(screen.includes('<BottomSheet visible={selected != null} title="Stock details" scroll onClose'), 'a long sheet scrolls');
  assert.ok(screen.includes('key={selected.product.id}'), 'switching to another product starts fresh');
  assert.ok(screen.includes("router.push({ pathname: '/manager/inventory/setup', params: { product: productId } } as never);"), 'Set opening stock goes to the Opening stock screen, on this product');
  assert.ok(screen.includes('onOpenProduct={(productId) => {'), 'View Rice opens Rice\'s details');
  assert.ok(screen.includes("label: 'Branch price'") && screen.includes('label="View returns"'), 'a branch manager keeps the sheet they had');
  // that route is a real screen, the same one the footer button opens
  const setup = read('app/(manager)/manager/inventory/setup.tsx');
  assert.ok(setup.includes('InventorySetupScreen'), 'app/(manager)/manager/inventory/setup.tsx renders the Opening stock screen');
  assert.ok(screen.includes("router.push('/manager/inventory/setup' as never)"), 'the footer button still opens Opening stock with nothing preselected');
  const details = read('src/features/inventory/MainStockDetails.tsx');
  assert.doesNotMatch(details, /Collapsible|useState|initiallyOpen/, 'nothing is hidden behind a tap');
  assert.match(details, /label=\{action\.label\}\s+variant="secondary"/, 'Set opening stock / Send stock use the light blue button, like View Rice stock');
  assert.ok(details.includes("priceValue: { color: managerColors.royalBlue"), 'prices are blue');
  assert.doesNotMatch(details, /priceValueMuted: \{ color: managerColors\.royalBlue/, 'Off / Not added stay gray so they do not read as a price');
  assert.ok(details.includes('styles.priceLabel') && details.includes('numberOfLines={2}') && details.includes("priceLabel: { flex: 1, minWidth: 0"), 'a long branch name wraps instead of pushing the price off');
  console.log('6. wiring and navigation: ok');
}

console.log('main_stock_details: ALL PASS');
