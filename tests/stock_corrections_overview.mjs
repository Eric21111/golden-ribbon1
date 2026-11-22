// Stock corrections: All branches overview -> one branch, the same flow as Void logs and Waste History.
//  - summary cards and a compact row per selling branch, built from the corrections in the chosen date range
//  - quantities are kept per STOCK UNIT (a half-egg unit is not a piece), never added across units
//  - the server lists only pages, so at most the newest 500 are loaded: a figure is called complete only when it provably is
//  - tapping a branch keeps the date range; the Main Branch Manager gets the same screens, behind the Main Branch guard
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
const up = (n, by, over = {}) => row(n, { details: { before: 10, after: 10 + by, reason: 'Physical recount', shift_id: 's1' }, ...over });
const down = (n, by, over = {}) => row(n, { details: { before: 10, after: 10 - by, reason: 'Incorrect kitchen count', shift_id: 's1' }, ...over });
const none = { rangeType: 'all_time', customStart: '', customEnd: '' };

// ---------------------------------------------------------------- 1. the rules
const m = loadTs('src/features/reports/stockCorrectionBranches.ts');

// units are never added together
const mixed = [up(1, 3), up(2, 4), down(3, 2), up(4, 5, { stock_unit_code: 'half_egg' }), down(5, 1, { stock_unit_code: 'half_egg' }), row(6, { details: { before: 5, after: 5, reason: 'x', shift_id: 's' } })];
const totals = m.summarizeCorrections(mixed);
assert.equal(totals.corrections, 6);
assert.equal(totals.increases, 3, 'corrections that raised stock (counted, not summed)');
assert.equal(totals.decreases, 2);
assert.deepEqual(totals.byUnit.map((u) => [u.unit, u.increase, u.decrease, u.net]), [['piece', 7, 2, 5], ['half_egg', 5, 1, 4]], 'pieces and half-egg units stay separate, pieces first');
assert.equal(m.netChangeText(totals), 'Net +5 pcs · +4 half-egg units');
assert.equal(m.netChangeText(m.summarizeCorrections([down(1, 3)])), 'Net −3 pcs', 'a real minus sign');
assert.equal(m.netChangeText(m.summarizeCorrections([up(1, 2), down(2, 2)])), 'Net 0 pcs', 'cancelling out is shown as 0, not hidden');
assert.equal(m.netChangeText(m.summarizeCorrections([])), '', 'nothing to say without corrections');
assert.equal(m.summarizeCorrections([row(1, { stock_unit_code: null }), row(2, { stock_unit_code: 'piece' })]).byUnit.length, 1, 'null and piece are both pieces');
assert.equal(m.signedUnitAmount(1, 'half_egg'), '+1 half-egg unit');
assert.equal(m.signedUnitAmount(-2, 'half_serving'), '−2 half-serving units');
assert.equal(m.unitAmountLabel(1, null), '1 pc');
assert.equal(m.unitAmountLabel(500, 'quarter_serving'), '500 quarter-serving units');
assert.deepEqual(m.summarizeCorrections(['5', '8'].map((v, i) => row(i, { details: { before: '5', after: v, reason: 'r', shift_id: 's' } }))).byUnit.map((u) => u.net), [3], 'numeric strings from the server');

// date ranges
const dated = [row(1, { created_at: '2026-11-11T07:20:00Z' }), row(2, { created_at: '2026-11-10T20:00:00Z' }), row(3, { created_at: '2026-11-09T10:00:00Z' })];
const day = (start, end) => ({ rangeType: 'custom', customStart: start, customEnd: end });
assert.deepEqual(m.correctionsInRange(dated, none).map((r) => r.id), ['c1', 'c2', 'c3']);
assert.deepEqual(m.correctionsInRange(dated, day('2026-11-11', '2026-11-11')).map((r) => r.id), ['c1', 'c2'], 'Manila days: the 4:00 AM one is Nov 11 there');
assert.deepEqual(m.correctionsInRange(dated, day('2026-11-09', '2026-11-09')).map((r) => r.id), ['c3']);

