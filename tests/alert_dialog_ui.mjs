// The app-wide confirm / notice dialog: a round icon says the kind (warning / danger / info / success), a "-" list shows as bullets,
// the confirm button of something that cannot be undone is red, and the order-confirmed pop-up after checkout matches. Real render of
// the dialog through its store; the call sites are checked for their tone and wording.
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

// ---------------------------------------------------------------- 1. the message becomes blocks
{
  const { parseAlertMessage } = loadTs('src/lib/alertMessage.ts');
  assert.deepEqual(parseAlertMessage('Plain sentence.'), [{ type: 'text', text: 'Plain sentence.' }]);
  assert.deepEqual(parseAlertMessage('- one\n- two'), [{ type: 'bullet', text: 'one' }, { type: 'bullet', text: 'two' }]);
  assert.deepEqual(parseAlertMessage('Intro:\n\n- a\n  \n- b\nTail'), [
    { type: 'text', text: 'Intro:' }, { type: 'bullet', text: 'a' }, { type: 'bullet', text: 'b' }, { type: 'text', text: 'Tail' },
  ], 'blank lines are only gaps');
  assert.deepEqual(parseAlertMessage('Charge ₱5 - stock deducted'), [{ type: 'text', text: 'Charge ₱5 - stock deducted' }], 'a dash inside a sentence is not a bullet');
  assert.deepEqual(parseAlertMessage(''), []);
  console.log('1. message blocks: ok');
}

// ---------------------------------------------------------------- 2. the rendered dialog
{
  const store = loadTs('src/stores/alertStore.ts', { zustand: require('zustand') });
  const confirmLib = loadTs('src/lib/confirmAction.ts', { '@/stores/alertStore': store });
  const Dialog = loadTs('src/components/GlobalAlertModal.tsx', {
    'react-native': { ...rnw, Platform: { OS: 'ios' }, Modal: (p) => (p.visible ? React.createElement('div', null, p.children) : null) },
    '@react-native-vector-icons/ionicons': { __esModule: true, default: (p) => React.createElement('i', { 'data-icon': p.name, 'data-color': p.color }) },
    '@/components/dashboard/ManagerActionButton': { ManagerActionButton: (p) => React.createElement('button', { 'data-variant': p.variant ?? 'primary' }, p.label) },
    // a server render reads zustand's INITIAL state, so read the live state directly
    '@/stores/alertStore': { useAlertStore: (selector) => selector(store.useAlertStore.getState()) },
  }).GlobalAlertModal;
  const render = () => renderToStaticMarkup(React.createElement(Dialog));
  const show = (title, message, labels) => { confirmLib.confirmAction(title, message, () => {}, labels); return render(); };

  // the End Shift dialog from the screenshot
  const endShift = show('End Shift for today?', '- Sales and stock changes stop for this booth today\n- You count the remaining stock and cash to finish\n- Today cannot be reopened', { confirm: 'Start End Shift', tone: 'danger' });
  assert.match(flat(endShift), /End Shift for today\?\|•\|Sales and stock changes stop for this booth today\|•\|You count the remaining stock and cash to finish\|•\|Today cannot be reopened\|Cancel\|Start End Shift\|$/, 'icon, title, three bullets, Cancel | confirm');
  assert.match(endShift, /data-icon="alert"[^>]*data-color="#B91C1C"/, 'a red icon for something that cannot be undone');
  assert.match(endShift, /data-variant="destructive"[^>]*>Start End Shift</, 'the confirm button is the red one');
  assert.match(endShift, /data-variant="secondary"[^>]*>Cancel</, 'Cancel stays the light one');

  // a careful (default) confirmation: amber icon, normal confirm button
  const logout = show('Log out?', 'You will need to sign in again.');
  assert.match(logout, /data-icon="alert"[^>]*data-color="#B45309"/);
  assert.match(logout, /data-variant="primary"[^>]*>Confirm</);
  assert.doesNotMatch(logout, /•/, 'a plain sentence is not a list');
  // an info confirmation
  assert.match(show('Checkout order?', 'Standard\nCharge ₱1,750.00. Stock will be deducted.', { confirm: 'Checkout', tone: 'info' }), /data-icon="information"[^>]*>.*Checkout</s);

  // notices: success and error
  confirmLib.alertNotice('Employee created', 'They can sign in.', 'success');
  const ok = render();
  assert.match(ok, /data-icon="checkmark"[^>]*data-color="#15803D"/);
  assert.match(flat(ok), /Employee created\|They can sign in\.\|OK\|$/, 'a notice has one OK button');
  confirmLib.alertNotice('Cannot start shift', 'Nope.', 'danger');
  assert.match(render(), /data-color="#B91C1C"/);
  confirmLib.alertNotice('Plain notice', 'Hello.');
  assert.match(render(), /data-icon="information"/, 'a notice defaults to info');
  store.useAlertStore.getState().dismiss();
  assert.equal(render(), '', 'nothing when nothing is showing');
  console.log('2. dialog: ok');
}

