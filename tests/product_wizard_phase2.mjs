// Phase 2 of the Create/Edit Product frontend audit (category-specific workflows):
//   1. "Category not set" in Edit Product (existing products have no saved category)
//   2. product-level "Stock Used Per Order" for single-price Meals and Snacks
//   3. step labels that follow the selected category (Drinks keeps its two-step flow)
// Pure logic is imported directly; screens are checked by reading their source, like the other UI tests.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  DEFAULT_PRODUCT_CATEGORY,
  INITIAL_EDIT_CATEGORY,
  PRODUCT_CATEGORIES,
  UNSET_CATEGORY_CONFIG,
  getCategoryConfig,
} from '../src/features/products/productCategoryPreview.ts';
import { THIS_PRODUCT_ID } from '../src/features/products/recipePreviewData.ts';
import {
  MAIN_PRODUCT_ITEM_ID,
  PRODUCT_STOCK_KEY,
  buildDraftSnapshot,
  getUnsavedPreviewItems,
  shouldOfferFirstOption,
  shouldSeedProductStock,
  withoutDefaultProductStock,
} from '../src/features/products/wizardGuards.ts';

const read = (path) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const createSrc = read('src/features/products/CreateProductWizard.tsx');
const editSrc = read('src/features/products/EditProductWizard.tsx');
const editorSrc = read('src/features/products/VariantListEditor.tsx');
const fieldSrc = read('src/features/products/ProductCategoryField.tsx');
const indexSrc = read('app/(manager)/manager/products/index.tsx');

