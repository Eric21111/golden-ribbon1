// Phase 3 of the Create/Edit Product frontend work: "Available for sale in POS" / inventory-only products.
//   1. sellability toggling (preview-only, never inferred from the category, never presumed for existing products)
//   2. wizard navigation (inventory-only = Step 1 only; Drinks two-step and the three-step flow are preserved)
//   3. preservation of existing data (variants, prices and every entry survive toggling; saved values unchanged)
//   4. backend limitation guard (documents why this cannot be enforced yet)
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import {
  POS_AVAILABILITY_ENABLED,
  resolveSellable,
  INVENTORY_ONLY_MESSAGE,
  INVENTORY_ONLY_UNSUPPORTED_MESSAGE,
  buildDraftSnapshot,
  buildPreviewNotice,
  flowSteps,
  getUnsavedPreviewItems,
  getWizardFlow,
  isSaveSupported,
} from '../src/features/products/wizardGuards.ts';

const read = (path) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const createSrc = read('src/features/products/CreateProductWizard.tsx');
const editSrc = read('src/features/products/EditProductWizard.tsx');
const fieldSrc = read('src/features/products/PosAvailabilityField.tsx');

const categories = ['meals', 'snacks', 'drinks', 'extras', 'supplies', 'unset'];

function functionBody(src, signature) {
  const start = src.indexOf(signature);
  assert.ok(start >= 0, `${signature} found`);
  const end = src.indexOf('\n  }\n', start);
  assert.ok(end > start, `${signature} end found`);
  return src.slice(start, end);
}

