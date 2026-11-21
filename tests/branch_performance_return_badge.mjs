import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

assert.match(readFileSync('app/(owner)/owner/reports/index.tsx', 'utf8'), /title="Branch Operations"/);
assert.match(readFileSync('src/components/dashboard/ManagerSidebar.tsx', 'utf8'), /label: 'Branch operations'/);

const source = readFileSync('src/features/reports/BranchPerformanceScreens.tsx', 'utf8');
assert.match(source, /fallback: DateFilterType/);
assert.match(source, /'all_time'/);
assert.doesNotMatch(source, /useState<DateFilterType>\('today'\)/);
assert.doesNotMatch(source, /All Time is the default/);
assert.doesNotMatch(source, /DISCREPANCY_UNITS_CAPTION|including resolved/);
assert.doesNotMatch(source, /ARCHIVE_SALES_NOTE|Live receipts for archived days|showOlderReturnHint|None in this range|does not create one/);
assert.doesNotMatch(source, /Issue qty counts missing|After archive cleanup/);
assert.doesNotMatch(source, /CASH REMITTANCE|PRODUCTS SOLD|STOCK SNAPSHOT|CURRENT INVENTORY|RECENT STOCK TRANSFERS|RECENT STOCK RETURNS|DISCREPANCY DETAILS|Open full branch report/);
assert.doesNotMatch(source, /formatLiveStock|modeLookupReady|RankProgressRow|ManagerActionButton|OwnerSummaryKpiPair/);
assert.match(source, /COMPANY OPERATIONS/);
assert.match(source, /Completed sales/);
assert.match(source, /Discrepancy units/);
assert.match(source, /Transfer & Return Issues/);
assert.match(source, /Product Sales/);
assert.match(source, /Branch Operations/);
assert.doesNotMatch(source, /Open issue|Completed transactions|Issue qty/);

const tile = readFileSync('src/components/dashboard/StatTile.tsx', 'utf8');
assert.match(tile, /tileCompact: \{ minHeight: 140 \}/);
assert.match(tile, /growForCopy && !isWide && styles.contentWrap/);

console.log('Branch Operations tests passed: All Time default, compact ops scorecard, no remittance/product/inventory duplicates.');
