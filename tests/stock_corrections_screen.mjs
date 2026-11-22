// Stock corrections > one branch (Owner / Main Branch Manager): built like the Void logs and Waste History branch screens. Shared header
// with the branch name, product search, the shared date range, compact correction cards (reason, cashier, time), client pages of 10, pull
// to refresh, and an honest note whenever only the newest corrections were loaded.
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

// ---- 1. display helpers
const d = loadTs('src/features/reports/stockCorrectionDisplay.ts');
assert.equal(d.CORRECTIONS_PAGE_SIZE, 50);
assert.equal(d.correctionChange({ before: 5, after: 8 }), 3);
assert.equal(d.correctionChange({ before: 10, after: 8 }), -2);
assert.equal(d.correctionChange({ before: '5', after: '8' }), 3, 'numeric strings from the server are fine');
assert.equal(d.formatCorrectionChange(3), '+3');
assert.equal(d.formatCorrectionChange(-2), '−2', 'a real minus sign');
assert.equal(d.formatCorrectionChange(0), '0');
assert.deepEqual([3, -2, 0].map(d.correctionDirection), ['increase', 'decrease', 'none']);
assert.equal(d.correctionQuantityLine({ before: 5, after: 8 }, null), '5 → 8 pcs', 'legacy / pieces: pcs');
assert.equal(d.correctionQuantityLine({ before: 5, after: 1 }, null), '5 → 1 pc', 'singular');
assert.equal(d.correctionQuantityLine({ before: 10, after: 8 }, 'half_egg'), '10 → 8 half-egg units', "the item's own unit");
assert.equal(d.correctionQuantityLine({ before: 3, after: 1 }, 'half_serving'), '3 → 1 half-serving unit');
assert.equal(d.correctionPageCount(0, 12), 1, 'a short first page: just one page');
assert.equal(d.correctionPageCount(0, 50), 2, 'a full page: one more may exist');
assert.match(d.formatCorrectionTime('2026-11-11T07:20:00Z'), /Nov 11, 3:20\s?PM/, 'shown in Manila time');
assert.equal(d.formatCorrectionTime('not a date'), '');

// ---- 2. the branch screen
let screenProps;
let header;
let pager;
let feedback;
let scanState;
let noticeProps;
let older = 0;
let overrides = {};
let index = 0;
const Pass = (props) => React.createElement('div', null, props.children);
const Screen = loadTs('src/features/reports/StockCorrectionsScreen.tsx', {
  react: { ...React, useState: (initial) => { const i = index++; return [i in overrides ? overrides[i] : initial, () => {}]; } },
  'react-native': rnw,
  '@react-native-vector-icons/ionicons': { __esModule: true, default: () => null },
  '@/components/ConstrainedWidth': { ConstrainedWidth: (props) => React.createElement('div', { 'data-fill': String(Boolean(props.fill)) }, props.children) },
  '@/components/Screen': { Screen: (props) => { screenProps = props; return React.createElement('div', null, props.children); } },
  '@/components/Pagination': { Pagination: (props) => { pager = props; return null; } },
  '@/components/dashboard/ManagerScreenHeader': { ManagerScreenHeader: (props) => { header = props; return React.createElement('h1', null, props.title, '|', props.subtitle); } },
  '@/components/dashboard/ManagerFeedback': {
    LoadingState: (props) => React.createElement('p', { 'data-loading': props.label }),
    ErrorState: (props) => { feedback = props; return React.createElement('p', { 'data-error': props.message }); },
    EmptyState: (props) => React.createElement('p', { 'data-empty': props.title }, props.message),
  },
  '@/components/dashboard/SearchInput': { SearchInput: (props) => React.createElement('input', { 'data-search': props.placeholder }) },
  '@/components/dashboard/theme': { managerColors: new Proxy({}, { get: () => '#000' }) },
  '@/features/reports/DateRangeFilter': { DateRangeFilter: (props) => React.createElement('div', { 'data-range': props.value }) },
  '@/features/reports/CorrectionCoverageNotice': { CorrectionCoverageNotice: (props) => { noticeProps = props; return React.createElement('aside', { 'data-notice': 'true' }, props.message); } },
  '@/hooks/useClientPagination': { useClientPagination: (items, key, size) => ({ pageItems: items.slice(0, size), page: 0, setPage() {}, totalPages: Math.max(1, Math.ceil(items.length / size)), showPagination: items.length > size, key, size }) },
  '@/hooks/useStockCorrectionScan': { useStockCorrectionScan: () => scanState },
  '@/lib/errors': { getErrorMessage: (error) => error.message },
}).default;

