// Employee sheets (Create / Edit / Reset PIN): two short sections (ACCOUNT, ACCESS), sentence-case labels without placeholders that
// repeat them, one short rule under the password, Manager | Cashier as two big choices, short status lines, and the buttons side by side
// (Cancel | Create, Reset PIN | Save). Real renders; what is submitted, the role -> branch rules and the validation are unchanged.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { loadTs } from './_load_ts.mjs';

const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const require = createRequire(import.meta.url);
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const rnw = require('react-native-web');
const flat = (html) => html.replace(/<[^>]+>/g, '|').replace(/\|+/g, '|');

const stubs = {
  'react-native': rnw,
  '@react-native-vector-icons/ionicons': { __esModule: true, default: () => null },
  '@/components/dashboard/ManagerActionButton': { ManagerActionButton: (p) => React.createElement('button', { disabled: p.disabled, 'data-variant': p.variant ?? 'primary' }, p.label) },
};
const branches = [
  { id: 'main', name: 'Main', is_main_branch: true },
  { id: 'sm1', name: 'SM 1', is_main_branch: false },
  { id: 'sm2', name: 'SM 2', is_main_branch: false },
];

// ---------------------------------------------------------------- 1. Create employee
{
  const { CreateEmployeeForm } = loadTs('src/features/employees/CreateEmployeeForm.tsx', stubs);
  const html = renderToStaticMarkup(React.createElement(CreateEmployeeForm, { branches, onSubmit() {}, onCancel() {} }));
  const text = flat(html);
  assert.match(text, /ACCOUNT\|Full name\|Email\|PIN\|Confirm PIN\|Six digits\.\|ACCESS\|Role\|Manager\|Cashier\|Branch\|SM 1\|SM 2\|Active\|Inactive employees cannot use the app\.\|Cancel\|Create\|$/, 'ACCOUNT then ACCESS, the cashier\'s branches (not Main), Cancel | Create');
  assert.doesNotMatch(text, /Jane Doe|name@example\.com|Never stored|never stored|app database|Full Name|Temporary Password|Assigned Branch|Active employee|protected app features|Create employee/, 'no placeholders that repeat the labels, no jargon, no Title Case, no long button');
  assert.doesNotMatch(html, /placeholder="/, 'no placeholders at all');
  assert.match(html, /data-variant="secondary"[^>]*>Cancel</, 'Cancel is the light one, on the left');
  assert.match(html, /aria-label="PIN, digit 6 of 6"/, 'all six boxes are accessible');
  assert.doesNotMatch(renderToStaticMarkup(React.createElement(CreateEmployeeForm, { branches, onSubmit() {} })), />Cancel</, 'no Cancel when it is not in a sheet');
  assert.match(flat(renderToStaticMarkup(React.createElement(CreateEmployeeForm, { branches, onSubmit() {}, onCancel() {}, error: 'Email already used.' }))), /Email already used\.\|Cancel\|Create\|$/, 'a server error shows right above the buttons');
  console.log('1. create: ok');
}

// ---------------------------------------------------------------- 2. Edit employee
{
  const { EditEmployeeForm } = loadTs('src/features/employees/EditEmployeeForm.tsx', stubs);
  const employee = { id: 'e', full_name: 'Cashier 1', email: 'c1@x.com', role: 'cashier', branch_id: 'sm1', is_active: true };
  const html = renderToStaticMarkup(React.createElement(EditEmployeeForm, { employee, branches, onSubmit() {}, onResetPassword() {}, onToggleActive() {} }));
  const text = flat(html);
  assert.match(text, /Email\|c1@x\.com\|Full name\|Role\|Manager\|Cashier\|Branch\|SM 1\|SM 2\|Active\. Cannot be deactivated while there is an open shift\.\|Reset PIN\|Save\|Deactivate\|$/, 'Reset PIN | Save side by side, then Deactivate');
  assert.doesNotMatch(text, /Save employee|Assigned Branch|Full Name|Status:|Jane Doe/);
  assert.match(html, /data-variant="danger"[^>]*>Deactivate</, 'Deactivate stays the red one');
  assert.match(html, /data-variant="secondary"[^>]*>Reset PIN</);
  console.log('2. edit: ok');
}

// ---------------------------------------------------------------- 3. Reset PIN
{
  const { ResetPasswordForm } = loadTs('src/features/employees/ResetPasswordForm.tsx', stubs);
  const html = renderToStaticMarkup(React.createElement(ResetPasswordForm, { employeeName: 'Cashier 1', employeeEmail: 'c1@x.com', onSubmit() {} }));
  const text = flat(html);
  assert.match(text, /Cashier 1 · c1@x\.com\|This replaces the employee&#x27;s PIN\.\|New PIN\|Confirm PIN\|Reset PIN\|$/);
  assert.doesNotMatch(text, /cannot be viewed|New Temporary Password|Confirm Temporary Password/);
  assert.doesNotMatch(html, /placeholder="/);
  console.log('3. reset: ok');
}

// ---------------------------------------------------------------- 4. what they do is unchanged
{
  const create = read('src/features/employees/CreateEmployeeForm.tsx');
  assert.ok(create.includes("selectedRole === 'cashier'") && create.includes('branches.filter((branch) => !branch.is_main_branch)') && create.includes('branches.filter((branch) => branch.is_main_branch)'), 'a cashier gets selling branches, a manager gets Main');
  assert.ok(create.includes("if (value === 'cashier' && current?.is_main_branch) setValue('branch_id', '');") && create.includes("if (value === 'manager' && current && !current.is_main_branch) setValue('branch_id', '');"), 'switching role clears a branch that no longer fits');
  assert.ok(create.includes('if (locked.current || loading) return;') && create.includes('onSubmit(values);'), 'no double submit');
  assert.ok(create.includes("resolver: zodResolver(createEmployeeSchema)"));
  const hub = read('src/features/employees/EmployeeHub.tsx');
  assert.ok(hub.includes('onCancel={() => setCreateOpen(false)}'), 'Cancel closes the sheet');
  const edit = read('src/features/employees/EditEmployeeForm.tsx');
  assert.ok(edit.includes('onPress={handleSubmit(onSubmit)}') && edit.includes('onPress={onToggleActive}') && edit.includes('onPress={onResetPassword}'), 'the same three actions');
  console.log('4. behaviour: ok');
}

console.log('employee_forms_ui: ALL PASS');
