import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadTs } from './_load_ts.mjs';

const user = '10000000-0000-4000-8000-000000000001';
const product = '20000000-0000-4000-8000-000000000001';
const returnId = '30000000-0000-4000-8000-000000000001';
const disk = new Map();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: key => disk.get(key) ?? null, setItem: (key, value) => disk.set(key, value), removeItem: key => disk.delete(key),
} });
const boot = () => loadTs('src/stores/returnStore.ts', { 'expo-sqlite/localStorage/install': {} }).useReturnStore;
let store = boot();
let stateIndex = 0;
let reviewProps;
let doneProps;
let entered = true;
let handler;
let calls = 0;
const invalidations = [];
const useStore = Object.assign(selector => selector(store.getState()), { getState: () => store.getState() });
const { default: CreateReturnScreen } = loadTs('app/(cashier)/cashier/returns/create.tsx', {
  react: { ...React, useState: initial => {
    const index = stateIndex++;
    return [index === 1 ? (entered ? { [product]: '2' } : {}) : index === 2 ? entered : initial, () => {}];
  } },
  '@tanstack/react-query': { useQuery: () => ({ refetch: () => Promise.resolve(), data: [{ product_id: product, product_name: 'Meal', product_sku: 'M', quantity_on_hand: 4 }] }),
    useQueryClient: () => ({ invalidateQueries: ({ queryKey }) => { invalidations.push(queryKey); return Promise.resolve(); } }) },
  'expo-router': { router: { replace() {} } },
  '@/features/auth/AuthProvider': { useAuth: () => ({ profile: { id: user, branch_id: product, branch: { name: 'Booth' } } }) },
  '@/features/stock/QuantityListScreen': { QuantityListScreen: () => null },
  '@/features/stock/QuantityReviewScreens': {
    QuantityReviewScreen: props => { reviewProps = props; return React.createElement('div', null, props.title); },
    QuantityDoneScreen: props => { doneProps = props; return React.createElement('div', null, props.heading); },
  },
  '@/services/inventoryService': {},
  '@/services/returnService': { createStockReturn: async request => {
    calls++;
    const persisted = JSON.parse(disk.get('golden-ribbon-pending-returns')).state.byUser[user];
    assert.deepEqual(persisted.request, request, 'return must be saved before the network write');
    return handler(request);
  } },
  '@/stores/returnStore': { useReturnStore: useStore },
});
const render = () => { stateIndex = 0; return renderToStaticMarkup(React.createElement(CreateReturnScreen)); };
const settle = () => new Promise(resolve => setImmediate(resolve));

let resolve;
handler = () => new Promise(r => { resolve = r; });
render(); reviewProps.onConfirm(); reviewProps.onConfirm();
assert.equal(calls, 1, 'double tap is locked synchronously');
resolve(returnId); await settle();
assert.equal(store.getState().byUser[user].id, returnId);
assert.match(render(), /In transit to Main Branch/);
assert.ok(invalidations.some(key => key[0] === 'stock-returns'));
doneProps.onDone(); assert.equal(store.getState().byUser[user], undefined);

handler = async () => { throw new Error('response lost'); };
render(); reviewProps.onConfirm(); await settle();
const original = store.getState().byUser[user].request;
store = boot(); entered = false;
render();
assert.equal(reviewProps.confirmLabel, 'Retry');
assert.equal(reviewProps.canEdit, false);
assert.equal(reviewProps.lines[0].quantity, 2);
handler = async request => { assert.deepEqual(request, original); throw { code: '42501' }; };
reviewProps.onConfirm(); await settle();
assert.deepEqual(store.getState().byUser[user].request, original, 'later refusal must not erase an uncertain return');
handler = async request => { assert.deepEqual(request, original); return returnId; };
render(); reviewProps.onConfirm(); await settle();
assert.equal(store.getState().byUser[user].id, returnId);
assert.match(render(), /In transit to Main Branch/);
assert.equal(doneProps.lines[0].quantity, 2, 'recovered return still displays the saved quantities');
doneProps.onDone();

// A frozen first attempt is a definitive rejection, not an unknown commit.
entered = true;
handler = async () => { throw { code: '55000', message: 'Branch inventory is frozen after final close' }; };
render(); reviewProps.onConfirm(); await settle();
assert.equal(store.getState().byUser[user], undefined);
console.log('Return UI passed: duplicate taps, durable retry after restart, original quantities/key, uncertain refusal, and first-attempt freeze.');