// the 500 limit: complete only when it provably is
const rowsAt = (...isos) => isos.map((iso, i) => row(i + 1, { created_at: iso }));
const fullScan = { rows: rowsAt('2026-11-11T00:00:00Z'), complete: true, pages: 1 };
assert.deepEqual(m.correctionCoverage(fullScan, none), { complete: true, note: null, loadedBack: null, canLoadOlder: false, loaded: 1 }, 'the server had no more: complete');
assert.deepEqual(m.correctionCoverage(undefined, none), { complete: true, note: null, loadedBack: null, canLoadOlder: false, loaded: 0 }, 'nothing loaded yet: nothing to warn about');
const cutScan = { rows: rowsAt('2026-11-11T00:00:00Z', '2026-11-03T05:00:00Z', '2026-11-07T00:00:00Z'), complete: false, pages: 10 };
let cov = m.correctionCoverage(cutScan, none);
assert.equal(cov.complete, false, 'All Time on a cut list is partial');
assert.equal(cov.loadedBack, 'Nov 3');
assert.equal(cov.note, 'Only the newest 3 corrections were loaded (back to Nov 3). Older corrections are not counted, so these figures may be incomplete.', 'the number is how many are really loaded');
assert.equal(cov.canLoadOlder, true, 'and older ones can be loaded');
assert.equal(m.correctionCoverage(cutScan, day('2026-10-20', '2026-11-05')).complete, false, 'a range that reaches back before the oldest loaded one is partial');
assert.equal(m.correctionCoverage(cutScan, day('2026-11-04', '2026-11-12')).complete, true, 'a range that starts after the oldest loaded one is fully covered (newest first)');
assert.equal(m.correctionCoverage(cutScan, day('2026-11-03', '2026-11-12')).complete, false, 'starting the same day as the oldest: not provably covered');
assert.equal(m.correctionCoverage(cutScan, { rangeType: 'custom', customStart: '2026-11-04', customEnd: '' }).complete, false, 'an incomplete custom range is not a range');
assert.equal(m.correctionCoverage({ rows: [], complete: false, pages: 10 }, none).complete, false, 'cut, with nothing readable: still partial');

// branch rows: selling branches only, zero branches kept, unknown names kept but not tappable, most corrections first
const branches = [
  { id: 'main', name: 'Main Branch', is_active: true, is_main_branch: true },
  { id: 'b1', name: 'SM 1', is_active: true, is_main_branch: false },
  { id: 'b2', name: 'SM 2', is_active: true, is_main_branch: false },
  { id: 'b3', name: 'SM 3', is_active: false, is_main_branch: false },
  { id: 'b4', name: 'SM 4', is_active: true, is_main_branch: false },
];
const data = [up(1, 3, { branch_name: 'SM 2' }), up(2, 2, { branch_name: 'SM 2' }), down(3, 1, { branch_name: 'SM 1' }), up(4, 9, { branch_name: 'Old Booth' })];
const rowsOut = m.buildCorrectionBranchRows(branches, data);
assert.deepEqual(rowsOut.map((r) => [r.branchName, r.totals.corrections]), [['SM 2', 2], ['Old Booth', 1], ['SM 1', 1], ['SM 3', 0], ['SM 4', 0]], 'selling branches (and unknown names) by count, then name; the Main Branch is not a row');
assert.ok(!rowsOut.some((r) => r.branchId === 'main'), 'the Main Branch is never a row of its own (it makes no corrections)');
assert.equal(rowsOut.find((r) => r.branchName === 'Old Booth').branchId, null, 'a name that is not in the branch list is shown but cannot be opened');
assert.equal(rowsOut.find((r) => r.branchName === 'SM 3').isActive, false);
assert.equal(rowsOut.find((r) => r.branchName === 'SM 4').totals.corrections, 0, 'a branch with none in range is still listed, at 0');
assert.deepEqual(m.buildCorrectionBranchRows([], []), []);
// the per-branch quantities are per unit too
const sm2 = rowsOut.find((r) => r.branchName === 'SM 2');
assert.equal(m.netChangeText(sm2.totals), 'Net +5 pcs');

