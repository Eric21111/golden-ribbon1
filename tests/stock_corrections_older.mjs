// Regression: corrections OLDER than the newest 500 stay reachable ("Load older corrections").
// The server can only list pages by offset, so the newest 500 load first and older pages are appended on request, from the next
// offset, without duplicates, with every filter and total working on whatever is loaded, and never calling a partial total complete.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { loadTs } from './_load_ts.mjs';

const require = createRequire(import.meta.url);
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const rnw = require('react-native-web');
const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const flat = (html) => html.replace(/<[^>]+>/g, '|').replace(/\|+/g, '|');

// a fake server holding `total` corrections, newest first, listed 50 at a time by offset (what list_stock_count_corrections does)
const HOUR = 3600_000;
const T0 = Date.UTC(2026, 10, 20); // Nov 20 2026
const makeRow = (n) => ({
  id: `c${String(n).padStart(5, '0')}`, created_at: new Date(T0 - n * HOUR).toISOString(), product_name: `Product ${n}`, stock_unit_code: n % 7 === 0 ? 'half_egg' : null,
  branch_name: n % 2 === 0 ? 'SM 1' : 'SM 2', cashier_name: 'Maria', details: { before: 10, after: 10 + (n % 3 === 0 ? -1 : 2), reason: 'Physical recount', shift_id: 's1' },
});
const server = (total, { newest = 0 } = {}) => {
  const calls = [];
  return {
    calls,
    fetchPage: async (offset) => {
      calls.push(offset);
      const rows = [];
      for (let i = offset; i < Math.min(offset + 50, total + newest); i++) rows.push(makeRow(i - newest));
      return rows;
    },
  };
};

const f = loadTs('src/features/reports/stockCorrectionFilters.ts');
const b = loadTs('src/features/reports/stockCorrectionBranches.ts');
const none = { rangeType: 'all_time', customStart: '', customEnd: '' };

// ---------------------------------------------------------------- 1. older pages are appended from the next offset
{
  const s = server(1230);
  const first = await f.scanCorrections(s.fetchPage);
  assert.equal(first.rows.length, 500, 'the newest 500 load first');
  assert.equal(first.complete, false);
  assert.equal(first.pages, 10);
  assert.equal(f.canLoadOlder(first), true);
  s.calls.length = 0;
  const frozen = JSON.stringify(first);
  const second = await f.extendScan(s.fetchPage, first);
  assert.deepEqual(s.calls, [500, 550, 600, 650, 700, 750, 800, 850, 900, 950], 'older pages continue from the next server offset: the same RPC, no new one');
  assert.equal(second.rows.length, 1000);
  assert.equal(second.complete, false);
  assert.equal(second.pages, 20);
  assert.equal(JSON.stringify(first), frozen, 'the earlier result is never changed');
  assert.deepEqual(second.rows.slice(0, 500).map((r) => r.id), first.rows.map((r) => r.id), 'the newest 500 stay exactly where they were');
  assert.equal(second.rows.at(-1).id, 'c00999', 'older ones follow, newest first');
  s.calls.length = 0;
  const third = await f.extendScan(s.fetchPage, second);
  assert.deepEqual(s.calls, [1000, 1050, 1100, 1150, 1200], 'the last pages: the server runs out');
  assert.equal(third.rows.length, 1230, 'every correction is reachable');
  assert.equal(third.complete, true, 'and only now is it complete');
  assert.equal(f.canLoadOlder(third), false, 'nothing older: no button');
  assert.equal(new Set(third.rows.map((r) => r.id)).size, 1230, 'no duplicates');
  s.calls.length = 0;
  assert.equal(await f.extendScan(s.fetchPage, third), third, 'already complete: nothing is fetched again');
  assert.deepEqual(s.calls, []);
}

// ---------------------------------------------------------------- 2. a new correction between loads: no duplicates, nothing missing
{
  const before = server(800);
  const first = await f.scanCorrections(before.fetchPage);
  // three more corrections arrive at the top: every older row moves down by three
  const after = server(800, { newest: 3 });
  const next = await f.extendScan(after.fetchPage, first);
  const ids = next.rows.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, 'the rows that moved across the page edge are kept once');
  for (let n = 0; n < 800; n++) assert.ok(ids.includes(makeRow(n).id), `old correction ${n} is still there`);
  assert.equal(next.rows.length, 800, 'the 3 new ones are not in this list until it is refreshed (and then they are, at the top)');
}

