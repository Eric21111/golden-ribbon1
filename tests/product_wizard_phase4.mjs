// Phase 4: mobile usability refinements for the Create/Edit Product wizards.
// IMPORTANT: this checks logic and source only. It cannot render the screens or run on a device, so tap sizes,
// keyboard behaviour and Android Back must still be verified by hand on real phones.
//   1. touch targets (>= 44) with compact visuals; quantity limits unchanged
//   2. pickers / keyboard / nested sheets
//   3. wizard navigation (buttons reachable, no nested scrolling, flows preserved)
//   4. warnings and feedback (preview pills, the disabled-save explanation, missing-price flags)
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { MIN_TOUCH_TARGET } from '../src/features/products/touchTargets.ts';
import { MAX_RECIPE_QUANTITY } from '../src/features/products/recipePreviewData.ts';
import {
  flowSteps,
  getWizardFlow,
  isPriceMissing,
} from '../src/features/products/wizardGuards.ts';

const read = (path) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const recipeSrc = read('src/features/products/VariantRecipePreview.tsx');
const drinkSrc = read('src/features/products/VariantDrinkChoicePreview.tsx');
const pricingSrc = read('src/features/products/BranchPricingStep.tsx');
const editorSrc = read('src/features/products/VariantListEditor.tsx');
const pickerSrc = read('src/features/products/InventoryItemPickerModal.tsx');
const fieldSrc = read('src/features/products/PosAvailabilityField.tsx');
const categorySrc = read('src/features/products/ProductCategoryField.tsx');
const searchSrc = read('src/components/dashboard/SearchInput.tsx');
const sheetSrc = read('src/components/BottomSheet.tsx');
const buttonSrc = read('src/components/dashboard/ManagerActionButton.tsx');
const createSrc = read('src/features/products/CreateProductWizard.tsx');
const editSrc = read('src/features/products/EditProductWizard.tsx');

const count = (src, re) => (src.match(re) ?? []).length;

