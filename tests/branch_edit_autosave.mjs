// Edit branch: no Save button; the changes are saved when the sheet closes (only if something changed and it is valid).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { loadTs } from './_load_ts.mjs';

const require = createRequire(import.meta.url);
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const rnw = require('react-native-web');
const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const flat = (html) => html.replace(/<[^>]+>/g, '|').replace(/\|+/g, '|');

const form = loadTs('src/features/branches/BranchForm.tsx', {
  'react-native': rnw,
  '@react-native-vector-icons/ionicons': { __esModule: true, default: (p) => React.createElement('i', { 'data-icon': p.name }) },
  '@/components/FormField': { FormField: (p) => React.createElement('label', null, p.label, React.createElement('input', { defaultValue: p.value })) },
  '@/components/SwitchField': { SwitchField: (p) => React.createElement('div', { 'data-switch': p.label }, p.label, '|', p.description) },
  '@/components/dashboard/ManagerActionButton': { ManagerActionButton: (p) => React.createElement('button', { 'data-label': p.label }) },
  '@/components/dashboard/theme': { managerColors: new Proxy({}, { get: () => '#000' }) },
}).BranchForm;
const values = { name: 'SM3', code: 'SM3', address: 'testing', is_main_branch: false, is_active: true, receiving_mode: 'cashier_confirm' };
const render = (props) => renderToStaticMarkup(React.createElement(form, { defaultValues: values, hideMainToggle: true, onSubmit() {}, ...props }));

let html = render({ autoSave: true });
assert.doesNotMatch(html, /data-label=/, 'no Save changes button');
assert.doesNotMatch(flat(html), /All changes saved/, 'no status text when idle');
assert.match(flat(html), /Active\|Inactive branches remain available for historical records\./);
assert.match(render({ autoSave: true, loading: true }), /Saving…/);

const list = read('src/features/branches/BranchListScreen.tsx');
assert.doesNotMatch(list, /Save changes/);
assert.match(list, /onClose=\{\(\) => void closeEdit\(\)\}/, 'closing (X, outside, back) saves');
assert.match(list, /const result = await editForm\.current\?\.flush\(\);/);
assert.match(list, /result === 'unchanged' \|\| result === 'saved'/, 'closes only when nothing changed or it saved');
assert.match(list, /discardOnNextClose\.current = true;/, 'after a failure, closing again discards: the sheet can always be left');
assert.match(list, /if \(updateMutation\.isPending\) return;/, 'not while it is saving');
assert.match(list, /mutateAsync\(/, 'the save can be waited for');
const src = read('src/features/branches/BranchForm.tsx');
assert.match(src, /if \(!formState\.isDirty\) return 'unchanged';/, 'nothing changed: nothing sent');
assert.match(src, /handleSubmit\(/, 'validated before saving');
console.log('Edit branch auto-save passed.');
