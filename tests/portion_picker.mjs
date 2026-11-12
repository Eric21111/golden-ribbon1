// Stock Used Per Order: physical portions (0.5, 1, 1.5 ...) shown on screen, whole stock units saved.
// Nothing here touches a database: it proves the on-screen portion converts exactly to the integer the existing
// product_stock_uses column/RPC already stores, and that legacy / piece items are left exactly as they were.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { loadTs } from './_load_ts.mjs';

const require = createRequire(import.meta.url);
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const rnw = require('react-native-web');

const units = loadTs('src/lib/stockUnits.ts');

// ---- 1. conversion tables
assert.equal(units.unitsPerWhole('half_egg'), 2);
assert.equal(units.unitsPerWhole('half_serving'), 2);
assert.equal(units.unitsPerWhole('quarter_serving'), 4);
assert.equal(units.unitsPerWhole('piece'), null, 'pieces have no portion display');
assert.equal(units.unitsPerWhole(null), null, 'legacy stock has no portion display');
assert.equal(units.unitsPerWhole(undefined), null);

// ---- 2. portions -> stored units (exact, never rounded)
const toUnits = units.portionsToUnits;
assert.equal(toUnits(0.5, 'half_egg'), 1);
assert.equal(toUnits(1, 'half_egg'), 2);
assert.equal(toUnits(1.5, 'half_egg'), 3);
assert.equal(toUnits(2, 'half_egg'), 4);
assert.equal(toUnits(0.5, 'half_serving'), 1);
assert.equal(toUnits(0.25, 'quarter_serving'), 1);
assert.equal(toUnits(0.5, 'quarter_serving'), 2);
assert.equal(toUnits(0.75, 'quarter_serving'), 3);
assert.equal(toUnits(1, 'quarter_serving'), 4);
assert.equal(toUnits(49.5, 'half_egg'), 99, 'the saved maximum is 99 units');
for (const bad of [0.3, 0.25, 0.1, 1.2, 0, -0.5, -1, 50, 100, NaN, Infinity, -Infinity]) {
  assert.equal(toUnits(bad, 'half_egg'), null, `half_egg refuses ${bad}`);
}
assert.equal(toUnits(0.125, 'quarter_serving'), null, 'finer than a quarter is refused, not rounded');
assert.equal(toUnits(0.5, 'piece'), null, 'pieces never accept a fraction');
assert.equal(toUnits(0.5, null), null, 'legacy stock never accepts a fraction');
assert.equal(toUnits(1e-7, 'half_egg'), null);

// ---- 3. stored units -> portions and the label
const toPortions = units.unitsToPortions;
assert.equal(toPortions(1, 'half_egg'), 0.5);
assert.equal(toPortions(3, 'half_egg'), 1.5);
assert.equal(toPortions(1, 'quarter_serving'), 0.25);
assert.equal(toPortions(3, 'quarter_serving'), 0.75);
assert.equal(toPortions(5, null), 5, 'legacy quantities are shown unchanged');
assert.equal(units.formatPortions(0.5), '0.5');
assert.equal(units.formatPortions(1), '1');
assert.equal(units.formatPortions(1.5), '1.5');
assert.equal(units.formatPortions(0.25), '0.25');
assert.equal(units.formatPortions(0.75), '0.75');
assert.equal(units.formatPortions(2), '2');
// every stored count 1..99 round-trips exactly (no drift, no rounding)
for (const code of ['half_egg', 'half_serving', 'quarter_serving']) {
  for (let n = 1; n <= 99; n++) assert.equal(toUnits(toPortions(n, code), code), n, `${code} ${n}`);
}
assert.equal(units.portionRatioNote('half_egg'), '2 units = 1 whole egg');
assert.equal(units.portionRatioNote('half_serving'), '2 units = 1 full serving');
assert.equal(units.portionRatioNote('quarter_serving'), '4 units = 1 full serving');
assert.equal(units.portionRatioNote('piece'), null);
assert.equal(units.portionRatioNote(null), null);

