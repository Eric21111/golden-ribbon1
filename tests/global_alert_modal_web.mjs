// Source pins for the web stacking fix in GlobalAlertModal.
//
// Bug: on the web build, pressing "Close" on a Create/Edit product sheet with unsaved edits did nothing. Close calls
// confirmAction("Discard changes?"), which is rendered by GlobalAlertModal, a Modal mounted once at app start.
// react-native-web appends a Modal's DOM node when it MOUNTS (not when it becomes visible) and gives every Modal the same
// z-index, so a sheet opened later sat on top of the dialog and hid it.
//
// (Verified separately in a real DOM, jsdom + the real react-native-web Modal: with the always-mounted modal the dialog is
// below the sheet; mounted only while a request is showing it is on top.)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const modal = read('src/components/GlobalAlertModal.tsx');

// the web-only mount guard, placed after the hooks and before the Modal
assert.match(modal, /import \{ Modal, Platform, Pressable, StyleSheet, Text, View \} from 'react-native';/);
assert.match(modal, /if \(Platform\.OS === 'web' && request == null\) return null;/);
assert.ok(
  modal.indexOf("Platform.OS === 'web' && request == null") > modal.indexOf('useAlertStore((state) => state.dismiss)'),
  'the early return comes after the hooks (rules of hooks)',
);
assert.ok(modal.indexOf("Platform.OS === 'web' && request == null") < modal.indexOf('<Modal transparent'), 'and before the Modal');
// native keeps the always-mounted Modal (the app's BottomSheet notes that unmounting a visible native Modal can leave a touch blocker)
assert.match(modal, /visible=\{request != null\}/);

// the root mounts it once, and Close on both product sheets still goes through the discard confirmation
assert.match(read('app/_layout.tsx'), /<GlobalAlertModal \/>/);
const products = read('app/(manager)/manager/products/index.tsx');
assert.match(products, /onClose=\{requestCloseCreate\}/);
assert.match(products, /onClose=\{requestCloseEdit\}/);
assert.match(products, /confirmAction\(DISCARD_DIALOG\.title, DISCARD_DIALOG\.message, closeNow,/);
assert.match(read('src/components/BottomSheet.tsx'), /accessibilityLabel="Close" accessibilityRole="button" hitSlop=\{12\} onPress=\{onClose\}/);

console.log('global_alert_modal_web: ALL PASS');
