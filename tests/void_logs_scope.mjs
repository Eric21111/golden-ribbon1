import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadTs } from './_load_ts.mjs';

const {
  scopeVoidLogRows,
  summarizeVoidLogs,
  voidLogsInRange,
  voidLogTimeBounds,
  voidLogsBranchMeta,
  voidLogsBranchHref,
  buildVoidLogBranchRows,
} = loadTs('src/features/reports/voidLogs.ts');

const rows = [
  { event_id: '1', branch_name: 'SM1', product_name: 'Cake' },
  { event_id: '2', branch_name: 'SM2', product_name: 'Tea' },
];

assert.deepEqual(
  scopeVoidLogRows(rows, {}).rows.map((row) => row.event_id),
  ['1', '2'],
  'company view keeps every void',
);

const waiting = scopeVoidLogRows(rows, { branchId: 'b1', branchLookupPending: true });
assert.equal(waiting.waitingForBranch, true);
assert.deepEqual(waiting.rows, [], 'do not show unfiltered voids while the branch name is loading');
assert.equal(waiting.branchMissing, false);

const missing = scopeVoidLogRows(rows, { branchId: 'b1', branchLookupPending: false });
assert.equal(missing.branchMissing, true);
assert.deepEqual(missing.rows, [], 'unknown branch is empty, not company-wide');

const scoped = scopeVoidLogRows(rows, { branchId: 'b1', branchName: 'SM1' });
assert.deepEqual(scoped.rows.map((row) => row.event_id), ['1']);
assert.equal(scoped.waitingForBranch, false);

const source = readFileSync('src/features/reports/VoidLogsScreen.tsx', 'utf8');
assert.match(source, /scopeVoidLogRows/);
assert.match(source, /subtitle=\{`\$\{row\.quantity\} voided · \$\{row\.cashier_name\}`\}/);
assert.match(source, /reasonText\(row\)/);
assert.doesNotMatch(source, /VOID_LOGS_ARCHIVE_NOTE|Export Data Archive|cleaned archive periods/);
assert.doesNotMatch(source, /if \(!branchName\) return data/);

const route = readFileSync('app/(owner)/owner/reports/void-logs/[branchId].tsx', 'utf8');
assert.match(route, /branchLookupPending/);
assert.match(route, /initialRangeType/);

const voidRow = (overrides) => ({
  event_id: 'e1',
  recorded_at: '2026-11-20T04:00:00.000Z',
  sale_number: 'SALE-1',
  product_name: 'Cake',
  variant_name: null,
  product_category: null,
  branch_name: 'SM1',
  cashier_name: 'Ana',
  quantity: 2,
  amount: 100.1,
  reason: 'wrong item',
  note: null,
  ...overrides,
});

{
  const twoItemsOneSale = summarizeVoidLogs([
    voidRow({ event_id: 'a', quantity: 2, amount: 100.1, sale_number: 'SALE-1' }),
    voidRow({ event_id: 'b', quantity: 1, amount: 50.2, sale_number: 'SALE-1' }),
  ]);
  assert.deepEqual(twoItemsOneSale, { items: 3, amount: 150.3, transactions: 1 });
  assert.equal(voidLogsBranchMeta(1, 1), '1 voided item · 1 transaction');
  assert.equal(voidLogsBranchMeta(12, 5), '12 voided items · 5 transactions');
  assert.equal(
    voidLogsBranchHref({ branchId: 'b-sm1', rangeType: 'this_week' }),
    '/owner/reports/void-logs/b-sm1?range=this_week',
  );
}

{
  const bounds = voidLogTimeBounds({ start: '2026-11-20T00:00:00+08:00', end: '2026-11-21T00:00:00+08:00' });
  const inRange = voidLogsInRange(
    [
      voidRow({ event_id: 'in', recorded_at: '2026-11-20T04:00:00.000Z' }),
      voidRow({ event_id: 'out', recorded_at: '2026-11-19T04:00:00.000Z' }),
    ],
    bounds,
  );
  assert.deepEqual(inRange.map((row) => row.event_id), ['in']);
}

{
  const built = buildVoidLogBranchRows(
    [
      { id: 'b-sm1', name: 'SM1', is_active: true, is_main_branch: false },
      { id: 'b-sm2', name: 'SM2', is_active: true, is_main_branch: false },
      { id: 'b-main', name: 'Main', is_active: true, is_main_branch: true },
    ],
    [
      voidRow({ branch_name: 'SM1', sale_number: 'S1', quantity: 2, amount: 80 }),
      voidRow({ event_id: 'e2', branch_name: 'SM1', sale_number: 'S1', quantity: 1, amount: 20 }),
      voidRow({ event_id: 'e3', branch_name: 'SM2', sale_number: 'S2', quantity: 4, amount: 200 }),
    ],
  );
  assert.deepEqual(
    built.map((row) => ({ name: row.branchName, items: row.items, amount: row.amount, tx: row.transactions, id: row.branchId })),
    [
      { name: 'SM2', items: 4, amount: 200, tx: 1, id: 'b-sm2' },
      { name: 'SM1', items: 3, amount: 100, tx: 1, id: 'b-sm1' },
    ],
  );
  assert.equal(built.some((row) => row.branchName === 'Main'), false, 'main branch is not a selling void card');
}

const overview = readFileSync('src/features/reports/VoidLogsOverviewScreen.tsx', 'utf8');
assert.doesNotMatch(overview, /COMPANY TOTALS|BRANCH TOTALS/);
assert.match(overview, /Total voided items/);
assert.match(overview, /Total amount deducted/);
assert.match(overview, /Void transactions/);
assert.doesNotMatch(overview, /VOID_LOGS_SCOPE_NOTE|Item-level voids only/);
assert.match(overview, /voidLogsBranchHref/);
assert.doesNotMatch(overview, /RankProgressRow|SellingBranchesHubScreen/);
assert.match(readFileSync('app/(owner)/owner/reports/void-logs/index.tsx', 'utf8'), /VoidLogsOverviewScreen/);

console.log('Void logs scope tests passed: branch load gate, row qty/cashier/reason, company totals from existing rows.');