// ---- 4. the choices offered
const eggChoices = units.portionChoices('half_egg', 1);
assert.deepEqual(eggChoices.slice(0, 4).map((c) => [c.label, c.units]), [['0.5', 1], ['1', 2], ['1.5', 3], ['2', 4]]);
assert.equal(eggChoices.length, 24);
assert.deepEqual(units.portionChoices('quarter_serving', 1).slice(0, 4).map((c) => c.label), ['0.25', '0.5', '0.75', '1']);
assert.deepEqual(units.portionChoices('piece', 1), [], 'no picker for pieces');
assert.deepEqual(units.portionChoices(null, 1), [], 'no picker for legacy stock');
// a saved amount above the list is kept, so opening the picker never hides or changes an existing recipe line
const big = units.portionChoices('half_egg', 40);
assert.equal(big.length, 25);
assert.deepEqual(big.at(-1), { units: 40, portions: 20, label: '20' });
for (const c of eggChoices) assert.equal(toUnits(c.portions, 'half_egg'), c.units, 'every offered choice is an exact whole count');

// ---- 5. summaries: physical portions on screen, legacy and pieces unchanged
const data = loadTs('src/features/products/recipePreviewData.ts');
const items = data.ingredientOptionsFromProducts([
  { id: 'egg', name: 'Egg', stockUnitCode: 'half_egg' },
  { id: 'bihon', name: 'Bihon', stockUnitCode: 'quarter_serving' },
  { id: 'rice', name: 'Rice', stockUnitCode: 'piece' },
  { id: 'old', name: 'Old Egg' },
]);
const egg = items.find((i) => i.id === 'egg');
assert.equal(egg.stockUnitCode, 'half_egg');
assert.equal(items.find((i) => i.id === 'old').stockUnitCode, undefined, 'legacy items carry no unit');
assert.equal(data.lineAmount(egg, 1), '0.5');
assert.equal(data.lineAmount(egg, 4), '2');
assert.equal(data.lineAmount(items.find((i) => i.id === 'bihon'), 3), '0.75');
assert.equal(data.lineAmount(items.find((i) => i.id === 'rice'), 3), '3', 'pieces show their count');
assert.equal(data.lineAmount(items.find((i) => i.id === 'old'), 3), '3', 'legacy shows its stored count');
assert.equal(data.lineAmount(undefined, 2), '2');
assert.equal(data.summarizeDeduction([{ itemId: 'egg', quantity: 1 }], 'Meal', items), 'Egg ×0.5');
assert.equal(data.summarizeDeduction([{ itemId: 'egg', quantity: 2 }], 'Extra Egg', items), 'Egg ×1');
assert.equal(data.summarizeDeduction([{ itemId: 'egg', quantity: 3 }, { itemId: 'rice', quantity: 2 }], 'Meal', items), 'Egg ×1.5, Rice ×2');
assert.equal(data.summarizeDeduction([{ itemId: 'old', quantity: 1 }], 'Meal', items), 'Old Egg ×1', 'legacy wording unchanged');
assert.equal(data.summarizeDeduction([], 'Meal', items), 'Meal ×1', 'no list still means the product itself x1');
assert.deepEqual(
  data.describeOrderDeduction({ lines: [{ itemId: 'egg', quantity: 1 }], productName: 'Meal', ingredients: items }),
  ['Each order uses Egg ×0.5.'],
);
assert.equal(data.summarizeExtras([{ itemId: 'this-product', quantity: 1 }, { itemId: 'egg', quantity: 1 }], 'Meal', items), '+ Egg ×0.5',
  'a half egg is never summarised as just "+ Egg"');
assert.equal(data.summarizeExtras([{ itemId: 'this-product', quantity: 1 }, { itemId: 'rice', quantity: 1 }], 'Meal', items), '+ Rice', 'pieces unchanged');
assert.equal(data.summarizeExtras([{ itemId: 'this-product', quantity: 1 }, { itemId: 'old', quantity: 1 }], 'Meal', items), '+ Old Egg', 'legacy unchanged');