const row = (n, over = {}) => ({
  id: `c${n}`, created_at: '2026-11-11T07:20:00Z', product_name: `Product ${n}`, stock_unit_code: null, branch_name: 'SM 1', cashier_name: 'Maria',
  details: { before: 5, after: 8, reason: 'Physical recount', shift_id: 's1' }, ...over,
});
const base = { isPending: false, isRefetching: false, error: null, data: undefined, refetch: () => { refetched++; } };
let refetched = 0;
const render = (scan, props = {}, state = {}, over = {}) => {
  index = 0; overrides = over; refetched = 0; pager = undefined; feedback = undefined; header = undefined;
  noticeProps = undefined;
  scanState = { ...base, loadOlder: () => { older++; }, loadingOlder: false, olderError: null, data: scan, ...state };
  return renderToStaticMarkup(React.createElement(Screen, { branchId: 'b1', branchName: 'SM 1', ...props }));
};
// state order in the screen: search, rangeType, customStart, customEnd
const withState = (extra) => ({ 0: '', 1: 'all_time', 2: '', 3: '', ...extra });

const complete = (rows) => ({ rows, complete: true, pages: 1 });

// header: the same plain header as Void logs, with the branch as the subtitle; always a back arrow (it is opened from the overview)
let html = render(complete([row(1)]));
assert.equal(header.title, 'Stock corrections');
assert.equal(header.subtitle, 'SM 1');
assert.equal(header.showBack, true);
assert.match(html, /data-search="Search product"/, 'product search stays');
assert.match(html, /data-range="all_time"/, 'the shared date range');
assert.equal(typeof screenProps.onRefresh, 'function', 'pull to refresh stays');
screenProps.onRefresh();
assert.equal(refetched, 1);

// the branch's own corrections only
html = render(complete([row(1, { product_name: 'Egg' }), row(2, { product_name: 'Beef', branch_name: 'SM 2' }), row(3, { product_name: 'Rice' })]));
let text = flat(html);
assert.match(text, /Egg/);
assert.match(text, /Rice/);
assert.doesNotMatch(text, /Beef/, "another branch's corrections never show");
assert.match(text, /2 of 2 corrections/);

// cards: reason, cashier, time, the change, in the item's own unit
html = render(complete([
  row(1),
  row(2, { product_name: 'Egg', stock_unit_code: 'half_egg', details: { before: 10, after: 8, reason: 'Incorrect kitchen count', shift_id: 's1' } }),
  row(3, { product_name: 'Rice', details: { action: 'add', before: 5, after: 8, reason: 'Wrong stock count: kitchen short', shift_id: 's1' } }),
]));
text = flat(html);
assert.match(text, /Product 1\|Maria\|\+3\|Recount\|5 → 8 pcs\|Physical recount\|Nov 11, 3:20\s?PM/, 'name, cashier, +change, Recount, count line, reason, time');
assert.match(text, /Egg\|Maria\|−2\|Recount\|10 → 8 half-egg units\|Incorrect kitchen count/, "a decrease, in the item's own unit");
assert.match(text, /Rice\|Maria\|\+3\|Added stock\|5 → 8 pcs\|Wrong stock count: kitchen short/, 'added stock keeps its label and reason');
assert.doesNotMatch(text, /SM 1 · Maria/, 'the branch is in the header, not repeated on every card');
assert.match(text, /3 of 3 corrections\|Net \+6 pcs · −2 half-egg units\|/, 'a net change per unit (+3 and +3 pieces, −2 half-egg units): never added across units');

// pages of 10 (like Void logs)
html = render(complete(Array.from({ length: 25 }, (_, i) => row(i + 1))));
assert.equal(pager.visible, true);
assert.equal(pager.totalPages, 3);
assert.equal((html.match(/Product \d+/g) ?? []).length, 10, '10 to a page');

// the 500 limit: said, never hidden
const cut = { rows: Array.from({ length: 500 }, (_, i) => row(i + 1, { created_at: new Date(Date.UTC(2026, 10, 1) + i * 3600_000).toISOString() })), complete: false, pages: 10 };
html = render(cut);
assert.match(html, /data-notice="true"[^>]*>Only the newest 500 corrections were loaded \(back to Nov 1\)\. Older corrections are not counted, so these figures may be incomplete\./);
html = render(complete([row(1)]));
assert.doesNotMatch(html, /data-notice/, 'nothing to warn about when everything was loaded');
// a range that starts after the oldest loaded correction is fully covered, so it is not called partial
html = render(cut, {}, {}, withState({ 1: 'custom', 2: '2026-11-20', 3: '2026-11-21' }));
assert.doesNotMatch(html, /data-notice/, 'newest-first: everything after the oldest loaded one was loaded');
html = render(cut, {}, {}, withState({ 1: 'custom', 2: '2026-10-01', 3: '2026-11-21' }));
assert.match(html, /data-notice="true"/, 'a range that reaches back further than what was loaded is partial');