// ---------------------------------------------------------------- 3. a failure keeps what is loaded; the ceiling is stated
{
  const s = server(2000);
  const first = await f.scanCorrections(s.fetchPage);
  await assert.rejects(f.extendScan(async (offset) => { if (offset >= 600) throw new Error('Network request failed'); return s.fetchPage(offset); }, first), /Network request failed/);
  assert.equal(first.rows.length, 500, 'the list that was already loaded is untouched');
  const endless = async (offset) => Array.from({ length: 50 }, (_, i) => makeRow(offset + i));
  let scan = await f.scanCorrections(endless, 10);
  for (let i = 0; i < 40; i++) scan = await f.extendScan(endless, scan);
  assert.equal(scan.pages, f.SCAN_HARD_MAX_PAGES, 'stops at the ceiling');
  assert.equal(scan.rows.length, f.SCAN_HARD_MAX_ROWS);
  assert.equal(scan.complete, false);
  assert.equal(f.canLoadOlder(scan), false, 'no button at the ceiling');
  const cov = b.correctionCoverage(scan, none);
  assert.equal(cov.complete, false, 'still not called complete');
  assert.match(cov.note, /That is the most this report can load \(10000\)\./);
}

// ---------------------------------------------------------------- 4. totals and filters follow what is loaded, and are honest about it
{
  const s = server(1230);
  const first = await f.scanCorrections(s.fetchPage);
  const all = await f.scanCorrections(s.fetchPage, 100);
  const older = await f.extendScan(s.fetchPage, first);
  // All Time is partial until everything is loaded
  assert.equal(b.correctionCoverage(first, none).complete, false);
  assert.equal(b.correctionCoverage(older, none).complete, false, '1000 of 1230: still partial');
  assert.equal(b.correctionCoverage(older, none).loaded, 1000, 'the notice counts what is really loaded');
  assert.match(b.correctionCoverage(older, none).note, /^Only the newest 1000 corrections were loaded \(back to /);
  assert.deepEqual(b.correctionCoverage(all, none), { complete: true, note: null, loadedBack: null, canLoadOlder: false, loaded: 1230 }, 'everything loaded: complete, no warning');
  // a range that reaches back past the first 500 becomes complete once enough older pages are loaded
  const day = (start, end) => ({ rangeType: 'custom', customStart: start, customEnd: end });
  const oldest500 = first.rows.at(-1).created_at; // about Oct 30
  const range = day('2026-10-20', '2026-10-25'); // older than anything in the first 500
  assert.equal(b.correctionCoverage(first, range).complete, false, 'not covered by the newest 500');
  assert.equal(b.correctionCoverage(older, range).complete, true, 'covered once the older pages are loaded (newest first: it starts after the oldest loaded)');
  assert.equal(b.correctionsInRange(first.rows, range).length, 0, 'nothing of that range in the newest 500...');
  assert.ok(b.correctionsInRange(older.rows, range).length > 0, '...and the older corrections appear after loading');
  assert.ok(oldest500 > '2026-10-25', 'sanity: the first 500 do not reach that far back');
  // branch totals include the older corrections, per unit, with no duplicates
  const before = b.summarizeCorrections(first.rows.filter((r) => r.branch_name === 'SM 1'));
  const afterLoad = b.summarizeCorrections(older.rows.filter((r) => r.branch_name === 'SM 1'));
  assert.equal(afterLoad.corrections, 500);
  assert.ok(afterLoad.corrections > before.corrections);
  assert.deepEqual(afterLoad.byUnit.map((u) => u.unit), ['piece', 'half_egg'], 'still per unit');
  // search and branch filters look through the older ones too
  assert.deepEqual(f.filterCorrections(first.rows, { search: 'Product 900', branch: 'all', ...none }).map((r) => r.id), [], 'not loaded yet: not found (and the screen says it only searched the newest)');
  assert.deepEqual(f.filterCorrections(older.rows, { search: 'Product 900', branch: 'all', ...none }).map((r) => r.id), ['c00900'], 'found after loading older corrections');
  assert.equal(f.filterCorrections(older.rows, { search: '', branch: 'SM 2', ...none }).every((r) => r.branch_name === 'SM 2'), true);
  // overview branch rows: counts grow, and "none" is only claimed when complete
  const branches = [{ id: 'b1', name: 'SM 1', is_active: true, is_main_branch: false }, { id: 'b2', name: 'SM 2', is_active: true, is_main_branch: false }];
  const rows1 = b.buildCorrectionBranchRows(branches, first.rows);
  const rows2 = b.buildCorrectionBranchRows(branches, all.rows);
  assert.equal(rows1.reduce((n, r) => n + r.totals.corrections, 0), 500);
  assert.equal(rows2.reduce((n, r) => n + r.totals.corrections, 0), 1230);
}

// ---------------------------------------------------------------- 5. the hook: the same list for every screen, refresh keeps how far back it reached
{
  const s = server(1230);
  const cache = new Map();
  let queryOptions;
  let mutationOptions;
  const hook = loadTs('src/hooks/useStockCorrectionScan.ts', {
    '@tanstack/react-query': {
      useQueryClient: () => ({ getQueryData: (key) => cache.get(JSON.stringify(key)), setQueryData: (key, value) => { cache.set(JSON.stringify(key), value); } }),
      useQuery: (options) => { queryOptions = options; return { data: cache.get(JSON.stringify(options.queryKey)), isPending: false }; },
      useMutation: (options) => { mutationOptions = options; return { mutate: () => {}, isPending: false, error: null }; },
    },
    '@/features/auth/AuthProvider': { useAuth: () => ({ profile: { id: 'u1' } }) },
    '@/services/stockCorrectionService': { listCorrections: s.fetchPage },
  }).useStockCorrectionScan;
  const key = JSON.stringify(['stock-corrections', 'scan', 'u1']);
  const result = hook();
  assert.equal(typeof result.loadOlder, 'function');
  assert.equal(result.loadingOlder, false);
  assert.equal(queryOptions.staleTime, 30_000);
  cache.set(key, await queryOptions.queryFn());
  assert.equal(cache.get(key).rows.length, 500);
  // "Load older corrections"
  hook();
  const next = await mutationOptions.mutationFn();
  mutationOptions.onSuccess(next);
  assert.equal(cache.get(key).rows.length, 1000, 'the older pages are in the shared list (the overview and every branch read it)');
  // a refresh reloads from the top but keeps the same reach: older corrections do not vanish
  hook();
  s.calls.length = 0;
  cache.set(key, await queryOptions.queryFn());
  assert.equal(cache.get(key).rows.length, 1000, 'refresh keeps how far back the list reached');
  assert.equal(s.calls.length, 20, '20 pages, from the top (so new corrections appear)');
  // at the end the button has nothing to do
  hook();
  await mutationOptions.onSuccess(await mutationOptions.mutationFn());
  assert.equal(cache.get(key).complete, true);
  hook();
  s.calls.length = 0;
  assert.equal(await mutationOptions.mutationFn(), cache.get(key));
  assert.deepEqual(s.calls, [], 'nothing more to load');
  // nothing loaded yet: nothing to extend
  cache.clear();
  hook();
  assert.equal(await mutationOptions.mutationFn(), undefined);
}

// ---------------------------------------------------------------- 6. the button, where the notice is
{
  let button;
  const Notice = loadTs('src/features/reports/CorrectionCoverageNotice.tsx', {
    'react-native': rnw,
    '@react-native-vector-icons/ionicons': { __esModule: true, default: () => null },
    '@/components/dashboard/ManagerActionButton': { ManagerActionButton: (props) => { button = props; return React.createElement('button', { 'data-label': props.label, 'data-loading': String(Boolean(props.loading)) }); } },
    '@/components/dashboard/theme': { managerColors: new Proxy({}, { get: () => '#000' }) },
  }).CorrectionCoverageNotice;
  const press = [];
  let html = renderToStaticMarkup(React.createElement(Notice, { message: 'Only the newest 500 corrections were loaded.', onLoadOlder: () => press.push('older') }));
  assert.match(html, /data-label="Load older corrections"/);
  assert.equal(button.variant, 'secondary', 'the same secondary button as the rest of the app');
  button.onPress();
  assert.deepEqual(press, ['older']);
  html = renderToStaticMarkup(React.createElement(Notice, { message: 'x', onLoadOlder: () => {}, loading: true }));
  assert.equal(button.disabled, true, 'not twice at once');
  assert.match(html, /data-loading="true"/);
  html = renderToStaticMarkup(React.createElement(Notice, { message: 'x', onLoadOlder: () => {}, error: 'Network request failed' }));
  assert.match(flat(html), /Couldn’t load older corrections\. Network request failed/, 'a failure is said, and what is loaded stays');
  html = renderToStaticMarkup(React.createElement(Notice, { message: 'That is the most this report can load.' }));
  assert.doesNotMatch(html, /Load older corrections/, 'no button when there is nothing more to load');
}

// ---------------------------------------------------------------- 7. both screens offer it, only while it matters
for (const file of ['src/features/reports/StockCorrectionsOverviewScreen.tsx', 'src/features/reports/StockCorrectionsScreen.tsx']) {
  const src = read(file);
  assert.match(src, /onLoadOlder=\{coverage\.canLoadOlder \? (scanQuery|query)\.loadOlder : undefined\}/, `${file}: the button only while older corrections can be loaded`);
  assert.match(src, /loading=\{(scanQuery|query)\.loadingOlder\}/);
  assert.match(src, /error=\{(scanQuery|query)\.olderError \? getErrorMessage\((scanQuery|query)\.olderError\) : null\}/);
  assert.doesNotMatch(src, /SCAN_MAX_ROWS/, `${file}: no hard-coded "500" any more: the notice counts what is loaded`);
}
// the notice shows whenever the figures for the chosen range are partial, nothing else changed
assert.match(read('src/features/reports/StockCorrectionsOverviewScreen.tsx'), /Partial · newest \$\{coverage\.loaded\} only/);
// no backend: the same RPC and offsets
assert.match(read('src/services/stockCorrectionService.ts'), /rpc\('list_stock_count_corrections', \{ p_offset: offset \}\)/);
assert.doesNotMatch(read('src/hooks/useStockCorrectionScan.ts'), /supabase|\.rpc\(/);

console.log('Older stock corrections passed: older pages append without duplicates, filters and totals follow, partial is never complete, refresh keeps the reach.');
