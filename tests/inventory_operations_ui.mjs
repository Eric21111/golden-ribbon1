import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadTs } from './_load_ts.mjs';

const recon = loadTs('src/features/reports/inventoryReconOverview.ts');
const issues = loadTs('src/features/reports/discrepancyOverview.ts');

const sm1 = { id: 'sm1', name: 'SM1', is_main_branch: false, is_active: true };
const main = { id: 'main', name: 'Main', is_main_branch: true, is_active: true };

const items = [
  {
    branch_id: 'sm1',
    branch_name: 'SM1',
    variance: 0,
    transfer_missing_qty: 0,
    transfer_excess_qty: 0,
    return_missing_qty: 0,
    return_excess_qty: 0,
  },
  {
    branch_id: 'sm1',
    branch_name: 'SM1',
    variance: 2,
    transfer_missing_qty: 0,
    transfer_excess_qty: 0,
    return_missing_qty: 0,
    return_excess_qty: 0,
  },
  {
    branch_id: 'main',
    branch_name: 'Main',
    variance: 0,
    transfer_missing_qty: 1,
    transfer_excess_qty: 0,
    return_missing_qty: 0,
    return_excess_qty: 0,
  },
];

assert.deepEqual(recon.summarizeInventoryRecon(items), {
  itemCount: 3,
  balancedCount: 1,
  issueCount: 2,
});

const cleared = {
  variance: 0,
  transfer_missing_qty: 0,
  transfer_excess_qty: 0,
  return_missing_qty: 0,
  return_excess_qty: 0,
};
const resolvedReturn = {
  kind: 'return',
  id: 'rd1',
  discrepancy_type: 'missing',
  difference: 2,
  resolution_reason: 'confirmed_shortage',
  resolution_note: 'confirmed missing',
  resolved_at: '2026-11-21T04:00:00Z',
  resolved_by_name: 'Main Manager',
};
assert.deepEqual(recon.reconciliationItemBadge(cleared), { label: 'Balanced', tone: 'success' });
assert.deepEqual(recon.reconciliationItemBadge({ ...cleared, variance: -3 }), { label: 'Stock mismatch', tone: 'danger' });
assert.deepEqual(recon.reconciliationItemBadge({ ...cleared, return_missing_qty: 2 }), {
  label: 'Return issue',
  tone: 'warning',
});
assert.deepEqual(recon.reconciliationItemBadge({ ...cleared, transfer_excess_qty: 1 }), {
  label: 'Transfer issue',
  tone: 'warning',
});
assert.deepEqual(recon.reconciliationItemBadge({ ...cleared, resolved_discrepancies: [resolvedReturn] }), {
  label: 'Resolved',
  tone: 'success',
});
assert.equal(
  recon.reconItemHasIssue({ ...cleared, resolved_discrepancies: [resolvedReturn] }),
  false,
  'resolved with a reason is not an open issue',
);
assert.deepEqual(
  recon.reconciliationItemBadge({
    ...cleared,
    return_missing_qty: 2,
    resolved_discrepancies: [resolvedReturn],
  }),
  { label: 'Return issue', tone: 'warning' },
  'open return qty stays an issue even with a prior resolution',
);
assert.equal(
  recon.reconCompactReasonLine({ ...cleared, resolved_discrepancies: [resolvedReturn] }),
  'Return · Confirmed shortage',
);
assert.equal(
  recon.reconOpenStatusLine({ ...cleared, return_missing_qty: 2 }),
  'Return · 2 missing',
);
assert.equal(
  recon.reconOpenStatusLine({ ...cleared, resolved_discrepancies: [resolvedReturn] }),
  null,
  'resolved-only products have no open status line',
);
assert.equal(
  recon.reconResolvedStatusLine({ ...cleared, resolved_discrepancies: [resolvedReturn] }),
  'Return · Confirmed shortage · confirmed missing',
);
assert.equal(
  recon.reconResolvedStatusLine({
    ...cleared,
    resolved_discrepancies: [{ ...resolvedReturn, resolution_note: null }],
  }),
  'Return · Confirmed shortage',
);
assert.equal(
  recon.reconCollapsedStatusLine({ ...cleared, return_missing_qty: 2 }),
  'Return · 2 missing',
);
assert.equal(
  recon.reconCollapsedStatusLine({ ...cleared, resolved_discrepancies: [resolvedReturn] }),
  'Return · Confirmed shortage',
);
assert.equal(
  recon.reconCollapsedStatusLine({
    ...cleared,
    return_missing_qty: 2,
    resolved_discrepancies: [resolvedReturn],
  }),
  'Return · 2 missing',
  'open count issue is the collapsed line, not the resolved reason',
);
assert.equal(
  recon.reconResolvedStatusLine({
    ...cleared,
    return_missing_qty: 2,
    resolved_discrepancies: [resolvedReturn],
  }),
  'Return · Confirmed shortage · confirmed missing',
  'resolved reason stays available beside an open issue',
);
assert.deepEqual(
  recon.reconNonZeroMovementLines({
    opening_stock: 0,
    transfer_in: 1121,
    transfer_out: 0,
    sale: 56,
    return_in: 0,
    return_out: 2,
    adjustment: -1061,
  }),
  [
    { label: 'Received transfer', quantity: 1121, era: 'live' },
    { label: 'Sales', quantity: -56, era: 'live' },
    { label: 'Returned leftover', quantity: -2, era: 'live' },
    { label: 'Adjustments', quantity: -1061, era: 'live' },
  ],
);
assert.deepEqual(recon.reconResolvedRowDetail(resolvedReturn), {
  title: 'Return · Confirmed shortage',
  meta: 'Main Manager · confirmed missing',
});