// older corrections: the button is offered while there are older ones to load, and only then
html = render(cut);
assert.equal(typeof noticeProps.onLoadOlder, 'function', 'partial, older ones can be loaded: "Load older corrections"');
noticeProps.onLoadOlder();
assert.equal(older, 1, 'the button loads the next older pages');
assert.equal(noticeProps.loading, false);
html = render(cut, {}, { loadingOlder: true, olderError: new Error('Network request failed') });
assert.equal(noticeProps.loading, true, 'shows it is loading');
assert.equal(noticeProps.error, 'Network request failed', 'a failure is said and what is loaded stays');
html = render({ ...cut, pages: 200 });
assert.equal(noticeProps.onLoadOlder, undefined, 'at the ceiling: no button, and the note says why');
assert.match(html, /That is the most this report can load \(10000\)\./);
html = render(complete([row(1)]));
assert.equal(noticeProps, undefined, 'complete: no notice, no button');

// empty states
html = render(complete([row(2, { branch_name: 'SM 2' })]));
assert.match(html, /data-empty="No stock corrections yet"[^>]*>Recounts and stock added by cashiers will appear here\./);
assert.match(html, /data-fill="true"/, 'nothing recorded: the message is in the middle of the screen');
html = render({ rows: [row(2, { branch_name: 'SM 2' })], complete: false, pages: 10 });
assert.match(html, /data-empty="None among the newest corrections"/, 'never "no corrections yet" when only the newest were checked');
html = render(complete([row(1)]), {}, {}, withState({ 0: 'zzz' }));
assert.match(html, /data-empty="No matching corrections"[^>]*>Try another branch, dates or product\./);
assert.match(flat(html), /0 of 1 correction/);
html = render({ rows: [row(1)], complete: false, pages: 10 }, {}, {}, withState({ 0: 'zzz' }));
assert.match(html, /Nothing among the newest corrections matches\. Older corrections are not searched\./);
html = render(complete([row(1)]), {}, {}, withState({ 1: 'custom', 2: '2026-11-11', 3: '' }));
assert.match(html, /data-empty="Select a date range"/, 'an incomplete custom range asks for the dates (like the other reports)');

// loading, error, retry
html = render(undefined, {}, { isPending: true });
assert.match(html, /data-loading="Loading stock corrections…"/);
assert.doesNotMatch(html, /data-empty/);
html = render(undefined, {}, { isPending: false, error: new Error('The requested service is currently unavailable.') });
assert.match(html, /data-error="The requested service is currently unavailable\."/);
feedback.onRetry();
assert.equal(refetched, 1);
assert.doesNotMatch(html, /data-empty/, 'an error is not "no corrections"');

// a branch that is not a selling branch of the list, or no branch at all: never everyone's corrections
html = render(complete([row(1), row(2, { branch_name: 'SM 2' })]), { branchName: undefined });
assert.match(html, /data-empty="Branch not found"/, 'unknown branch / the Main Branch');
assert.doesNotMatch(flat(html), /Product 1|Product 2/);
html = render(complete([row(1)]), { branchId: undefined, branchName: undefined });
assert.match(html, /data-empty="Branch not found"/, 'no branch chosen is not "all branches"');
html = render(complete([row(1)]), { branchLookupPending: true, branchName: undefined });
assert.doesNotMatch(html, /data-empty="Branch not found"/, 'still looking the branch up: not an error yet');

// the date range chosen on the overview arrives with the link
html = render(complete([row(1)]), { initialRangeType: 'custom', initialCustomStart: '2026-11-11', initialCustomEnd: '2026-11-11' }, {}, {});
assert.match(html, /data-range="all_time"|data-range="custom"/);

// source: the shared pieces, no ad-hoc layout
const src = read('src/features/reports/StockCorrectionsScreen.tsx');
for (const piece of ['ManagerScreenHeader', 'ConstrainedWidth', 'ErrorState', 'EmptyState', 'LoadingState', 'Pagination', 'DateRangeFilter', 'SearchInput']) assert.match(src, new RegExp(piece), piece);
assert.match(src, /useState<DateFilterType>\(initialRangeType\)/, 'starts on the range chosen in the overview');
assert.doesNotMatch(src, /ManagerActionButton/, 'no stray buttons');

console.log('Stock corrections branch screen passed: display helpers, branch scope, cards, pages, the 500 limit, states.');
