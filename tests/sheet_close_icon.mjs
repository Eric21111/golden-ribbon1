// Every bottom sheet closes with an X in the header instead of the word "Close". One shared header (BottomSheet), used by all the
// sheets, so this is a source check: the icon, the colour it takes, and that it still closes the same way and is still announced
// as "Close". (A Modal cannot be rendered outside a device, so there is no rendered check.)
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const sheet = read('src/components/BottomSheet.tsx');
const managerSheet = read('src/components/dashboard/ManagerBottomSheet.tsx');

// ---------------------------------------------------------------- 1. the header
assert.ok(sheet.includes("import Ionicons from '@react-native-vector-icons/ionicons';"));
assert.match(sheet, /<Pressable accessibilityLabel="Close" accessibilityRole="button" hitSlop=\{12\} onPress=\{onClose\}>\n\s+<Ionicons name="close" size=\{26\} color=\{CLOSE_ICON_COLOR\} \/>\n\s+<\/Pressable>/, 'an X, same button: still labelled "Close" for screen readers, same tap area, same action');
assert.doesNotMatch(sheet, /<Text style=\{\[styles\.close, closeLabelStyle\]\}>Close<\/Text>/, 'the word is gone');
// one light gray for every sheet: no per-sheet or per-theme colour for the X any more
assert.ok(sheet.includes("const CLOSE_ICON_COLOR = '#98A2B3';"), 'light gray');
assert.doesNotMatch(sheet + managerSheet, /closeLabelStyle|closeColor|styles\.close\b/, 'the old word-styling and per-sheet colour are gone');
assert.doesNotMatch(managerSheet, /royalBlue/, 'the manager wrapper no longer colours the close');
console.log('1. header: ok');

// ---------------------------------------------------------------- 2. nowhere else shows the word as a button
const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? walk(path) : /\.tsx$/.test(name) ? [path] : [];
});
const offenders = [...walk('src'), ...walk('app')].filter((file) => />Close<\/Text>|label="Close"/.test(read(file)));
assert.deepEqual(offenders, [], 'no other "Close" text button');
console.log('2. no leftover "Close" word: ok');

console.log('sheet_close_icon: ALL PASS');