const reconRows = recon.buildInventoryReconBranchRows(items, [sm1, main]);
assert.deepEqual(
  reconRows.map((row) => ({ id: row.branchId, items: row.itemCount, issues: row.issueCount, main: row.isMain })),
  [
    { id: 'sm1', items: 2, issues: 1, main: false },
    { id: 'main', items: 1, issues: 1, main: true },
  ],
);
assert.equal(
  recon.inventoryReconBranchHref({ branchId: 'sm1', rangeType: 'all_time' }),
  '/owner/reports/inventory-reconciliation?branchId=sm1&range=all_time',
);
assert.equal(recon.inventoryReconIssueBadge(reconRows[0]).label, '1 issue');

const transfers = [
  { branch_id: 'sm1', branch_name: 'SM1', difference: -4, status: 'open' },
  { branch_id: 'sm1', branch_name: 'SM1', difference: 2, status: 'resolved' },
];
const returns = [
  { branch_id: 'sm1', branch_name: 'SM1', difference: -3, status: 'resolved' },
  { branch_id: 'sm2', branch_name: 'SM2', difference: 5, status: 'open' },
];
assert.deepEqual(issues.summarizeIssueRecords(transfers, returns), {
  totalUnits: 14,
  transferUnits: 6,
  returnUnits: 8,
  openCount: 2,
  resolvedCount: 2,
  recordCount: 4,
});

const issueRows = issues.buildIssueBranchRows(transfers, returns, [
  sm1,
  { id: 'sm2', name: 'SM2', is_main_branch: false, is_active: true },
  main,
]);
assert.equal(issues.issueBranchBadge(issueRows.find((row) => row.branchId === 'sm1')).label, '1 open');
assert.equal(issues.issueBranchBadge(issueRows.find((row) => row.branchId === 'main')).label, '—');

const reconSrc = readFileSync('src/features/reports/InventoryReconciliationScreen.tsx', 'utf8');
assert.match(reconSrc, /firstSearchParam\(params\.branchId\)/);
assert.match(reconSrc, /router\.(push|replace)/);
assert.match(readFileSync('src/features/reports/inventoryReconOverview.ts', 'utf8'), /Return received/);
assert.match(reconSrc, /title=\{title\} subtitle=\{subtitle\}/);
assert.doesNotMatch(reconSrc, /FilterDropdown/);
assert.doesNotMatch(reconSrc, /COMPANY TOTALS|BRANCH TOTALS/);
assert.doesNotMatch(reconSrc, /Return issues/);
assert.doesNotMatch(reconSrc, /setSelectedBranchId/);
assert.match(reconSrc, /useFocusEffect/);
assert.match(reconSrc, /reconOpenStatusLine/);
assert.match(reconSrc, /resolvedDiscrepancySummary\(item\)/);
assert.match(reconSrc, /ManagerBottomSheet/);
assert.match(reconSrc, /reconNonZeroMovementLines/);
assert.match(reconSrc, /label="Ledger"/);
assert.doesNotMatch(reconSrc, /OPEN COUNT ISSUES/);
assert.doesNotMatch(reconSrc, /chevron-down|chevron-up/);
assert.match(reconSrc, /reconciliationItemBadge/);
assert.match(reconSrc, /statusResolved/);
assert.doesNotMatch(reconSrc, /Count differences stay listed even when stock totals match/);

const issuesSrc = readFileSync('app/(owner)/owner/reports/discrepancies/index.tsx', 'utf8');
assert.match(issuesSrc, /DateRangeFilter/);
assert.match(issuesSrc, /kpiTotals\.openCount/);
assert.match(issuesSrc, /title=\{title\} subtitle=\{subtitle\}/);
assert.doesNotMatch(issuesSrc, /FilterDropdown/);
assert.doesNotMatch(issuesSrc, /COMPANY TOTALS|BRANCH TOTALS/);
assert.doesNotMatch(issuesSrc, /Shift Remittances/);
assert.doesNotMatch(issuesSrc, /useShiftRemittances/);
assert.doesNotMatch(issuesSrc, /value: 'remittance'/);
assert.doesNotMatch(issuesSrc, /Stock count changes/);

const wasteHub = readFileSync('src/features/reports/WasteHistoryBranchesScreen.tsx', 'utf8');
assert.match(wasteHub, /DateRangeFilter/);
assert.match(wasteHub, /Waste occurrences/);
assert.doesNotMatch(wasteHub, /COMPANY TOTALS|BRANCH TOTALS/);
assert.doesNotMatch(wasteHub, /Total waste quantity/);

console.log('inventory_operations_ui: ALL PASS');
