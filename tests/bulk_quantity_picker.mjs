import assert from 'node:assert/strict';
import { loadTs } from './_load_ts.mjs';

const state = [];
let cursor = 0;
const { BulkQuantityPicker } = loadTs('src/features/inventory/BulkQuantityPicker.tsx', {
  react: {useState(initial) {
    const index = cursor++;
    state[index] ??= initial;
    return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }];
  }},
  'react-native': {Pressable:'checkbox', Text:'text', TextInput:'input', View:'view'},
  '@/components/dashboard/ManagerBottomSheet': {ManagerBottomSheet:'sheet'},
  '@/components/dashboard/ManagerActionButton': {ManagerActionButton:'button'},
});
let applied;
const props = {
  rows: [{id:'rice',name:'Rice',maximum:5},{id:'egg',name:'Egg',maximum:2},{id:'fish',name:'Fish',maximum:8}],
  onApply: (ids, quantity) => {applied = {ids:[...ids],quantity};}
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
render()[0].props.onPress();
render().filter(e => e.type === 'checkbox')[0].props.onPress();
render().filter(e => e.type === 'checkbox')[1].props.onPress();
const setAmount = value => render().find(e => e.type === 'input').props.onChangeText(value);
const applyButton = () => render().find(e => e.props.label === 'Apply to 2 products');
setAmount('3');
assert.equal(applyButton().props.disabled, true);
setAmount('2');
assert.equal(applyButton().props.disabled, false);
applyButton().props.onPress();
assert.deepEqual(applied, {ids:['rice','egg'],quantity:'2'});
assert.equal(render()[0].props.label, 'Set quantity for multiple products');
console.log('Bulk draft quantities passed selection, availability and apply checks.');