// the row text says what the zeros mean
assert.deepEqual(m.correctionBranchMeta(sm2.totals, { complete: true }), { subtitle: '2 corrections', meta: 'Net +5 pcs' });
assert.deepEqual(m.correctionBranchMeta(m.summarizeCorrections([up(1, 1)]), { complete: true }), { subtitle: '1 correction', meta: 'Net +1 pc' });
assert.deepEqual(m.correctionBranchMeta(m.summarizeCorrections([]), { complete: true }), { subtitle: 'No corrections in this range' }, 'complete: none really means none');
assert.deepEqual(m.correctionBranchMeta(m.summarizeCorrections([]), { complete: false }), { subtitle: 'None among the newest corrections' }, 'partial: it never claims none exist');

// links keep the date range
assert.equal(m.correctionBranchHref({ role: 'owner', branchId: 'b1', rangeType: 'this_week' }), '/owner/reports/stock-count-changes/b1?range=this_week');
assert.equal(m.correctionBranchHref({ role: 'manager', branchId: 'b1', rangeType: 'all_time' }), '/manager/reports/stock-count-changes/b1?range=all_time');
assert.equal(m.correctionBranchHref({ role: 'owner', branchId: 'b1', rangeType: 'custom', customStart: '2026-11-01', customEnd: '2026-11-07' }), '/owner/reports/stock-count-changes/b1?range=custom&start=2026-11-01&end=2026-11-07');
assert.doesNotMatch(m.correctionBranchHref({ role: 'owner', branchId: 'b1', rangeType: 'today', customStart: '2026-11-01', customEnd: '2026-11-07' }), /start=/, 'custom dates only travel with a custom range');

