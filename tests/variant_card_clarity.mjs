// An option that includes a drink but has none picked is unfinished: it must look unfinished (amber summary, "Pick a drink" pill,
// "Add drink" as the obvious tap), and "Done editing" must not look like the step's main button.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { loadTs } from './_load_ts.mjs';

const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const require = createRequire(import.meta.url);
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const rnw = require('react-native-web');
const icon = { __esModule: true, default: (p) => React.createElement('i', { 'data-icon': p.name }) };
const text = (html) => html.replace(/<[^>]+>/g, '|').replace(/\|+/g, '|');

// ---------------------------------------------------------------- 1. the summary box
{
  const { describeOrderDeduction } = loadTs('src/features/products/recipePreviewData.ts');
  const ing = [{ id: 'rice', name: 'Rice' }];
  const base = { lines: [{ itemId: 'rice', quantity: 1 }], productName: 'Fried Chicken', ingredients: ing, drinks: [{ id: 'w', name: 'Bottled Water' }] };
  assert.deepEqual(describeOrderDeduction({ ...base, drink: { enabled: true, drinkIds: [] } }).at(-1), 'Plus 1 drink, but none is selected yet. Add at least one drink above.');
  assert.match(describeOrderDeduction({ ...base, drink: { enabled: true, drinkIds: ['w'] } }).at(-1), /^Plus 1 drink, chosen at checkout: Bottled Water\.$/);

  const { DeductionPreview } = loadTs('src/features/products/DeductionPreview.tsx', { 'react-native': rnw, '@react-native-vector-icons/ionicons': icon });
  const warn = renderToStaticMarkup(React.createElement(DeductionPreview, { sentences: ['x'], warning: true }));
  const info = renderToStaticMarkup(React.createElement(DeductionPreview, { sentences: ['x'] }));
  assert.match(warn, /data-icon="alert-circle-outline"/, 'a missing drink is shown with the warning icon');
  assert.match(info, /data-icon="remove-circle-outline"/, 'a complete option keeps the quiet one');
  console.log('1. summary box: ok');
}

// ---------------------------------------------------------------- 2. the drink choice
{
  const mod = loadTs('src/features/products/VariantDrinkChoicePreview.tsx', {
    'react-native': rnw,
    '@react-native-vector-icons/ionicons': icon,
    './InventoryItemPickerModal': { InventoryItemPickerModal: () => null },
  });
  const drinks = [{ id: 'w', name: 'Bottled Water' }, { id: 'c', name: 'Coke Mismo' }];
  const render = (choice, showValidation = false) => text(renderToStaticMarkup(React.createElement(mod.VariantDrinkChoicePreview, { choice, productName: 'Fried Chicken', drinks, showValidation, onChange() {} })));
  assert.match(render({ enabled: true, drinkIds: [] }), /Select at least one drink\./, 'said at once, not only after Next');
  assert.match(render({ enabled: true, drinkIds: ['w', 'c'] }), /Cashier picks 1 of 2\./);
  assert.match(render({ enabled: true, drinkIds: ['w'] }), /Only 1 drink, so the cashier cannot choose\./);
  assert.doesNotMatch(render({ enabled: false, drinkIds: [] }), /Select at least one drink|Add drink/);
  const src = read('src/features/products/VariantDrinkChoicePreview.tsx');
  assert.match(src, /drink\.inactive \? `\$\{drink\.name\} · Disabled` : drink\.name/, 'a disabled drink says so on its chip (it used to be in the removed box)');
  assert.match(src, /Every picked drink is disabled\. Enable one or add another\./);
  assert.match(src, /styles\.allChip, missing && styles\.allChipNeeded/, '"Add drink" is the filled button while a drink is missing');
  assert.match(src, /\(missing \|\| allDisabled\) && styles\.hintNeeded, missing && showValidation && styles\.hintError/, 'amber first, red after a refused Next');
  console.log('2. drink choice: ok');
}