// ---- 6. the saved payload is still the plain integer, whatever is displayed
const mapping = loadTs('src/features/products/stockUseMapping.ts', {
  './wizardGuards': { MAIN_PRODUCT_ITEM_ID: 'this-product', PRODUCT_STOCK_KEY: 'product' },
});
const payload = mapping.buildStockUsePayload({ product: [{ itemId: 'egg', quantity: toUnits(0.5, 'half_egg') }] }, []);
assert.deepEqual(payload, [{ ingredient_product_id: 'egg', quantity: 1 }], '0.5 egg is saved as 1 half-egg unit');
assert.ok(Number.isInteger(payload[0].quantity));
assert.deepEqual(mapping.buildStockUsePayload({ product: [{ itemId: 'egg', quantity: 0.5 }] }, []), [], 'a raw fraction is dropped, never saved');
// reopening a saved row shows the same amount again
const saved = mapping.savedStockUsesToRecipes([{ variant_id: null, ingredient_product_id: 'egg', quantity: 3 }], 'p', []);
assert.equal(data.lineAmount(egg, saved.product[0].quantity), '1.5');

// ---- 7. rendered editor
const stubs = (extra = {}) => ({
  'react-native': { ...rnw, TextInput: (props) => React.createElement('input', { value: props.value, readOnly: true, 'aria-label': props.accessibilityLabel }) },
  '@react-native-vector-icons/ionicons': { __esModule: true, default: () => null },
  './InventoryItemPickerModal': { InventoryItemPickerModal: () => null },
  './PortionPickerSheet': { PortionPickerSheet: () => null },
  './CategoryIcon': { CategoryIcon: () => null },
  ...extra,
});
const { VariantRecipePreview } = loadTs('src/features/products/VariantRecipePreview.tsx', stubs());
const render = (lines) => renderToStaticMarkup(React.createElement(VariantRecipePreview, { lines, productName: 'Meal', ingredients: items, onChange: () => {} }));

const portionHtml = render([{ itemId: 'egg', quantity: 1 }]);
assert.match(portionHtml, /Egg quantity per order, 0\.5\. Change quantity/, 'a select showing the physical portion');
assert.match(portionHtml, />Quantity</, 'the select is labelled Quantity');
assert.match(portionHtml, /Stored as 1 half-egg unit/, 'the stored unit is shown separately');
assert.match(portionHtml, /2 units = 1 whole egg/);
assert.doesNotMatch(portionHtml, /<input/, 'no free-text box that could take a fraction');
assert.doesNotMatch(portionHtml, /Increase Egg quantity/, 'no raw-unit stepper on a portion item');

assert.match(render([{ itemId: 'egg', quantity: 3 }]), /Egg quantity per order, 1\.5\./);
assert.match(render([{ itemId: 'bihon', quantity: 1 }]), /Bihon quantity per order, 0\.25\./);
assert.match(render([{ itemId: 'bihon', quantity: 4 }]), /Stored as 4 quarter-serving units/);

for (const [id, label] of [['rice', 'Rice'], ['old', 'Old Egg']]) {
  const html = render([{ itemId: id, quantity: 2 }]);
  assert.match(html, new RegExp(`Increase ${label} quantity`), `${label}: the whole-number stepper is unchanged`);
  assert.match(html, /<input/, `${label}: the number input is unchanged`);
  assert.doesNotMatch(html, /quantity per order/, `${label}: no portion select`);
}
const mixed = render([{ itemId: 'rice', quantity: 1 }, { itemId: 'egg', quantity: 1 }]);
assert.match(mixed, /Increase Rice quantity/);
assert.match(mixed, /Egg quantity per order, 0\.5\./, 'a meal can mix whole-number and portion items');