// ---------------------------------------------------------------- 1. sellability toggling
{
  // inventory-only is chosen by the toggle alone, for every category
  for (const category of categories) {
    for (const variantCount of [0, 3]) {
      assert.equal(getWizardFlow({ sellable: false, category, variantCount }), 'inventory', `${category}/${variantCount}: inventory-only`);
      assert.notEqual(getWizardFlow({ sellable: true, category, variantCount }), 'inventory', `${category}/${variantCount}: sellable is never inventory-only`);
    }
  }
  // sellable: the category-specific flows are untouched
  // Drinks, Extras & Sides and Inventory Supplies without variants go straight from Product Info to Branch Pricing
  for (const category of ['drinks', 'extras', 'supplies']) {
    assert.equal(getWizardFlow({ sellable: true, category, variantCount: 0 }), 'simple', `${category}: two-step flow`);
    assert.equal(getWizardFlow({ sellable: true, category, variantCount: 2 }), 'full', `an existing ${category} product with variants keeps all three steps`);
  }
  for (const category of ['meals', 'snacks', 'unset']) {
    assert.equal(getWizardFlow({ sellable: true, category, variantCount: 0 }), 'full');
  }

  // every product starts sellable; nothing derives it from the category or from an existing product
  for (const [name, src] of [['create', createSrc], ['edit', editSrc]]) {
    assert.match(src, /const \[sellableChoice, setSellable\] = useState\(true\);/, `${name}: starts sellable`);
    assert.doesNotMatch(src, /setSellable\([^)]*category/, `${name}: never set from the category`);
  }
  assert.doesNotMatch(editSrc, /setSellable\(false\)/, 'existing products are never marked inventory-only');
  assert.doesNotMatch(createSrc, /setSellable\(false\)/);

  // the setting is a preview-only change: reported, and part of unsaved-change detection
  const base = { category: 'meals', defaultCategory: 'meals', recipes: {}, drinks: {} };
  assert.deepEqual(getUnsavedPreviewItems(base), [], 'sellable (absent) is not a preview setting');
  assert.deepEqual(getUnsavedPreviewItems({ ...base, sellable: true }), []);
  assert.deepEqual(getUnsavedPreviewItems({ ...base, sellable: false }), ['POS Availability']);
  assert.equal(
    buildPreviewNotice(getUnsavedPreviewItems({ ...base, category: 'snacks', sellable: false })),
    'Not saved yet: Product Category and POS Availability. Everything else is saved.',
  );
  const snap = (sellable) => buildDraftSnapshot({ name: 'Rice', sellable });
  assert.notEqual(snap(false), snap(true), 'turning it off is an unsaved change');
  assert.equal(snap(true), snap(true));
  for (const src of [createSrc, editSrc]) {
    assert.match(src, /category,\n\s*sellable,\n\s*\}\);/, 'snapshot includes the sellable choice');
    assert.match(src, /defaultCategory: [A-Z_]+,\n\s*sellable,\n\s*\}\)/, 'preview notice includes it');
  }

  // the field: exact label/description/messages, marked preview-only
  assert.match(fieldSrc, /label="Sell in POS"/);
  assert.match(fieldSrc, /description="Turn off for items you only keep in stock\."/);
  // marked preview-only by the Setup group header that holds it
  for (const src of [createSrc, editSrc]) {
    assert.match(src, /<SectionHeader title="How it's sold" preview \/>\s*<ProductCategoryField[^\n]*\n\s*\{POS_AVAILABILITY_ENABLED \? <PosAvailabilityField/);
  }
  assert.equal(INVENTORY_ONLY_MESSAGE, 'Stock only. Customers can\'t buy this in POS.');
  assert.match(fieldSrc, /\{!value \? \(/, 'the inventory-only message only shows when it is off');
  assert.match(fieldSrc, /INVENTORY_ONLY_MESSAGE/);
  for (const [name, src] of [['create', createSrc], ['edit', editSrc]]) {
    assert.match(src, /<PosAvailabilityField value=\{sellable\} onChange=\{changeSellable\} \/>/, `${name}: field in Step 1`);
  }
  // the screen says plainly that inventory-only products cannot be saved yet
  assert.equal(
    INVENTORY_ONLY_UNSUPPORTED_MESSAGE,
    'Stock-only products can\'t be saved yet. This is coming in a later update.',
  );
  assert.match(fieldSrc, /INVENTORY_ONLY_UNSUPPORTED_MESSAGE/);
  console.log('phase3 sellability toggling: ok');
}

// ---------------------------------------------------------------- 2. wizard navigation
{
  assert.deepEqual(flowSteps('full'), [1, 2, 3]);
  assert.deepEqual(flowSteps('simple'), [1, 3], 'the Drinks / Extras two-step flow');
  assert.deepEqual(flowSteps('inventory'), [1], 'inventory-only has no selling variants or pricing step');

  for (const [name, src, saveLabel] of [['create', createSrc, 'Create product'], ['edit', editSrc, 'Save changes']]) {
    // flow comes from the shared rules; the indicator shows only the steps that apply
    assert.match(src, /const flow: WizardFlow = getWizardFlow\(\{ sellable, category, variantCount: variants\.length \}\);/);
    assert.match(src, /const inventoryOnly = flow === 'inventory';/);
    assert.match(src, /const steps = flowSteps\(flow\);/);
    assert.match(src, /<StepIndicator step=\{step\} flow=\{flow\}/);

    // Step 1 is the only step, but saving an inventory-only product is not supported yet: the button is
    // disabled and does nothing, and there is no separate save path for it
    assert.match(
      src,
      new RegExp(`<ManagerActionButton label="${saveLabel}" disabled onPress=\\{\\(\\) => \\{\\}\\} />`),
      `${name}: "${saveLabel}" is disabled for inventory-only products`,
    );
    assert.doesNotMatch(src, /submitInventoryOnly|inventoryOnlyError|inventoryOnlyMessage/, `${name}: no inventory-only save path remains`);
    assert.match(src, /<ManagerActionButton label="Next" onPress=\{goToStep2\} \/>/, `${name}: other flows still use Next`);
    // the existing step moves are untouched
    assert.match(src, /setStep\(simpleFlow \? 3 : 2\)/);
    assert.match(src, /setStep\(\(current\) => \(current === 3 \? \(simpleFlow \? 1 : 2\) : 1\)\)/);
    // the server error stays on the pricing step, as before
    assert.match(src, /\{step === 3 && error \? <Text/);

    // the normal save refuses an inventory-only product even if it were ever reached, before any payload is built
    const submitBody = functionBody(src, 'function submit()');
    assert.match(submitBody, /if \(!isSaveSupported\(flow\)\) return;/);
    assert.ok(
      submitBody.indexOf('isSaveSupported') < submitBody.indexOf('onSubmit('),
      `${name}: the guard comes before anything is sent`,
    );
    // hidden variants / prices can no longer block saving: there is nothing to save in this mode, and they are kept
    // the shared Step 1 / variant checks keep the existing rules and messages
    assert.match(src, /function validateStep1\(\): boolean \{/);
    assert.match(src, /return Object\.keys\(errors\)\.length === 0;/);
    assert.match(src, /'Enter a name for each variant, or remove it\.'/);
    assert.match(src, /'Variant names must be unique\.'/);
    assert.match(src, /'Variant names must be 60 characters or fewer\.'/);
    assert.match(src, /'A product can have at most 50 variants\.'/);
    assert.match(functionBody(src, 'function goToStep3()'), /const variantError = getVariantNameError\(\);/);
  }
  console.log('phase3 wizard navigation: ok');
}

// ---------------------------------------------------------------- 3. preservation of existing data and saved values
{
  for (const [name, src] of [['create', createSrc], ['edit', editSrc]]) {
    // toggling only flips the flag: nothing is cleared, so turning it back on restores everything
    const body = functionBody(src, 'function changeSellable(next: boolean)');
    for (const forbidden of [
      'setVariants',
      'setPriceDrafts',
      'setUniformBase',
      'setUniformVariantPrices',
      'setRecipePreview',
      'setDrinkPreview',
      'setDeletedVariantIds',
      'setCategory',
      'setName',
      'setSku',
    ]) {
      assert.ok(!body.includes(forbidden), `${name}: changeSellable must not call ${forbidden}`);
    }
    assert.match(body, /setSellable\(next\);/);
    // nothing else reacts to the flag by deleting data
    assert.doesNotMatch(src, /if \(!sellable\)[^\n]*\n?[^\n]*(setVariants|setPriceDrafts)/);
    assert.doesNotMatch(src, /sellable[^\n]*setVariants\(\[\]\)/);

    // saved values are unchanged: the sellable choice never reaches the payload
    const start = src.indexOf('onSubmit(\n      {');
    const end = src.indexOf('      pricing,', start);
    assert.ok(start > 0 && end > start, `${name}: submit block found`);
    const block = src.slice(start, end);
    for (const forbidden of ['sellable', 'inventoryOnly', 'category']) {
      assert.ok(!block.includes(forbidden), `${name}: saved values must not include ${forbidden}`);
    }
    for (const required of ['name:', 'sku:', 'description:', 'default_price:', 'variants:', 'closingStockBehavior:', 'isNonReturnable', 'stockUses:', 'drinkChoices:']) {
      assert.ok(block.includes(required), `${name}: saved values keep ${required}`);
    }
    // pricing is still validated by the one submit(); an inventory-only product is not exempt from it
    assert.match(src, /Enter a valid selling price\./);
    assert.match(src, /Enter a price for every variant on each selected branch\./);
  }

  // inventory-only is blocked, not faked: it never saves, while every other flow still can
  assert.equal(isSaveSupported('inventory'), false);
  assert.equal(isSaveSupported('full'), true);
  assert.equal(isSaveSupported('simple'), true);
  // switching back to sellable restores the normal Next / Create flow (the disabled button is only the inventory branch)
  for (const [name, src] of [['create', createSrc], ['edit', editSrc]]) {
    assert.match(src, /<ManagerActionButton label="Next" onPress=\{goToStep2\} \/>/, `${name}: sellable products keep Next`);
  }
  console.log('phase3 data preservation: ok');
}

// ---------------------------------------------------------------- 4. backend limitation guard
{
  // Inventory-only cannot be enforced yet: the schema has no sellability field, and a variant-free product needs
  // a valid default price. If either changes, this fails, which is the cue to revisit the inventory-only flow.
  const migrations = readdirSync('supabase/migrations').filter((file) => file.endsWith('.sql'));
  const all = migrations.map((file) => read(`supabase/migrations/${file}`)).join('\n');
  assert.doesNotMatch(all, /is_sellable|sellable boolean|available_in_pos/i, 'no sellability field exists in the backend');
  assert.match(all, /A default base price is required\./, 'a variant-free product still needs a valid default price');
  console.log('phase3 backend limitation guard: ok');
}

// ---------------------------------------------------------------- POS availability is hidden for now
{
  // one switch controls it; it is OFF, and only the visible setting + inventory-only flow depend on it
  assert.equal(POS_AVAILABILITY_ENABLED, false, 'hidden until the backend can store POS availability');
  assert.equal(resolveSellable(false, true), true);
  assert.equal(resolveSellable(false, false), true, 'a stored "off" choice is ignored while hidden');
  assert.equal(resolveSellable(true, true), true);
  assert.equal(resolveSellable(true, false), false, 'when the feature returns, the choice is honoured');

  // while hidden, no category / variant combination can reach the inventory-only flow or a disabled save
  for (const category of categories) {
    for (const variantCount of [0, 1, 5]) {
      for (const chosen of [true, false]) {
        const flow = getWizardFlow({ sellable: resolveSellable(POS_AVAILABILITY_ENABLED, chosen), category, variantCount });
        assert.notEqual(flow, 'inventory', category + '/' + variantCount + '/' + chosen);
        assert.equal(isSaveSupported(flow), true, category + ': saving is never blocked');
        assert.ok(flowSteps(flow).length >= 2, category + ': has a pricing step');
      }
    }
  }
  // category never makes a product unsellable: Inventory Supplies still uses Product Info -> Price
  assert.deepEqual(flowSteps(getWizardFlow({ sellable: true, category: 'supplies', variantCount: 0 })), [1, 3]);
  assert.deepEqual(flowSteps(getWizardFlow({ sellable: true, category: 'supplies', variantCount: 2 })), [1, 2, 3]);

  for (const [name, src] of [['create', createSrc], ['edit', editSrc]]) {
    // the wizards use the resolved value, and the field only renders when the feature is on
    assert.match(src, /const sellable = resolveSellable\(POS_AVAILABILITY_ENABLED, sellableChoice\);/, name);
    assert.match(src, /\{POS_AVAILABILITY_ENABLED \? <PosAvailabilityField value=\{sellable\} onChange=\{changeSellable\} \/> : null\}/, name);
    // nothing else in the wizard reads the raw stored choice
    assert.equal((src.match(/sellableChoice/g) ?? []).length, 2, name + ': only the declaration and the resolver read it');
    // the saved payload never mentions it
    assert.doesNotMatch(src, /onSubmit\(\{[\s\S]{0,400}sellable/, name);
  }
  // the component and its messages are kept for later
  assert.match(fieldSrc, /export function PosAvailabilityField/);
  assert.match(fieldSrc, /export function InventoryOnlyNotice/);
  assert.match(fieldSrc, /HIDDEN FOR NOW/);
  console.log('phase3 hidden POS availability: ok');
}

console.log('product_wizard_phase3: ALL PASS');
