import assert from 'node:assert/strict';
import { loadTs } from './_load_ts.mjs';

const state = [];
let cursor;
const { SelectedReturnCloseForm } = loadTs('src/features/shifts/SelectedReturnCloseForm.tsx', {
  react: { useState(initial) {
    const index = cursor++;
    if (!(index in state)) state[index] = initial;
    return [state[index], change => { state[index] = typeof change === 'function' ? change(state[index]) : change; }];
  }},
  'react-native': { Pressable:'checkbox', ScrollView:'scroll', View:'view', Text:'text', StyleSheet:{ create: x => x } },
  '@/components/FormField': { FormField:'input' },
  '@/components/dashboard/ManagerActionButton': { ManagerActionButton:'button' },
  '@/components/dashboard/ManagerBottomSheet': { ManagerBottomSheet:'sheet' },
  '@/components/dashboard/theme': { managerColors:{} },
});
const p = (id, stock, returnable) => ({product_id:id,product_name_snapshot:id,system_balance_before_waste:stock,returnable});
const preview = {expected_cash:20,expected_gcash:10,products:[p('Rice',4,true),p('Egg',2,true),p('Carryover',8,false),p('Empty',0,true)]};
let submission;
function render() {
  cursor = 0;
  const elements = [];
  function collect(e) {
    if (Array.isArray(e)) return e.forEach(collect);
    if (!e?.props || (e.type === 'sheet' && !e.props.visible)) return;
    elements.push(e);
    collect(e.props.children);
  }
  collect(SelectedReturnCloseForm({ preview, operator:'Cashier', loading:false, onSubmit:(...args) => { submission = args; } }));
  return elements;
}
const byLabel = label => render().find(e => e.props.label === label);
const submit = () => byLabel('Complete End Shift');
assert.equal(submit().props.disabled,true);
byLabel('Cash on hand').props.onChangeText('20');
byLabel('GCash received').props.onChangeText('10');
byLabel('Select return items (0)').props.onPress();
assert.equal(render().filter(e=>e.type==='checkbox').length,2);
assert.equal(render().filter(e=>e.type==='sheet')[0].props.children.props.children.flat(Infinity).some(e=>e?.type==='input'),false);
byLabel('Select all').props.onPress();
byLabel('Clear selection').props.onPress();
render().find(e=>e.type==='checkbox').props.onPress();
byLabel('Done').props.onPress();
byLabel('Review waste (0)').props.onPress();
const wasteInput = () => render().find(e=>e.type==='input' && e.props.label.startsWith('Rice ·'));
wasteInput().props.onChangeText('5');
assert.equal(submit().props.disabled,true);
wasteInput().props.onChangeText('1');
byLabel('Done').props.onPress();
submit().props.onPress();
assert.deepEqual(submission,['20','10',{productIds:['Rice'],waste:{Rice:1}}]);
console.log('Cashier selection, read-only return quantities, waste validation and remittance submission passed.');
