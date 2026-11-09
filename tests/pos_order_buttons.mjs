// POS order: the order sheet (phone) and the order pane (tablet) end with two buttons side by side, "Clear" (light) and "Confirm"
// (dark), instead of two stacked full-width buttons with a sentence between them. Clear opens a confirmation pop-up first (phone and tablet).
// Real renders of both components; what Confirm and Clear DO (the callbacks) is not touched.
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
  '@/lib/confirmAction': { confirmAction() {} },
  'react-native': rnw,
  '@react-native-vector-icons/ionicons': { __esModule: true, default: () => null },
  '@/components/dashboard/ManagerActionButton': { ManagerActionButton: (p) => React.createElement('button', { disabled: p.disabled, 'data-variant': p.variant ?? 'primary' }, p.label) },
  '@/components/dashboard/ManagerBottomSheet': { ManagerBottomSheet: (p) => React.createElement('section', null, p.children) },
  './PosOrderLine': { OrderLine: (p) => React.createElement('div', null, `LINE:${p.label}`) },
};
const line = { product_id: 'p', variant_id: null, product_name: 'Beef Curry', variant_name: null, quantity: 70, unit_price: 25, drink_product_id: null, drink_name: null };
const props = {
  visible: true, items: [line], stockByProductId: new Map([['p', 100]]), onIncrease() {}, onDecrease() {}, onQuantityChange() {}, onClear() {}, onConfirm() {}, onClose() {}, onCheckout() {},
};

// ---------------------------------------------------------------- 1. the phone's sheet
{
  const { PosViewOrderSheet } = loadTs('src/features/pos/PosViewOrderSheet.tsx', stubs);
  const html = renderToStaticMarkup(React.createElement(PosViewOrderSheet, props));
  const text = flat(html);
  assert.match(text, /70 items\|₱1,750\.00\|Clear\|Confirm\|$/, 'total, then Clear and Confirm, in that order (Clear on the left)');
  assert.match(html, /data-variant="secondary"[^>]*>Clear</, 'Clear is the light button');
  assert.match(html, /data-variant="primary"[^>]*>Confirm</, 'Confirm is the dark one');
  assert.doesNotMatch(text, /Clear order|Nothing is sold|removes every product|Confirm Order/, 'no sentence, no long labels');
  // empty order: nothing to clear, Confirm is off
  const empty = renderToStaticMarkup(React.createElement(PosViewOrderSheet, { ...props, items: [] }));
  assert.doesNotMatch(empty, />Clear</);
  assert.match(empty, /disabled=""[^>]*>Confirm</);

  const src = read('src/features/pos/PosViewOrderSheet.tsx');
  assert.ok(src.includes("actions: { flexDirection: 'row', gap: 10 },") && src.includes('action: { flex: 1 },'), 'two equal columns');
  // Clear is ONE tap on the phone: no "tap again" step, so no armed state to keep or reset
  // Clear is one tap that opens the "Clear order?" pop-up (the same app-wide dialog as the tablet's); only its Clear button empties
  // the order, so a stray tap cannot lose the order. No "tap again" button state.
  assert.match(src, /label="Clear"\n\s+variant="secondary"\n\s+onPress=\{\(\) => confirmAction\('Clear order\?', 'Remove every product from this order\.', onClear, \{ confirm: 'Clear', tone: 'danger' \}\)\}/);
  assert.doesNotMatch(src, /confirmClear|Tap to clear|setConfirmClear|useState|useEffect/, 'no two-step button state');
  assert.ok(src.includes("import { confirmAction } from '@/lib/confirmAction';"));
  assert.ok(!src.includes('onPress={onClear}'), 'the button never clears directly');
  // the dialog is the shared one: what its buttons do
  const dialog = read('src/components/GlobalAlertModal.tsx');
  assert.ok(dialog.includes("if (current?.kind === 'confirm') current.onConfirm();"), 'only the confirm button runs the action');
  assert.ok(src.includes('onPress={onConfirm}'));
  console.log('1. order sheet: ok');
}

// ---------------------------------------------------------------- 2. the tablet's pane
{
  const { PosOrderPane } = loadTs('src/features/pos/PosOrderPane.tsx', { ...stubs, '@/lib/confirmAction': { confirmAction() {} } });
  const html = renderToStaticMarkup(React.createElement(PosOrderPane, props));
  assert.match(flat(html), /70 items\|₱1,750\.00\|Clear\|Confirm\|$/);
  assert.match(html, /data-variant="secondary"[^>]*>Clear</);
  assert.doesNotMatch(flat(html), /Clear order|Confirm Order/);
  const src = read('src/features/pos/PosOrderPane.tsx');
  assert.ok(src.includes('onPress={onCheckout}'), 'Confirm still goes to checkout');
  assert.ok(src.includes("'Clear order?',") && src.includes('onClear,'), 'Clear still asks first');
  console.log('2. order pane: ok');
}

console.log('pos_order_buttons: ALL PASS');
