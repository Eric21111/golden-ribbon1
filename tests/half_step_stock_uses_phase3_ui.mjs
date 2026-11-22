/**
 * Phase 3 — Stock Used Per Order half-step UI (gated off).
 * FRACTIONAL_STOCK_USES_ENABLED stays false; fractional save remains blocked.
 * UI half-step behavior is exercised via VariantRecipePreview's test override prop.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { loadTs } from './_load_ts.mjs';

const require = createRequire(import.meta.url);
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const rnw = require('react-native-web');

const half = loadTs('src/lib/halfStepQuantity.ts');
const mapping = loadTs('src/features/products/stockUseMapping.ts');
const data = loadTs('src/features/products/recipePreviewData.ts');
const { PRODUCT_STOCK_KEY } = loadTs('src/features/products/wizardGuards.ts');

assert.equal(half.FRACTIONAL_STOCK_USES_ENABLED, false, 'Phase 3 keeps the save gate off');
assert.equal(mapping.FRACTIONAL_STOCK_USES_ENABLED, false);

// ---- helpers (gate-independent)
assert.equal(half.recipeQuantityStep('half_step'), 0.5);
assert.equal(half.recipeQuantityStep('integer'), 1);
assert.equal(half.recipeQuantityMin('half_step'), 0.5);
assert.equal(half.recipeQuantityMin('integer'), 1);
assert.equal(half.formatRecipeQuantityInput(1), '1');
assert.equal(half.formatRecipeQuantityInput(1.5), '1.5');
assert.equal(half.formatRecipeQuantityInput(0.5), '0.5');
assert.equal(half.formatRecipeQuantityInput(0), '');
assert.equal(half.nudgeRecipeQuantity(1, 1, 'half_step'), 1.5);
assert.equal(half.nudgeRecipeQuantity(1, -1, 'half_step'), 0.5);
assert.equal(half.nudgeRecipeQuantity(0.5, -1, 'half_step'), 0.5, 'min floor');
assert.equal(half.nudgeRecipeQuantity(1, -1, 'integer'), 1, 'integer min floor');

assert.deepEqual(half.parseOrdinaryRecipeQuantityText('1.5', 'half_step'), { kind: 'ok', value: 1.5 });
assert.deepEqual(half.parseOrdinaryRecipeQuantityText('0.5', 'half_step'), { kind: 'ok', value: 0.5 });
assert.equal(half.parseOrdinaryRecipeQuantityText('0.3', 'half_step').kind, 'error');
assert.equal(half.parseOrdinaryRecipeQuantityText('1.', 'half_step').kind, 'draft');
assert.equal(half.parseOrdinaryRecipeQuantityText('1.5', 'integer').kind, 'error');
assert.deepEqual(half.parseOrdinaryRecipeQuantityText('2', 'integer'), { kind: 'ok', value: 2 });

// ---- gate off: payload still rejects fractional save (Create/Edit path)
assert.throws(
  () => mapping.buildStockUsePayload({ [PRODUCT_STOCK_KEY]: [{ itemId: 'rice', quantity: 0.5 }] }, []),
  (err) => err?.name === 'StockUseValidationError' && /whole number/.test(String(err.message)),
  'wizard save cannot send 0.5 while gate is off',
);
assert.throws(
  () => mapping.buildStockUsePayload({ [PRODUCT_STOCK_KEY]: [{ itemId: 'rice', quantity: 1.5 }] }, []),
  /whole number/,
);
assert.deepEqual(
  mapping.buildStockUsePayload({ [PRODUCT_STOCK_KEY]: [{ itemId: 'rice', quantity: 2 }] }, []),
  [{ ingredient_product_id: 'rice', quantity: 2 }],
);

// ---- wizards catch StockUseValidationError (no silent omit)
const createSrc = readFileSync('src/features/products/CreateProductWizard.tsx', 'utf8');
const editSrc = readFileSync('src/features/products/EditProductWizard.tsx', 'utf8');
assert.match(createSrc, /StockUseValidationError/);
assert.match(createSrc, /buildStockUsePayload\(/);
assert.match(editSrc, /StockUseValidationError/);
assert.match(editSrc, /stockUsesForSave\([\s\S]*?buildStockUsePayload\(/);
assert.doesNotMatch(createSrc, /fractionalEnabled\s*=\s*true/, 'Create does not force the gate on');
assert.doesNotMatch(editSrc, /fractionalEnabled\s*=\s*true/, 'Edit does not force the gate on');

// recipe-saving paths: only productService -> create/update_complete_product
const service = readFileSync('src/services/productService.ts', 'utf8');
assert.match(service, /p_stock_uses: input\.stockUses \?\? null,/);
assert.equal((service.match(/p_stock_uses:/g) ?? []).length, 2, 'create + update only');
assert.doesNotMatch(service, /from\('product_stock_uses'\)[\s\S]{0,80}\.insert/, 'no direct table insert bypass');

const items = data.ingredientOptionsFromProducts([
  { id: 'egg', name: 'Egg', stockUnitCode: 'half_egg' },
  { id: 'rice', name: 'Rice', stockUnitCode: 'piece' },
  { id: 'old', name: 'Old Egg' },
]);

let inputProps;
let decreaseProps;
let increaseProps;
const captureStubs = {
  'react-native': {
    ...rnw,
    TextInput: (props) => {
      inputProps = props;
      return React.createElement('input', { value: props.value, readOnly: true, 'aria-label': props.accessibilityLabel });
    },
    Pressable: (props) => {
      const label = props.accessibilityLabel ?? '';
      if (label.startsWith('Decrease ')) decreaseProps = props;
      if (label.startsWith('Increase ')) increaseProps = props;
      return React.createElement('button', { 'aria-label': label, disabled: props.disabled }, props.children);
    },
  },
  '@react-native-vector-icons/ionicons': { __esModule: true, default: () => null },
  './InventoryItemPickerModal': { InventoryItemPickerModal: () => null },
  './CategoryIcon': { CategoryIcon: () => null },
};
const { VariantRecipePreview } = loadTs('src/features/products/VariantRecipePreview.tsx', captureStubs);

const render = (lines, props = {}) => {
  inputProps = undefined;
  decreaseProps = undefined;
  increaseProps = undefined;
  return renderToStaticMarkup(
    React.createElement(VariantRecipePreview, {
      lines,
      productName: 'Meal',
      ingredients: items,
      onChange: () => {},
      ...props,
    }),
  );
};

// ---- gate off (default): ordinary piece stays integer pad / step 1
render([{ itemId: 'rice', quantity: 1 }]);
assert.equal(inputProps.keyboardType, 'number-pad', 'gate off: integer pad for piece');
assert.equal(decreaseProps.disabled, true, 'gate off: min is 1');
assert.equal(inputProps.value, '1');

let changes = [];
render([{ itemId: 'rice', quantity: 2 }], {
  onChange: (next) => {
    changes.push(next);
  },
});
increaseProps.onPress();
assert.deepEqual(changes.at(-1), [{ itemId: 'rice', quantity: 3 }], 'gate off: + steps by 1');
changes = [];
decreaseProps.onPress();
assert.deepEqual(changes.at(-1), [{ itemId: 'rice', quantity: 1 }], 'gate off: − steps by 1');
changes = [];
inputProps.onChangeText('1.5');
assert.equal(changes.length, 0, 'gate off: typed 1.5 rejected');
inputProps.onChangeText('0.5');
assert.equal(changes.length, 0, 'gate off: typed 0.5 rejected');

// portion path unchanged (still converts; no double half-step on stored units)
changes = [];
render([{ itemId: 'egg', quantity: 1 }], {
  onChange: (next) => {
    changes.push(next);
  },
});
assert.equal(inputProps.value, '0.5');
assert.equal(inputProps.keyboardType, 'decimal-pad');
increaseProps.onPress();
assert.deepEqual(changes.at(-1), [{ itemId: 'egg', quantity: 2 }], 'portion + still adds 1 stored unit');

// ---- gate on (test override only): ordinary half-steps
changes = [];
render([{ itemId: 'rice', quantity: 1 }], {
  fractionalEnabled: true,
  onChange: (next) => {
    changes.push(next);
  },
});
assert.equal(inputProps.keyboardType, 'decimal-pad', 'gate on: decimal pad for piece');
assert.equal(decreaseProps.disabled, false, 'gate on: can step down from 1 to 0.5');
decreaseProps.onPress();
assert.deepEqual(changes.at(-1), [{ itemId: 'rice', quantity: 0.5 }], '− steps by 0.5');
changes = [];
render([{ itemId: 'rice', quantity: 0.5 }], {
  fractionalEnabled: true,
  onChange: (next) => {
    changes.push(next);
  },
});
assert.equal(decreaseProps.disabled, true, 'min 0.5');
assert.equal(inputProps.value, '0.5');
increaseProps.onPress();
assert.deepEqual(changes.at(-1), [{ itemId: 'rice', quantity: 1 }], '+ from 0.5 → 1');
changes = [];
render([{ itemId: 'rice', quantity: 1 }], {
  fractionalEnabled: true,
  onChange: (next) => {
    changes.push(next);
  },
});
increaseProps.onPress();
assert.deepEqual(changes.at(-1), [{ itemId: 'rice', quantity: 1.5 }], '+ from 1 → 1.5');

for (const [text, qty] of [
  ['0.5', 0.5],
  ['1', 1],
  ['1.5', 1.5],
  ['2', 2],
]) {
  changes = [];
  render([{ itemId: 'rice', quantity: 2 }], {
    fractionalEnabled: true,
    onChange: (next) => {
      changes.push(next);
    },
  });
  inputProps.onChangeText(text);
  assert.deepEqual(changes.at(-1), [{ itemId: 'rice', quantity: qty }], `typing ${text}`);
}
changes = [];
render([{ itemId: 'rice', quantity: 2 }], {
  fractionalEnabled: true,
  onChange: (next) => {
    changes.push(next);
  },
});
inputProps.onChangeText('0.3');
assert.equal(changes.length, 0, '0.3 refused');
inputProps.onChangeText('0');
assert.equal(changes.length, 0, '0 refused');

// portion items ignore ordinary half-step mode even when gate override is on
changes = [];
const portionHtml = render([{ itemId: 'egg', quantity: 2 }], {
  fractionalEnabled: true,
  onChange: (next) => {
    changes.push(next);
  },
});
assert.match(portionHtml, /Stored as 2 half-egg/);
assert.equal(inputProps.value, '1');
increaseProps.onPress();
assert.deepEqual(changes.at(-1), [{ itemId: 'egg', quantity: 3 }], 'portion still steps stored units by 1');

console.log(
  'half_step_stock_uses_phase3_ui passed: gate off, UI half-step behind override, portion unchanged, save still integer-only.',
);
