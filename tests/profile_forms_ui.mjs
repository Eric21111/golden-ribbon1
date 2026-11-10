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
  assert.match(text, /Full name\|Cancel\|Save\|$/, 'the field, then Cancel and Save');
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
  assert.match(text, /Current password\|New password\|At least 8 characters\.\|Confirm password\|Cancel\|Update\|$/, 'three fields, the one rule under New password, then Cancel | Update');
  assert.doesNotMatch(text, /Updates the password for this signed-in account|Role and branch|Enter current password|Enter new password|Re-enter new password|Current Password|Confirm New Password|Change password\|/, 'no paragraph, no placeholders, no Title Case labels');
  assert.match(html, /data-variant="secondary"[^>]*>Cancel</);
  assert.match(html, /aria-label="Show current password"/, 'the show / hide eyes are still there');
  assert.equal((html.match(/type="password"/g) ?? []).length, 3, 'all three start hidden');
  console.log('2. change password: ok');
}

// ---------------------------------------------------------------- 3. the forms' behaviour and the three profile screens
{
  const nameSrc = read('src/features/profile/ChangeNameForm.tsx');
  const passSrc = read('src/features/profile/ChangePasswordForm.tsx');
  assert.ok(nameSrc.includes('await changeOwnName(values.full_name)') && passSrc.includes('await changeOwnPassword(values.current_password, values.new_password)'), 'same calls');
  assert.ok(passSrc.includes("if (message === 'Current password is incorrect.') {"), 'same error handling');
  assert.ok(nameSrc.includes("setSuccess('Name updated.')") && passSrc.includes("setSuccess('Password updated.')"));
  assert.ok(passSrc.includes('formState.errors.new_password?.message ? null :'), 'the rule makes way for the real error under the field');
  assert.ok(nameSrc.includes("actions: { flexDirection: 'row', gap: spacing.sm },") && passSrc.includes("actions: { flexDirection: 'row', gap: spacing.sm },"), 'two columns');

  for (const file of ['app/(cashier)/cashier/profile.tsx', 'app/(manager)/manager/profile.tsx', 'app/(owner)/owner/profile.tsx']) {
    const src = read(file);
    assert.ok(src.includes('<ManagerActionButton label="Save" loading={loading}') && src.includes('<ManagerActionButton label="Update" loading={loading}'), `${file}: short button labels`);
    assert.doesNotMatch(src, /label="Save name"|label="Change password" loading=/, `${file}: the long labels are gone`);
    const nameForm = src.slice(src.indexOf('<ChangeNameForm'), src.indexOf('<ChangePasswordForm'));
    assert.doesNotMatch(nameForm, /hintStyle/, `${file}: no hint on the name form`);
  }
  console.log('3. behaviour and screens: ok');
}

// ---------------------------------------------------------------- 4. Change email: the same look as Change password
{
  const { ChangeEmailForm } = loadTs('src/features/profile/ChangeEmailForm.tsx', {
    ...stubs,
    '@/services/accountService': { changeOwnEmail: async () => ({ confirmed: true }) },
  });
  const html = renderToStaticMarkup(React.createElement(ChangeEmailForm, { currentEmail: 'golden-ribbons@gmail.com', onCancel() {} }));
  const text = flat(html);
  assert.match(text, /Current email: golden-ribbons@gmail\.com\|Current password\|New email\|Confirm email\|Cancel\|Update\|$/, 'the current email, three fields, then Cancel | Update');
  assert.doesNotMatch(text, /Updates the sign-in email for this account only|historical records|Enter current password|name@example\.com|Re-enter new email|Current Password|New Email|Confirm New Email|Change email\|/, 'no paragraph, no placeholders, no Title Case labels');
  assert.match(html, /data-variant="secondary"[^>]*>Cancel</, 'Cancel is the light one, on the left');
  assert.match(html, /aria-label="Show password"/, 'the show / hide eye is still there');
  assert.equal((html.match(/type="password"/g) ?? []).length, 1, 'the password starts hidden');
  assert.doesNotMatch(renderToStaticMarkup(React.createElement(ChangeEmailForm, { currentEmail: 'a@b.c' })), />Cancel</);

  const src = read('src/features/profile/ChangeEmailForm.tsx');
  assert.ok(src.includes('await changeOwnEmail(values.current_password, values.new_email)'), 'same call');
  assert.ok(src.includes('Verification has been sent to your email. Complete verification to finish changing your email.'), 'the verification message is unchanged: it says something that matters');
  assert.ok(src.includes("actions: { flexDirection: 'row', gap: spacing.sm },"));
  for (const file of ['app/(manager)/manager/profile.tsx', 'app/(owner)/owner/profile.tsx']) {
    const screen = read(file);
    const emailForm = screen.slice(screen.indexOf('<ChangeEmailForm'));
    assert.ok(emailForm.includes('<ManagerActionButton label="Update" loading={loading}'), `${file}: short button label`);
    assert.doesNotMatch(emailForm.slice(0, emailForm.indexOf('/>')), /hintStyle|label="Change email" loading=/, `${file}: no hint, no long label`);
  }
  console.log('4. change email: ok');
}

console.log('profile_forms_ui: ALL PASS');
