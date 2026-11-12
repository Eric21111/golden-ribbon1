import assert from 'node:assert/strict';
import { loadTs } from './_load_ts.mjs';

const state = [];
let cursor = 0;
const confirms = [];
const { BulkQuantityPicker } = loadTs('src/features/inventory/BulkQuantityPicker.tsx', {
  react: {useState(initial) {
    const index = cursor++;
    state[index] ??= initial;
    return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }];
  }},
  'react-native': {
    Pressable: 'pressable', ScrollView: 'scroll', Text: 'text', TextInput: 'input', View: 'view',
    StyleSheet: { create: styles => styles }, useWindowDimensions: () => ({ height: 800 }),
  },
  '@react-native-vector-icons/ionicons': { __esModule: true, default: 'icon' },
  '@/components/dashboard/ManagerBottomSheet': {ManagerBottomSheet:'sheet'},
  '@/components/dashboard/ManagerActionButton': {ManagerActionButton:'button'},
  '@/components/dashboard/FilterChipRow': {FilterChipRow:'pills'},
  '@/components/dashboard/ToolbarIconButtons': {FilterIconButton:'funnel'},
  '@/features/products/ProductFilterControls': {ListFiltersSheet:'filtersSheet'},
  '@/features/products/listFilters': {DEFAULT_LIST_FILTERS: {category:'all',pos:'all',returns:'all'}},
  '@/features/products/CategoryIcon': {CategoryIcon:'categoryIcon'},
  '@/components/dashboard/theme': { managerColors: { ink: '#111', subtext: '#667', royalBlue: '#13c' } },
  '@/lib/confirmAction': { confirmAction: (title, message, action, labels) => { confirms.push({ title, message, action, labels }); } },
});
let applied;
let cleared = 0;
const props = {
  rows: [
    {id:'rice',name:'Rice',maximum:5,category:'supplies'},
    {id:'egg',name:'Egg',maximum:2,category:'supplies'},
    {id:'fish',name:'Fish',maximum:8,category:'meals'},
    {id:'soda',name:'Soda',maximum:0,category:'drinks'},
  ],
  onApply: (values) => {applied = [...values];}
};
function render() {
  cursor = 0;
  const elements = [];
  function walk(element) {
    if (Array.isArray(element)) return element.forEach(walk);
    if (!element?.props) return;
    elements.push(element);
    walk(element.props.children);
  }
  walk(BulkQuantityPicker(props));
  return elements;
}
const text = () => render().flatMap(e => [e.props.children].flat(Infinity)).filter(c => typeof c === 'string').join('|');
const rowButtons = () => render().filter(e => e.props.accessibilityRole === 'checkbox');
const input = label => render().find(e => e.type === 'input' && e.props.accessibilityLabel === label);
const qtyInput = () => input('Quantity per selected product');
const link = label => render().find(e => e.props.accessibilityRole === 'button' && [e.props.children].flat(Infinity).some(c => c?.props?.children === label || c === label));
const applyButton = () => render().find(e => e.type === 'button' && /^Apply to|^Select products$/.test(e.props.label));
// status pills: All / Empty (n) / Filled (n). Category: a funnel button that opens the shared Filters sheet.
const pills = () => render().find(e => e.type === 'pills');
const pillLabels = () => pills()?.props.options.map(o => o.label);
const pickStatus = value => pills().props.onChange(value);
const funnel = () => render().find(e => e.type === 'funnel');
const filtersSheet = () => render().find(e => e.type === 'filtersSheet');
const pickCategory = value => { const sheet = filtersSheet(); sheet.props.onChange({ ...sheet.props.filters, category: value }); };
const categoryValue = () => filtersSheet().props.filters.category;
const trigger = () => render().find(e => e.props.accessibilityLabel === 'Set quantity for multiple products');
const clearAll = () => render().find(e => /^Clear all quantities/.test(e.props.accessibilityLabel ?? ''));
const closeSheet = () => render().find(e => e.type === 'sheet').props.onClose();
const labels = () => rowButtons().map(e => e.props.accessibilityLabel);

// closed: only the trigger
assert.equal(trigger().props.accessibilityLabel, 'Set quantity for multiple products');
assert.match(text(), /Set quantity in bulk\|One quantity for many products/, 'a titled card with a one-line hint');
assert.equal(clearAll(), undefined, 'no Clear all while nothing is entered');
trigger().props.onPress();

// nothing selected yet: the button says what to do, not "Apply to 0 products"
assert.equal(rowButtons().length, 4);
assert.match(text(), /None selected/);
assert.equal(applyButton().props.label, 'Select products');
assert.equal(applyButton().props.disabled, true);
assert.match(text(), /5 available/, 'each row shows how many can be sent');
assert.deepEqual(pillLabels(), ['All', 'Empty (4)', 'Filled (0)'], 'the pills are always there, with counts');
assert.doesNotMatch(text(), /Pick the products|enter one quantity for all of them|already have a quantity/, 'no helper text');
assert.doesNotMatch(text(), /already have a quantity|already has a quantity/);

