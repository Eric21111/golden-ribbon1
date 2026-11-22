// Checkout screen (Order Summary): one card with a line per product and the total ONCE (Catalog / Discount only when the pricing
// changes the price), compact pricing pills with a hint only for a non-standard program, and Back | Checkout side by side.
// Real render of the order card; the screen itself (router, stores, queries) is checked as wiring. What is charged and sent is untouched.
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

const { OrderSummary } = loadTs('src/features/pos/OrderSummary.tsx', {
  'react-native': rnw,
  '@/features/products/CategoryIcon': { CategoryIcon: (p) => React.createElement('i', { 'data-category': String(p.category) }) },
});
const items = [
  { product_id: 'w', variant_id: null, product_name: 'Bottled Water', variant_name: null, sku: 'W', quantity: 60, unit_price: 20, subtotal: 1200 },
  { product_id: 'c', variant_id: null, product_name: 'Coke Mismo', variant_name: null, sku: 'C', quantity: 10, unit_price: 55, subtotal: 550 },
];
const categories = new Map([['w', 'drinks'], ['c', 'drinks']]);
const render = (program, settings) => renderToStaticMarkup(React.createElement(OrderSummary, { items, program, settings, categoryByProductId: categories }));

// ---------------------------------------------------------------- 1. the order card
{
  const standard = render('standard');
  const text = flat(standard);
  assert.match(text, /Bottled Water\|60 × ₱20\.00\|₱1,200\.00\|/, 'quantity x price, line total');
  assert.match(text, /Coke Mismo\|10 × ₱55\.00\|₱550\.00\|Total\|₱1,750\.00\|$/, 'then the total, once');
  assert.equal((text.match(/₱1,750\.00/g) ?? []).length, 1, 'the total is shown ONCE for a standard order');
  assert.doesNotMatch(text, /Order Summary|TOTAL|Catalog|Discount|Charge/, 'no repeated title, no Catalog / Charge box when nothing changes');
  assert.equal((standard.match(/data-category="drinks"/g) ?? []).length, 2, 'a category icon on every line');

  // a program that changes the price shows how: Catalog, the discount, then the total
  const pwd = flat(render('pwd', { pwd: { program: 'pwd', discount_percent: 25, pricing_mode: null, fixed_amount: null, label: 'PWD' } }));
  assert.match(pwd, /Catalog\|₱1,750\.00\|Discount\|−₱437\.50\|Total\|₱1,312\.50\|$/, 'PWD 25%: catalog, discount, total');
  const employee = flat(render('employee_meal'));
  assert.match(employee, /Catalog\|₱1,750\.00\|Employee meal\|−₱1,750\.00\|Total\|₱0\.00\|$/, 'employee meal: everything off, ₱0 charged');
  // the amount taken off is red (the same red as the app's errors), the catalog and total amounts are not
  const orderSource = read('src/features/pos/OrderSummary.tsx');
  assert.ok(orderSource.includes("discountValue: { color: '#B91C1C' },"));
  assert.ok(orderSource.includes('style={[styles.adjustValue, styles.discountValue]}'), 'only the discount / employee-meal amount');
  assert.equal((orderSource.match(/styles\.discountValue\]/g) ?? []).length, 1);
  // no category known (not loaded yet): the line still renders
  assert.match(flat(renderToStaticMarkup(React.createElement(OrderSummary, { items, program: 'standard' }))), /Bottled Water/);
  console.log('1. order card: ok');
}

