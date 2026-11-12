// The quantity box in the steppers (Opening stock, Send stock, Receive return, Create return / Local purchase) grows with what is
// typed, so a number of up to 6 digits (999999) is never cut off by a fixed width. Short numbers keep today's width.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadTs } from './_load_ts.mjs';

const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const { quantityBoxWidth: width, PIECE_QUANTITY_MAX_LENGTH } = loadTs('src/lib/format.ts');

const screens = [
  { file: 'src/features/inventory/InventorySetupScreen.tsx', min: 48, fontSize: 18, value: 'quantity.value' },
  { file: 'src/features/transfers/CreateTransferScreen.tsx', min: 40, fontSize: 17, value: 'quantity.value' },
  { file: 'src/features/returns/ReceiveReturnScreen.tsx', min: 40, fontSize: 15, value: 'quantity.value' },
  { file: 'src/features/stock/QuantityListScreen.tsx', min: 48, fontSize: 18, value: 'raw' },
];
assert.equal(PIECE_QUANTITY_MAX_LENGTH, 6, 'the largest quantity is 6 digits');

for (const { min, fontSize } of screens) {
  const opts = { min, fontSize };
  // short numbers keep the existing width
  assert.equal(width('', opts), min, 'empty (placeholder 0)');
  assert.equal(width('5', opts), min);
  assert.equal(width('25', opts), min);
  // never narrower than before, and never shrinks as digits are added
  let previous = 0;
  for (let digits = 1; digits <= 6; digits++) {
    const w = width('9'.repeat(digits), opts);
    assert.ok(w >= min, `${digits} digits: not narrower than ${min}`);
    assert.ok(w >= previous, `${digits} digits: grows or stays, never shrinks`);
    // room for the digits themselves (a bold digit is at most ~0.66em), plus the two 1px borders
    assert.ok(w >= digits * fontSize * 0.66 + 2, `${digits} digits at ${fontSize}px fit in ${w}px`);
    previous = w;
  }
  assert.ok(width('9999', opts) > min || min >= 56, '4 digits (1000+) get a wider box than the fixed one');
  assert.ok(width('999999', opts) <= 90, 'and it stays reasonable at the 6-digit maximum');
}
assert.equal(width(undefined, { min: 48, fontSize: 18 }), 48);
assert.equal(width(null, { min: 48, fontSize: 18 }), 48);
// the case from the screenshot: 1000 was cut off at 40-48px
assert.ok(width('1000', { min: 48, fontSize: 18 }) >= 4 * 18 * 0.66 + 2);
assert.ok(width('1000', { min: 40, fontSize: 17 }) > 40);

// every screen with this stepper uses it, on the box's own text size and current minimum
for (const { file, min, fontSize, value } of screens) {
  const src = read(file);
  assert.match(src, /quantityBoxWidth/, `${file} imports the helper`);
  assert.ok(src.includes(`width: quantityBoxWidth(${value}, { min: ${min}, fontSize: ${fontSize} })`), `${file} sizes the number box from what is typed`);
}
// the shift-close count box already fills its field (flex: 1), so it needs nothing
assert.match(read('src/features/shifts/CashierShiftCloseForm.tsx'), /stepperInput: \{\n\s+flex: 1,/);

console.log('Quantity box width passed: grows with the digits up to 6, short numbers unchanged, all four stepper screens use it.');
