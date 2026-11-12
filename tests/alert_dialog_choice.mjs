// The shared confirm dialog can show a second action (instead of Cancel) and an X in the corner. Used for "Replace it / Add to it"
// in the bulk quantity sheet. Every dialog that does not ask for them must look and behave exactly as before.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { loadTs } from './_load_ts.mjs';

const require = createRequire(import.meta.url);
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const rnw = require('react-native-web');
const flat = (html) => html.replace(/<[^>]+>/g, '|').replace(/\|+/g, '|');

const store = loadTs('src/stores/alertStore.ts', { zustand: require('zustand') });
const confirmLib = loadTs('src/lib/confirmAction.ts', { '@/stores/alertStore': store });
let buttons = [];
let pressables = [];
const Dialog = loadTs('src/components/GlobalAlertModal.tsx', {
  'react-native': {
    ...rnw,
    Platform: { OS: 'ios' },
    Modal: (p) => (p.visible ? React.createElement('div', null, p.children) : null),
    Pressable: (p) => { pressables.push(p); return React.createElement('div', { 'aria-label': p.accessibilityLabel }, p.children); },
  },
  '@react-native-vector-icons/ionicons': { __esModule: true, default: (p) => React.createElement('i', { 'data-icon': p.name, 'data-color': p.color }) },
  '@/components/dashboard/ManagerActionButton': { ManagerActionButton: (p) => { buttons.push(p); return React.createElement('button', { 'data-variant': p.variant ?? 'primary' }, p.label); } },
  // a server render reads zustand's INITIAL state, so read the live state directly
  '@/stores/alertStore': { useAlertStore: (selector) => selector(store.useAlertStore.getState()) },
}).GlobalAlertModal;
const render = () => { buttons = []; pressables = []; return renderToStaticMarkup(React.createElement(Dialog)); };
const close = () => pressables.find((p) => p.accessibilityLabel === 'Close');

// 1. a standard confirm is unchanged: Cancel | Confirm, no X
{
  confirmLib.confirmAction('Log out?', 'You will need to sign in again.', () => {});
  const html = render();
  assert.match(flat(html), /Log out\?\|You will need to sign in again\.\|Cancel\|Confirm\|$/);
  assert.equal(close(), undefined, 'no X unless asked for');
  assert.deepEqual(buttons.map((b) => b.label), ['Cancel', 'Confirm']);
  assert.equal(buttons[0].variant, 'secondary');
  store.useAlertStore.getState().dismiss();
  console.log('1. standard confirm unchanged: ok');
}

// 2. Replace it / Add to it: standard look, two buttons side by side, an X, no Cancel
{
  const calls = [];
  confirmLib.confirmAction(
    'Some already have a quantity',
    '1 of the 1 selected already has a quantity. What should happen?\n- Replace it: set to 50 (Beef Bopes: 70 → 50)\n- Add to it: add 50 (Beef Bopes: 70 → 120)',
    () => calls.push('replace'),
    { confirm: 'Replace it', tone: 'info', closeButton: true, secondary: { label: 'Add to it', onPress: () => calls.push('add') } },
  );
  const html = render();
  assert.match(html, /data-icon="information"/, 'the same round icon');
  assert.match(flat(html), /Some already have a quantity\|1 of the 1 selected already has a quantity\. What should happen\?\|•\|Replace it: set to 50 \(Beef Bopes: 70 → 50\)\|•\|Add to it: add 50 \(Beef Bopes: 70 → 120\)\|Add to it\|Replace it\|$/);
  assert.deepEqual(buttons.map((b) => [b.label, b.variant ?? 'primary']), [['Add to it', 'secondary'], ['Replace it', 'primary']], 'Add to it | Replace it');
  assert.doesNotMatch(html, />Cancel</, 'no Cancel');
  assert.ok(close(), 'an X in the corner');
  assert.match(html, /data-icon="close"[^>]*data-color="#98A2B3"/, 'the same light gray as every other X');

  // Add to it: the dialog closes first, then the action runs
  buttons[0].onPress();
  assert.equal(store.useAlertStore.getState().request, null, 'closed');
  assert.deepEqual(calls, ['add']);

  // Replace it
  confirmLib.confirmAction('t', 'm', () => calls.push('replace'), { confirm: 'Replace it', closeButton: true, secondary: { label: 'Add to it', onPress: () => calls.push('add') } });
  render();
  buttons[1].onPress();
  assert.deepEqual(calls, ['add', 'replace']);
  assert.equal(store.useAlertStore.getState().request, null);

  // the X closes without doing anything
  confirmLib.confirmAction('t', 'm', () => calls.push('replace'), { confirm: 'Replace it', closeButton: true, secondary: { label: 'Add to it', onPress: () => calls.push('add') } });
  render();
  close().onPress();
  assert.equal(store.useAlertStore.getState().request, null, 'the X closes it');
  assert.deepEqual(calls, ['add', 'replace'], 'and nothing is applied');
  console.log('2. replace / add dialog with an X: ok');
}

// 3. a second action without the X, and the X without a second action, both work independently
{
  confirmLib.confirmAction('t', 'm', () => {}, { closeButton: true });
  render();
  assert.ok(close());
  assert.deepEqual(buttons.map((b) => b.label), ['Cancel', 'Confirm'], 'an X alone keeps Cancel');
  store.useAlertStore.getState().dismiss();
  confirmLib.confirmAction('t', 'm', () => {}, { secondary: { label: 'Other', onPress: () => {} } });
  render();
  assert.equal(close(), undefined);
  assert.deepEqual(buttons.map((b) => b.label), ['Other', 'Confirm']);
  store.useAlertStore.getState().dismiss();
  // notices never get an X or a second button
  confirmLib.alertNotice('Saved', 'Done.', 'success');
  render();
  assert.equal(close(), undefined);
  assert.deepEqual(buttons.map((b) => b.label), ['OK']);
  console.log('3. options are independent, notices unchanged: ok');
}
