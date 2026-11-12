// Stock corrections (Owner / Main Branch Manager): built like the other report screens. Shared header, loading / error / empty states,
// compact correction cards, and the shared pager instead of Refresh / Previous / Next buttons.
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
assert.equal(d.correctionPageCount(2, 50), 4);
assert.equal(d.correctionPageCount(2, 7), 3, 'the last page');
assert.match(d.formatCorrectionTime('2026-11-11T07:20:00Z'), /Nov 11, 3:20\s?PM/, 'shown in Manila time');
assert.equal(d.formatCorrectionTime('not a date'), '');

// ---- 2. the screen
let role = 'owner';
let column;
let queryState;
let queryOptions;
let refetches = 0;
const listCalls = [];
let header;
let pager;
let feedback;
const Pass = (props) => React.createElement('div', null, props.children);
const Screen = loadTs('src/features/reports/StockCorrectionsScreen.tsx', {
  'react-native': rnw,
  '@react-native-vector-icons/ionicons': { __esModule: true, default: () => null },
  '@tanstack/react-query': { useQuery: (options) => { queryOptions = options; return queryState; } },
  '@/components/ConstrainedWidth': { ConstrainedWidth: (props) => { column = props; return React.createElement('div', null, props.children); } },
  '@/components/Screen': { Screen: Pass },
  '@/components/Pagination': { Pagination: (props) => { pager = props; return React.createElement('nav', { 'data-page': props.page, 'data-total': props.totalPages, 'data-visible': String(props.visible) }); } },
  '@/components/dashboard/ManagerScreenHeader': { ManagerScreenHeader: (props) => { header = props; return React.createElement('h1', null, props.title, '|', props.subtitle); } },
  '@/components/dashboard/ManagerFeedback': {
    LoadingState: (props) => React.createElement('p', { 'data-loading': props.label }),
    ErrorState: (props) => { feedback = props; return React.createElement('p', { 'data-error': props.message }); },
    EmptyState: (props) => React.createElement('p', { 'data-empty': props.title }, props.message),
  },
  '@/components/dashboard/theme': { managerColors: { ink: '#111', subtext: '#667', royalBlue: '#13c', cardBorder: '#ddd' } },
  '@/features/auth/AuthProvider': { useAuth: () => ({ profile: { id: 'u1', role } }) },
  '@/lib/errors': { getErrorMessage: (error) => error.message },
  '@/services/stockCorrectionService': { listCorrections: async (offset) => { listCalls.push(offset); return []; } },
}).default;
const render = (state) => { queryState = { isPending: false, error: null, data: [], refetch: () => { refetches++; }, ...state }; pager = undefined; feedback = undefined; return renderToStaticMarkup(React.createElement(Screen)); };
const row = (n, over = {}) => ({
  id: `c${n}`, created_at: '2026-11-11T07:20:00Z', product_name: `Product ${n}`, stock_unit_code: null, branch_name: 'SM 1', cashier_name: 'Maria',
  details: { before: 5, after: 8, reason: 'Physical recount', shift_id: 's1' }, ...over,
});

// the same header as the other reports
render({ data: [] });
assert.equal(header.title, 'Stock count changes');
assert.equal(header.subtitle, undefined, 'the same plain header as Waste History: title only');
assert.equal(header.showBack, true, 'the owner drills in from Reports: back arrow');
role = 'manager';
render({ data: [] });
assert.equal(header.showBack, false, 'the manager has it in the sidebar: menu icon, like Waste History');
role = 'owner';

// loading
let html = render({ isPending: true, data: undefined });
assert.equal(column.fill, true, 'loading sits in the middle of the screen');
assert.match(html, /data-loading="Loading stock corrections…"/);
assert.doesNotMatch(html, /data-empty|data-error/);

// error: the shared error state with Retry (no plain red text, no stray buttons)
html = render({ isPending: false, error: new Error('The requested service is currently unavailable.'), data: undefined });
assert.match(html, /data-error="The requested service is currently unavailable\."/);
assert.equal(column.fill, true, 'so does the error');
feedback.onRetry();
assert.equal(refetches, 1, 'Retry refetches');
assert.doesNotMatch(html, /data-empty/, 'an error is not also "no corrections"');

// empty
assert.match(render({ data: [] }), /data-empty="No corrections"[^>]*>No stock counts have been corrected yet\./);
assert.equal(pager.visible, false, 'no pager when everything fits');
assert.equal(column.fill, true, 'the empty message is centred in the screen, not left under the header');

// rows: compact cards
html = render({ data: [row(1), row(2, { product_name: 'Egg', stock_unit_code: 'half_egg', details: { before: 10, after: 8, reason: 'Incorrect kitchen count', shift_id: 's1' } })] });
const text = flat(html);
assert.match(text, /Product 1\|SM 1 · Maria\|\+3\|5 → 8 pcs\|Physical recount\|Nov 11, 3:20\s?PM/, 'name, branch · cashier, +change, count line, reason, time');
assert.match(text, /Egg\|SM 1 · Maria\|−2\|10 → 8 half-egg units\|Incorrect kitchen count/, 'a decrease, in the item\'s own unit');
assert.doesNotMatch(html, /Verified counts entered by cashiers|These adjustments are included in remittance/, 'no helper paragraph');
assert.doesNotMatch(html, />Refresh<|>Previous page<|>Next page</, 'no stray Refresh / Previous / Next buttons');
assert.equal(column.fill, false, 'with cards the list starts under the header as usual');
assert.equal(pager.visible, false);

// pager: shown when a full page may have more, and on later pages; it asks for the right offset
const fifty = Array.from({ length: 50 }, (_, i) => row(i));
render({ data: fifty });
assert.equal(pager.visible, true);
assert.equal(pager.totalPages, 2);
assert.equal(pager.page, 0);
assert.equal(typeof pager.onPageChange, 'function');
await queryOptions.queryFn();
assert.deepEqual(listCalls, [0], 'page 1 asks for offset 0');
assert.deepEqual(queryOptions.queryKey, ['stock-corrections', 'u1', 0]);
assert.equal(queryOptions.staleTime, 0, 'always fresh');
assert.equal(queryOptions.enabled, true);

// source: the shared pieces, no ad-hoc layout
const src = read('src/features/reports/StockCorrectionsScreen.tsx');
for (const piece of ['ManagerScreenHeader', 'ConstrainedWidth', 'ErrorState', 'EmptyState', 'LoadingState', 'Pagination']) assert.match(src, new RegExp(piece), piece);
assert.doesNotMatch(src, /ManagerActionButton/, 'the Refresh / Previous / Next buttons are gone');
assert.doesNotMatch(src, /borderColor: '#CBD5E1'/, 'no one-off card style');

console.log('Stock corrections screen passed: display helpers, shared states, compact cards, shared pager.');