// ---------------------------------------------------------------- 2. the All branches overview
let role = 'owner';
let params = {};
let scanState;
let branchState;
let screenProps;
let header;
let statTiles;
let pair;
let heading;
let rowsSeen;
let pushed;
let feedback;
let rangeSeen;
let overrides = {};
let index = 0;
let refetched;
let noticeProps;
let older = 0;
const Pass = (props) => React.createElement('div', null, props.children);
const Overview = loadTs('src/features/reports/StockCorrectionsOverviewScreen.tsx', {
  react: { ...React, useState: (initial) => { const i = index++; return [i in overrides ? overrides[i] : initial, () => {}]; } },
  'react-native': rnw,
  'expo-router': { router: { push: (href) => pushed.push(href) }, useLocalSearchParams: () => params },
  '@/components/ConstrainedWidth': { ConstrainedWidth: Pass },
  '@/components/Screen': { Screen: (props) => { screenProps = props; return React.createElement('div', null, props.children); } },
  '@/components/dashboard/ListRowCard': { ListRowCard: (props) => { rowsSeen.push(props); return React.createElement('section', { 'data-row': props.title }, props.title, '|', props.subtitle, '|', props.meta, '|', props.trailing); } },
  '@/components/dashboard/ManagerFeedback': {
    LoadingState: (props) => React.createElement('p', { 'data-loading': props.label }),
    ErrorState: (props) => { feedback = props; return React.createElement('p', { 'data-error': props.message }); },
    EmptyState: (props) => React.createElement('p', { 'data-empty': props.title }, props.message),
  },
  '@/components/dashboard/ManagerScreenHeader': { ManagerScreenHeader: (props) => { header = props; return React.createElement('h1', null, props.title, '|', props.subtitle); } },
  '@/components/dashboard/StatTile': { StatTile: (props) => { statTiles.push(props); return React.createElement('div', { 'data-tile': props.label }, String(props.value), '|', props.caption); } },
  '@/components/dashboard/theme': { managerColors: new Proxy({}, { get: () => '#000' }) },
  '@/features/auth/AuthProvider': { useAuth: () => ({ profile: { id: 'u1', role } }) },
  '@/features/reports/DateRangeFilter': {
    DATE_RANGE_OPTIONS: [{ label: 'All Time', value: 'all_time' }, { label: 'Today', value: 'today' }, { label: 'This Week', value: 'this_week' }, { label: 'This Month', value: 'this_month' }],
    DateRangeFilter: (props) => { rangeSeen = props; return React.createElement('div', { 'data-range': props.value }); },
  },
  '@/features/reports/OwnerSummaryKpiPair': { OwnerSummaryKpiPair: (props) => { pair = props; return React.createElement('div', { 'data-kpi': 'true' }, String(props.left.value), '|', String(props.right.value), '|', props.left.caption); } },
  '@/features/reports/ReportSectionHeading': { ReportSectionHeading: (props) => { heading = props; return React.createElement('h2', null, props.title, '|', props.meta); } },
  '@/features/reports/CorrectionCoverageNotice': { CorrectionCoverageNotice: (props) => { noticeProps = props; return React.createElement('aside', { 'data-notice': 'true' }, props.message); } },
  '@/hooks/useBranches': { useBranches: () => branchState },
  '@/hooks/useStockCorrectionScan': { useStockCorrectionScan: () => scanState },
  '@/lib/errors': { getErrorMessage: (error) => error.message },
  '@/lib/nameAccent': { accentForName: () => 'blue' },
}).StockCorrectionsOverviewScreen;
const q = { isPending: false, isLoading: false, isError: false, isRefetching: false, error: null, refetch: () => { refetched.push('refetch'); } };
const render = ({ scan, scanExtra = {}, branchList = branches, branchExtra = {}, over = {} } = {}) => {
  index = 0; overrides = over; statTiles = []; rowsSeen = []; pushed = []; refetched = []; feedback = undefined; pair = undefined; heading = undefined;
  noticeProps = undefined;
  scanState = { ...q, loadOlder: () => { older++; }, loadingOlder: false, olderError: null, data: scan, ...scanExtra };
  branchState = { ...q, data: branchList, ...branchExtra };
  return renderToStaticMarkup(React.createElement(Overview));
};
// state order: rangeType, customStart, customEnd
const withRange = (rangeType, customStart = '', customEnd = '') => ({ 0: rangeType, 1: customStart, 2: customEnd });
const everything = { rows: data, complete: true, pages: 1 };

let html = render({ scan: everything });
let text = flat(html);
assert.equal(header.title, 'Stock corrections');
assert.equal(header.showBack, true, 'the owner drills in from Reports: back arrow');
role = 'manager';
render({ scan: everything });
assert.equal(header.showBack, false, 'the Main Manager has it in the sidebar: menu icon, like Waste History');
role = 'owner';
html = render({ scan: everything });
assert.match(html, /data-range="all_time"/, 'the shared date range pills, like Void logs');
const tile = statTiles[0];
assert.equal(tile.layout, 'wide', 'one headline card...');
assert.equal(tile.emphasis, true, '...in the navy gradient');
assert.equal(tile.value, 4, 'corrections in range');
assert.equal(pair.left.label, 'Increased stock');
assert.equal(pair.left.value, 3, 'how many corrections raised stock (a count, never a mixed-unit sum)');
assert.equal(pair.right.label, 'Reduced stock');
assert.equal(pair.right.value, 1);
assert.equal(tile.caption, 'Net +13 pcs', 'the net change is shown per unit');
assert.doesNotMatch(html, /data-notice/, 'complete: no warning');
assert.equal(heading.title, 'BRANCHES');
assert.equal(heading.meta, 'All Time');
// the rows
assert.deepEqual(rowsSeen.map((r) => r.title), ['SM 2', 'Inactive · Old Booth', 'SM 1', 'Inactive · SM 3', 'SM 4'], 'branches by count; one that is inactive or not in the list is labelled, like Void logs');
assert.equal(rowsSeen[0].subtitle, '2 corrections');
assert.equal(rowsSeen[0].meta, 'Net +5 pcs');
assert.equal(rowsSeen.find((r) => r.title === 'SM 4').subtitle, 'No corrections in this range');
assert.equal(rowsSeen.find((r) => r.title === 'Inactive · Old Booth').onPress, undefined, 'a name that is not in the branch list cannot be opened');
assert.match(rowsSeen[0].accessibilityLabel, /^SM 2\. 2 corrections\. Net \+5 pcs$/);
rowsSeen[0].onPress();
assert.deepEqual(pushed, ['/owner/reports/stock-count-changes/b2?range=all_time'], 'a tap opens that branch');

