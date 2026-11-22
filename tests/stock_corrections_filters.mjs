// Stock corrections (Owner / Main Branch Manager): branch, date and product filters, pull to refresh, and honest paging.
// The server function lists corrections 50 at a time by offset only; it cannot filter. So filters are applied on the loaded corrections,
// and the screen says how far it searched. Frontend only: no RPC, migration or calculation changed.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { loadTs } from './_load_ts.mjs';

const require = createRequire(import.meta.url);
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const rnw = require('react-native-web');
const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const flat = (html) => html.replace(/<[^>]+>/g, '|').replace(/\|+/g, '|');

const row = (n, over = {}) => ({
  id: `c${n}`, created_at: '2026-11-11T07:20:00Z', product_name: `Product ${n}`, stock_unit_code: null, branch_name: 'SM 1', cashier_name: 'Maria',
  details: { before: 5, after: 8, reason: 'Physical recount', shift_id: 's1' }, ...over,
});

// ---------------------------------------------------------------- 1. the filter rules
const m = loadTs('src/features/reports/stockCorrectionFilters.ts');
const rows = [
  row(1, { product_name: 'Egg', branch_name: 'SM 1', created_at: '2026-11-11T07:20:00Z' }),         // Nov 11, 3:20 PM Manila
  row(2, { product_name: 'Beef Curry', branch_name: 'SM 2', created_at: '2026-11-10T20:00:00Z' }),  // Nov 11, 4:00 AM Manila
  row(3, { product_name: 'Egg White', branch_name: 'SM 2', created_at: '2026-11-09T10:00:00Z' }),   // Nov 9, 6:00 PM Manila
  row(4, { product_name: 'Rice', branch_name: 'SM 1', created_at: 'not a date' }),
];
const none = m.NO_CORRECTION_FILTERS;
const ids = (list) => list.map((r) => r.id);
assert.deepEqual(ids(m.filterCorrections(rows, none)), ['c1', 'c2', 'c3', 'c4'], 'no filter: everything, even a row with an odd date');
assert.equal(m.hasCorrectionFilters(none), false);
// product
assert.deepEqual(ids(m.filterCorrections(rows, { ...none, search: 'egg' })), ['c1', 'c3'], 'case-insensitive, part of the name');
assert.deepEqual(ids(m.filterCorrections(rows, { ...none, search: '  EGG  ' })), ['c1', 'c3'], 'spaces around are ignored');
assert.deepEqual(ids(m.filterCorrections(rows, { ...none, search: 'zzz' })), []);
assert.deepEqual(ids(m.filterCorrections(rows, { ...none, search: 'maria' })), [], 'product search only: it does not match the cashier');
// branch
assert.deepEqual(ids(m.filterCorrections(rows, { ...none, branch: 'SM 2' })), ['c2', 'c3']);
assert.deepEqual(ids(m.filterCorrections(rows, { ...none, branch: 'Nowhere' })), []);
// dates (Manila days, end exclusive)
const day = (start, end) => ({ ...none, rangeType: 'custom', customStart: start, customEnd: end });
assert.deepEqual(ids(m.filterCorrections(rows, day('2026-11-11', '2026-11-11'))), ['c1', 'c2'], 'Nov 11 in Manila time includes the 4:00 AM one (still Nov 10 in UTC)');
assert.deepEqual(ids(m.filterCorrections(rows, day('2026-11-09', '2026-11-10'))), ['c3']);
assert.deepEqual(ids(m.filterCorrections(rows, day('2026-11-09', '2026-11-11'))), ['c1', 'c2', 'c3'], 'a range');
assert.deepEqual(ids(m.filterCorrections(rows, day('2026-11-12', '2026-11-20'))), []);
assert.equal(m.correctionDateWindow(day('2026-11-11', '2026-11-10')), null, 'end before start narrows nothing');
assert.equal(m.correctionDateWindow({ ...none, rangeType: 'custom', customStart: '2026-11-11', customEnd: '' }), null, 'an incomplete custom range narrows nothing');
assert.equal(m.hasCorrectionFilters({ ...none, rangeType: 'custom', customStart: '2026-11-11', customEnd: '' }), false, 'and is not "filtering" (no scan)');
assert.equal(m.hasCorrectionFilters(day('2026-11-11', '2026-11-11')), true);
for (const rangeType of ['today', 'this_week', 'this_month']) {
  const window = m.correctionDateWindow({ ...none, rangeType });
  assert.ok(window && window.end > window.start, `${rangeType} is a real window`);
  assert.equal(m.hasCorrectionFilters({ ...none, rangeType }), true);
}
const nowRow = row(9, { created_at: new Date().toISOString() });
assert.deepEqual(ids(m.filterCorrections([nowRow, rows[2]], { ...none, rangeType: 'today' })), ['c9'], 'Today keeps only today');
// combined, and never mutates
const copy = JSON.stringify(rows);
assert.deepEqual(ids(m.filterCorrections(rows, { ...none, search: 'egg', branch: 'SM 2', ...day('2026-11-09', '2026-11-09') })), ['c3'], 'all filters at once');
assert.equal(JSON.stringify(rows), copy, 'the list is never changed');

