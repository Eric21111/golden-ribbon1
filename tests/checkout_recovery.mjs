import assert from 'node:assert/strict';
import { loadTs } from './_load_ts.mjs';

const user = '10000000-0000-4000-8000-000000000001';
const other = '10000000-0000-4000-8000-000000000002';
const request = { shiftId: '20000000-0000-4000-8000-000000000001', key: 'sale-original-request-123', amountPaid: '25.00', pricingProgram: 'standard',
  items: [{ product_id: '30000000-0000-4000-8000-000000000001', variant_id: null, quantity: 1 }] };
const sale = { id: '40000000-0000-4000-8000-000000000001', shift_id: request.shiftId, sale_number: 'SALE-1', total_amount: 25 };
const disk = new Map();
let failWrite = false;
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: key => disk.get(key) ?? null,
  setItem: (key, value) => { if (failWrite) throw new Error('disk full'); disk.set(key, value); },
  removeItem: key => { if (failWrite) throw new Error('disk full'); disk.delete(key); },
} });
const key = `golden-ribbon-checkout-v1:${user}`;
let callCount = 0;
let handler = async () => sale;
const boot = () => loadTs('src/stores/checkoutStore.ts', {
  'expo-sqlite/localStorage/install': {},
  '@/services/saleService': { confirmSale: async attempt => {
    callCount++;
    assert.deepEqual(JSON.parse(disk.get(`golden-ribbon-checkout-v1:${store.getState().userId}`)).request, attempt,
      'request must be durable before sending');
    return handler(attempt);
  } },
}).useCheckoutStore;
let store = boot();
store.getState().activateUser(user);

// A lost response after commit, followed by process death and retry with an edited cart.
handler = async () => { throw new Error('response lost after commit'); };
await store.getState().submit(request);
assert.equal(store.getState().reset(), false, 'unknown outcomes cannot be discarded');
store = boot();
store.getState().activateUser(user);
assert.equal(store.getState().pending, false, 'in-flight state is never restored');
assert.deepEqual(store.getState().request, request);
handler = async attempt => { assert.deepEqual(attempt, request); return sale; };
await store.getState().submit({ ...request, key: 'different-key-must-not-be-used' });
assert.equal(store.getState().sale.id, sale.id);
await store.getState().submit(request);
assert.equal(callCount, 2, 'confirmed sale cannot be submitted again');

// Confirmed receipt survives restart; only explicitly completing it clears the journal.
store = boot(); store.getState().activateUser(user);
assert.equal(store.getState().sale.id, sale.id);
assert.equal(store.getState().reset(), true);
assert.equal(disk.has(key), false);

// Synchronous duplicate taps send exactly one RPC.
let resolve;
handler = () => new Promise(r => { resolve = r; });
const inFlight = store.getState().submit(request);
await store.getState().submit(request);
assert.equal(callCount, 3);
resolve(sale); await inFlight;
store.getState().reset();

// Storage failure prevents sending; no new key is needed to retry after a response loss.
failWrite = true;
await store.getState().submit(request);
assert.equal(callCount, 3);
assert.equal(store.getState().request, null);
failWrite = false;
handler = async () => { failWrite = true; return sale; };
await store.getState().submit(request);
assert.equal(store.getState().reset(), false, 'failed acknowledgement preserves recovery');
failWrite = false;
store = boot(); store.getState().activateUser(user);
assert.deepEqual(store.getState().request, request);
assert.equal(store.getState().sale, null, 'original journal recovers when saving success failed');

// Another account never inherits or deletes this account's checkout.
store.getState().activateUser(null);
assert.equal(store.getState().request, null);
assert.equal(disk.has(key), true, 'sign out detaches but does not discard unresolved checkout');
store.getState().activateUser(other);
assert.equal(store.getState().request, null);
assert.equal(disk.has(key), true);
store.getState().activateUser(user);
assert.deepEqual(store.getState().request, request);
handler = async () => { throw { code: '42501', message: 'account deactivated after original request' }; };
await store.getState().submit(request);
assert.deepEqual(store.getState().request, request, 'a later refusal cannot disprove the original commit');
assert.equal(disk.has(key), true);

// A first, definitive refusal can release the order safely.
disk.clear(); store = boot(); store.getState().activateUser(user);
await store.getState().submit(request);
assert.equal(store.getState().request, null);
assert.equal(disk.has(key), false);

// Corrupt recovery must block new sales, never overwrite potential committed history.
disk.set(key, '{broken'); store = boot(); store.getState().activateUser(user);
const before = callCount;
await store.getState().submit(request);
assert.equal(callCount, before);
assert.equal(store.getState().recoveryError, true);
assert.equal(disk.get(key), '{broken');
console.log('Checkout recovery passed: durable keys, restart, duplicate taps, storage failure, account isolation, and uncertain outcomes.');
