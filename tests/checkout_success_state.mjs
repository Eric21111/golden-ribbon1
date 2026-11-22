// Order Summary: once the sale is confirmed, the retry state is over. A sale that succeeds on a RETRY used to leave the screen
// behind the "Order confirmed" pop-up still saying "Saved checkout" with a "Retry" button and the old "still unverified" message,
// because the saved request stays in the store until Done clears it. This pins the store (no duplicate send, error cleared, Done and
// View sale clean up) and the screen (everything behind the pop-up is keyed on "request without sale").
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { loadTs } from './_load_ts.mjs';

const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const user = '10000000-0000-4000-8000-000000000001';
const request = {
  shiftId: '20000000-0000-4000-8000-000000000001',
  key: 'sale-original-request-123',
  amountPaid: '760.50',
  paymentMethod: 'gcash',
  pricingProgram: 'pwd',
  items: [{ product_id: '30000000-0000-4000-8000-000000000001', variant_id: null, quantity: 9 }],
};
const sale = { id: '40000000-0000-4000-8000-000000000001', shift_id: request.shiftId, sale_number: 'SALE-0000000276', total_amount: 760.5, payment_method: 'gcash', pricing_program: 'pwd' };

const disk = new Map();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: { getItem: (k) => disk.get(k) ?? null, setItem: (k, v) => void disk.set(k, v), removeItem: (k) => void disk.delete(k) },
});
const key = `golden-ribbon-checkout-v1:${user}`;
const sent = [];
let outcome = async () => sale;
const boot = () =>
  loadTs('src/stores/checkoutStore.ts', {
    'expo-sqlite/localStorage/install': {},
    '@/services/saleService': { confirmSale: async (attempt) => { sent.push(attempt); return outcome(attempt); } },
  }).useCheckoutStore;

// ---- 1. the sale is confirmed on a retry
let store = boot();
store.getState().activateUser(user);
outcome = async () => { throw new Error('response lost after commit'); };
await store.getState().submit(request);
assert.ok(store.getState().request && !store.getState().sale, 'unknown outcome: a saved request, no sale');
assert.match(store.getState().error, /could not be verified|unverified|awaiting/i, 'and the screen says so (this is the retry state)');

outcome = async () => sale;
await store.getState().submit(store.getState().request);
assert.equal(store.getState().sale?.sale_number, 'SALE-0000000276');
assert.equal(store.getState().error, '', 'a confirmed sale clears the "still unverified" message');
assert.ok(store.getState().request, 'the request stays until Done (it is what Done clears)');
assert.equal(sent.length, 2);
assert.equal(sent[0].key, sent[1].key, 'the retry reuses the same idempotency key, so the server returns the same sale');

// ---- 2. nothing can be sent again once the sale is confirmed (no second sale, payment or stock deduction)
await store.getState().submit(store.getState().request);
await store.getState().submit({ ...request, key: 'a-brand-new-key-000000' });
assert.equal(sent.length, 2, 'submit does nothing while a confirmed sale is on screen');

// ---- 3. Done clears the saved checkout; the next sale starts clean
assert.equal(store.getState().reset(), true);
assert.equal(disk.has(key), false, 'the saved checkout is removed from the device');
assert.deepEqual([store.getState().request, store.getState().sale, store.getState().error], [null, null, '']);

// ---- 4. closing the app on the confirmation: the saved sale comes back without the retry message
outcome = async () => sale;
await store.getState().submit(request);
assert.ok(store.getState().sale);
store = boot();
store.getState().activateUser(user);
assert.ok(store.getState().sale, 'the confirmed sale is restored');
assert.equal(store.getState().error, '', 'with no "awaiting confirmation" message');
store.getState().reset();

// ---- 5. the screen: what shows behind the confirmation, and the confirmation itself
const screen = read('app/(cashier)/cashier/payment.tsx');
assert.match(screen, /const awaitingRetry = Boolean\(checkout\.request\) && !checkout\.sale;/);
assert.match(screen, /\{awaitingRetry && checkout\.request \? \(\s*<View>\s*<Text style=\{styles\.cardLine\}>Saved checkout/, '"Saved checkout" only while a retry is waiting');
assert.match(screen, /label=\{awaitingRetry \? 'Retry' : 'Checkout'\}/, '"Retry" only while a retry is waiting');
assert.match(screen, /disabled=\{checkout\.pending \|\| awaitingRetry\}/, 'Back is held only while a retry is waiting');
assert.match(screen, /const canConfirm = !checkout\.sale && /, 'the footer button is off once the sale is confirmed');
assert.match(screen, /const runSubmit = \(\) => \{\s*if \(checkout\.pending \|\| stockChecking \|\| checkout\.sale\) return;/, 'no submit after a confirmed sale');
assert.match(screen, /const submit = \(\) => \{\s*if \(checkout\.pending \|\| stockChecking \|\| checkout\.sale\) return;/);
assert.match(screen, /\{!checkout\.sale && \(validation \|\| checkout\.error\) \? \(/, 'no error text behind the confirmation');
assert.match(screen, /\{awaitingRetry && checkout\.error && !checkout\.pending \? \(/);
// the confirmation shows the saved sale record, not whatever is selected on the screen now
assert.match(screen, /const confirmedProgram = checkout\.sale\?\.pricing_program \?\? checkout\.request\?\.pricingProgram \?\? 'standard';/);
assert.match(screen, /formatMoney\(checkout\.sale\?\.total_amount \?\? 0\)/);
assert.match(screen, /label: 'Payment', value: paymentLabel\(checkout\.sale\?\.payment_method\)/);
assert.match(screen, /label: 'Pricing', value: pricingProgramLabel\(confirmedProgram\)/);
assert.match(screen, /label: 'Sale', value: checkout\.sale\?\.sale_number/);
// layout: the details in the shared SummaryCard, the two buttons side by side with a gap
assert.match(screen, /<SummaryCard\s+rows=/);
assert.match(screen, /confirmedAction: \{ alignSelf: 'stretch', flexDirection: 'row', gap: 10/);
// View sale and Done: the sale id is read before the store is cleared, and nothing navigates if clearing failed
assert.match(screen, /const saleId = checkout\.sale\?\.id;\s*if \(!checkout\.reset\(\)\) return;/);
assert.match(screen, /router\.replace\(viewSale && saleId \? `\/cashier\/sales\/\$\{saleId\}` : '\/cashier\/pos'\)/);

// ---- 6. the server: a retry with the same key returns the sale that exists, before anything is deducted
const migration = read('supabase/migrations/20261111155918_cashier_item_voids.sql');
const lookup = migration.indexOf('and idempotency_key = p_idempotency_key;');
assert.ok(lookup > 0, 'confirm_sale looks the key up first');
assert.ok(lookup < migration.indexOf('perform public.lock_branch_inventory_gate(v_branch);'), '... before it locks or deducts stock');
assert.match(migration.slice(lookup, lookup + 600), /return v_sale;/, 'and returns the existing sale');
assert.match(read('supabase/migrations/20260906110100_milestone_4_sales.sql'), /unique\(cashier_id, idempotency_key\)/, 'one sale per cashier per key');

console.log('Checkout success state passed: retry state ends with the sale, no duplicate send, Done / View sale, confirmation matches the saved sale.');
