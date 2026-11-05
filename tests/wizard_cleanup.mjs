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
  assert.match(recipe, /\{mainOnly \? null : \(\s*<Pressable[\s\S]*?Add Stock Item/);
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
    // one group for category + POS and one for the other settings (all saved)
    assert.match(src, /<SectionHeader title="Category & availability" \/>/, name);
    assert.match(src, /<SectionHeader title="Other settings" \/>/, name);
    assert.equal((src.match(/<SectionHeader /g) ?? []).length, 2, name + ': exactly two groups');
    // the old headings and dividers are gone
    assert.doesNotMatch(src, /Product details|sectionTitle|sectionDivider/, name);
    assert.match(src, /Each drink is its own product, like Coke Mismo\./, name);
    // fields keep their order: category, then POS, then the saved settings
    assert.match(src, /<ProductCategoryField[^\n]*\n\s*\{POS_AVAILABILITY_ENABLED \? <PosAvailabilityField[\s\S]*?<SectionHeader title="Other settings"[\s\S]*?<NonReturnableField/, name);
  }
  const status = read('src/features/products/ProductStatusField.tsx');
  assert.match(status, /label="Enable Product"/);
  assert.doesNotMatch(status + pos, /choice=/, 'no Yes/No or Enabled/Disabled word beside the switches');
  assert.doesNotMatch(layout, /styles\.choice|choice\?:/);
  assert.match(edit, /<ProductStatusField value=\{isActive\} onChange=\{setIsActive\} \/>/);
  assert.match(create, /<ProductStatusField value=\{enabledChoice\} onChange=\{changeEnabled\} \/>/);
  assert.doesNotMatch(edit, /opening stock/);
  assert.doesNotMatch(edit, /canActivate/);

  // no "Not saved yet" badge anywhere in Step 1: everything on it is saved
  assert.doesNotMatch(layout, /Not saved yet|pillText|PreviewPill/);
  for (const src of [pos, category]) assert.doesNotMatch(src, /Not saved yet|pillText/);
  assert.doesNotMatch(pos, /POS availability'|>POS availability</, 'no heading repeating the switch label');

  // short one-line copy
  assert.match(pos, /label="Show in Cashier POS"/);
  assert.match(pos, /description="Show this product on the cashier menu\."/);
  assert.match(category, /Choose what kind of product this is\./);
  assert.match(nonReturnable, /description="Keep leftover stock instead of returning it to Main\."/);
  assert.doesNotMatch(nonReturnable, /Return Policy/);
  // the long explanation lives behind the (i), not on the row
  assert.match(nonReturnable, /info=\{\{/);
  assert.match(layout, /info && infoOpen/);

  // the saved flag is unchanged: same switch, same label, still the value that is saved
  assert.match(nonReturnable, /label="Keep Unsold Stock at Branch"/);
  assert.match(layout, /accessibilityLabel=\{label\}/, 'switches stay labelled for screen readers');
  assert.match(layout, /MIN_TOUCH_TARGET/);
}

// ---- the three renamed settings use their new names everywhere a person can read them (code strings, not comments)
{
  const OLD_LABELS = /Sell Separately|Sell in POS|Sold in POS|Product Status|Non-returnable|non-returnable items|marked non-returnable|Product status/;
  const walk = (dir, out = []) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(file, out);
      else if (/\.(ts|tsx)$/.test(entry.name)) out.push(file);
    }
    return out;
  };
  for (const file of [...walk('app'), ...walk('src')]) {
    const lines = read(file).split('\n');
    lines.forEach((line, index) => {
      const code = line.trim();
      if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) return;
      // errors.ts matches the database's own message text, which cannot change without editing an old migration
      if (file.endsWith('errors.ts') && code.includes("includes('not marked non-returnable')")) return;
      assert.doesNotMatch(line, OLD_LABELS, `${file}:${index + 1} still shows an old label`);
    });
  }
  // the helper lines and the info boxes (the wording is checked against PGlite in product_setting_helper_rules.mjs)
  const fieldSrc = (name) => read(`src/features/products/${name}.tsx`);
  const layout = fieldSrc('StepOneLayout');
  const pos2 = fieldSrc('PosAvailabilityField');
  const keep2 = fieldSrc('NonReturnableField');
  const status2 = fieldSrc('ProductStatusField');
  assert.match(pos2, /description="Show this product on the cashier menu\."/);
  assert.match(keep2, /description="Keep leftover stock instead of returning it to Main\."/);
  assert.match(status2, /description="Allow sales, transfers, and local purchases\."/);
  // rules and exceptions kept: branch price + enabled; stock/transfers/meal options when off; returns, shift close, older products
  assert.match(pos2, /Available for separate sale when enabled and priced at the branch\./);
  assert.match(pos2, /can still be used for stock, transfers, and meal options when eligible\./);
  assert.match(keep2, /It cannot be returned to Main and is eligible for local purchases\./);
  assert.match(keep2, /Turning Off allows returns and changes the shift-close behavior when switching from On\. Existing products may have different closing settings\./);
  assert.match(status2, /Stops new sales, transfers, and local purchases\. A disabled drink is not offered as a meal drink\. Existing stock and sales history remain unchanged\./);
  // the setting name is not repeated inside its own box: the title is only the (i) button's spoken label
  assert.doesNotMatch(layout, /tipTitle|>\s*\{info\.title\}/);
  assert.match(layout, /accessibilityLabel=\{info\.title\}/);
  assert.match(layout, /info\.body\.split\('\\n\\n'\)/, 'blank lines in the body make separate paragraphs');
  assert.match(layout, /useState\(false\)/, 'info boxes start collapsed');
  for (const [src, label] of [[pos2, 'Show in Cashier POS'], [keep2, 'Keep Unsold Stock at Branch'], [status2, 'Enable Product']]) {
    assert.doesNotMatch(src.slice(src.indexOf('body:')), new RegExp(label), `${label}: not repeated in its own info text`);
    assert.match(src, new RegExp(`title: '${label}'`), `${label}: the (i) button is labelled with the setting`);
  }
  assert.match(read('app/(cashier)/cashier/local-purchase.tsx'), /Only enabled products set to Keep Unsold Stock at Branch/);
}

console.log('wizard_cleanup: ALL PASS');