// ---------------------------------------------------------------- 3. what each dialog says and how serious it is
{
  const at = (file, needle) => {
    const src = read(file);
    assert.ok(src.includes(needle), `${file}: ${needle}`);
  };
  // cannot-be-undone ones are red
  at('app/(cashier)/cashier/dashboard.tsx', "{ cancel: 'Cancel', confirm: 'Start End Shift', tone: 'danger' }");
  at('app/(cashier)/cashier/dashboard.tsx', "{ cancel: 'Cancel', confirm: 'Finalize', tone: 'danger' }");
  at('src/features/pos/PosViewOrderSheet.tsx', "{ confirm: 'Clear', tone: 'danger' }");
  at('src/features/pos/PosOrderPane.tsx', "{ confirm: 'Clear', tone: 'danger' }");
  at('src/features/products/VariantListEditor.tsx', "{ confirm: 'Remove', tone: 'danger' }");
  at('src/features/employees/EmployeeHub.tsx', "tone: deactivating ? 'danger' : 'info'");
  assert.equal((read('app/(manager)/manager/products/index.tsx').match(/tone: 'danger',/g) ?? []).length, 2, 'discarding changes, on both the create and the edit sheet');
  // normal ones are not
  at('app/(cashier)/cashier/payment.tsx', "{ confirm: 'Checkout', tone: 'info' }");
  // errors and successes say so
  at('app/(cashier)/cashier/dashboard.tsx', "alertNotice('Cannot start shift', message, 'danger');");
  at('app/(cashier)/cashier/dashboard.tsx', "formatCloseSuccessSummary(result, names), 'success'");
  at('src/features/employees/EmployeeHub.tsx', "'They can sign in with the email and temporary password.', 'success'");
  // shorter wording
  const close = read('src/features/shifts/closeDisplay.ts');
  assert.ok(!close.includes('Once you start End Shift') && !close.includes('You cannot reopen'), 'the long End Shift paragraph is gone');
  assert.ok(close.includes("- They cannot be changed afterward"));
  at('src/features/products/wizardGuards.ts', "message: 'Your unsaved changes will be lost.',");
  at('src/features/auth/useSignOut.ts', "'You will need to sign in again.'");
  console.log('3. call sites: ok');
}

// ---------------------------------------------------------------- 4. the order-confirmed pop-up and the red button
{
  const pay = read('app/(cashier)/cashier/payment.tsx');
  assert.doesNotMatch(pay, /ORDER CONFIRMED|Sale: \{checkout|Total: \{formatMoney/, 'the all-caps list of "Label: value" lines is gone');
  assert.ok(pay.includes('<Text style={styles.title}>Order confirmed</Text>') && pay.includes('styles.successBadge'), 'a green check and a sentence-case title');
  assert.ok(pay.includes('<Text style={styles.confirmedTotal}>{formatMoney(checkout.sale?.total_amount ?? 0)}</Text>'), 'the total is the big number');
  assert.ok(pay.includes("!== 'standard' ? ("), 'the pricing program is mentioned only when it is not Standard');
  assert.ok(pay.includes('<ManagerActionButton label="Done" onPress={done} />'), 'Done still finishes the sale screen');
  const button = read('src/components/dashboard/ManagerActionButton.tsx');
  assert.ok(button.includes("variant?: 'primary' | 'secondary' | 'danger' | 'destructive';") && button.includes("backgroundColor: '#DC2626'"), 'a solid red variant');
  console.log('4. order confirmed + red button: ok');
}

console.log('alert_dialog_ui: ALL PASS');
