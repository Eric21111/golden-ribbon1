// Extras & Sides: a NEW extra starts on "Take from other items" (most extras are made from ingredients that are already counted),
// with nothing deducted and Next refused until an item is added or "Count its own stock" is chosen. Existing products are shown as saved.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { loadTs } from './_load_ts.mjs';

const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const require = createRequire(import.meta.url);
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const rnw = require('react-native-web');
const { extrasStockMissing, PRODUCT_STOCK_KEY } = loadTs('src/features/products/wizardGuards.ts');

// ---------------------------------------------------------------- 1. what still has nothing in it
{
  const rice = [{ itemId: 'rice', quantity: 1 }];
  const own = [{ itemId: 'this-product', quantity: 1 }];
  assert.deepEqual(extrasStockMissing({ category: 'extras', variants: [], recipes: {} }), [PRODUCT_STOCK_KEY], 'a new extra with nothing chosen');
  assert.deepEqual(extrasStockMissing({ category: 'extras', variants: [], recipes: { [PRODUCT_STOCK_KEY]: rice } }), [], 'an item chosen');
  assert.deepEqual(extrasStockMissing({ category: 'extras', variants: [], recipes: { [PRODUCT_STOCK_KEY]: own } }), [], '"Count its own stock" writes an explicit list, so it is a choice');
  const options = [{ key: 'v1' }, { key: 'v2' }];
  assert.deepEqual(extrasStockMissing({ category: 'extras', variants: options, recipes: {} }), ['v1', 'v2']);
  assert.deepEqual(extrasStockMissing({ category: 'extras', variants: options, recipes: { v1: rice } }), ['v2']);
  assert.deepEqual(extrasStockMissing({ category: 'extras', variants: options, recipes: { [PRODUCT_STOCK_KEY]: rice } }), [], 'an option inherits the product-level list');
  assert.deepEqual(extrasStockMissing({ category: 'extras', variants: options, recipes: { v1: [], [PRODUCT_STOCK_KEY]: [] } }), ['v1', 'v2'], 'empty lists count as nothing');
  for (const other of ['meals', 'snacks', 'drinks', 'supplies', 'unset']) {
    assert.deepEqual(extrasStockMissing({ category: other, variants: options, recipes: {} }), [], `${other}: not affected`);
  }
  console.log('1. missing stock source: ok');
}

// ---------------------------------------------------------------- 2. the real component
{
  const mod = loadTs('src/features/products/VariantRecipePreview.tsx', {
    'react-native': rnw,
    '@react-native-vector-icons/ionicons': { __esModule: true, default: (p) => React.createElement('i', { 'data-icon': p.name }) },
    '@/components/GlyphIcon': { GlyphIcon: () => null },
    './InventoryItemPickerModal': { InventoryItemPickerModal: () => null },
    './PortionPickerSheet': { PortionPickerSheet: () => null },
  });
  const rice = { id: 'rice', name: 'Rice', unit: { singular: 'pc', plural: 'pcs' }, hint: '' };
  const render = (props) => renderToStaticMarkup(React.createElement(mod.VariantRecipePreview, {
    label: 'STOCK DEDUCTION', stockModeChoice: true, lines: [], productName: 'Extra Rice', ingredients: [rice], onChange() {}, ...props,
  }));
  const text = (html) => html.replace(/<[^>]+>/g, '|').replace(/\|+/g, '|');
  const radios = (html) => [...html.matchAll(/data-icon="(radio-button-(?:on|off))"/g)].map((m) => m[1]);

  // a NEW extra: ingredient choice first and selected, nothing claimed, the add buttons are there
  const fresh = render({ startOnOtherItems: true });
  assert.deepEqual(radios(fresh), ['radio-button-on', 'radio-button-off'], '"Take from other items" is selected');
  const freshText = text(fresh);
  assert.ok(freshText.indexOf('Take from other items') < freshText.indexOf('Count its own stock'), 'the ingredient choice is listed first');
  assert.match(freshText, /Selling it deducts the items you list, like Rice ×1\./);
  assert.match(freshText, /Extra Rice is received and counted by itself\./);
  assert.match(freshText, /Add what each order uses, for example Rice\./);
  assert.doesNotMatch(freshText, /Each order uses/, 'no "uses Extra Rice ×1" claim while nothing is chosen');
  assert.match(freshText, /Add Stock Item/, 'the way to add an item is right there');

  // the same product when it is NOT a new extra (Edit, or nothing asked): the saved list decides, an empty list is its own stock
  const saved = render({});
  assert.deepEqual(radios(saved), ['radio-button-off', 'radio-button-on'], 'an empty saved list means its own stock, as always');
  assert.doesNotMatch(text(saved), /Each order uses/, 'and no "Each order uses" box');

  // a list with an item: "other", with the item and what an order uses (even when it was asked to start on other)
  const withRice = render({ startOnOtherItems: true, lines: [{ itemId: 'rice', quantity: 1 }] });
  assert.deepEqual(radios(withRice), ['radio-button-on', 'radio-button-off']);
  assert.match(text(withRice), /Rice/);
  assert.doesNotMatch(text(withRice), /Each order uses/);
  // own stock written explicitly is own stock, whatever the start
  const own = render({ startOnOtherItems: true, lines: [{ itemId: 'this-product', quantity: 1 }] });
  assert.deepEqual(radios(own), ['radio-button-off', 'radio-button-on']);
  console.log('2. component states: ok');
}