// ---------------------------------------------------------------- 3. loading enough of the history to filter it
const page = (start, n) => Array.from({ length: n }, (_, i) => row(start + i));
let calls = [];
let scan = await m.scanCorrections(async (offset) => { calls.push(offset); return offset === 0 ? page(0, 50) : offset === 50 ? page(50, 20) : []; });
assert.deepEqual(calls, [0, 50], 'asks for page after page, and stops at the first short page');
assert.equal(scan.rows.length, 70);
assert.equal(scan.complete, true, 'every correction was loaded');
calls = [];
scan = await m.scanCorrections(async (offset) => { calls.push(offset); return page(offset, 50); }, 3);
assert.deepEqual(calls, [0, 50, 100], 'never more than the cap');
assert.equal(scan.rows.length, 150);
assert.equal(scan.complete, false, 'older corrections exist but were not loaded: it says so');
assert.equal(m.SCAN_MAX_ROWS, 500);
assert.equal((await m.scanCorrections(async () => [])).complete, true, 'nothing recorded: complete, empty');
// a correction made while loading shifts the next page by one: the same row twice is kept once
scan = await m.scanCorrections(async (offset) => (offset === 0 ? page(0, 50) : [row(49), ...page(50, 10)]));
assert.equal(scan.rows.length, 60, 'no duplicate');
assert.deepEqual(new Set(scan.rows.map((r) => r.id)).size, 60);
// a failure is a failure (not a short list)
await assert.rejects(m.scanCorrections(async (offset) => { if (offset > 0) throw new Error('offline'); return page(0, 50); }), /offline/);
assert.equal((await m.scanCorrections(async () => null)).complete, true, 'a null page is treated as empty');

// ---------------------------------------------------------------- 4. what the screen says about its limits
assert.deepEqual(m.correctionEmptyState({ filtering: false, page: 0 }), { title: 'No stock corrections yet', message: 'Recounts and stock added by cashiers will appear here.' });
assert.equal(m.correctionEmptyState({ filtering: false, page: 2 }).title, 'No more corrections');
assert.equal(m.correctionEmptyState({ filtering: true, page: 0, complete: true }).title, 'No matching corrections');
assert.match(m.correctionEmptyState({ filtering: true, page: 0, complete: true }).message, /Try another branch, dates or product/);
assert.match(m.correctionEmptyState({ filtering: true, page: 0, complete: false }).message, /Older corrections are not searched/, 'a partial search never claims "nothing exists"');

// ---------------------------------------------------------------- 5. how to get there, and what is left alone
// (the All branches overview and the branch history are tested in stock_corrections_overview.mjs)
const owner = read('app/(owner)/owner/reports/index.tsx');
assert.match(owner, /title="Stock corrections"\s+onPress=\{\(\) => router\.push\('\/owner\/reports\/stock-count-changes' as never\)\}/, 'the owner tile opens the overview');
for (const file of [
  'app/(owner)/owner/reports/stock-count-changes/index.tsx', 'app/(owner)/owner/reports/stock-count-changes/[branchId].tsx',
  'app/(manager)/manager/reports/stock-count-changes/index.tsx', 'app/(manager)/manager/reports/stock-count-changes/[branchId].tsx',
]) assert.ok(existsSync(file), file);
assert.ok(!existsSync('app/(owner)/owner/reports/stock-count-changes.tsx'), 'the old single-file route is now a folder (same URL)');
assert.match(read('app/(manager)/_layout.tsx'), /manager\/reports\/stock-count-changes\/index/);
const sidebar = read('src/components/dashboard/ManagerSidebar.tsx');
assert.match(sidebar, /label: 'Stock corrections',\n\s+href: '\/manager\/reports\/stock-count-changes'/, 'the Main Manager sidebar');
assert.match(sidebar, /label: 'Stock corrections', href: '\/owner\/reports\/stock-count-changes'/, 'the owner sidebar');
assert.doesNotMatch(sidebar, /label: 'Stock correction'[^s]/, 'one name everywhere');
// Void logs keep their routes and their screen
assert.match(sidebar, /label: 'Void logs',\n\s+href: '\/manager\/reports\/stock-corrections'/, 'Void logs: same label, same route');
for (const file of ['app/(manager)/manager/reports/stock-corrections.tsx', 'app/(cashier)/cashier/stock-corrections.tsx']) {
  assert.match(read(file), /VoidLogsScreen/, `${file} still shows Void logs`);
}
assert.match(read('app/(owner)/owner/reports/stock-corrections/index.tsx'), /void-logs/, 'the old owner links still redirect to Void logs');
assert.match(read('app/(owner)/owner/reports/stock-corrections/[branchId].tsx'), /void-logs/);
assert.match(read('app/(manager)/manager/dashboard.tsx'), /title="Void logs"[\s\S]{0,120}\/manager\/reports\/stock-corrections/, 'the manager dashboard Void logs tile is untouched');
assert.match(read('app/(cashier)/cashier/inventory.tsx'), /label="Void logs"[\s\S]{0,120}\/cashier\/stock-corrections/, 'the cashier Void logs button is untouched');
// frontend only
assert.doesNotMatch(read('src/features/reports/stockCorrectionFilters.ts'), /supabase|\.rpc\(|from\('/, 'the filter rules touch no backend');
assert.match(read('src/services/stockCorrectionService.ts'), /rpc\('list_stock_count_corrections', \{ p_offset: offset \}\)/, 'the service (and the RPC call) is unchanged');
const screenCode = read('src/features/reports/StockCorrectionsScreen.tsx').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
assert.doesNotMatch(screenCode, /Inventory Reconciliation|Void logs|void_/i, 'on screen it is not Void logs and not Inventory Reconciliation');

console.log('Stock corrections filters passed: filter rules, the 500-correction limit stated, routes, Void logs untouched.');