// category chips: All plus only the categories that are in the list
assert.ok(funnel(), 'a funnel button for the category filter (the list has more than one category)');
assert.equal(funnel().props.count, 0);
assert.equal(filtersSheet().props.visible, false, 'the Filters sheet is closed until the funnel is tapped');
assert.deepEqual(filtersSheet().props.keys, ['category'], 'the same category filter as the other lists');
assert.equal(categoryValue(), 'all');
funnel().props.onPress();
assert.equal(filtersSheet().props.visible, true);
filtersSheet().props.onClose();
assert.equal(filtersSheet().props.visible, false);
assert.equal(render().filter(e => e.type === 'categoryIcon').length, 4, 'every row shows its category icon');

// products with nothing to send are shown but cannot be picked
const soda = () => rowButtons().find(e => /Soda/.test(e.props.accessibilityLabel));
assert.equal(soda().props.disabled, true);
assert.equal(soda().props.accessibilityLabel, 'Soda, out of stock');
assert.match(text(), /Out of stock/);
assert.doesNotMatch(text(), /0 available/, 'no "0 available" wording');

// the original selection / availability / apply checks (nothing typed yet, so the mode choice never shows)
rowButtons()[0].props.onPress();
rowButtons()[1].props.onPress();
assert.match(text(), /2 selected/);
assert.doesNotMatch(text(), /What should happen/, 'no Replace/Add choice when none of the picked products has a quantity');
qtyInput().props.onChangeText('3');
assert.equal(applyButton().props.label, 'Apply to 2 products');
assert.equal(applyButton().props.disabled, true, 'more than Egg has available');
assert.match(text(), /Egg only has 2 available\./);
qtyInput().props.onChangeText('2');
assert.equal(applyButton().props.disabled, false);
qtyInput().props.onChangeText('2x');
assert.equal(qtyInput().props.value, '2', 'only digits are accepted');
applyButton().props.onPress();
assert.deepEqual(applied, [['rice', '2'], ['egg', '2']], 'the final quantity for each picked product');
assert.ok(trigger(), 'closes and resets after applying');
assert.equal(rowButtons().length, 0, 'the sheet is closed');

// category filter + Select all shown
trigger().props.onPress();
assert.match(text(), /None selected/, 'the previous selection was cleared');
pickCategory('supplies');
assert.equal(funnel().props.count, 1, 'the funnel shows one filter is on');
assert.deepEqual(labels(), ['Rice, 5 available', 'Egg, 2 available'], 'the category narrows the list');
link('Select all shown').props.onPress();
assert.match(text(), /2 selected/, 'Select all shown picks only the shown products');
pickCategory('drinks');
assert.deepEqual(labels(), ['Soda, out of stock']);
assert.match(text(), /2 selected/, 'the selection survives changing the filter');
pickCategory('all');
assert.ok(!link('Unselect all'), 'only 2 of the 3 products that can be sent are selected');
link('Clear').props.onPress();
assert.match(text(), /None selected/);

// Select all never adds an out-of-stock product
link('Select all').props.onPress();
assert.match(text(), /3 selected/, 'Rice, Egg and Fish; not Soda');
link('Unselect all').props.onPress();

// search, combined with the category, and Clear
input('Search products').props.onChangeText('ri');
assert.deepEqual(labels(), ['Rice, 5 available'], 'search narrows the list');
pickCategory('meals');
assert.equal(rowButtons().length, 0, 'search and category both apply');
assert.match(text(), /No products match\./);
pickCategory('all');
input('Search products').props.onChangeText('');
assert.equal(rowButtons().length, 4, 'clearing both brings every product back');
rowButtons()[2].props.onPress();
qtyInput().props.onChangeText('4');
assert.equal(applyButton().props.label, 'Apply to 1 product', 'singular');
assert.equal(applyButton().props.disabled, false);
qtyInput().props.onChangeText('0');
assert.equal(applyButton().props.disabled, true, 'zero is not a quantity');
qtyInput().props.onChangeText('');
assert.equal(applyButton().props.disabled, true, 'empty is not a quantity');
link('Clear')?.props.onPress();
assert.match(text(), /None selected/);
closeSheet();

