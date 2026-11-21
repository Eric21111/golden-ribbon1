import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { loadTs } from './_load_ts.mjs';

const {
  appendReportRangeQuery,
  branchHubHref,
  branchSalesHistoryHref,
  branchRemittanceHref,
  branchWasteHref,
  branchInventoryReconciliationHref,
  branchTransferReturnIssuesHref,
  transferReturnIssuesHref,
  salesOverviewHref,
  buildBranchHubLinks,
  parseReportDateFilter,
} = loadTs('src/features/reports/branchHub.ts');

assert.equal(parseReportDateFilter('this_week'), 'this_week');
assert.equal(parseReportDateFilter('nope'), 'today');

assert.equal(
  appendReportRangeQuery('/owner/reports/x', { rangeType: 'today' }),
  '/owner/reports/x?range=today',
);
assert.equal(
  branchHubHref({ branchId: 'b1', rangeType: 'this_month' }),
  '/owner/reports/branch/b1?range=this_month',
);
assert.equal(
  branchSalesHistoryHref({ branchId: 'b1', rangeType: 'today' }),
  '/owner/reports/sales-overview/b1?range=today',
);
assert.equal(
  branchRemittanceHref({ branchId: 'b1', rangeType: 'today' }),
  '/owner/reports/shift-remittances/branch/b1?range=today',
);
assert.equal(
  branchWasteHref({ branchId: 'b1', rangeType: 'all_time' }),
  '/owner/reports/waste-history/b1?range=all_time',
);
assert.equal(
  branchInventoryReconciliationHref({ branchId: 'b1', rangeType: 'today' }),
  '/owner/reports/inventory-reconciliation?branchId=b1&range=today',
);
assert.equal(
  branchTransferReturnIssuesHref({ branchId: 'b1', rangeType: 'this_week' }),
  '/owner/reports/discrepancies?branchId=b1&range=this_week',
);
assert.equal(
  transferReturnIssuesHref({ rangeType: 'all_time' }),
  '/owner/reports/discrepancies?range=all_time',
);
assert.equal(
  salesOverviewHref({ rangeType: 'this_month' }),
  '/owner/reports/sales-overview?range=this_month',
);

const ownerLinks = buildBranchHubLinks({
  branchId: 'b1',
  rangeType: 'today',
  isMainBranch: false,
});
assert.deepEqual(
  ownerLinks.map((link) => link.id),
  ['product_sales', 'remittance'],
);
assert.match(ownerLinks[0].href, /\/owner\/reports\/product-sales\/b1\?range=today/);
assert.match(ownerLinks[1].href, /\/owner\/reports\/shift-remittances\/branch\/b1\?range=today/);
assert.doesNotMatch(readFileSync('src/features/reports/branchHub.ts', 'utf8'), /Shift History/);
assert.ok(branchSalesHistoryHref({ branchId: 'b1', rangeType: 'today' }), 'sales history deep link preserved');

const mainLinks = buildBranchHubLinks({
  branchId: 'main',
  rangeType: 'today',
  isMainBranch: true,
});
assert.equal(mainLinks.find((link) => link.id === 'product_sales')?.href, null);
assert.equal(mainLinks.find((link) => link.id === 'remittance')?.href, null);

const overview = readFileSync('src/features/reports/SalesOverviewScreen.tsx', 'utf8');
assert.match(overview, /branchHubHref/);
assert.doesNotMatch(overview, /salesByBranchHref/);
assert.match(overview, /Opens Branch Hub/);

assert.ok(existsSync('app/(owner)/owner/reports/branch/[branchId].tsx'));
assert.equal(existsSync('app/(manager)/manager/reports/branch/[branchId].tsx'), false, 'manager Branch Hub reverted');
assert.ok(existsSync('app/(owner)/owner/reports/sales-overview/[branchId].tsx'), 'sales deep link preserved');
assert.match(readFileSync('app/(owner)/owner/reports/sales-overview/[branchId].tsx', 'utf8'), /BranchSalesDetailScreen/);
assert.match(readFileSync('app/(owner)/_layout.tsx', 'utf8'), /owner\/reports\/branch\/\[branchId\]/);
assert.doesNotMatch(readFileSync('app/(manager)/_layout.tsx', 'utf8'), /manager\/reports\/branch\/\[branchId\]/);

const hubSrc = readFileSync('src/features/reports/BranchHubScreen.tsx', 'utf8');
assert.match(hubSrc, /SALES BY DAY/);
assert.match(hubSrc, /ORDERS/);
assert.match(hubSrc, /shouldShowBranchOrderLog/);
assert.match(hubSrc, /useBranchDailySales/);
assert.match(hubSrc, /useBranchSalesLog/);
assert.match(hubSrc, /DayOrdersPanel|expandedDate/);
assert.match(hubSrc, /DAY_PAGE_SIZE = 5/);
assert.match(hubSrc, /useClientPagination/);
assert.match(hubSrc, /Pagination/);
assert.doesNotMatch(hubSrc, /REPORTS/);
assert.doesNotMatch(hubSrc, /buildBranchHubLinks/);
assert.doesNotMatch(hubSrc, /Show more days/);
assert.match(hubSrc, /useOwnerSalesByBranch/);
assert.doesNotMatch(hubSrc, /useShiftRemittances/);
assert.doesNotMatch(hubSrc, /OwnerSummaryKpiPair/);
assert.doesNotMatch(hubSrc, /No remittance recorded/);
assert.match(hubSrc, /Total sales revenue/);
assert.match(hubSrc, /Transactions/);
assert.doesNotMatch(hubSrc, /role: 'manager'|role === 'manager'/);

const inventory = readFileSync('src/features/reports/InventoryReconciliationScreen.tsx', 'utf8');
assert.match(inventory, /useLocalSearchParams/);
assert.match(inventory, /firstSearchParam\(params\.branchId\)/);

const remittanceBranches = readFileSync('src/features/reports/ShiftRemittanceBranchesScreen.tsx', 'utf8');
assert.doesNotMatch(remittanceBranches, /branchHubHref/);
assert.match(remittanceBranches, /shiftRemittanceBranchHref/);
assert.match(remittanceBranches, /DateRangeFilter/);
assert.doesNotMatch(remittanceBranches, /rangeType: 'today'/);

const wasteBranches = readFileSync('src/features/reports/WasteHistoryBranchesScreen.tsx', 'utf8');
assert.doesNotMatch(wasteBranches, /branchHubHref/);
assert.match(wasteBranches, /wasteHistoryBranchHref/);

console.log('Branch Hub tests passed: owner-only hub, manager changes reverted, deep links preserved.');
