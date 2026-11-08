// Cashier POS catalog and item sheet, calmer and easier to scan: prices are blue and medium weight (not heavy black), "From" sits
// above the price, the item sheet has no explanation paragraphs, options and drinks are compact, and quantity + Add share one row.
// Source checks plus a real render of the row. The cart / stock logic is covered by the other POS tests and is not touched here.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { loadTs } from './_load_ts.mjs';

const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

// ---------------------------------------------------------------- 1. the product row
{
  const require = createRequire(import.meta.url);
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const rnw = require('react-native-web');
  const { PosProductRow } = loadTs('src/features/pos/PosProductRow.tsx', {
    'react-native': rnw,
    '@react-native-vector-icons/ionicons': { __esModule: true, default: () => null },
    '@/components/GlyphIcon': { GlyphIcon: () => null },
  });
  const text = (item, cartQuantity = 0) => renderToStaticMarkup(React.createElement(PosProductRow, { item, cartQuantity, onPress() {} })).replace(/<[^>]+>/g, '|').replace(/\|+/g, '|');
  const base = { product: { id: 'p', name: 'Beef Curry', sku: 'BC', product_category: 'meals', selling_price: 88, sell_in_pos: true }, quantity_on_hand: 25 };
  assert.match(text({ ...base, variants: [{ selling_price: 88 }, { selling_price: 98 }] }), /Beef Curry\|From\|₱88\.00\|Available: 25 pcs/, '"From" above the cheapest price');
  const single = text({ ...base, variants: [{ selling_price: 30 }] });
  assert.match(single, /₱30\.00/);
  assert.doesNotMatch(single, /From/, 'one price: no "From"');
  assert.match(text(base, 2), /×2\|.*₱88\.00/, 'the quantity badge sits before the price');
  assert.match(text({ ...base, quantity_on_hand: 0 }), /Out of stock/);

  const row = read('src/features/pos/PosProductRow.tsx');
  assert.ok(row.includes("price: { color: managerColors.royalBlue, fontFamily: 'Inter_600SemiBold', fontSize: 15 }"), 'blue, medium weight');
  assert.doesNotMatch(row, /price: \{[^}]*Inter_700Bold/, 'no heavy black price');
  console.log('1. product row: ok');
}

// ---------------------------------------------------------------- 2. category pills instead of the funnel
{
  const pos = read('app/(cashier)/cashier/pos.tsx');
  assert.ok(pos.includes('options={CATEGORY_CHIPS}') && pos.includes('keepSelectedVisible'));
  assert.doesNotMatch(pos, /FilterIconButton|ListFiltersSheet/, 'no filter button');
  // the search box now has the whole width, with the pills under it, on the phone layout and the tablet split
  assert.equal((pos.match(/<View style=\{styles\.searchWrap\}>\{searchField\}<\/View>/g) ?? []).length, 2);
  console.log('2. pills: ok');
}

// ---------------------------------------------------------------- 3. the item sheet
{
  const sheet = read('src/features/pos/PosItemSheet.tsx');
  assert.doesNotMatch(sheet, /One stock deduction per item|Prefer \{|A drink chosen here|Included in the meal price|Out of stock cannot be selected/, 'no explanation paragraphs');
  assert.doesNotMatch(sheet, /qtyCard|Subtotal|subtotalValue/, 'the subtotal card is gone: the total is on the Add button');
  assert.ok(sheet.includes("label={quantity > 0 ? `Add · ${formatMoney(subtotal)}` : 'Add'}"), 'Add shows what it adds');
  assert.match(sheet, /<View style=\{styles\.actionRow\}>\n\s+<View style=\{styles\.stepperPill\}>/, 'stepper and Add share a row');
  assert.ok(sheet.includes('Choose an option') && sheet.includes('Choose a drink') && sheet.includes('Included in price'));
  assert.ok(sheet.includes("name=\"cafe-outline\"") && sheet.includes('styles.drinkChip'), 'drinks are compact chips');
  assert.ok(sheet.includes("optionPriceSelected: { color: managerColors.royalBlue"), 'option prices in blue when chosen');
  // behaviour that must not change
  assert.match(sheet, /canAdd = remaining > 0 && quantity > 0 && \(!needsDrink \|\| selectedDrink !== null\)/);
  assert.match(sheet, /onAdd\(selectedVariant, quantity, selectedDrink \?/);
  assert.match(sheet, /Maximum available quantity selected\./);
  assert.match(sheet, /No more stock available\./);
  assert.match(sheet, /disabled=\{out\}/, 'an out-of-stock drink cannot be picked');
  assert.match(sheet, /disabled=\{unavailable\}/, 'an unavailable option cannot be picked');
  console.log('3. item sheet: ok');
}

console.log('pos_catalog_ui: ALL PASS');
