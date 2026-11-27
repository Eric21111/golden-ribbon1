// Edit name and Change password (the cashier, manager and owner profile sheets share these two forms): no explanation paragraphs,
// sentence-case labels without repeated placeholders, one short rule under New password, and Cancel | Save (Update) side by side.
// Real renders of both forms; what they send (changeOwnName / changeOwnPassword, the schemas, the error handling) is untouched.
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
  '@/components/BottomSheet': { useSheetScrollToTop: () => () => {} },
  'react-native': rnw,
  '@react-native-vector-icons/ionicons': { __esModule: true, default: () => null },
  '@/components/AppButton': { AppButton: (p) => React.createElement('button', { disabled: p.disabled, 'data-variant': p.variant ?? 'primary' }, p.label) },
  '@/features/auth/AuthProvider': { useAuth: () => ({ session: null }) },
  '@tanstack/react-query': { useQueryClient: () => ({ setQueryData() {}, invalidateQueries() {} }) },
  '@/services/accountService': { changeOwnName: async () => 'x', changeOwnPassword: async () => {} },
};

// ---------------------------------------------------------------- 1. Edit name
{
  const { ChangeNameForm } = loadTs('src/features/profile/ChangeNameForm.tsx', stubs);
  const html = renderToStaticMarkup(React.createElement(ChangeNameForm, { currentName: 'Cashier 1', onCancel() {} }));
  const text = flat(html);
  assert.match(text, /Full name\| \*\|Cancel\|Save\|$/, 'the field with a red star, then Cancel and Save');
  assert.match(html, /value="Cashier 1"/);
  assert.doesNotMatch(text, /Updates your own display name|Role, branch|Enter your full name|Full Name|Save name/, 'no paragraph, no placeholder, no long label');
  assert.match(html, /data-variant="secondary"[^>]*>Cancel</, 'Cancel is the light one, on the left');
  assert.match(html, /data-variant="primary"[^>]*>Save</);
  // no Cancel when the form is not in a sheet
  assert.doesNotMatch(renderToStaticMarkup(React.createElement(ChangeNameForm, { currentName: 'A' })), />Cancel</);
  console.log('1. edit name: ok');
}

// ---------------------------------------------------------------- 2. Change password
{
  const { ChangePasswordForm } = loadTs('src/features/profile/ChangePasswordForm.tsx', stubs);
  const html = renderToStaticMarkup(React.createElement(ChangePasswordForm, { onCancel() {} }));
  const text = flat(html);
  assert.match(text, /Current PIN\|Current PIN\| \*\| \|Cancel\|Continue\|$/, 'current PIN is verified before showing new PIN fields');
  assert.doesNotMatch(text, /Updates the password for this signed-in account|Role and branch|Enter current password|Enter new password|Re-enter new password|Current Password|Confirm New Password|Change password\|/, 'no paragraph, no placeholders, no Title Case labels');
  assert.match(html, /data-variant="secondary"[^>]*>Cancel</);
  assert.match(html, /aria-label="Show PIN"/, 'the show / hide control remains');
  assert.equal((html.match(/type="password"/g) ?? []).length, 6, 'all six PIN digits start hidden');
  console.log('2. change password: ok');
}

// ---------------------------------------------------------------- 3. the forms' behaviour and the three profile screens
{
  const nameSrc = read('src/features/profile/ChangeNameForm.tsx');
  const passSrc = read('src/features/profile/ChangePasswordForm.tsx');
  assert.ok(nameSrc.includes('await changeOwnName(values.full_name)') && passSrc.includes('await changeOwnPassword(parsed.data.current_password, parsed.data.new_password)'), 'validated values reach the account service');
  assert.ok(passSrc.includes("if (message === 'Current PIN is incorrect.') {"), 'wrong PIN remains actionable');
  assert.ok(nameSrc.includes("setSuccess('Name updated.')") && passSrc.includes("setSuccess('PIN updated.')"));
  assert.ok(passSrc.includes('error={fieldState.error?.message}'), 'field validation stays visible');
  assert.match(passSrc, /actions: \{ flexDirection: 'row'/);

  for (const file of ['app/(cashier)/cashier/profile.tsx', 'app/(manager)/manager/profile.tsx', 'app/(owner)/owner/profile.tsx']) {
    const src = read(file);
    assert.ok(src.includes('<ManagerActionButton label="Save" loading={loading}') && src.includes('<ManagerActionButton label={label} loading={loading}'), `${file}: shared step action labels`);
    assert.doesNotMatch(src, /label="Save name"|label="Change password" loading=/, `${file}: the long labels are gone`);
    const nameForm = src.slice(src.indexOf('<ChangeNameForm'), src.indexOf('<ChangePasswordForm'));
    assert.doesNotMatch(nameForm, /hintStyle/, `${file}: no hint on the name form`);
  }
  console.log('3. behaviour and screens: ok');
}

// (Change email is two steps like Change PIN now: see change_email_steps.mjs)

console.log('profile_forms_ui: ALL PASS');