// ---------------------------------------------------------------- 3. wiring: Create only, Next refused, Edit untouched
{
  const create = read('src/features/products/CreateProductWizard.tsx');
  const edit = read('src/features/products/EditProductWizard.tsx');
  assert.match(create, /const noStock = extrasStockMissing\(\{ category, variants: variants\.map\(\(variant\) => \(\{ key: variant\.id \}\)\), recipes: recipePreview \}\);\n\s+if \(noStock\.length > 0\) \{\n\s+failStep2\('Add the items each order uses, or choose "Count its own stock"\.'\);/);
  assert.match(create, /preferOtherStock\n/, 'Create starts new extras on the ingredient choice');
  assert.doesNotMatch(edit, /preferOtherStock|extrasStockMissing/, 'Edit shows what is saved, and never blocks on it');
  const editor = read('src/features/products/VariantListEditor.tsx');
  assert.match(editor, /\{ label: 'Add items', style: styles\.statusWarn/, 'a collapsed option still without items says so');
  assert.match(editor, /noStock === PRODUCT_STOCK_KEY \? productStockRef\.current : cardRefs\.current\.get\(noStock\) \?\? null/, 'a refused Next shows the first list that is empty');
  assert.equal((editor.match(/startOnOtherItems=\{preferOtherStock\}/g) ?? []).length, 2, 'option lists and the product-level list');
  console.log('3. wiring: ok');
}

// ---------------------------------------------------------------- 4. Extras & Sides get the Selling Options step; the stock choice leads it
{
  const { getWizardFlow, flowSteps } = loadTs('src/features/products/wizardGuards.ts');
  const steps = (category, variantCount = 0) => flowSteps(getWizardFlow({ sellable: true, category, variantCount }));
  assert.deepEqual(steps('extras'), [1, 2, 3], 'Product Info, Selling Options, Branch Pricing');
  assert.deepEqual(steps('extras', 2), [1, 2, 3]);
  assert.deepEqual(steps('drinks'), [1, 3], 'Drinks keep two steps');
  assert.deepEqual(steps('supplies'), [1, 3], 'Inventory Supplies keep two steps');
  assert.deepEqual(flowSteps(getWizardFlow({ sellable: false, category: 'extras', variantCount: 0 })), [1], 'a stock-only extra still has just Product Info');
  const editor = read('src/features/products/VariantListEditor.tsx');
  const lead = editor.indexOf('{config.stockModeChoice ? productStockBlock : null}');
  const empty = editor.indexOf('{variants.length === 0 && config.simpleEmpty && config.stockModeChoice ? (');
  const trail = editor.indexOf('{config.stockModeChoice ? null : productStockBlock}');
  assert.ok(lead > 0 && lead < empty && empty < trail, 'Extras: stock choice first, then the optional selling options; the others keep their order');
  const categories = read('src/features/products/productCategoryPreview.ts');
  // one heading, no price wording on Step 2 (the price is Step 3's job), and a small add button instead of the grey "Sold at one fixed price" card
  assert.ok(categories.includes("step2Title: 'What it uses from stock',"), 'one heading on the page');
  assert.doesNotMatch(categories.slice(categories.indexOf("id: 'extras'"), categories.indexOf("id: 'supplies'")), /Simple Selling Options/);
  assert.doesNotMatch(editor, /addOptionHint/, 'the add button stands alone: no hint line under it');
  assert.ok(read('src/features/products/VariantRecipePreview.tsx').includes('{stockModeChoice ? null : <Text style={styles.label}>{label}</Text>}'), 'the stock box does not repeat the heading');
  const extrasBlock = categories.slice(categories.indexOf("id: 'extras'"), categories.indexOf("id: 'supplies'"));
  assert.doesNotMatch(extrasBlock, /Skip this step/, 'the step cannot be skipped empty: the stock choice has to be made');
  for (const f of ['CreateProductWizard', 'EditProductWizard']) {
    assert.doesNotMatch(read(`src/features/products/${f}.tsx`), /simpleFlow && getCategoryConfig\(category\)\.productLevelStock/, `${f}: Step 1 no longer carries the stock block`);
  }
  console.log('4. Extras & Sides steps: ok');
}

// ---------------------------------------------------------------- 5. the layout: two option cards, the item list inside the one it belongs to
{
  const mod = loadTs('src/features/products/VariantRecipePreview.tsx', {
    'react-native': rnw,
    '@react-native-vector-icons/ionicons': { __esModule: true, default: (p) => React.createElement('i', { 'data-icon': p.name }) },
    '@/components/GlyphIcon': { GlyphIcon: () => null },
    './InventoryItemPickerModal': { InventoryItemPickerModal: () => null },
    './PortionPickerSheet': { PortionPickerSheet: () => null },
  });
  const ingredients = [{ id: 'rice', name: 'Rice', unit: { singular: 'pc', plural: 'pcs' }, hint: 'Stock only' }];
  const plain = (props) => renderToStaticMarkup(React.createElement(mod.VariantRecipePreview, { label: 'STOCK DEDUCTION', stockModeChoice: true, productName: 'Extra Rice', ingredients, onChange() {}, lines: [], ...props })).replace(/<[^>]+>/g, '|').replace(/\|+/g, '|');
  const other = plain({ lines: [{ itemId: 'rice', quantity: 1 }] });
  const at = (s) => other.indexOf(s);
  assert.ok(at('Take from other items') < at('Rice') && at('Rice') < at('Add Stock Item') && at('Add Stock Item') < at('Count its own stock'), 'the items and the add button sit inside "Take from other items", above the second card');
  const own = plain({ lines: [{ itemId: 'this-product', quantity: 1 }] });
  assert.doesNotMatch(own, /Add Stock Item/, 'the own-stock choice has no item list');
  assert.ok(own.indexOf('Take from other items') < own.indexOf('Count its own stock'));
  const src = read('src/features/products/VariantRecipePreview.tsx');
  assert.ok(src.includes("{selected && value === 'other' && showList ? <View style={styles.modeBody}>{listBlock}</View> : null}"));
  assert.ok(src.includes('{stockModeChoice ? null : listBlock}'), 'the other categories keep the list where it was');
  const editor = read('src/features/products/VariantListEditor.tsx');
  assert.ok(editor.includes('<Text style={styles.addOptionLabel}>SELLING OPTIONS · OPTIONAL</Text>'), 'the selling options are their own labelled section');
  assert.ok(editor.includes('config.stockModeChoice && styles.productStockPlain'), 'no card around the cards');
  console.log('5. option cards: ok');
}

console.log('extras_default_other: ALL PASS');
