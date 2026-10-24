// Phase 1 of the Create/Edit Product frontend audit:
//   1. preview-only warning on the final pricing step
//   2. unsaved-changes confirmation when closing the wizard
//   3. pricing inputs preserved when switching pricing mode
// Pure logic is imported straight from the helper module; the screens are checked by reading their source
// (the same approach as the other UI tests in this folder).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  DISCARD_DIALOG,
  activeUniformBase,
  activeUniformPrice,
  buildDraftSnapshot,
  buildPreviewNotice,
  decideClose,
  getUnsavedPreviewItems,
  otherModeHasPrices,
} from '../src/features/products/wizardGuards.ts';

const read = (path) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const indexSrc = read('app/(manager)/manager/products/index.tsx');
const createSrc = read('src/features/products/CreateProductWizard.tsx');
const editSrc = read('src/features/products/EditProductWizard.tsx');
const pricingSrc = read('src/features/products/BranchPricingStep.tsx');

const base = { category: 'meals', defaultCategory: 'meals', recipes: {}, drinks: {} };

// ---------------------------------------------------------------- 1. preview-only warning
{
  assert.equal(buildPreviewNotice(getUnsavedPreviewItems(base)), null, 'no notice when nothing preview-only was used');

  // choosing the default category again is not "using" the preview setting
  assert.deepEqual(getUnsavedPreviewItems({ ...base, category: 'meals' }), []);

  // empty lists and disabled drink choices don't count
  assert.deepEqual(
    getUnsavedPreviewItems({
      ...base,
      recipes: { v1: [], v2: [] },
      drinks: { v1: { enabled: false, drinkIds: ['coke'] }, v2: { enabled: false, drinkIds: [] } },
    }),
    [],
  );

  assert.deepEqual(getUnsavedPreviewItems({ ...base, category: 'drinks' }), ['Product Category']);
  assert.equal(
    buildPreviewNotice(['Product Category']),
    'Not saved yet: Product Category. Everything else is saved.',
  );

  const all = getUnsavedPreviewItems({
    category: 'snacks',
    defaultCategory: 'meals',
    recipes: { v1: [{ itemId: 'this-product', quantity: 1 }] },
    drinks: { v1: { enabled: true, drinkIds: ['sample-coke'] } },
  });
  // Stock Used Per Order and Drink Choice are saved with the product now, so they are never reported as unsaved
  assert.deepEqual(all, ['Product Category']);
  assert.equal(buildPreviewNotice(all), 'Not saved yet: Product Category. Everything else is saved.');
  assert.equal(
    buildPreviewNotice(['Product Category', 'POS Availability']),
    'Not saved yet: Product Category and POS Availability. Everything else is saved.',
  );

  // wiring: both wizards compute the notice and hand it to the pricing step, which renders it
  for (const src of [createSrc, editSrc]) {
    assert.match(src, /buildPreviewNotice\(\s*getUnsavedPreviewItems\(/);
    assert.match(src, /previewNotice=\{previewNotice\}/);
  }
  assert.match(pricingSrc, /\{previewNotice \? \(/);
  // the stock text beside the prices is saved data now, so it is shown plainly (no "Preview" marker)
  assert.match(pricingSrc, /\{summaries\[variant\.key\]\}/);
  assert.doesNotMatch(pricingSrc, /Preview ·/);

  // the notice must not leak into what is saved: the submit values carry no preview-only fields
  for (const [name, src] of [['create', createSrc], ['edit', editSrc]]) {
    const start = src.indexOf('onSubmit(\n      {');
    const end = src.indexOf('      pricing,', start);
    assert.ok(start > 0 && end > start, `${name}: submit block found`);
    const block = src.slice(start, end);
    for (const forbidden of ['category', 'previewNotice', 'stockSummaries']) {
      assert.ok(!block.includes(forbidden), `${name}: submit values must not include ${forbidden}`);
    }
    for (const required of ['name:', 'sku:', 'description:', 'default_price:', 'variants:', 'closingStockBehavior:', 'isNonReturnable', 'stockUses:', 'drinkChoices:']) {
      assert.ok(block.includes(required), `${name}: submit values keep ${required}`);
    }
  }
  console.log('phase1 preview warning: ok');
}

// ---------------------------------------------------------------- 2. unsaved-changes confirmation
{
  assert.equal(decideClose({ dirty: false, submitting: false }), 'close', 'nothing changed: close at once');
  assert.equal(decideClose({ dirty: true, submitting: false }), 'confirm', 'unsaved edits: ask first');
  assert.equal(decideClose({ dirty: true, submitting: true }), 'close', 'a save in flight is never interrupted');
  assert.equal(decideClose({ dirty: false, submitting: true }), 'close');

  assert.equal(DISCARD_DIALOG.cancel, 'Continue Editing');
  assert.equal(DISCARD_DIALOG.confirm, 'Discard Changes');

  const start = {
    name: '',
    variants: [],
    uniformBase: '',
    uniformVariantPrices: {},
    priceDrafts: {},
    recipePreview: {},
    drinkPreview: {},
    category: 'meals',
    isNonReturnable: false,
  };
  const snap = (patch = {}) => buildDraftSnapshot({ ...start, ...patch });
  const initial = snap();

  assert.equal(snap(), initial, 'identical state is not dirty');
  assert.notEqual(snap({ name: 'Curry' }), initial, 'typing a name is a change');
  assert.equal(snap({ name: '' }), initial, 'clearing it again is not a change');
  assert.notEqual(snap({ isNonReturnable: true }), initial);
  assert.equal(snap({ isNonReturnable: false }), initial);
  assert.notEqual(snap({ variants: [''] }), initial, 'adding a blank variant is a change');
  assert.notEqual(snap({ variants: ['Viand Only'] }), initial);
  assert.notEqual(snap({ uniformBase: '80' }), initial, 'entering a price is a change');
  assert.equal(snap({ uniformBase: '' }), initial);
  assert.notEqual(snap({ priceDrafts: { b1: { base: '', variantPrices: { v1: '90' } } } }), initial);
  assert.equal(snap({ priceDrafts: { b1: { base: '', variantPrices: { v1: '' } } } }), initial, 'a cleared price is not a change');
  assert.notEqual(snap({ category: 'drinks' }), initial, 'preview-only category counts');
  assert.notEqual(snap({ recipePreview: { v1: [{ itemId: 'this-product', quantity: 1 }] } }), initial, 'preview stock lines count');
  assert.equal(snap({ recipePreview: { v1: [] } }), initial, 'an emptied stock list is not a change');
  assert.notEqual(snap({ drinkPreview: { v1: { enabled: true, drinkIds: ['sample-coke'] } } }), initial, 'preview drink choice counts');
  assert.equal(snap({ drinkPreview: { v1: { enabled: false, drinkIds: [] } } }), initial, 'drink choice toggled back off is not a change');
  // key order does not matter
  assert.equal(
    buildDraftSnapshot({ a: 1, b: { y: 2, x: 1 } }),
    buildDraftSnapshot({ b: { x: 1, y: 2 }, a: 1 }),
  );
  // an edited saved field flips back and forth correctly
  const editStart = buildDraftSnapshot({ name: 'Beef Curry', isActive: true });
  assert.notEqual(buildDraftSnapshot({ name: 'Beef Curry', isActive: false }), editStart, 'deactivating is a change');
  assert.equal(buildDraftSnapshot({ name: 'Beef Curry', isActive: true }), editStart);

  // wiring: every dismissal path (Close, backdrop, Android back) goes through the sheet's onClose
  assert.match(indexSrc, /title="Create product" scroll onClose=\{requestCloseCreate\}/);
  assert.match(indexSrc, /onClose=\{requestCloseEdit\}/);
  assert.doesNotMatch(indexSrc, /onClose=\{\(\) => setCreateOpen\(false\)\}/, 'create sheet no longer closes unconditionally');
  assert.doesNotMatch(indexSrc, /onClose=\{\(\) => setEditProduct\(null\)\}/, 'edit sheet no longer closes unconditionally');
  assert.match(indexSrc, /decideClose\(\{ dirty: createDirtyRef\.current, submitting: isSubmitting \}\)/);
  assert.match(indexSrc, /decideClose\(\{ dirty: editDirtyRef\.current, submitting: isEditSubmitting \}\)/);
  assert.match(indexSrc, /confirmAction\(DISCARD_DIALOG\.title, DISCARD_DIALOG\.message, closeNow/);
  assert.match(indexSrc, /onDirtyChange=\{\(dirty\) => \{\s*createDirtyRef\.current = dirty;/);
  assert.match(indexSrc, /onDirtyChange=\{\(dirty\) => \{\s*editDirtyRef\.current = dirty;/);
  // successful saves close directly (no prompt) and reset the flag
  assert.match(indexSrc, /createDirtyRef\.current = false;\n\s*setCreateOpen\(false\);\n\s*\}\)\n\s*\.finally/);
  assert.match(indexSrc, /editDirtyRef\.current = false;\n\s*setEditProduct\(null\);\n\s*\}\)\n\s*\.catch/);
  // both wizards report dirtiness from a first-render snapshot
  for (const src of [createSrc, editSrc]) {
    assert.match(src, /onDirtyChange\?: \(dirty: boolean\) => void;/);
    assert.match(src, /initialSnapshotRef\.current = draftSnapshot/);
    assert.match(src, /onDirtyChange\?\.\(isDirty\)/);
  }
  console.log('phase1 unsaved-changes confirmation: ok');
}

// ---------------------------------------------------------------- 3. pricing inputs preserved across modes
{
  const uniformPrices = { v1: '100', v2: '200' };

  // only the selected mode's prices are used
  assert.equal(activeUniformBase('same', '80'), '80');
  assert.equal(activeUniformBase('different', '80'), '', 'same-for-all base must not leak into per-branch mode');
  assert.equal(activeUniformPrice('same', uniformPrices, 'v1'), '100');
  assert.equal(activeUniformPrice('different', uniformPrices, 'v1'), undefined, 'hidden uniform prices are not submitted');

  const drafts = { b1: { base: '', variantPrices: { v1: '95' } } };
  const empty = { uniformBase: '', uniformPrices: {}, branchDrafts: {} };

  // the user is told when the other mode still holds prices
  assert.equal(otherModeHasPrices('same', { ...empty, branchDrafts: drafts }), true);
  assert.equal(otherModeHasPrices('different', { ...empty, uniformPrices }), true);
  assert.equal(otherModeHasPrices('different', { ...empty, uniformBase: '80' }), true);
  assert.equal(otherModeHasPrices('same', empty), false);
  assert.equal(otherModeHasPrices('same', { ...empty, branchDrafts: { b1: { base: ' ', variantPrices: { v1: '' } } } }), false);

  // Switching modes is a plain state change: nothing is cleared (both wizards)
  for (const [name, src] of [['create', createSrc], ['edit', editSrc]]) {
    const start = src.indexOf('function switchPricingMode');
    const end = src.indexOf('\n  }\n', start);
    assert.ok(start > 0 && end > start, `${name}: switchPricingMode found`);
    const body = src.slice(start, end);
    assert.doesNotMatch(body, /setPriceDrafts\(/, `${name}: switching mode must not clear branch prices`);
    assert.doesNotMatch(body, /setUniformBase\(/, `${name}: switching mode must not clear the same-for-all price`);
    assert.doesNotMatch(body, /setUniformVariantPrices\(/, `${name}: switching mode must not clear same-for-all variant prices`);
    assert.match(body, /setPricingMode\(mode\)/);

    // the hidden mode's inputs are ignored when building what is saved
    assert.match(src, /activeUniformBase\(pricingMode, uniformBase\)/, `${name}: base price uses the active mode only`);
    assert.match(src, /activeUniformPrice\(pricingMode, uniformVariantPrices,/, `${name}: variant default uses the active mode only`);
    // the pricing branches of submit are still chosen by the selected mode
    assert.match(src, /if \(pricingMode === 'same'\) \{/);
    // existing validation messages are unchanged
    assert.match(src, /Enter a valid selling price\./);
    assert.match(src, /Enter a price for every variant\./);
    assert.match(src, /Enter a price for every variant on each selected branch\./);
    assert.match(src, /Complete the pricing for all selected branches\./);
    // the pricing step is told when the other mode's prices are kept
    assert.match(src, /otherModePricesKept=\{otherModePricesKept\}/);
  }
  assert.match(pricingSrc, /Your per-branch prices are kept if you switch back\./);
  assert.match(pricingSrc, /Your same-for-all prices are kept if you switch back\./);
  console.log('phase1 pricing mode switching: ok');
}

console.log('product_wizard_phase1: ALL PASS');