// ---- 8. the sheet
let sheetProps;
const sheetStubs = {
  'react-native': rnw,
  '@react-native-vector-icons/ionicons': { __esModule: true, default: () => null },
  '@/components/BottomSheet': { BottomSheet: (props) => { sheetProps = props; return React.createElement('div', null, props.children); } },
  '@/components/dashboard/theme': { managerColors: { subtext: '#667', ink: '#111', royalBlue: '#13c' } },
};
const { PortionPickerSheet } = loadTs('src/features/products/PortionPickerSheet.tsx', sheetStubs);
const sheet = (item, quantity) => renderToStaticMarkup(React.createElement(PortionPickerSheet, { item, quantity, onSelect: () => {}, onClose: () => {} }));
const sheetHtml = sheet(egg, 2);
assert.equal(sheetProps.title, 'Quantity per order');
assert.match(sheetHtml, /2 units = 1 whole egg/);
for (const [portion, stored] of [['0.5', 1], ['1', 2], ['1.5', 3], ['2', 4]]) {
  assert.match(sheetHtml, new RegExp(`${portion} Egg, saved as ${stored} half-egg unit`), `${portion} -> ${stored}`);
}
assert.match(sheetHtml, /Saved as 1 half-egg unit/);
assert.match(sheetHtml, /Saved as 2 half-egg units/);
const rowClass = (label) => sheetHtml.match(new RegExp(`aria-label="${label}"[^>]*class="([^"]*)"`))[1];
assert.notEqual(rowClass('1 Egg, saved as 2 half-egg units'), rowClass('0.5 Egg, saved as 1 half-egg unit'), 'the saved amount (1 egg = 2 units) is highlighted');
assert.equal(rowClass('1.5 Egg, saved as 3 half-egg units'), rowClass('0.5 Egg, saved as 1 half-egg unit'), 'other rows are not');
assert.equal(sheet(items.find((i) => i.id === 'old'), 2), '', 'legacy stock never gets a portion sheet');
assert.equal(sheet(items.find((i) => i.id === 'rice'), 2), '', 'pieces never get a portion sheet');

// ---- 9. Create Product: "Split into halves or quarters" switch (off = whole pieces), plain words, live "Try it"
let chips = [];
let row;
let tryInput;
const { StockUnitField, unitFromParts, partsFromUnit, countFor, partName } = loadTs('src/features/products/StockUnitField.tsx', {
  'react-native': { ...rnw, TextInput: (props) => { tryInput = props; return React.createElement('input', { value: props.value, readOnly: true, 'aria-label': props.accessibilityLabel }); } },
  '@/components/dashboard/FilterChip': { FilterChip: (props) => { chips.push(props); return React.createElement('span', { 'data-chip': props.label, 'data-selected': String(props.selected) }); } },
  '@/components/dashboard/theme': { managerColors: { subtext: '#667', ink: '#111' } },
  './StepOneLayout': {
    SettingsCard: (props) => React.createElement('section', null, props.children),
    SettingRow: (props) => { row = props; return React.createElement('div', null, props.label, ' / ', props.description); },
  },
});
const field = (value, onChange = () => {}) => { chips = []; row = undefined; tryInput = undefined; return renderToStaticMarkup(React.createElement(StockUnitField, { value, onChange })); };

// whole pieces: only the switch, off, and the reason to turn it on
const pieces = field('piece');
assert.equal(row.label, 'Split into halves or quarters');
assert.equal(row.value, false, 'off by default');
assert.equal(row.description, 'Turn on if a meal uses less than 1 whole item, like half an egg.', 'says why you would turn it on');
assert.equal(chips.length, 0, 'whole-piece users never see the choices');
assert.equal(tryInput, undefined);
assert.doesNotMatch(pieces, /Type \d+ when/);

// switch on / off reports the right unit
const calls = [];
field('piece', (code) => calls.push(code));
row.onValueChange(true);
assert.deepEqual(calls, ['half_egg'], 'turning it on starts with half an egg');
field('quarter_serving', (code) => calls.push(code));
row.onValueChange(false);
assert.equal(calls.at(-1), 'piece', 'turning it off goes back to whole pieces');
assert.ok(row.info?.body.includes("can't be changed after you save"), 'the lock is explained in the info, not as clutter');
assert.equal(row.description, 'Stock is counted in parts, not whole items.');

