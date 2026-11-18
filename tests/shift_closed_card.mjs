// The "Shift closed for today" state on the cashier home: a centred empty/done layout (big green check, title, one line),
// Reopen POS as a secondary button that opens a bottom sheet with required Reason *, Cancel | Confirm.
// Incoming / leftover stay off the closed empty state. What reopening does is untouched.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync('app/(cashier)/cashier/dashboard.tsx', 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('<Text style={styles.closedTitle}>Shift closed for today</Text>');
const end = src.indexOf('<Text style={styles.closedTitle}>No Active Shift</Text>');
assert.ok(start > 0 && end > start);
const card = src.slice(src.lastIndexOf('{sameDayClosedHint ? (', start - 200), end);

// the head: a big green check, centred title and one line
assert.match(
  card,
  /<View style=\{styles\.closedHead\}>\n\s+<View style=\{styles\.closedBadge\}>\n\s+<Ionicons name="checkmark" size=\{32\} color="#15803D" \/>/,
);
assert.ok(card.includes('End Shift is complete. Start again next business day.'));
assert.ok(src.includes('closedEmpty:') && src.includes('closedTitle:') && src.includes("textAlign: 'center'"));

// reopen CTA stays on the empty state; the form lives in a sheet
assert.match(card, /<Text style=\{styles\.reopenQuestion\}>Need to sell more today\?<\/Text>/);
assert.match(card, /label="Reopen POS"/);
assert.doesNotMatch(card, /label="Reason"/, 'reason field is not inline on the closed empty state');
assert.ok(src.includes('ManagerBottomSheet'), 'reopen uses a bottom sheet');
assert.match(src, /title="Reopen POS"/);
assert.match(src, /label="Reason"/);
assert.match(src, /\brequired\b/);
assert.ok(src.includes("The system decides whether a new shift can start."));
assert.ok(src.includes("Reason is required.") && src.includes('Enter a reason of at least 8 characters.'));
assert.match(src, /label="Cancel"/);
assert.match(src, /label="Confirm"/);
assert.ok(src.includes("closedActions: { flexDirection: 'row', gap: 10 },") && src.includes('closedAction: { flex: 1 },'));

// Incoming / Branch inventory / leftover sit off both no-shift empty states
assert.doesNotMatch(card, /Branch inventory|incomingTile|leftoverReturnTile/, 'closed empty state stays action-free');
const noShift = src.slice(end, src.indexOf('>Active Shift</Text>'));
assert.doesNotMatch(noShift, /label="Branch inventory"|Incoming shipments/, 'pre-shift empty state matches closed: Start shift only');
assert.ok(src.includes('title="Branch inventory"'), 'Branch inventory remains on the active-shift home');

assert.equal((src.match(/title="Leftover return"/g) || []).length, 1);
assert.match(
  src,
  /icon="return-down-back-outline"[\s\S]{0,80}title="Leftover return"[\s\S]{0,80}router\.push\('\/cashier\/returns\/create'\)/,
);
const activeShift = src.slice(src.indexOf('>Active Shift</Text>'));
assert.equal((activeShift.match(/leftoverReturnTile/g) || []).length, 1);

assert.ok(src.includes('const submitReopen = () => {') && src.includes('const closeReopenSheet = () => {'));
console.log('shift_closed_card: ALL PASS');