// ---- products that already have a quantity are shown, and can be replaced or added to
props.rows = [
  {id:'rice',name:'Rice',maximum:20,category:'supplies',current:'10'},
  {id:'egg',name:'Egg',maximum:2,category:'supplies',current:''},
  {id:'fish',name:'Fish',maximum:8,category:'meals',current:'3'},
  {id:'soda',name:'Soda',maximum:0,category:'drinks'},
];
trigger().props.onPress();
assert.deepEqual(pillLabels(), ['All', 'Empty (2)', 'Filled (2)']);
assert.equal(pillLabels().filter(label => label === 'All').length, 1, 'a single All');
assert.doesNotMatch(text(), /Pick the products|enter one quantity for all of them|already have a quantity/, 'no helper text, even with quantities entered');
assert.match(text(), /\|10\|/, 'Rice shows its current quantity');
assert.match(text(), /\|3\|/, 'Fish shows its current quantity');
assert.equal(rowButtons()[0].props.accessibilityLabel, 'Rice, 20 available, quantity 10 entered', 'screen readers hear it too');
pickStatus('filled');
assert.deepEqual(labels(), ['Rice, 20 available, quantity 10 entered', 'Fish, 8 available, quantity 3 entered']);
pickStatus('empty');
assert.deepEqual(labels(), ['Egg, 2 available', 'Soda, out of stock'], 'Empty shows the products still to fill');
pickCategory('supplies');
assert.deepEqual(labels(), ['Egg, 2 available'], 'Empty and the category chip work together');
pickCategory('all');
pickStatus('all');
pickStatus('filled');
assert.equal(pills().props.value, 'filled');
pickStatus('all');
assert.equal(pills().props.value, 'all');
assert.equal(rowButtons().length, 4, 'and every product is back');

// a filled product can still be picked. The sheet itself does not change: the question comes after Apply, in the app's standard dialog.
const ask = () => confirms.at(-1);
confirms.length = 0;
rowButtons()[0].props.onPress(); // Rice (10)
rowButtons()[1].props.onPress(); // Egg (empty)
assert.match(text(), /2 selected/);
assert.doesNotMatch(text(), /What should happen/, 'no Replace/Add box inside the sheet');
assert.match(text(), /Quantity for each selected product/, 'the field label stays the same');
qtyInput().props.onChangeText('2');
assert.equal(applyButton().props.disabled, false);
applied = undefined;
applyButton().props.onPress();
assert.equal(confirms.length, 1, 'the standard dialog is asked after Apply');
assert.equal(applied, undefined, 'nothing is applied until a choice is made');
assert.equal(ask().title, 'Some already have a quantity');
assert.equal(ask().message, '', 'no explanation text: the title and the two buttons are enough');
assert.deepEqual({ ...ask().labels, secondary: ask().labels.secondary.label }, { confirm: 'Replace it', tone: 'info', closeButton: true, secondary: 'Add to it' },
  'standard look: Add to it | Replace it, an X in the corner');
assert.equal(ask().labels.cancel, undefined, 'no Cancel: the X or a tap outside closes it');
assert.equal(link('Cancel'), undefined);
assert.match(text(), /2 selected/, 'the sheet and the selection are untouched while the dialog is open');
assert.equal(qtyInput().props.value, '2');

// Replace (the main button): every picked product gets the new quantity, and the sheet closes
ask().action();
assert.deepEqual(applied, [['rice', '2'], ['egg', '2']], 'Replace: both get the new quantity');
assert.ok(trigger(), 'closed');

// Add (the other button): the new quantity goes on top of what is there; empty products just get it
trigger().props.onPress();
rowButtons()[0].props.onPress(); // Rice (10)
rowButtons()[1].props.onPress(); // Egg (empty)
qtyInput().props.onChangeText('2');
applyButton().props.onPress();
ask().labels.secondary.onPress();
assert.deepEqual(applied, [['rice', '12'], ['egg', '2']], 'Add: 10 + 2 = 12, and the empty one is just 2');

// products that have nothing yet never ask
const asked = confirms.length;
trigger().props.onPress();
rowButtons()[1].props.onPress(); // Egg (empty)
qtyInput().props.onChangeText('1');
applyButton().props.onPress();
assert.equal(confirms.length, asked, 'only empty products: applied straight away, no question');
assert.deepEqual(applied, [['egg', '1']]);

// Add respects what can be sent: Fish has 3 and only 8 are available
trigger().props.onPress();
rowButtons()[2].props.onPress(); // Fish (3)
qtyInput().props.onChangeText('6');
assert.equal(applyButton().props.disabled, false, 'replacing with 6 is fine');
applyButton().props.onPress();
assert.equal(ask().labels.secondary, undefined, '3 + 6 = 9 is more than the 8 available: Add is not offered');
assert.equal(ask().labels.confirm, 'Replace it', 'Replace is still offered');
assert.equal(ask().message, "Add to it isn't possible. Fish has 3. Adding 6 is over the 8 available.", 'only the reason is shown, as one line');
ask().action();
assert.deepEqual(applied, [['fish', '6']]);
trigger().props.onPress();
rowButtons()[2].props.onPress();
qtyInput().props.onChangeText('5');
applyButton().props.onPress();
assert.ok(ask().labels.secondary, '3 + 5 = 8 is exactly the limit');
assert.equal(ask().message, '', 'no text when both choices are available');
ask().labels.secondary.onPress();
assert.deepEqual(applied, [['fish', '8']]);

