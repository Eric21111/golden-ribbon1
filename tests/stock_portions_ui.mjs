import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { loadTs } from './_load_ts.mjs';
const require = createRequire(import.meta.url);
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const rnw = require('react-native-web');
const format = loadTs('src/lib/format.ts');
assert.equal(format.formatLiveStock(3, 'piece_stock', 'half_egg'), '3 half-egg units');
assert.equal(format.formatSnapshottedQuantity(7, 'piece_stock', 'half_serving'), '7 half-serving units');
assert.equal(format.formatTransferReceivedQuantity('received', 3, 'piece_stock', 'half_egg'), '3 half-egg units');
assert.equal(format.formatTransferDifference('received_with_discrepancy', 4, 3, 'piece_stock', 'half_egg'), '1 half-egg unit');
assert.equal(format.formatLiveStock(100), '100 pcs', 'no conversion or relabeling of legacy balances');
assert.equal(format.formatLiveStock(0.5, 'piece_stock', 'half_egg'), 'Invalid quantity');
const { ingredientOptionsFromProducts } = loadTs('src/features/products/recipePreviewData.ts');
const items = ingredientOptionsFromProducts([
  { id: 'legacy', name: 'Egg' },
  { id: 'new', name: 'Renamed item', stockUnitCode: 'half_egg' },
]);
assert.equal(items.find(p => p.id === 'legacy').unit.plural, 'stock units (legacy)');
assert.equal(items.find(p => p.id === 'new').unit.plural, 'half-egg units');
const { StockUnitHint } = loadTs('src/components/StockUnitHint.tsx', { 'react-native': rnw });
assert.match(renderToStaticMarkup(React.createElement(StockUnitHint, { code: 'half_egg' })), /2 units = 1 whole egg/);
assert.equal(renderToStaticMarkup(React.createElement(StockUnitHint, {})), '');

let requests = 0;
let fail = false;
const { withStockUnits } = loadTs('src/services/stockUnitService.ts', {
  '@/lib/supabase': { supabase: { rpc: async (name, args) => {
    assert.equal(name, 'get_stock_unit_codes');
    requests++;
    return fail ? { error: new Error('metadata unavailable') }
      : { data: args.p_product_ids.map(id => ({ product_id: id, stock_unit_code: 'half_egg' })), error: null };
  } } },
});
const result = await withStockUnits({ products: [{ product_id: 'egg', quantity: 3 }], items: [{ product_id: 'egg', quantity_received: 2 }] });
assert.equal(requests, 1, 'one batched query, not one per row');
assert.equal(result.products[0].stock_unit_code, 'half_egg');
assert.equal(result.products[0].quantity, 3);
assert.equal(result.items[0].stock_unit_code, 'half_egg');
requests = 0;
await withStockUnits(Array.from({ length: 1001 }, (_, i) => ({ product_id: String(i) })));
assert.equal(requests, 3, 'metadata is not silently truncated at an API row limit');
fail = true;
await assert.rejects(withStockUnits([{ product_id: 'egg' }]), /metadata unavailable/, 'do not mislabel unknown portion stock as pieces');
console.log('Stock portion UI/data tests passed: labels, legacy values, rename stability, batched metadata and error handling.');

// Exercise the actual recipe editor handler: decimal paste must never become another integer.
let inputProps;
let changes = [];
const { VariantRecipePreview } = loadTs('src/features/products/VariantRecipePreview.tsx', {
  'react-native': { ...rnw, TextInput: props => { inputProps = props; return React.createElement('input', { value: props.value, readOnly: true }); } },
  '@react-native-vector-icons/ionicons': { __esModule: true, default: () => null },
  './InventoryItemPickerModal': { InventoryItemPickerModal: () => null },
  './CategoryIcon': { CategoryIcon: () => null },
});
const html = renderToStaticMarkup(React.createElement(VariantRecipePreview, {
  lines: [{ itemId: 'new', quantity: 2 }], productName: 'Extra Egg', ingredients: items,
  onChange: value => changes.push(value),
}));
assert.match(html, /half-egg units/);
assert.ok(inputProps);
assert.equal(inputProps.maxLength, undefined, 'native truncation must not turn pasted 10.5 into 10');
inputProps.onChangeText('0.5');
inputProps.onChangeText('10.5');
inputProps.onChangeText('-1');
assert.equal(changes.length, 0);
inputProps.onChangeText('1');
assert.deepEqual(changes, [[{ itemId: 'new', quantity: 1 }]]);
console.log('Rendered recipe editor passed: correct unit and rejection of fractional/negative input.');
