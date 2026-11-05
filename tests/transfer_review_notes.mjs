// Send stock -> Review transfer: the optional note is written on the review screen (not on the long list), and the review's two
// buttons sit side by side with short labels: Back to edit | Confirm. Source checks: the screen needs a router and a form to mount.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync('src/features/transfers/CreateTransferScreen.tsx', 'utf8').replace(/\r\n/g, '\n');
const at = (needle) => {
  const i = src.indexOf(needle);
  assert.ok(i >= 0, `missing: ${needle}`);
  return i;
};
const reviewStart = at('if (review) {');
const reviewEnd = at('<ManagerScreenHeader title="Send stock" showBack />');
const review = src.slice(reviewStart, reviewEnd);
const edit = src.slice(reviewEnd);

// ---------------------------------------------------------------- 1. the note moved
assert.equal(src.split('label="Notes (optional)"').length - 1, 1, 'one Notes field on the whole screen');
assert.ok(review.includes('label="Notes (optional)"'), 'it is on the review screen');
assert.ok(!edit.includes('Notes (optional)') && !edit.includes('name="notes"'), 'and no longer under the list of products');
// it sits after the product cards, before the error, inside the scrolling part (so the keyboard cannot cover the buttons)
assert.ok(review.indexOf('selectedItems.map(') < review.indexOf('name="notes"'));
assert.ok(review.indexOf('name="notes"') < review.indexOf('</ScrollView>'));
assert.ok(review.indexOf('name="notes"') < review.indexOf('mutation.error'));
// what is typed there is what is sent (read from the form at the moment of Confirm, not from the snapshot taken before the review)
assert.ok(review.includes("notes: getValues('notes')?.trim() || null,"));
assert.doesNotMatch(src, /review\.notes/, 'the old read-only "Notes: ..." line and the stale snapshot are gone');
// the form still owns the value, so going Back to edit and returning to the review keeps what was typed
assert.ok(src.includes('notes: z.string().max(1000).optional(),'));
assert.doesNotMatch(src, /shouldUnregister/);
console.log('1. notes on the review: ok');

// ---------------------------------------------------------------- 2. two columns
const footer = review.slice(review.indexOf('<View style={styles.footer}>'));
assert.match(footer, /<View style=\{styles\.footerButtonRow\}>\n\s+<View style=\{styles\.footerButton\}>\n\s+<ManagerActionButton\n\s+label="Back to edit"\n\s+variant="secondary"/, 'Back to edit first, light blue');
assert.match(footer, /<View style=\{styles\.footerButton\}>\n\s+<ManagerActionButton\n\s+label="Confirm"\n\s+icon="checkmark-circle-outline"/, 'Confirm second');
assert.doesNotMatch(src, /Confirm and send/, 'the long label is gone');
assert.ok(src.includes("footerButtonRow: { flexDirection: 'row', gap: 10 },") && src.includes('footerButton: { flex: 1 },'), 'two equal columns');
// nothing about the send changed
assert.ok(footer.includes('selectedItems.some((item) => item.quantity > item.quantity_on_hand)'), 'still blocked while a quantity exceeds what Main has');
assert.ok(footer.includes('loading={mutation.isPending}') && footer.includes('disabled={mutation.isPending}'), 'busy states');
assert.ok(footer.includes('idempotencyKey: requestKey.current,') && footer.includes("router.replace({ pathname: '/manager/transfers/[id]', params: { id } } as never);"), 'same request key and same destination after sending');
assert.ok(footer.includes("requestKey.current = makeIdempotencyKey('send');\n                    setReview(null);"), 'Back to edit still starts a fresh request key');
console.log('2. two-column buttons: ok');

console.log('transfer_review_notes: ALL PASS');