// the date range travels with the tap (custom dates too), and counts follow the range
html = render({ scan: everything, over: withRange('custom', '2026-11-11', '2026-11-12') });
rowsSeen[0].onPress();
assert.deepEqual(pushed, ['/owner/reports/stock-count-changes/b2?range=custom&start=2026-11-11&end=2026-11-12']);
html = render({ scan: everything, over: withRange('custom', '2026-01-01', '2026-01-02') });
assert.equal(statTiles[0].value, 0);
assert.equal(heading.meta, 'Custom range');
assert.equal(rowsSeen.find((r) => r.title === 'SM 2').subtitle, 'No corrections in this range');
// the range arrives from a link as well (back from a branch)
params = { range: 'custom', start: '2026-11-11', end: '2026-11-11' };
render({ scan: everything });
assert.equal(rangeSeen.value, 'custom');
assert.equal(rangeSeen.customStart, '2026-11-11');
params = {};
// the Main Branch Manager's links go to the manager routes
role = 'manager';
render({ scan: everything });
rowsSeen[0].onPress();
assert.deepEqual(pushed, ['/manager/reports/stock-count-changes/b2?range=all_time']);
role = 'owner';

// an incomplete custom range asks for the dates and shows no numbers
html = render({ scan: everything, over: withRange('custom', '2026-11-11', '') });
assert.match(html, /data-empty="Select a date range"/);
assert.equal(statTiles[0].value, '—');
assert.equal(rowsSeen.length, 0);

// the 500 limit is stated on every figure
const cutData = { rows: Array.from({ length: 500 }, (_, i) => up(i + 1, 1, { branch_name: 'SM 1', created_at: new Date(Date.UTC(2026, 10, 1) + i * 3600_000).toISOString() })), complete: false, pages: 10 };
html = render({ scan: cutData });
text = flat(html);
assert.equal(statTiles[0].caption, 'Partial · newest 500 only', 'the headline card says it is partial');
assert.equal(pair.left.caption, 'Partial · newest 500 only');
assert.match(html, /data-notice="true"[^>]*>Only the newest 500 corrections were loaded \(back to Nov 1\)\./);
assert.equal(heading.meta, 'All Time · newest 500', 'and the branch list too');
assert.equal(rowsSeen.find((r) => r.title === 'SM 2').subtitle, 'None among the newest corrections', 'never "none" when it was only the newest that were checked');
assert.match(rowsSeen.find((r) => r.title === 'SM 1').accessibilityLabel, /Newest corrections only$/);
// older corrections can be loaded from the overview, and the figures say how many are loaded
assert.equal(typeof noticeProps.onLoadOlder, 'function');
noticeProps.onLoadOlder();
assert.equal(older, 1);
const moreData = { rows: Array.from({ length: 1000 }, (_, i) => up(i + 1, 1, { branch_name: 'SM 1', created_at: new Date(Date.UTC(2026, 9, 1) + i * 3600_000).toISOString() })), complete: false, pages: 20 };
html = render({ scan: moreData });
assert.equal(statTiles[0].caption, 'Partial · newest 1000 only', 'after loading older ones it says 1000, not 500');
assert.equal(heading.meta, 'All Time · newest 1000');
html = render({ scan: { ...moreData, complete: true } });
assert.doesNotMatch(html, /data-notice/, 'everything loaded: complete, no warning');
assert.notEqual(statTiles[0].caption, 'Partial · newest 1000 only');
html = render({ scan: { ...moreData, pages: 200 } });
assert.equal(noticeProps.onLoadOlder, undefined, 'at the ceiling there is nothing more to load');
// a range fully inside what was loaded is complete (no warning)
html = render({ scan: cutData, over: withRange('custom', '2026-11-20', '2026-11-21') });
assert.doesNotMatch(html, /data-notice/);
assert.notEqual(statTiles[0].caption, 'Partial · newest 500 only');
assert.equal(heading.meta, 'Custom range');
// a range that reaches back before the oldest loaded correction is partial
html = render({ scan: cutData, over: withRange('custom', '2026-10-01', '2026-11-21') });
assert.match(html, /data-notice="true"/);

