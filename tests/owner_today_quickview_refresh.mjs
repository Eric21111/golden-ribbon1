import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { mock } from 'node:test';
import { pathToFileURL } from 'node:url';

// Runs the real useManilaDayRefresh with minimal stand-ins for react (effects run once, immediately)
// and react-native (an AppState the test can drive), under mocked timers and clock.
const stubs = {
  react: `
    export const useRef = (value) => ({ current: value });
    const cleanups = [];
    export const useEffect = (effect) => { const cleanup = effect(); if (cleanup) cleanups.push(cleanup); };
    export const unmountAll = () => { while (cleanups.length) cleanups.pop()(); };
  `,
  'react-native': `
    const listeners = new Set();
    export const AppState = {
      currentState: 'active',
      addEventListener(type, listener) {
        listeners.add(listener);
        return { remove: () => listeners.delete(listener) };
      },
      emit(state) { this.currentState = state; for (const l of [...listeners]) l(state); },
      listenerCount: () => listeners.size,
    };
  `,
};
const srcRoot = pathToFileURL(`${process.cwd()}/src/`).href;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier in stubs) {
      return { url: `data:text/javascript,${encodeURIComponent(stubs[specifier])}`, shortCircuit: true };
    }
    if (specifier.startsWith('@/')) {
      return { url: `${srcRoot}${specifier.slice(2)}.ts`, shortCircuit: true };
    }
    return next(specifier, context);
  },
});

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
// 23:58 Manila on 2026-11-08.
mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-11-08T15:58:00Z') });

const { useManilaDayRefresh } = await import('../src/hooks/useManilaDayRefresh.ts');
const { unmountAll } = await import('react');
const { AppState } = await import('react-native');

let calls = 0;
useManilaDayRefresh(() => {
  calls += 1;
});
assert.equal(calls, 0, 'no refresh on mount');

mock.timers.tick(MIN);
assert.equal(calls, 0, '23:59 Manila: same day');

mock.timers.tick(MIN + 1000);
assert.equal(calls, 1, 'refreshes once just after Manila midnight');

mock.timers.tick(12 * HOUR);
assert.equal(calls, 1, 'no extra refresh during the day');

mock.timers.tick(12 * HOUR);
assert.equal(calls, 2, 'refreshes again at the next Manila midnight');

AppState.emit('background');
assert.equal(calls, 2, 'going to background does not refresh');
AppState.emit('active');
assert.equal(calls, 3, 'returning to foreground refreshes');
AppState.emit('active');
assert.equal(calls, 3, 'repeated active events without leaving do not refresh again');

// Rollover while in background: the timer may not run, the foreground event catches it.
AppState.emit('background');
AppState.emit('inactive');
AppState.emit('active');
assert.equal(calls, 4, 'inactive -> active (e.g. iOS app switcher) refreshes');

unmountAll();
assert.equal(AppState.listenerCount(), 0, 'AppState listener removed on unmount');
mock.timers.tick(48 * HOUR);
AppState.emit('background');
AppState.emit('active');
assert.equal(calls, 4, 'no refresh after unmount');

mock.timers.reset();
console.log('Owner Today Quickview refresh tests passed: Manila midnight rollover, foreground refresh, cleanup.');
