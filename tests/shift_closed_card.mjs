// The "Shift closed for today" card on the cashier home: a centred "done" layout (big green check, title, one line), Reopen POS as a
// quiet "Need to sell more today? Reopen POS" link, the caveat only once Reopen is chosen, Cancel | Confirm in the form, and no
// Incoming shipments tile inside the card (the Incoming tab opens it). Source checks (the dashboard needs the router, stores and
// queries to mount); what reopening does is untouched.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync('app/(cashier)/cashier/dashboard.tsx', 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('<Text style={styles.closedTitle}>Shift closed for today</Text>');
const end = src.indexOf('<Text style={styles.noticeTitle}>No Active Shift</Text>');
assert.ok(start > 0 && end > start);
const card = src.slice(src.lastIndexOf('<>', start), end);

// the head: a big green check, centred title and one line
assert.match(card, /<View style=\{styles\.closedHead\}>\n\s+<View style=\{styles\.closedBadge\}>\n\s+<Ionicons name="checkmark" size=\{30\} color="#15803D" \/>/);
assert.ok(card.includes('End Shift is complete. Start again next business day.'));
assert.ok(src.includes("closedHead: { alignItems: 'center', gap: 8, paddingTop: 4 },") && src.includes("closedTitle:") && src.includes("textAlign: 'center'"));
assert.doesNotMatch(card, /Reopen POS only if you still need to sell today|The server decides|Today&apos;s End Shift is complete/, 'the old paragraph is gone');

// reopen: a quiet link under a divider, not a button
const closedBranch = card.slice(card.indexOf(': ('), card.length);
assert.match(card, /<Text style=\{styles\.reopenQuestion\}>Need to sell more today\?<\/Text>\n\s+<Pressable\n\s+accessibilityRole="button"[^]*?<Text style=\{styles\.reopenLink\}>Reopen POS<\/Text>/);
assert.doesNotMatch(card, /label="Reopen POS"/, 'no full-width button for an exception');
assert.ok(src.includes('reopenRow: {') && src.includes("borderTopWidth: 1,"), 'separated by a divider');

// the caveat is only in the reopen form, never on the card by default
const form = card.slice(card.indexOf('{reopenOpen ? ('), card.indexOf(') : ('));
assert.ok(form.includes('The system decides whether a new shift can start.'), 'shown once Reopen is chosen (still no promise that POS can reopen)');
const idleCard = card.slice(card.indexOf(') : ('));
assert.doesNotMatch(idleCard, /remittance stays as recorded|decides whether/, 'not on the idle card');
assert.doesNotMatch(card, /remittance stays as recorded/);

// the form: Reason, then Cancel | Confirm side by side
assert.match(card, /label="Reason"/);
assert.match(card, /<View style=\{styles\.closedActions\}>\n\s+<View style=\{styles\.closedAction\}>\n\s+<ManagerActionButton\n\s+label="Cancel"\n\s+variant="secondary"/);
assert.match(card, /<ManagerActionButton label="Confirm" loading=\{reopenBusy\} disabled=\{reopenBusy\} onPress=\{submitReopen\} \/>/);
assert.ok(src.includes("closedActions: { flexDirection: 'row', gap: 10 },") && src.includes('closedAction: { flex: 1 },'));

// Incoming shipments is not repeated inside the closed card; the "No Active Shift" card is as it was
assert.ok(src.includes('{showIncomingTile && !sameDayClosedHint ? ('), 'the tile stays on No Active Shift, and not on the closed card');
assert.ok(src.includes("import { Pressable, StyleSheet, Text, View } from 'react-native';"));

// The existing Leftover return tile, unchanged, also sits under a completed close. Not on No Active Shift, and not on the pending remittance form.
assert.equal((src.match(/title="Leftover return"/g) || []).length, 1);
assert.match(src, /icon="return-down-back-outline"[\s\S]{0,80}title="Leftover return"[\s\S]{0,80}router\.push\('\/cashier\/returns\/create'\)/);
assert.match(src, /\{sameDayClosedHint \? <Row>\{leftoverReturnTile\}<\/Row> : null\}/);
const noShiftBranch = src.slice(
  src.indexOf('<Text style={styles.noticeTitle}>No Active Shift</Text>'),
  src.indexOf('{showIncomingTile && !sameDayClosedHint ? ('),
);
assert.doesNotMatch(noShiftBranch, /leftoverReturnTile/);
const pendingStart = src.indexOf('if (pendingPreview &&');
const pendingEnd = src.indexOf('Checking active shift');
assert.ok(pendingStart > 0 && pendingEnd > pendingStart);
assert.doesNotMatch(src.slice(pendingStart, pendingEnd), /leftoverReturnTile/);
const activeShift = src.slice(src.indexOf('>Active Shift</Text>'));
assert.equal((activeShift.match(/leftoverReturnTile/g) || []).length, 1);

// what reopening does is unchanged
assert.ok(src.includes('const submitReopen = () => {') && card.includes("setReopenError('');") && card.includes('setReopenOpen(true);'));
console.log('shift_closed_card: ALL PASS');