// replacing is still checked in the sheet itself
trigger().props.onPress();
rowButtons()[1].props.onPress(); // Egg, 2 available
qtyInput().props.onChangeText('3');
assert.equal(applyButton().props.disabled, true);
assert.match(text(), /Egg only has 2 available\./);
closeSheet();

// the same cap as the quantity boxes
props.rows = [{id:'rice',name:'Rice',category:'supplies',current:'999990'}];
trigger().props.onPress();
rowButtons()[0].props.onPress();
qtyInput().props.onChangeText('20');
applyButton().props.onPress();
assert.equal(ask().labels.secondary, undefined, 'Add is not offered over the cap');
assert.equal(ask().message, "Add to it isn't possible. Rice would go over 999,999.");
qtyInput().props.onChangeText('9');
applyButton().props.onPress();
assert.ok(ask().labels.secondary);
ask().labels.secondary.onPress();
assert.deepEqual(applied, [['rice', '999999']]);

// a typed 0 counts as "has a quantity", but adds nothing and can still be replaced
props.rows = [{id:'a',name:'Alpha',category:'supplies',current:'0'},{id:'b',name:'Beta',category:'supplies',current:''}];
trigger().props.onPress();
assert.deepEqual(pillLabels(), ['All', 'Empty (1)', 'Filled (1)'], 'the count is on the pill, not in a sentence');
rowButtons()[0].props.onPress();
qtyInput().props.onChangeText('4');
applyButton().props.onPress();
assert.equal(ask().message, '');
ask().labels.secondary.onPress();
assert.deepEqual(applied, [['a', '4']], '0 + 4 = 4');

// several filled products: still just the two buttons, each product worked out on its own
props.rows = [{id:'a',name:'Ampalaya',category:'supplies',current:'5'},{id:'b',name:'Bihon',category:'supplies',current:'7'},{id:'c',name:'Cheese',category:'supplies',current:''}];
trigger().props.onPress();
rowButtons().forEach(e => e.props.onPress());
qtyInput().props.onChangeText('40');
applyButton().props.onPress();
assert.equal(ask().message, '');
ask().labels.secondary.onPress();
assert.deepEqual(applied, [['a', '45'], ['b', '47'], ['c', '40']], 'each product is worked out on its own');


// Clear all (outside the sheet): only when something is entered, always confirmed, then the screen's handler runs
confirms.length = 0;
props.filledCount = 0;
props.onClearAll = () => { cleared++; };
assert.equal(clearAll(), undefined, 'hidden while nothing is entered');
props.filledCount = 1;
assert.equal(clearAll().props.accessibilityLabel, 'Clear all quantities, 1 entered');
clearAll().props.onPress();
assert.equal(cleared, 0, 'nothing is cleared before the user confirms');
assert.equal(confirms.length, 1);
assert.equal(confirms[0].title, 'Clear all quantities?');
assert.match(confirms[0].message, /for 1 product\. This cannot be undone\./);
assert.deepEqual(confirms[0].labels, { confirm: 'Clear all', tone: 'danger' }, 'a red, destructive confirm');
confirms[0].action();
assert.equal(cleared, 1, 'confirming clears');
props.filledCount = 5;
clearAll().props.onPress();
assert.match(confirms[1].message, /for 5 products\./);
props.onClearAll = undefined;
assert.equal(clearAll(), undefined, 'no handler, no button');
trigger().props.onPress();
assert.equal(clearAll(), undefined, 'not shown inside the sheet');
closeSheet();

// a list with a single category and nothing entered shows no chips; rows without a maximum are never capped or greyed
props.rows = [{id:'a',name:'Alpha',category:'supplies'},{id:'b',name:'Beta',category:'supplies'}];
trigger().props.onPress();
assert.equal(funnel(), undefined, 'one category: no category filter to offer');
assert.equal(filtersSheet(), undefined);
rowButtons()[0].props.onPress();
qtyInput().props.onChangeText('999999');
assert.equal(applyButton().props.disabled, false);
assert.doesNotMatch(text(), /available|Out of stock/);
assert.ok(rowButtons().every(e => !e.props.disabled));

console.log('Bulk draft quantities passed selection, category and Empty/Filled filters, replace/add, search, select-all, out-of-stock, availability, clear-all and apply checks.');