// ---------------------------------------------------------------- 2. the screen
{
  const src = read('app/(cashier)/cashier/payment.tsx');
  // pricing: pills in a wrapping row, the hint only when the program is not Standard
  assert.ok(src.includes("programList: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },") && src.includes("flexBasis: '47%',"), 'pricing: two equal columns of selectable cards (no hint text), like Cash / GCash');
  assert.doesNotMatch(src, /selectedProgram|option\.hint|\.hint\}/, 'no hint line under the pills at all (neither "Full catalog price" nor "25% discount on catalog prices")');
  assert.doesNotMatch(src, /programHint|programOption\b|<Text style=\{styles\.programHint\}/, 'the per-option hint text is gone');
  assert.ok(src.includes('Discounts are unavailable until the pending database update is applied.'), 'the one real notice (programs unavailable) stays');
  assert.ok(src.includes('disabled={unavailable || Boolean(checkout.request)}'), 'unavailable programs and a saved retry still cannot be changed');
  assert.ok(src.includes('onPress={() => setPricingProgram(option.value)}'));
  // no separate totals box
  assert.doesNotMatch(src, /totalsCard|totalsChargeLabel|styles\.totals/, 'no second Catalog / Charge box');
  assert.ok(src.includes('categoryByProductId={categories.data}') && src.includes('listCashierProductCategories'), 'icons from the same read-only lookup the POS uses');
  // buttons: Back | Checkout
  assert.match(src, /<View style=\{styles\.footer\}>\n\s+<View style=\{styles\.footerButton\}>\n\s+<ManagerActionButton\n\s+label="Back"\n\s+variant="secondary"/, 'Back first, light blue');
  assert.match(src, /label=\{awaitingRetry \? 'Retry' : 'Checkout'\}\n\s+icon="card-outline"/, 'Checkout second (Retry when a saved checkout is waiting)');
  assert.ok(src.includes("footer: {") && src.includes("flexDirection: 'row',\n    gap: 10,") && src.includes('footerButton: { flex: 1 },'), 'two equal columns');
  assert.ok(src.includes("disabled={checkout.pending || awaitingRetry}\n                onPress={() => router.replace('/cashier/pos')}"), 'Back is still off while a checkout is pending or saved');
  assert.doesNotMatch(src, /Back to order|Retry checkout/);
  // what is charged and sent is the same code as before
  assert.ok(src.includes('const charged = previewOrderTotals(liveItems, pricingProgram, pricingSettings, categories.data).chargedTotal;'));
  assert.ok(src.includes('amountPaid: centsDecimal(Math.round(charged * 100)),') && src.includes('pricingProgram,'));
  assert.ok(src.includes("'Checkout order?',") && src.includes('runSubmit,'), 'still asks before checking out');
  console.log('2. screen: ok');
  // no "Cash · Standard · ₱…" line above the buttons: the cards already show the choice and the order card the total
  assert.doesNotMatch(src, /footerSummary/);
}

// ---------------------------------------------------------------- 3. a line: the product, and the option / drink as tags
{
  const { cartLineParts, cartLineLabel } = loadTs('src/features/pos/cartLine.ts');
  assert.deepEqual(cartLineParts({ product_name: 'Beef Kulma', variant_name: 'Beef Kulma Only', drink_name: null }), { name: 'Beef Kulma', option: 'Only', drink: null }, 'a variant that repeats the product keeps only what is new');
  assert.deepEqual(cartLineParts({ product_name: 'Corned Beef', variant_name: 'Corned beef only', drink_name: null }).option, 'Only', 'case does not matter');
  assert.deepEqual(cartLineParts({ product_name: 'Chicken BBQ', variant_name: 'BBQ only', drink_name: null }).option, 'BBQ only', 'a different name stays whole');
  assert.deepEqual(cartLineParts({ product_name: 'Chicken Curry', variant_name: 'With Rice', drink_name: 'Coke' }), { name: 'Chicken Curry', option: 'With Rice', drink: 'Coke' });
  assert.deepEqual(cartLineParts({ product_name: 'Water', variant_name: null, drink_name: null }), { name: 'Water', option: null, drink: null });
  assert.equal(cartLineLabel({ product_name: 'Beef Kulma', variant_name: 'Beef Kulma Only', drink_name: null }), 'Beef Kulma (Beef Kulma Only)', 'the full text is unchanged for screen readers and history');
  const withOption = renderToStaticMarkup(React.createElement(OrderSummary, { items: [{ product_id: 'k', variant_id: 'v', product_name: 'Beef Kulma', variant_name: 'Beef Kulma Only', drink_name: null, sku: 'K', quantity: 3, unit_price: 90, subtotal: 270 }], program: 'standard' }));
  assert.match(flat(withOption), /Beef Kulma\|Only\|3 × ₱90\.00\|₱270\.00\|Total\|₱270\.00/, 'name, tag, quantity x price, total');
  assert.doesNotMatch(flat(withOption), /Beef Kulma Only|\(Beef/, 'no repeated "(Beef Kulma Only)"');
  console.log('3. line parts: ok');
}

console.log('checkout_summary_ui: ALL PASS');