// ---------------------------------------------------------------- 1. Category not set (Edit)
{
  assert.equal(INITIAL_EDIT_CATEGORY, 'unset', 'Edit starts with no category');
  assert.equal(DEFAULT_PRODUCT_CATEGORY, 'meals', 'Create keeps its default');
  assert.deepEqual(
    PRODUCT_CATEGORIES.map((category) => category.id),
    ['meals', 'snacks', 'drinks', 'extras', 'supplies'],
    'the five real categories only; "unset" is not a pickable real category',
  );

  const unset = getCategoryConfig('unset');
  assert.equal(unset, UNSET_CATEGORY_CONFIG);
  assert.equal(unset.label, 'Category not set');
  // neutral layout: assumes nothing about the product. Saved stock-used lists ARE shown (the category is not saved,
  // so it can't tell us whether an existing product has them); the preview-only drink choice is not.
  assert.equal(unset.showIngredients, true);
  assert.equal(unset.showDrinkChoice, false);
  assert.equal(unset.showStatus, false);
  assert.equal(unset.productLevelStock, true);
  assert.equal(unset.autoAddMainProduct, false, 'nothing is auto-added to existing products');
  assert.equal(unset.simpleEmpty, null);

  // "unset" is the baseline, so it is not reported as a preview setting; choosing a category is
  const base = { category: 'unset', defaultCategory: 'unset', recipes: {}, drinks: {} };
  assert.deepEqual(getUnsavedPreviewItems(base), []);
  assert.deepEqual(getUnsavedPreviewItems({ ...base, category: 'snacks' }), ['Product Category']);
  // and an unchanged form is not dirty
  const snap = (category) => buildDraftSnapshot({ name: 'Beef Curry', category });
  assert.equal(snap('unset'), snap('unset'));
  assert.notEqual(snap('snacks'), snap('unset'), 'choosing a category is a (preview) change');

  // wiring
  assert.match(editSrc, /: INITIAL_EDIT_CATEGORY,/, 'Edit starts unset when no category is saved');
  assert.match(editSrc, /: INITIAL_EDIT_CATEGORY,/);
  assert.match(editSrc, /<ProductCategoryField value=\{category\} onChange=\{setCategory\} allowUnset \/>/);
  assert.match(createSrc, /useState<CategoryChoice>\(DEFAULT_PRODUCT_CATEGORY\)/, 'Create keeps its default');
  assert.doesNotMatch(createSrc, /allowUnset/);
  assert.match(fieldSrc, /label: 'Category not set'/);
  assert.match(fieldSrc, /Choose what kind of product this is\./);
  // the preview badge is shown once for the whole Setup group (category + POS), not per field
  assert.match(editSrc, /<SectionHeader title="How it's sold" preview \/>/, 'the category stays marked as preview-only');
  assert.match(createSrc, /<SectionHeader title="How it's sold" preview \/>/);
  assert.match(editorSrc, /Category not set\. Pick one in Step 1 to set up drink options\./);

  // existing variants/prices are untouched by the unset layout: variants are always listed, never hidden
  assert.match(editorSrc, /variants\.map\(\(variant, index\) =>/);
  assert.doesNotMatch(editorSrc, /category === 'unset' \? null/);
  // switching category only hides sections (with a note); nothing is deleted
  assert.match(editorSrc, /Saved drink choice stays on this \$\{noun\}\./, 'a hidden drink choice is kept AND saved');
  assert.match(editorSrc, /Saved stock stays on this \$\{noun\}\./, 'a hidden stock list is kept AND saved');
  for (const src of [createSrc, editSrc]) {
    assert.doesNotMatch(src, /setVariants\(\[\]\)/, 'no code path wipes the variants');
  }
  console.log('phase2 category not set: ok');
}

// ---------------------------------------------------------------- 2. single-price Meals & Snacks
{
  const flag = (id, key) => getCategoryConfig(id)[key];
  // A product-level list while there are no variants: Meals and Snacks (a single-price meal/snack), Extras (simple,
  // fixed-price items) and "Category not set" (existing products may already have saved lists). Drinks and Supplies
  // have none. Once variants exist, each variant has its own list.
  for (const id of ['meals', 'snacks', 'extras', 'unset']) assert.equal(flag(id, 'productLevelStock'), true, `${id}: product-level stock`);
  for (const id of ['drinks', 'supplies']) assert.equal(flag(id, 'productLevelStock'), false, `${id}: none`);
  // This Product x1 is automatic for Meals and Snacks only; Extras stays optional/empty
  for (const id of ['meals', 'snacks']) assert.equal(flag(id, 'autoAddMainProduct'), true, `${id}: auto-add`);
  for (const id of ['drinks', 'extras', 'supplies', 'unset']) assert.equal(flag(id, 'autoAddMainProduct'), false, `${id}: no auto-add`);

  // the guard module and the recipe data agree on the main-product id
  assert.equal(MAIN_PRODUCT_ITEM_ID, THIS_PRODUCT_ID);

  // seeding: only a brand-new list for a variant-free product
  assert.equal(shouldSeedProductStock({ variantCount: 0, autoAdd: true, current: undefined }), true);
  assert.equal(shouldSeedProductStock({ variantCount: 0, autoAdd: true, current: [] }), false, 'a list the user emptied is never refilled');
  assert.equal(
    shouldSeedProductStock({ variantCount: 0, autoAdd: true, current: [{ itemId: THIS_PRODUCT_ID, quantity: 3 }] }),
    false,
    'an existing quantity is never overwritten',
  );
  assert.equal(shouldSeedProductStock({ variantCount: 2, autoAdd: true, current: undefined }), false, 'products with variants are not seeded');
  assert.equal(shouldSeedProductStock({ variantCount: 0, autoAdd: false, current: undefined }), false, 'Extras is not auto-seeded');

  // the automatic default is not an "edit"; real changes still are
  const seeded = { [PRODUCT_STOCK_KEY]: [{ itemId: THIS_PRODUCT_ID, quantity: 1 }] };
  assert.deepEqual(withoutDefaultProductStock(seeded), {});
  const initial = buildDraftSnapshot({ name: 'Cheesesticks', recipes: withoutDefaultProductStock({}) });
  assert.equal(buildDraftSnapshot({ name: 'Cheesesticks', recipes: withoutDefaultProductStock(seeded) }), initial, 'seeding alone is not a change');
  const three = { [PRODUCT_STOCK_KEY]: [{ itemId: THIS_PRODUCT_ID, quantity: 3 }] };
  assert.notEqual(buildDraftSnapshot({ name: 'Cheesesticks', recipes: withoutDefaultProductStock(three) }), initial, 'x3 is a change');
  const withExtra = { [PRODUCT_STOCK_KEY]: [{ itemId: THIS_PRODUCT_ID, quantity: 1 }, { itemId: 'sample-rice', quantity: 1 }] };
  assert.notEqual(buildDraftSnapshot({ name: 'Cheesesticks', recipes: withoutDefaultProductStock(withExtra) }), initial);
  const cleared = { [PRODUCT_STOCK_KEY]: [] };
  assert.equal(buildDraftSnapshot({ name: 'Cheesesticks', recipes: withoutDefaultProductStock(cleared) }), initial, 'removing the default again is clean');
  // other variants' entries are left alone
  const mixed = { ...seeded, v1: [{ itemId: 'sample-egg', quantity: 1 }] };
  assert.deepEqual(withoutDefaultProductStock(mixed), { v1: [{ itemId: 'sample-egg', quantity: 1 }] });

  // wiring: the editor seeds through the guard, and shows the list only while there are no variants
  assert.match(editorSrc, /shouldSeedProductStock\(\{/);
  assert.match(editorSrc, /variantCount: variants\.length/);
  assert.match(editorSrc, /autoAdd: config\.autoAddMainProduct/);
  // (the stock-list condition is asserted in section 4)
  assert.match(editorSrc, /\{showProductStock \? \(/);
  assert.match(editorSrc, /lockMainProduct=\{config\.id === 'meals'\}\n\s*mainOnly=\{!config\.allowOtherStock\}\n\s*lines=\{recipes\[PRODUCT_STOCK_KEY\]/);
  for (const src of [createSrc, editSrc]) {
    assert.match(src, /recipePreview: withoutDefaultProductStock\(recipePreview\)/, 'seed is excluded from unsaved-change detection');
  }
  // no placeholder variant is created
  for (const [name, src] of [['editor', editorSrc], ['create', createSrc], ['edit', editSrc]]) {
    assert.doesNotMatch(src, /['"]Regular['"]/, `${name}: no placeholder "Regular" variant`);
  }
  // the product-level list is saved ONLY through the stockUses payload. Category is saved so the drink
  // picker can list drinks, and the raw recipe map is not part of the saved values.
  for (const [name, src] of [['create', createSrc], ['edit', editSrc]]) {
    const start = src.indexOf('onSubmit(\n      {');
    const end = src.indexOf('      pricing,', start);
    const block = src.slice(start, end);
    assert.ok(!block.includes('PRODUCT_STOCK_KEY'), `${name}: saved values must not include PRODUCT_STOCK_KEY`);
    assert.match(block, /productCategory:/, `${name}: category is saved for the stock and drink pickers`);
  }
  console.log('phase2 single-price stock: ok');
}

// ---------------------------------------------------------------- 3. step labels follow the category
{
  const labels = Object.fromEntries(
    ['meals', 'snacks', 'drinks', 'extras', 'supplies', 'unset'].map((id) => [id, getCategoryConfig(id).stepLabel]),
  );
  assert.deepEqual(labels, {
    meals: 'Meal Options',
    snacks: 'Selling Options',
    drinks: 'Sizes & Packaging',
    extras: 'Selling Options',
    supplies: 'Inventory Details',
    unset: 'Variants',
  });

  for (const [name, src] of [['create', createSrc], ['edit', editSrc]]) {
    assert.match(src, /middleLabel=\{getCategoryConfig\(category\)\.stepLabel\}/, `${name}: indicator uses the category label`);
    assert.match(src, /const labels = \{ 1: 'Product Info', 2: middleLabel, 3: 'Branch Pricing' \} as const;/);
    assert.doesNotMatch(src, /2: 'Variants'/, `${name}: Step 2 label is no longer hard-coded`);
    // the Drinks two-step flow and the three-step flow are preserved
    // (the flow rules now live in getWizardFlow / flowSteps, covered by the Phase 3 test)
    assert.match(src, /const flow: WizardFlow = getWizardFlow\(\{ sellable, category, variantCount: variants\.length \}\);\n\s*const simpleFlow = flow === 'simple';/);
    assert.match(src, /const steps = flowSteps\(flow\);/);
    assert.match(src, /setStep\(simpleFlow \? 3 : 2\)/);
    // Phase 1 safeguards still in place
    assert.match(src, /onDirtyChange\?\.\(isDirty\)/);
    assert.match(src, /buildPreviewNotice/);
  }
  assert.match(indexSrc, /onClose=\{requestCloseCreate\}/);
  assert.match(indexSrc, /onClose=\{requestCloseEdit\}/);
  for (const [name, src] of [['create', createSrc], ['edit', editSrc]]) {
    const start = src.indexOf('function switchPricingMode');
    const end = src.indexOf('\n  }\n', start);
    const body = src.slice(start, end);
    assert.doesNotMatch(body, /setPriceDrafts\(|setUniformBase\(|setUniformVariantPrices\(/, `${name}: pricing inputs still preserved`);
  }
  console.log('phase2 step labels: ok');
}

// ---------------------------------------------------------------- 4. Meals and Snacks open Step 2 on an option card (Create)
{
  const recipeSrc = read('src/features/products/VariantRecipePreview.tsx');

  // which categories open on an option card, and the wording
  for (const id of ['meals', 'snacks']) assert.equal(getCategoryConfig(id).startsWithOption, true, `${id}: opens on an option card`);
  for (const id of ['drinks', 'extras', 'supplies', 'unset']) assert.equal(getCategoryConfig(id).startsWithOption, false, `${id}: unchanged`);
  assert.equal(getCategoryConfig('meals').ingredientsLabel, 'THIS MEAL USES');
  assert.equal(getCategoryConfig('snacks').ingredientsLabel, 'THIS SNACK USES · OPTIONAL');
  assert.equal(getCategoryConfig('extras').ingredientsLabel, 'STOCK USED PER ORDER · OPTIONAL', 'Extras keeps its own label');
  assert.equal(getCategoryConfig('meals').emptyBody, 'Skip this step if the product has a single price.');

  // the rule: only a brand-new, option-free product, and only once
  assert.equal(shouldOfferFirstOption({ startsWithOption: true, variantCount: 0, alreadyOffered: false }), true);
  assert.equal(shouldOfferFirstOption({ startsWithOption: true, variantCount: 0, alreadyOffered: true }), false, 'never re-added after the first time');
  assert.equal(shouldOfferFirstOption({ startsWithOption: true, variantCount: 2, alreadyOffered: false }), false, 'existing options are left alone');
  assert.equal(shouldOfferFirstOption({ startsWithOption: false, variantCount: 0, alreadyOffered: false }), false, 'other categories are unchanged');

  // wiring: Create adds the card when moving to Step 2 (never in the Drinks two-step flow); Edit never does
  assert.match(createSrc, /const firstOptionOfferedRef = useRef\(false\);/);
  assert.match(createSrc, /startsWithOption: getCategoryConfig\(category\)\.startsWithOption,/);
  assert.match(createSrc, /alreadyOffered: firstOptionOfferedRef\.current,/);
  assert.match(createSrc, /setVariants\(\[\{ id, name: '' \}\]\);/, 'one blank, unnamed option');
  assert.match(createSrc, /\[id\]: \[\{ itemId: THIS_PRODUCT_ID, quantity: 1 \}\]/, 'with This Product x1 already in it');
  assert.match(createSrc, /if \(!simpleFlow\) offerFirstOption\(\);\n\s*setStep\(simpleFlow \? 3 : 2\);/);
  assert.doesNotMatch(editSrc, /offerFirstOption|shouldOfferFirstOption|firstOptionOfferedRef/, 'Edit never adds variants');

  // the earlier stock-list-first pieces are gone
  assert.doesNotMatch(editorSrc, /startsAsSingle|moreOptions|How is this|One way, one price|Different options/);
  assert.doesNotMatch(editorSrc, /What one order of this product uses/);
  assert.doesNotMatch(recipeSrc, /This Product is always included\./);
  // the standard empty box is back for every category without a simple note (Edit with no variants shows it)
  assert.match(editorSrc, /<Text style=\{styles\.emptyTitle\}>No \{noun\}s yet<\/Text>/);
  // only Extras shows a product-level list
  assert.match(editorSrc, /const showProductStock = variants\.length === 0 && config\.productLevelStock && config\.showIngredients;/);

  // a single-price meal just removes the card: it asks first, and the discarded preview data goes with it
  assert.match(editorSrc, /requestRemove/);
  assert.match(editorSrc, /Remove this \$\{noun\}\?/);

  // the main product row shows its real name and just the unit
  assert.match(recipeSrc, /const shownName = item\.id === THIS_PRODUCT_ID && productName\.trim\(\) \? productName\.trim\(\) : item\.name;/);
  assert.match(recipeSrc, /item\.id !== THIS_PRODUCT_ID && item\.hint/);

  // nothing about this reaches the saved values
  for (const [name, src] of [['create', createSrc], ['edit', editSrc]]) {
    const start = src.indexOf('onSubmit(\n      {');
    const end = src.indexOf('      pricing,', start);
    const block = src.slice(start, end);
    for (const forbidden of ['startsWithOption', 'firstOption', 'shownName']) {
      assert.ok(!block.includes(forbidden), `${name}: saved values must not include ${forbidden}`);
    }
  }
  console.log('phase2 option cards first: ok');
}

console.log('product_wizard_phase2: ALL PASS');
