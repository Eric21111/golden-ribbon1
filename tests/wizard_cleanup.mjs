// Final cleanup checks for the Create/Edit Product wizards (source-level; does not render).
//   1. variant status: an empty stock list is just "No items yet" (recipes are saved, so nothing is "pending")
//   2. unused leftovers are gone, and nothing that is still used was removed
//   3. the pricing pre-fill fix and the saved payload are untouched
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const editor = read('src/features/products/VariantListEditor.tsx');
const edit = read('src/features/products/EditProductWizard.tsx');
const create = read('src/features/products/CreateProductWizard.tsx');
const data = read('src/features/products/recipePreviewData.ts');

// ---------------------------------------------------------------- 1. variant status
{
  // Stock lists are saved now, so existing variants are no longer "pending": an empty list is just "No items yet"
  assert.doesNotMatch(editor, /SAVED_VARIANT_STATUS|Stock setup pending/);
  assert.match(editor, /label: 'No items yet', style: styles\.statusMuted/);
  assert.doesNotMatch(edit, /saved: variant\.id !== null/);
  assert.doesNotMatch(create, /saved:/);
  // the "Add This Product" warning and the name/drink validation are untouched
  assert.match(editor, /label: 'Add This Product', style: styles\.statusWarn/);
  assert.match(editor, /const nameProblem = /);
  assert.match(editor, /const drinkMissing =/);

  // Edit starts from what is saved (never from an empty guess), and nothing is auto-assigned to existing variants
  assert.match(edit, /useState<Record<string, RecipeLine\[\]>>\(\(\) =>\s*savedStockUsesToRecipes\(sourceStockUses, product\.id, variants, /);
  assert.doesNotMatch(edit, /offerFirstOption|shouldOfferFirstOption/);
}

// ---------------------------------------------------------------- 2. unused code removed, used code kept
{
  assert.equal(existsSync('src/features/products/ClosingStockBehaviorField.tsx'), false);
  assert.doesNotMatch(data, /summarizeRecipe/);

  // no source file may still reference either removed name
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(entry.name)) files.push(path);
    }
  };
  walk('src');
  walk('app');
  for (const file of files) {
    const text = read(file);
    assert.doesNotMatch(text, /ClosingStockBehaviorField|summarizeRecipe/, `${file} still references a removed item`);
  }

  // helpers that look related but are still used must remain
  assert.match(data, /export function unitLabel/);
  assert.match(data, /export function findInventoryItem/);
  assert.match(data, /export function summarizeExtras/);
  assert.match(data, /export function summarizeDrinkChoice/);

  // closing-stock behaviour itself is still part of the saved data (type, service and wizard payload)
  assert.match(read('src/types/models.ts'), /ClosingStockBehavior/);
  assert.match(read('src/services/productService.ts'), /ClosingStockBehavior/);
  assert.match(create, /closingStockBehavior/);
  assert.match(edit, /closingStockBehavior/);
  assert.match(read('app/(manager)/manager/products/index.tsx'), /closingStockBehavior/);
}

// ---------------------------------------------------------------- 3. earlier fixes preserved
{
  assert.match(edit, /seedVariantPrices\(variants, first\)/);
  assert.match(edit, /seedVariantPrices\(variants, prices\)/);
  assert.match(edit, /return \{ id: variant\.id, name: variant\.name\.trim\(\), default_price: price \}/);
}

