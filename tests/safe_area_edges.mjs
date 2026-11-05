// Android safe areas. Android is always edge-to-edge (Expo SDK 57), so every screen draws under the status bar, the camera
// cut-out and the navigation / gesture bar and has to pad them itself. This pins the rule and how the app applies it.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { loadTs } from './_load_ts.mjs';

const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const { resolveScreenEdges } = loadTs('src/lib/safeArea.ts');
const sorted = (list) => [...list].sort();

// ---- the rule
// no tab bar: the screen owns the bottom inset (this was the bug: edges={['top']} dropped it)
assert.deepEqual(sorted(resolveScreenEdges(['top'], false)), ['bottom', 'left', 'right', 'top']);
assert.deepEqual(sorted(resolveScreenEdges(undefined, false)), ['bottom', 'left', 'right', 'top'], 'no edges given: top is padded too');
// tab bar showing: the tab bar owns the bottom inset, so the screen never pads it again
assert.deepEqual(sorted(resolveScreenEdges(['top'], true)), ['left', 'right', 'top']);
assert.deepEqual(sorted(resolveScreenEdges(undefined, true)), ['left', 'right', 'top']);
// a caller can leave the top out, but can never switch the bottom on or off
assert.deepEqual(sorted(resolveScreenEdges([], false)), ['bottom', 'left', 'right']);
assert.deepEqual(sorted(resolveScreenEdges([], true)), ['left', 'right']);
assert.deepEqual(sorted(resolveScreenEdges(['top', 'bottom'], true)), ['left', 'right', 'top'], 'no double bottom padding under the tab bar');
assert.deepEqual(sorted(resolveScreenEdges(['bottom'], false)), ['bottom', 'left', 'right']);
for (const nav of [true, false]) {
  const edges = resolveScreenEdges(['top'], nav);
  assert.equal(new Set(edges).size, edges.length, 'never the same edge twice');
  assert.equal(edges.includes('bottom'), !nav);
}

// ---- Screen uses it
const screen = read('src/components/Screen.tsx');
assert.match(screen, /import \{ resolveScreenEdges \} from '@\/lib\/safeArea';/);
assert.match(screen, /const safeEdges = resolveScreenEdges\(edges, hasBottomNavigation\);/);
assert.doesNotMatch(screen, /edges \?\? \(hasBottomNavigation/, 'the old "edges replaces everything" default is gone');

// ---- the tab bar is the other owner of the bottom inset
const nav = read('src/components/RoleNavigation.tsx');
assert.match(nav, /<SafeAreaView\s+edges=\{\['bottom', 'left', 'right'\]\}/);

// ---- every call site
const files = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (p.endsWith('.tsx')) files.push(p);
  }
};
walk('app');
walk('src');
let screens = 0;
for (const file of files) {
  const source = read(file);
  for (const match of source.matchAll(/<Screen\b([\s\S]*?)>/g)) {
    screens++;
    const props = match[1];
    const edges = props.match(/edges=\{(\[[^\]]*\])\}/);
    if (edges) assert.doesNotMatch(edges[1], /'bottom'/, `${file}: the bottom inset is automatic, do not list it`);
  }
}
assert.ok(screens > 60, `found ${screens} Screen usages`);

// no screen pads the status bar by hand (a fixed top padding is wrong on every device with a different bar or cut-out)
for (const file of files) {
  assert.doesNotMatch(read(file), /StatusBar\.currentHeight/, `${file}: use the safe-area inset, not StatusBar.currentHeight`);
}

// ---- other places that draw their own edges
const login = read('app/(auth)/login.tsx');
assert.match(login, /edges=\{\['top', 'bottom', 'left', 'right'\]\}/);
const sheet = read('src/components/BottomSheet.tsx');
assert.match(sheet, /paddingBottom: Math\.max\(insets\.bottom, spacing\.md\)/, 'the sheet clears the navigation bar itself (a Modal is edge-to-edge too)');
assert.match(sheet, /paddingLeft: Math\.max\(insets\.left, spacing\.md\)/);
assert.match(sheet, /paddingRight: Math\.max\(insets\.right, spacing\.md\)/);
assert.match(sheet, /statusBarTranslucent/);
assert.match(read('src/components/dashboard/ManagerSidebar.tsx'), /<SafeAreaView edges=\{\['top'\]\}[\s\S]*<SafeAreaView edges=\{\['bottom'\]\}/);
assert.match(read('app/_layout.tsx'), /<SafeAreaProvider>/);

// ---- app config: edge-to-edge is mandatory in SDK 57 and must not be configured away; keyboard mode unchanged
const config = JSON.parse(read('app.json')).expo;
assert.equal(config.android.edgeToEdgeEnabled, undefined, 'edgeToEdgeEnabled is no longer available');
assert.equal(config.android.softwareKeyboardLayoutMode, 'pan');
assert.equal(config.android.predictiveBackGestureEnabled, false);

console.log(`safe_area_edges: ALL PASS (${screens} Screen usages checked)`);
