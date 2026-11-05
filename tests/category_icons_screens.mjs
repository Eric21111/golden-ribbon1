// Category icons on the Opening stock and Send stock cards, the POS (item sheet header, order lines) and the inventory details
// sheet. The icon is the product's category (never one fixed picture), and "Category not set" shows the neutral one.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { loadTs } from './_load_ts.mjs';

const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const require = createRequire(import.meta.url);
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const rnw = require('react-native-web');

const stubs = {
  'react-native': rnw,
  '@react-native-vector-icons/ionicons': { __esModule: true, default: (p) => React.createElement('i', { 'data-icon': p.name }) },
  '@/components/GlyphIcon': { GlyphIcon: (p) => React.createElement('i', { 'data-glyph': p.name }) },
};

// ---------------------------------------------------------------- 1. a POS order line shows its product's category
{
  const { OrderLine } = loadTs('src/features/pos/PosOrderLine.tsx', stubs);
  const item = { product_id: 'p1', variant_id: null, product_name: 'Coke Mismo', variant_name: null, quantity: 2, unit_price: 20 };
  const noop = () => {};
  const render = (category) => renderToStaticMarkup(React.createElement(OrderLine, { item, label: 'Coke Mismo', category, atLimit: false, maxQuantity: 9, onIncrease: noop, onDecrease: noop, onQuantityChange: noop, onRemove: noop }));
  const glyph = (html) => html.match(/data-glyph="([^"]+)"/)?.[1];
  const drinks = glyph(render('drinks'));
  const meals = glyph(render('meals'));
  const none = glyph(render(undefined));
  assert.ok(drinks && meals && none, 'every line has an icon');
  assert.notEqual(drinks, meals, 'the picture follows the category');
  assert.notEqual(drinks, none, 'a product with no category gets the neutral one');
  assert.equal(glyph(render(null)), none, 'null and missing are the same: Category not set');
  assert.match(render('drinks'), /Coke Mismo/);
  console.log('1. order line icon: ok');
}

// ---------------------------------------------------------------- 2. wiring
{
  for (const [name, file] of [['Opening stock', 'src/features/inventory/InventorySetupScreen.tsx'], ['Send stock', 'src/features/transfers/CreateTransferScreen.tsx']]) {
    const src = read(file);
    assert.match(src, /<View style=\{styles\.cardTop\}>\n\s+<CategoryIcon category=\{item\.product\.product_category\} size=\{36\} decorative \/>\n\s+<View style=\{styles\.cardInfo\}>/, `${name}: the icon sits left of the name, SKU and tag`);
  }
  // the Review opening stock list: the same icon, left of the name and SKU
  assert.match(
    read('src/features/inventory/InventorySetupScreen.tsx'),
    /<View style=\{styles\.reviewRowMain\}>\n\s+<CategoryIcon category=\{item\.product\.product_category\} size=\{36\} decorative \/>\n\s+<View style=\{styles\.reviewRowInfo\}>/,
    'Review opening stock: the icon sits left of the name and SKU',
  );
  // the Review transfer cards: the same icon, left of the name and SKU
  assert.match(
    read('src/features/transfers/CreateTransferScreen.tsx'),
    /<View style=\{styles\.reviewTop\}>\n\s+<CategoryIcon category=\{item\.product\.product_category\} size=\{36\} decorative \/>\n\s+<View style=\{styles\.reviewInfo\}>/,
    'Review transfer: the icon sits left of the name and SKU',
  );
  const sheet = read('src/features/pos/PosItemSheet.tsx');
  assert.match(sheet, /<CategoryIcon category=\{item\.product\.product_category\} size=\{48\} decorative \/>/, 'POS item sheet: the product\'s category');
  assert.doesNotMatch(sheet, /fast-food-outline/, 'no one fixed food icon for every product');

  const details = read('src/features/inventory/InventoryProductDetails.tsx');
  assert.match(details, /<CategoryIcon category=\{item\.product\.product_category\} size=\{40\} \/>/);

  const pos = read('app/(cashier)/cashier/pos.tsx');
  assert.match(pos, /new Map\(limitedInventory\.map\(\(item\) => \[item\.product\.id, item\.product\.product_category\]\)\)/);
  assert.equal((pos.match(/categoryByProductId=\{categoryByProductId\}/g) ?? []).length, 2, 'the tablet order pane and the View Order sheet');
  for (const file of ['src/features/pos/PosOrderPane.tsx', 'src/features/pos/PosViewOrderSheet.tsx']) {
    assert.match(read(file), /category=\{categoryByProductId\?\.get\(item\.product_id\)\}/, file);
  }
  // the POS product rows already pick their icon from the category
  assert.match(read('src/features/pos/PosProductRow.tsx'), /getCategoryIndicator\(item\.product\.product_category\)/);
  console.log('2. wiring: ok');
}

console.log('category_icons_screens: ALL PASS');
