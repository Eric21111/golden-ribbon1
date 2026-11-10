import assert from 'node:assert/strict';
import React from 'react';
import { loadTs } from './_load_ts.mjs';

const effects = [];
let context;
let onAuth;
let resolveInitial;
let cleared = 0;
let cartCleared = 0;
let signOutError = null;
let pending = false;
let activeUser = null;
const activated = [];
const pushCalls = [];
const client = { clear: () => cleared++, invalidateQueries: () => Promise.resolve() };
const state = () => ({ userId: activeUser, pending, activateUser: id => { activeUser = id; activated.push(id); } });
const { AuthProvider } = loadTs('src/features/auth/AuthProvider.tsx', {
  react: { ...React, useState: initial => [initial, () => {}], useEffect: fn => effects.push(fn),
    useCallback: fn => fn, useMemo: fn => { context = fn(); return context; } },
  '@tanstack/react-query': { useQueryClient: () => client, useQuery: () => ({ data: null }) },
  '@/lib/supabase': { isSupabaseConfigured: true, supabase: { auth: {
    getSession: () => new Promise(resolve => { resolveInitial = resolve; }),
    onAuthStateChange: callback => { onAuth = callback; return { data: { subscription: { unsubscribe() {} } } }; },
    signOut: async () => { pushCalls.push('signOut'); return { error: signOutError }; },
  } } },
  '@/features/notifications/pushRegistration': {
    unregisterThisDeviceForPush: async () => { pushCalls.push('unregister'); },
    registerThisDeviceForPush: async () => { pushCalls.push('reregister'); return true; },
  },
  '@/features/notifications/pushNotifications': { clearDeliveredNotifications: async () => { pushCalls.push('clearTray'); } },
  '@/services/profileService': {},
  '@/stores/cartStore': { useCartStore: { getState: () => ({ clearCart: () => cartCleared++ }) } },
  '@/stores/checkoutStore': { useCheckoutStore: { getState: state } },
});
AuthProvider({ children: null });
const cleanup = effects[0]();
onAuth('SIGNED_IN', { user: { id: 'cashier-A' } });
assert.equal(activeUser, 'cashier-A');
assert.equal(cleared, 1); assert.equal(cartCleared, 1);
onAuth('TOKEN_REFRESHED', { user: { id: 'cashier-A' } });
assert.equal(cleared, 1, 'token refresh must not erase the current cart/query state');
resolveInitial({ data: { session: { user: { id: 'stale-initial-user' } } } });
await Promise.resolve();
assert.equal(activeUser, 'cashier-A', 'late initial lookup must not replace the current authenticated user');
onAuth('SIGNED_IN', { user: { id: 'cashier-B' } });
assert.equal(cleared, 2); assert.equal(cartCleared, 2);
assert.equal(activeUser, 'cashier-B');
pending = true;
await assert.rejects(context.signOut(), /request to finish/);
assert.equal(activeUser, 'cashier-B');
assert.deepEqual(pushCalls, [], 'blocked logout leaves push registration alone');
pending = false; signOutError = new Error('offline');
await assert.rejects(context.signOut(), /offline/);
assert.equal(activeUser, 'cashier-B', 'failed logout must not discard local session recovery');
assert.deepEqual(pushCalls, ['unregister', 'signOut', 'reregister'], 'failed logout restores this device’s push registration');
signOutError = null;
pushCalls.length = 0;
await context.signOut();
assert.equal(activeUser, null);
assert.deepEqual(pushCalls, ['unregister', 'signOut', 'clearTray'], 'device unregistered while still authenticated, tray cleared after');
assert.equal(activated.at(-1), null, 'successful logout detaches the journal instead of resetting/deleting it');
cleanup();
console.log('Auth checkout session tests passed: account switching, token refresh, stale initial lookup, and safe logout.');