// ---------------------------------------------------------------- 3. the option card
{
  const editor = read('src/features/products/VariantListEditor.tsx');
  assert.match(editor, /const status = drinkNeedsPick\n\s+\? \{ label: 'Pick a drink', style: styles\.statusWarn, textStyle: styles\.statusWarnText \}/, 'a collapsed card says it still needs a drink');
  assert.match(editor, /drinkVisible && drinkChoice\.enabled && \(offeredDrinks\.length === 0 \|\| offeredDrinks\.every\(\(item\) => item\.inactive\)\)/, 'no drink, or only disabled drinks');
  assert.match(editor, /doneButton: \{[^}]*backgroundColor: BLUE_TINT/s, 'Done editing is the quiet button');
  assert.match(editor, /doneButtonText: \{ color: managerColors\.royalBlue/);
  // the wizards still refuse Next while a drink is missing
  for (const file of ['src/features/products/CreateProductWizard.tsx', 'src/features/products/EditProductWizard.tsx']) {
    assert.match(read(file), /failStep2\(`Select at least one drink for/, `${file}: Next is still refused`);
  }
  console.log('3. option card: ok');
}

// ---------------------------------------------------------------- 4. the drink picker stays open while drinks are added
{
  let picker = null;
  const mod = loadTs('src/features/products/VariantDrinkChoicePreview.tsx', {
    'react-native': rnw,
    '@react-native-vector-icons/ionicons': icon,
    './InventoryItemPickerModal': { InventoryItemPickerModal: (props) => { picker = props; return null; } },
  });
  const changes = [];
  renderToStaticMarkup(React.createElement(mod.VariantDrinkChoicePreview, { choice: { enabled: true, drinkIds: [] }, productName: 'Fried Chicken', drinks: [], showValidation: false, onChange: (next) => changes.push(next.drinkIds) }));
  assert.ok(picker, 'the picker is rendered');
  // two taps before the parent has re-rendered: the second one still builds on the first
  picker.onSelect('w');
  picker.onSelect('c');
  picker.onSelect('w'); // already added: ignored
  assert.deepEqual(changes, [['w'], ['w', 'c']], 'each add keeps what was added before; a repeat adds nothing');
  const src = read('src/features/products/VariantDrinkChoicePreview.tsx');
  const handler = src.slice(src.indexOf('onSelect={(drinkId) => {'), src.indexOf('onClose={() => setPickerOpen(false)}'));
  assert.doesNotMatch(handler, /setPickerOpen/, 'adding a drink does not close the sheet');
  assert.ok(src.includes('onClose={() => setPickerOpen(false)}'), 'Close still does');
  console.log('4. drink picker: ok');
}

// ---------------------------------------------------------------- 5. the stock item picker stays open too
{
  let picker = null;
  const mod = loadTs('src/features/products/VariantRecipePreview.tsx', {
    'react-native': rnw,
    '@react-native-vector-icons/ionicons': icon,
    '@/components/GlyphIcon': { GlyphIcon: () => null },
    './InventoryItemPickerModal': { InventoryItemPickerModal: (props) => { picker = props; return null; } },
  });
  const changes = [];
  const ingredients = [{ id: 'rice', name: 'Rice' }, { id: 'egg', name: 'Egg' }].map((item) => ({ ...item, unit: { singular: 'pc', plural: 'pcs' }, hint: '' }));
  renderToStaticMarkup(React.createElement(mod.VariantRecipePreview, {
    label: 'STOCK DEDUCTION', lines: [{ itemId: 'this-product', quantity: 1 }], productName: 'Fried Chicken', ingredients, onChange: (next) => changes.push(next.map((line) => line.itemId)),
  }));
  assert.ok(picker, 'the picker is rendered');
  picker.onSelect('rice');
  picker.onSelect('egg'); // before the parent re-rendered: builds on the rice that was just added
  picker.onSelect('rice'); // already in the list: ignored
  assert.deepEqual(changes, [['this-product', 'rice'], ['this-product', 'rice', 'egg']], 'every add keeps the earlier ones');
  const src = read('src/features/products/VariantRecipePreview.tsx');
  const handler = src.slice(src.indexOf('onSelect={(itemId) => {'), src.indexOf('onClose={closePicker}'));
  assert.doesNotMatch(handler, /closePicker|setPickerOpen/, 'picking an item does not close the sheet');
  assert.match(src, /onClose={closePicker}/, 'Close still does');
  console.log('5. stock item picker: ok');
}

// ---------------------------------------------------------------- 6. a snack's own item is locked like a meal's
{
  const mod = loadTs('src/features/products/VariantRecipePreview.tsx', {
    'react-native': rnw,
    '@react-native-vector-icons/ionicons': icon,
    '@/components/GlyphIcon': { GlyphIcon: () => null },
    './InventoryItemPickerModal': { InventoryItemPickerModal: () => null },
  });
  const render = (props) => renderToStaticMarkup(React.createElement(mod.VariantRecipePreview, { label: 'STOCK DEDUCTION', lines: [{ itemId: 'this-product', quantity: 3 }], productName: 'Cheesestick', ingredients: [], onChange() {}, ...props }));
  const locked = render({ lockMainProduct: true, mainOnly: true });
  assert.match(locked, /data-icon="lock-closed-outline"/, 'the own item shows the lock');
  assert.match(locked, /Base product · Required/);
  assert.doesNotMatch(locked, /Remove Cheesestick/, 'and cannot be removed');
  assert.match(locked, /Increase .* quantity/, 'its quantity can still change (3 pcs)');
  assert.doesNotMatch(locked, /Remove /, 'nothing on the row removes it');
  const open = render({ lockMainProduct: false });
  assert.match(open, /data-icon="close"/, 'an unlocked item keeps its remove button');
  const editor = read('src/features/products/VariantListEditor.tsx');
  assert.equal((editor.match(/lockMainProduct=\{config\.id === 'meals' \|\| config\.id === 'snacks'\}/g) ?? []).length, 2, 'option cards and the product-level list, Meals and Snacks');
  console.log('6. snack own item locked: ok');
}

console.log('variant_card_clarity: ALL PASS');