// loading, error, empty
html = render({ scan: undefined, scanExtra: { isPending: true } });
assert.match(html, /data-loading="Loading stock corrections…"/);
assert.equal(statTiles[0].value, '—', 'no numbers while loading');
assert.doesNotMatch(html, /data-empty/);
html = render({ scan: undefined, scanExtra: { isError: true, error: new Error('Network request failed') } });
assert.match(html, /data-error="Network request failed"/);
feedback.onRetry();
assert.deepEqual(refetched, ['refetch'], 'Retry reloads the corrections');
assert.equal(statTiles[0].value, '—', 'an error is not "0 corrections"');
html = render({ scan: { rows: [], complete: true, pages: 1 }, branchList: [{ id: 'main', name: 'Main Branch', is_active: true, is_main_branch: true }] });
assert.match(html, /data-empty="No selling branches"/);

// pull to refresh reloads the corrections and the branch list
render({ scan: everything });
screenProps.onRefresh();
assert.deepEqual(refetched, ['refetch', 'refetch']);
assert.equal(screenProps.refreshing, false);
render({ scan: everything, scanExtra: { isRefetching: true } });
assert.equal(screenProps.refreshing, true);

// ---------------------------------------------------------------- 3. the branch route: only a selling branch of the list opens
let branchData = { data: branches, isError: false, isPending: false, isFetched: true, error: null, refetch() {} };
let routeParams = {};
let screenSeen;
const Route = loadTs('src/features/reports/StockCorrectionsBranchRoute.tsx', {
  react: React,
  'react-native': rnw,
  'expo-router': { useLocalSearchParams: () => routeParams },
  '@/components/ConstrainedWidth': { ConstrainedWidth: Pass },
  '@/components/Screen': { Screen: Pass },
  '@/components/dashboard/ManagerFeedback': { ErrorState: (props) => React.createElement('p', { 'data-error': props.message }) },
  '@/components/dashboard/ManagerScreenHeader': { ManagerScreenHeader: (props) => React.createElement('h1', null, props.title) },
  '@/features/reports/StockCorrectionsScreen': { __esModule: true, default: (props) => { screenSeen = props; return React.createElement('div', { 'data-screen': 'true' }); } },
  '@/hooks/useBranches': { useBranches: () => branchData },
  '@/lib/errors': { getErrorMessage: (error) => error.message },
}).StockCorrectionsBranchRoute;
const renderRoute = (p, data = branchData) => { routeParams = p; branchData = data; screenSeen = undefined; return renderToStaticMarkup(React.createElement(Route)); };
renderRoute({ branchId: 'b2', range: 'this_week' });
assert.equal(screenSeen.branchId, 'b2');
assert.equal(screenSeen.branchName, 'SM 2', 'the name comes from the branch list');
assert.equal(screenSeen.initialRangeType, 'this_week', 'the date range chosen in the overview');
renderRoute({ branchId: 'b2', range: 'custom', start: '2026-11-01', end: '2026-11-07' });
assert.deepEqual([screenSeen.initialRangeType, screenSeen.initialCustomStart, screenSeen.initialCustomEnd], ['custom', '2026-11-01', '2026-11-07']);
renderRoute({ branchId: 'b2', range: 'this_week', start: '2026-11-01', end: '2026-11-07' });
assert.deepEqual([screenSeen.initialCustomStart, screenSeen.initialCustomEnd], ['', ''], 'dates only count for a custom range');
renderRoute({ branchId: 'b2' });
assert.equal(screenSeen.initialRangeType, 'all_time', 'no range in the link: All Time');
renderRoute({ branchId: 'main' });
assert.equal(screenSeen.branchName, undefined, 'the Main Branch makes no corrections: "Branch not found", never everyone');
renderRoute({ branchId: 'nope' });
assert.equal(screenSeen.branchName, undefined, 'an unknown branch too');
assert.equal(screenSeen.branchLookupPending, false);
renderRoute({ branchId: 'b2' }, { ...branchData, data: undefined, isPending: true, isFetched: false });
assert.equal(screenSeen.branchLookupPending, true, 'still looking the branch up: wait, do not say "not found"');
const errorHtml = renderRoute({ branchId: 'b2' }, { ...branchData, data: undefined, isError: true, error: new Error('Network request failed') });
assert.match(errorHtml, /data-error="Network request failed"/);
branchData = { data: branches, isError: false, isPending: false, isFetched: true, error: null, refetch() {} };