// egg: no size question (only halves exist), a plain meaning, and the Try it box
const eggField = field('half_egg');
assert.equal(row.value, true);
assert.deepEqual(chips.map((c) => [c.label, c.selected]), [['Egg', true], ['Serving', false]]);
assert.match(eggField, /What is being split\?/);
assert.doesNotMatch(eggField, /Split into</, 'a quarter egg is not offered');
assert.match(eggField, /Eggs are split into halves\./);
assert.match(eggField, />Each count = half an egg\.</);
assert.match(eggField, />Try it</);
assert.equal(tryInput.value, '10');
assert.match(eggField, />10 eggs = 20 halves</, '10 eggs in halves -> 20');
assert.match(eggField, />Type 20 when you add or count stock\.</, 'says what to do with the number');

// serving: size question appears
const half = field('half_serving');
assert.deepEqual(chips.map((c) => [c.label, c.selected]), [['Egg', false], ['Serving', true], ['Halves', true], ['Quarters', false]]);
assert.match(half, /Split into/);
assert.match(half, />Each count = half a serving\.</);
assert.match(half, />10 servings = 20 halves</);
const quarter = field('quarter_serving');
assert.match(quarter, />Each count = a quarter of a serving\.</);
assert.match(quarter, />10 servings = 40 quarters</, '10 servings in quarters -> 40');

// the Try it input only takes plain numbers (it is display only and never saved)
assert.equal(tryInput.keyboardType, 'decimal-pad');
assert.ok(tryInput.accessibilityLabel);

// chips report exactly the matching fixed unit; switching Egg <-> Serving keeps a sensible size
const picked = [];
field('quarter_serving', (code) => picked.push(code));
chips.forEach((chip) => chip.onPress());
assert.deepEqual(picked, ['half_egg', 'quarter_serving', 'half_serving', 'quarter_serving'], 'Egg, Serving (keeps Quarters), Halves, Quarters');

// wording for one vs many
assert.deepEqual([partName('half', 1), partName('half', 2), partName('quarter', 1), partName('quarter', 4)], ['half', 'halves', 'quarter', 'quarters']);

// the converter: exact amounts only, never rounded
assert.equal(countFor('10', 'half_serving'), 20);
assert.equal(countFor('30', 'half_egg'), 60);
assert.equal(countFor('10', 'quarter_serving'), 40);
assert.equal(countFor('10.5', 'half_serving'), 21);
assert.equal(countFor('2.25', 'quarter_serving'), 9);
assert.equal(countFor('0', 'half_egg'), 0);
for (const bad of ['', '  ', 'abc', '10.3', '2.1', '-1', 'Infinity']) {
  assert.equal(countFor(bad, 'half_egg'), null, `half_egg refuses ${JSON.stringify(bad)}`);
}
assert.equal(countFor('10.25', 'half_serving'), null, 'a quarter is not an exact half');
assert.equal(countFor('10', 'piece'), null, 'pieces have no parts');

// mapping is complete and reversible; no new unit exists
assert.equal(unitFromParts('egg', 'half'), 'half_egg');
assert.equal(unitFromParts('egg', 'quarter'), 'half_egg', 'there is no quarter egg');
assert.equal(unitFromParts('serving', 'half'), 'half_serving');
assert.equal(unitFromParts('serving', 'quarter'), 'quarter_serving');
assert.equal(partsFromUnit('piece'), null);
for (const code of ['half_egg', 'half_serving', 'quarter_serving']) {
  const parts = partsFromUnit(code);
  assert.equal(unitFromParts(parts.of, parts.size), code, `${code} round-trips`);
}
assert.equal(Object.keys(units.STOCK_UNITS).length, 4, 'no new unit was added');

console.log('Portion picker passed: exact conversion, refused fractions, unchanged legacy/piece items, integer payload, rendered editor and sheet.');