// ---------------------------------------------------------------- 4. Snacks are just the snack
{
  const config = read('src/features/products/productCategoryPreview.ts');
  const recipe = read('src/features/products/VariantRecipePreview.tsx');
  const snacks = config.slice(config.indexOf("id: 'snacks'"), config.indexOf("id: 'drinks'"));
  assert.match(snacks, /allowOtherStock: false/, 'snacks: no Rice / Egg / Browse all');
  assert.match(snacks, /showDrinkChoice: false/, 'snacks: no drink choice');
  assert.match(snacks, /showIngredients: true/, 'snacks still list their own quantity (e.g. BBQ x3)');
  // auto-add and options-first behaviour are unchanged
  assert.match(snacks, /autoAddMainProduct: true/);
  assert.match(snacks, /startsWithOption: true/);
  // other categories keep their behaviour: meals keep drink choice and other stock; extras keep other stock
  const meals = config.slice(config.indexOf("id: 'meals'"), config.indexOf("id: 'snacks'"));
  assert.match(meals, /allowOtherStock: true/);
  assert.match(meals, /showDrinkChoice: true/);
  assert.match(config.slice(config.indexOf("id: 'extras'"), config.indexOf("id: 'supplies'")), /allowOtherStock: true/);
  // the stock list honours the flag in both places it is used (variant cards and the product-level list)
  assert.equal((editor.match(/mainOnly=\{!config\.allowOtherStock\}/g) ?? []).length, 2);
  assert.match(recipe, /const quickAddItems = mainOnly \? \[\] : getQuickAddItems/);
  assert.match(recipe, /\{mainOnly \? null : \(\s*<Pressable[\s\S]*?Browse all/);
  assert.match(recipe, /\{mainOnly \? null : \(\s*<InventoryItemPickerModal/);
  // hidden drink data never blocks a snack: validation only runs where the drink section is shown
  assert.match(create, /isDrinkChoiceVisible\(category, true\)/);
  assert.match(edit, /isDrinkChoiceVisible\(category, true\)/);
}

// ---------------------------------------------------------------- 5. Step 1 layout: short, grouped, one preview badge
{
  const layout = read('src/features/products/StepOneLayout.tsx');
  const pos = read('src/features/products/PosAvailabilityField.tsx');
  const category = read('src/features/products/ProductCategoryField.tsx');
  const nonReturnable = read('src/features/products/NonReturnableField.tsx');

  assert.equal(existsSync('src/features/products/InfoHeading.tsx'), false, 'replaced by the inline (i) on the row');

  for (const [name, src] of [['create', create], ['edit', edit]]) {
    // one Setup group (preview-only: category + POS) and one Settings group (saved)
    assert.match(src, /<SectionHeader title="How it's sold" preview \/>/, name);
    assert.match(src, /<SectionHeader title="Other settings" \/>/, name);
    assert.equal((src.match(/<SectionHeader /g) ?? []).length, 2, name + ': exactly two groups');
    // the old headings and dividers are gone
    assert.doesNotMatch(src, /Product details|sectionTitle|sectionDivider/, name);
    assert.match(src, /Each drink is its own product, like Coke Mismo\./, name);
    // fields keep their order: category, then POS, then the saved settings
    assert.match(src, /<ProductCategoryField[^\n]*\n\s*\{POS_AVAILABILITY_ENABLED \? <PosAvailabilityField[\s\S]*?<SectionHeader title="Other settings"[\s\S]*?<NonReturnableField/, name);
  }
  const status = read('src/features/products/ProductStatusField.tsx');
  assert.match(status, /label="Product Status"/);
  assert.match(status, /choice=\{\{ on: 'Enabled', off: 'Disabled' \}\}/);
  assert.match(edit, /<ProductStatusField value=\{isActive\} onChange=\{setIsActive\} \/>/);
  assert.match(create, /<ProductStatusField value=\{enabledChoice\} onChange=\{changeEnabled\} \/>/);
  assert.doesNotMatch(edit, /opening stock/);
  assert.doesNotMatch(edit, /canActivate/);

  // the preview badge exists once, in the shared layout, and not on each field
  assert.equal((layout.match(/Not saved yet/g) ?? []).length, 1);
  for (const src of [pos, category]) assert.doesNotMatch(src, /Not saved yet|pillText/);
  assert.doesNotMatch(pos, /POS availability'|>POS availability</, 'no heading repeating the switch label');

  // short one-line copy
  assert.match(pos, /description="Off keeps it for stock and meals only\."/);
  assert.match(category, /Choose what kind of product this is\./);
  assert.match(nonReturnable, /description="Unsold stock stays at the branch\."/);
  assert.doesNotMatch(nonReturnable, /Return Policy/);
  // the long explanation lives behind the (i), not on the row
  assert.match(nonReturnable, /info=\{\{/);
  assert.match(layout, /info && infoOpen/);

  // the saved flag is unchanged: same switch, same label, still the value that is saved
  assert.match(nonReturnable, /label="Non-returnable"/);
  assert.match(layout, /accessibilityLabel=\{label\}/, 'switches stay labelled for screen readers');
  assert.match(layout, /MIN_TOUCH_TARGET/);
}

console.log('wizard_cleanup: ALL PASS');
