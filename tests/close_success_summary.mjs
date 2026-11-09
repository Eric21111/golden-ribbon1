// The message in the "End Shift Complete" dialog: the cash, ONE line for the inventory, and only the products that did not match, by
// name. It used to repeat the title, say "Inventory:" on its own line, print "17 exact / 0 shortage / 0 excess" on three lines and list
// every product (even the exact ones, even without a name). Pure function, plus how the dialog shows it.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadTs } from './_load_ts.mjs';

const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const { formatCloseSuccessSummary: summary } = loadTs('src/features/shifts/closeDisplay.ts');
const { parseAlertMessage } = loadTs('src/lib/alertMessage.ts');

const row = (id, result, discrepancy, expected = 5) => ({ product_id: id, result, discrepancy, expected_remaining: expected, actual_remaining: expected + discrepancy, waste_quantity: 0, unsold_quantity: 0, carried_quantity: 0 });
const result = (cash, products, difference = 0) => ({ shift_id: 's', expected_cash: 100, actual_cash: 100 - difference, difference, result: cash, status: 'reconciled', products });
const names = { a: 'Beef Curry', b: 'Egg', c: 'Rice' };

// ---------------------------------------------------------------- everything matched: two short lines, no list
{
  const all = Array.from({ length: 17 }, (_, i) => row(`p${i}`, 'exact', 0));
  assert.equal(summary(result('exact', all), names), 'Cash: Exact\nInventory: all 17 products exact', 'the screenshot case: 17 exact products used to be 22 lines');
  assert.equal(summary(result('exact', [row('a', 'exact', 0)]), names), 'Cash: Exact\nInventory: all 1 product exact');
  assert.equal(summary(result('exact', []), names), 'Cash: Exact', 'a cash-only shift');
  assert.equal(summary(result('exact', undefined), names), 'Cash: Exact');
  // the old noise is gone
  assert.doesNotMatch(summary(result('exact', all), names), /End Shift Complete|expected remaining|difference 0|0 shortage|0 excess|Product:/);
  console.log('1. all exact: ok');
}

// ---------------------------------------------------------------- something is off: only those, with names
{
  const text = summary(result('shortage', [row('a', 'shortage', -2), row('b', 'exact', 0), row('c', 'excess', 3), row('d', 'exact', 0)], 15), names);
  assert.equal(text, 'Cash: ₱15.00 shortage\nInventory: 2 exact · 1 shortage · 1 excess\n- Beef Curry: 2 short\n- Rice: 3 over');
  assert.doesNotMatch(text, /Egg/, 'a product that matched is not listed');
  // a missing name falls back, it never prints "undefined"
  assert.match(summary(result('exact', [row('zzz', 'shortage', -1)]), names), /- Product: 1 short/);
  // a lot of mismatches: the first few, then a count
  const many = Array.from({ length: 11 }, (_, i) => row(`m${i}`, 'shortage', -1));
  const long = summary(result('exact', many), {}).split('\n');
  assert.equal(long.length, 2 + 8 + 1, 'cash, inventory, 8 products, "and 3 more"');
  assert.equal(long.at(-1), '…and 3 more');
  // the server's totals still add up in the inventory line
  assert.match(summary(result('exact', [row('a', 'shortage', -1), row('b', 'shortage', -1)]), names), /Inventory: 2 shortage$/m, 'no "0 exact" noise');
  console.log('2. mismatches: ok');
}

// ---------------------------------------------------------------- how the dialog shows it
{
  const blocks = parseAlertMessage(summary(result('shortage', [row('a', 'shortage', -2), row('c', 'excess', 3), row('b', 'exact', 0)], 15), names));
  assert.deepEqual(blocks.map((b) => b.type), ['text', 'text', 'bullet', 'bullet'], 'two lines, then a bullet per product that is off');
  assert.deepEqual(blocks.slice(2).map((b) => b.text), ['Beef Curry: 2 short', 'Rice: 3 over']);
  // all exact: no bullets, so the dialog centres it under the check mark
  assert.ok(parseAlertMessage(summary(result('exact', [row('a', 'exact', 0)]), names)).every((b) => b.type === 'text'));

  const dash = read('app/(cashier)/cashier/dashboard.tsx');
  assert.ok(dash.includes('(closePreview?.products ?? pendingShift.data?.products ?? [])'), 'the names come from the shift that was remitted, also a pending one (that is why products showed as "Product")');
  assert.ok(dash.includes("alertNotice('End Shift Complete', formatCloseSuccessSummary(result, names), 'success');"));
  console.log('3. dialog: ok');
}

console.log('close_success_summary: ALL PASS');
