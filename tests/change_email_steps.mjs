// Change email: two steps like Change PIN. 1 the current PIN (checked before going on), 2 the new email twice.
// The current email is a read-only card, the stars are red, the PIN boxes are compact, and after Update the green message shows and
// the sheet closes. What is sent is unchanged: changeOwnEmail(current password, new email).
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

let overrides = {};
let index = 0;
const buttons = [];
const stubs = {
  react: { ...React, useState: (initial) => { const i = index++; return [i in overrides ? overrides[i] : initial, () => {}]; } },
  'react-native': rnw,
  '@react-native-vector-icons/ionicons': { __esModule: true, default: (p) => React.createElement('i', { 'data-icon': p.name }) },
  '@/components/AppButton': { AppButton: (p) => { buttons.push(p.label); return React.createElement('button', { 'data-variant': p.variant ?? 'primary' }, p.label); } },
  '@/components/BottomSheet': { useSheetScrollToTop: () => () => {} },
  '@/services/accountService': { changeOwnEmail: async () => ({ confirmed: true }), verifyOwnPassword: async () => {} },
};
const { ChangeEmailForm } = loadTs('src/features/profile/ChangeEmailForm.tsx', stubs);
// state order in the form: step, verifying, success
const render = (props = {}, over = {}) => { index = 0; overrides = over; buttons.length = 0; return renderToStaticMarkup(React.createElement(ChangeEmailForm, { currentEmail: 'golden-ribbon@gmail.com', onCancel() {}, ...props })); };

// step 1
let html = render();
let text = flat(html);
assert.match(text, /^\|1\|2\|Current PIN\|Current email\|golden-ribbon@gmail\.com\|Current PIN\| \*\|/, 'the steps, the read-only current email, then the PIN with a red star');
assert.match(text, /Use password instead\|Cancel\|Continue\|$/, 'Cancel | Continue');
assert.doesNotMatch(text, /New email|Confirm email|Update/, 'the new email is for step 2');
assert.match(html, /data-icon="lock-closed-outline"/, 'the current email is read-only');
assert.equal((html.match(/aria-label="Current PIN, digit \d of 6"/g) ?? []).length, 6);
assert.doesNotMatch(text, /Current email:/, 'no gray sentence: a card');

// step 2
html = render({}, { 0: 2 });
text = flat(html);
assert.match(text, /^\|1\|2\|New email\|Current email\|golden-ribbon@gmail\.com\|New email\| \*\|Confirm email\| \*\|Back\|Update\|$/, 'the new email twice, Back | Update');
assert.doesNotMatch(html, /digit \d of 6/, 'no PIN boxes any more');
assert.doesNotMatch(text, /Cancel|Continue/);

// no Cancel when it is not in a sheet (step 1)
assert.doesNotMatch(render({ onCancel: undefined }), />Cancel</);

// source: the same call, the check before going on, the messages
const src = read('src/features/profile/ChangeEmailForm.tsx');
assert.ok(src.includes('await changeOwnEmail(values.current_password, values.new_email)'), 'same call');
assert.ok(src.includes('await verifyOwnPassword(parsed.data.current_password);'), 'the PIN is checked before step 2');
assert.ok(src.includes("setError('current_password', { message: 'Current PIN is incorrect.' })"), 'a wrong PIN says so');
assert.ok(src.includes('Verification has been sent to your email. Complete verification to finish changing your email.'), 'the verification message is unchanged');
assert.ok(src.includes('Your email has been updated.'));
assert.match(src, /setTimeout\(\(\) => onDone\(\), 900\)/, 'the sheet closes about a second after the message');
assert.match(src, /allowPassword\s+required\s+compact/, 'a red star, compact boxes, and "Use password instead" stays');
assert.match(src, /label="New email"\s+required/);
assert.match(src, /label="Confirm email"\s+required/);
for (const file of ['app/(manager)/manager/profile.tsx', 'app/(owner)/owner/profile.tsx']) {
  const screen = read(file);
  const form = screen.slice(screen.indexOf('<ChangeEmailForm'), screen.indexOf('</BottomSheet>', screen.indexOf('<ChangeEmailForm')));
  assert.match(form, /onDone=\{\(\) => setEmailOpen\(false\)\}/, `${file}: the sheet closes after the message`);
  assert.match(form, /key=\{emailOpen \?/, `${file}: it starts at step 1 each time`);
  assert.match(form, /label=\{label\}/, `${file}: the buttons say Cancel / Continue / Back / Update`);
}
// the shared step indicator is the Change PIN one
assert.match(read('src/features/profile/ChangePasswordForm.tsx'), /<StepIndicator step=\{step\} labels=\{\{ 1: 'Current PIN', 2: 'New PIN' \}\} \/>/);
console.log('Change email steps passed.');