// ---------------------------------------------------------------- 4. access and the shared look (source)
const guard = (file) => read(file);
for (const file of ['app/(manager)/manager/reports/stock-count-changes/index.tsx', 'app/(manager)/manager/reports/stock-count-changes/[branchId].tsx']) {
  assert.match(guard(file), /<MainBranchGuard>[\s\S]*<\/MainBranchGuard>/, `${file}: only the Main Branch Manager`);
}
for (const file of ['app/(owner)/owner/reports/stock-count-changes/index.tsx', 'app/(owner)/owner/reports/stock-count-changes/[branchId].tsx']) {
  assert.doesNotMatch(guard(file), /MainBranchGuard/, `${file}: the owner area is already owner-only`);
  assert.ok(existsSync(file));
}
const overviewSrc = read('src/features/reports/StockCorrectionsOverviewScreen.tsx');
for (const piece of ['StatTile', 'OwnerSummaryKpiPair', 'ReportSectionHeading', 'DateRangeFilter', 'ListRowCard', 'ManagerScreenHeader', 'EmptyState', 'ErrorState', 'LoadingState']) {
  assert.match(overviewSrc, new RegExp(piece), `the same ${piece} as Void logs / Waste History`);
}
assert.match(overviewSrc, /layout="wide"\s+emphasis/, 'the navy headline card');
assert.doesNotMatch(overviewSrc, /LinearGradient|backgroundColor: '#0/, 'no new gradient or background: the shared tiles carry the navy');
assert.match(read('src/hooks/useStockCorrectionScan.ts'), /const key = \['stock-corrections', 'scan', profile\?\.id\]/, 'under the "stock-corrections" key so a new correction refreshes it');
assert.match(read('src/hooks/useStockCorrectionScan.ts'), /scanCorrections\(listCorrections, /, 'the same RPC, paged by offset');
assert.doesNotMatch(read('src/features/reports/stockCorrectionBranches.ts'), /supabase|\.rpc\(/, 'no backend in the summaries');
// the pages of the server are 50 and the cap is 500
const f = loadTs('src/features/reports/stockCorrectionFilters.ts');
assert.equal(f.SCAN_MAX_ROWS, 500);

console.log('Stock corrections overview passed: per-unit summaries, the 500 limit stated, All branches -> branch with the date range, Owner and Main Manager routes.');