// ---------------------------------------------------------------- 1. touch targets
{
  assert.ok(MIN_TOUCH_TARGET >= 44, 'the shared minimum is at least 44');

  // quantity stepper, remove, quick-add: a 44px tap area around a compact visual
  assert.match(recipeSrc, /stepTouch: \{ width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET/);
  assert.match(recipeSrc, /removeButton: \{ width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET/);
  assert.match(recipeSrc, /width: 36,\n\s*height: MIN_TOUCH_TARGET,/, 'the quantity field is tall enough to tap');
  assert.match(recipeSrc, /chipTouch: \{ minHeight: MIN_TOUCH_TARGET/);
  assert.equal(count(recipeSrc, /styles\.stepTouch/g), 2, 'minus and plus both use the 44px tap area');
  assert.doesNotMatch(recipeSrc, /\(\{ pressed \}\) => \[styles\.stepButton/, 'the compact circle is never the pressable itself');
  assert.match(recipeSrc, /stepButton: \{\n\s*width: 30,\n\s*height: 30,/, 'icons/visuals stay compact');
  assert.equal(count(recipeSrc, /style=\{\(\{ pressed \}\) => \[styles\.chipTouch/g), 3, 'put-back chip (snacks), quick-add chips and Browse all');

  // drink choice: every chip, Select all, and the checkbox row
  assert.match(drinkSrc, /chipTouch: \{ minHeight: MIN_TOUCH_TARGET/);
  assert.match(drinkSrc, /checkRow: \{[^}]*minHeight: MIN_TOUCH_TARGET/);
  assert.equal(count(drinkSrc, /style=\{\(\{ pressed \}\) => \[styles\.chipTouch/g), 2, 'Select all + each drink chip');

  // pricing step controls
  assert.match(pricingSrc, /toggleButton: \{[^}]*minHeight: MIN_TOUCH_TARGET/);
  assert.match(pricingSrc, /minHeight: MIN_TOUCH_TARGET,\n[\s\S]*?paddingHorizontal: 12/, 'branch chips');
  assert.match(pricingSrc, /priceBox: \{[\s\S]*?height: MIN_TOUCH_TARGET/);

  // variant cards
  assert.match(editorSrc, /headerMain: \{[^}]*minHeight: MIN_TOUCH_TARGET/);
  assert.match(editorSrc, /linkTouch: \{ minHeight: MIN_TOUCH_TARGET/);
  assert.match(editorSrc, /minHeight: 48,\n\s*\},\n\s*doneButtonText/);
  assert.match(editorSrc, /minHeight: 48,\n\s*\},\n\s*addButtonText/);

  // quantity limits and validation are unchanged
  assert.equal(MAX_RECIPE_QUANTITY, 99);
  assert.match(recipeSrc, /Math\.max\(0, Math\.min\(quantity, MAX_RECIPE_QUANTITY\)\)/);
  assert.match(recipeSrc, /maxLength=\{2\}/);
  assert.match(recipeSrc, /disabled=\{line\.quantity <= 1\}/);
  assert.match(recipeSrc, /disabled=\{line\.quantity >= MAX_RECIPE_QUANTITY\}/);
  assert.match(recipeSrc, /if \(line\.quantity === 0\) setQuantity\(index, 1\);/);
  console.log('phase4 touch targets: ok');
}

// ---------------------------------------------------------------- 2. pickers, keyboard, nested sheets
{
  // the sheet that hosts every picker already lifts above the keyboard, keeps taps working and dismisses on drag
  assert.match(sheetSrc, /useKeyboardBottomInset/);
  assert.match(sheetSrc, /keyboardShouldPersistTaps="handled"/);
  assert.match(sheetSrc, /keyboardDismissMode="on-drag"/);
  assert.match(sheetSrc, /onRequestClose=\{onClose\}/, 'Android Back closes the topmost sheet');

  // the stock picker: its own sheet (so Back closes only the picker), search with a Search key that closes the keyboard
  assert.match(pickerSrc, /<ManagerBottomSheet visible=\{visible\} title=\{title\} scroll onClose=\{onClose\}>/);
  assert.match(pickerSrc, /returnKeyType="search"/);
  assert.match(pickerSrc, /onSubmitEditing=\{Keyboard\.dismiss\}/);
  assert.match(searchSrc, /'returnKeyType' \| 'onSubmitEditing'/);
  assert.match(searchSrc, /returnKeyType=\{returnKeyType\}/);
  assert.match(recipeSrc, /onClose=\{\(\) => setPickerOpen\(false\)\}/, 'closing the picker never closes the wizard sheet');
  // search, selection and duplicate prevention are unchanged
  assert.match(pickerSrc, /matchesInventorySearch\(item, search\)/);
  assert.match(pickerSrc, /disabled=\{added\}/);
  assert.match(recipeSrc, /if \(lines\.some\(\(line\) => line\.itemId === itemId\)\) return;/);
  assert.match(recipeSrc, /Missing an item|addedItemIds=\{lines\.map/);
  // the drink picker has no keyboard at all (chips only)
  assert.doesNotMatch(drinkSrc, /TextInput/);
  console.log('phase4 pickers and keyboard: ok');
}

// ---------------------------------------------------------------- 3. wizard navigation
{
  // Back / Next / Create / Save are full-size buttons
  assert.match(buttonSrc, /primary: \{\n\s*height: 54,/);
  assert.ok(54 >= MIN_TOUCH_TARGET);
  for (const [name, src, save] of [['create', createSrc, 'Create product'], ['edit', editSrc, 'Save changes']]) {
    assert.equal(count(src, /<View style=\{styles\.buttonRow\}>/g), 1, `${name}: one button row`);
    assert.match(src, /label="Back"/);
    assert.match(src, /label="Next"/);
    assert.match(src, new RegExp(`label="${save}"`));
    // the flows are untouched
    assert.match(src, /const flow: WizardFlow = getWizardFlow\(\{ sellable, category, variantCount: variants\.length \}\);/);
    assert.match(src, /const steps = flowSteps\(flow\);/);
  }
  assert.deepEqual(flowSteps(getWizardFlow({ sellable: false, category: 'meals', variantCount: 0 })), [1]);
  assert.deepEqual(flowSteps(getWizardFlow({ sellable: true, category: 'drinks', variantCount: 0 })), [1, 3]);
  assert.deepEqual(flowSteps(getWizardFlow({ sellable: true, category: 'extras', variantCount: 0 })), [1, 3]);
  assert.deepEqual(flowSteps(getWizardFlow({ sellable: true, category: 'supplies', variantCount: 0 })), [1, 3]);
  assert.deepEqual(flowSteps(getWizardFlow({ sellable: true, category: 'meals', variantCount: 0 })), [1, 2, 3]);

  // no unnecessary nested scrolling inside the wizard: it lives in the sheet's single ScrollView
  const productFiles = readdirSync('src/features/products').filter((file) => file.endsWith('.tsx'));
  for (const file of productFiles) {
    const src = read(`src/features/products/${file}`);
    assert.doesNotMatch(src, /\b(ScrollView|FlatList|SectionList)\b/, `${file}: no nested scroll container`);
  }
  // rows of chips wrap instead of overflowing horizontally
  for (const [name, src] of [['stock list', recipeSrc], ['drinks', drinkSrc], ['pricing', pricingSrc]]) {
    assert.match(src, /flexWrap: 'wrap'/, `${name}: chip rows wrap`);
  }
  console.log('phase4 wizard navigation: ok');
}

// ---------------------------------------------------------------- 4. warnings and feedback
{
  // "Not saved yet" stays readable (12px) wherever it appears
  const layoutSrc = read('src/features/products/StepOneLayout.tsx');
  assert.match(layoutSrc, /Not saved yet/);
  assert.match(layoutSrc, /pillText: \{[^}]*fontSize: 12/, 'pill text is 12px');
  // the drink choice is saved with the product now, so it no longer carries a "Not saved yet" marker
  assert.doesNotMatch(drinkSrc, /PreviewPill|Not saved yet/);

  for (const [name, src] of [['create', createSrc], ['edit', editSrc]]) {
    assert.match(src, /sellInPos: false/, `${name}: stock-only save is available`);
    assert.doesNotMatch(src, /InventoryOnlyNotice/, `${name}: saving is no longer blocked`);
  }

  // price problems are flagged on the field itself, not only in a message at the bottom
  const prices = { v1: '80', v2: '', v3: '  ' };
  const keys = ['v1', 'v2', 'v3'];
  assert.equal(isPriceMissing({ showErrors: true, prices, keys, key: 'v2' }), true, 'empty next to a filled one');
  assert.equal(isPriceMissing({ showErrors: true, prices, keys, key: 'v3' }), true, 'blank spaces count as empty');
  assert.equal(isPriceMissing({ showErrors: true, prices, keys, key: 'v1' }), false, 'a filled field is fine');
  assert.equal(isPriceMissing({ showErrors: false, prices, keys, key: 'v2' }), false, 'nothing is flagged before an error shows');
  assert.equal(isPriceMissing({ showErrors: true, prices: {}, keys, key: 'v1' }), false, 'an untouched list is not flagged field by field');
  assert.equal(isPriceMissing({ showErrors: true, prices: { v1: '80', v2: '90', v3: '1' }, keys, key: 'v2' }), false);
  assert.match(pricingSrc, /isPriceMissing\(\{/);
  assert.equal(count(pricingSrc, /highlightMissing=\{Boolean\(error\)\}/g), 2, 'both price lists');
  assert.match(pricingSrc, /'Invalid price' : 'Enter a price'/);
  // existing inline validation near the fields is still there
  assert.match(editorSrc, /`Enter a \$\{noun\} name\.`/);
  assert.match(editorSrc, /'This name is already used\.'/);
  assert.match(drinkSrc, /Select at least one drink\./);
  assert.match(createSrc, /error=\{step1Errors\.name\}/);
  console.log('phase4 warnings and feedback: ok');
}

console.log('product_wizard_phase4: ALL PASS');
