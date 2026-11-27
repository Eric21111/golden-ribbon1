import assert from 'node:assert/strict';
import { loadTs } from './_load_ts.mjs';

const { getShiftErrorMessage } = loadTs('src/lib/errors.ts');
for (const [message, expected] of [
  ['invalid input syntax for type bigint: "3.000"', /apply the remittance update/],
  ['Piece quantities must be whole numbers until half-step stock ops are enabled.', /Half quantities are not enabled/],
  ['Invalid waste quantity.', /Review the waste quantities/],
  ['Waste exceeds available stock.', /Waste exceeds the available stock/],
  ['Selected stock cannot be returned.', /review your selection/],
  ['Product outside this shift.', /review your selection/],
  ['Shift already closed with different details.', /already been submitted/],
]) {
  assert.match(getShiftErrorMessage({ message }), expected);
}
assert.doesNotMatch(getShiftErrorMessage({message:'internal database detail: private_table'}), /private_table/);
console.log('Remittance error messages passed.');
