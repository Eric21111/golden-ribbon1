// Empty / loading / error states look the same everywhere: the shared centred state, not a list of identical "No waste recorded" lines
// or loose unstyled text. Waste History shows ONE centred "No waste recorded" when nothing was wasted anywhere in the period; the report
// screens let their message fill the screen under the filter so it sits in the middle; the cashier screens that used plain text now use
// the shared states.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { loadTs } from './_load_ts.mjs';

const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const require = createRequire(import.meta.url);
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const rnw = require('react-native-web');
const flat = (html) => html.replace(/<[^>]+>/g, '|').replace(/\|+/g, '|');

const shift = (id, status, over = {}) => ({ shift_id: id, business_date: '2026-11-12', branch_id: 'b', branch_name: 'SM 1', cashier_id: 'c', cashier_name: 'Cashier 1', started_at: '2026-11-12T00:00:00Z', ended_at: '2026-11-12T08:00:00Z', waste_status: status, occurrences: [], ...over });
const quietDay = (date, status = 'no_waste') => ({ business_date: date, occurrence_count: 0, distinct_product_count: 0, shifts: [shift('s-' + date, status)] });
const wasteDay = (date) => ({
  business_date: date, occurrence_count: 1, distinct_product_count: 1,
  shifts: [shift('w-' + date, 'waste_recorded', { occurrences: [{ occurrence_id: 'o', product_id: 'p', product_name: 'Rice', recorded_at: '2026-11-12T01:00:00Z', recorded_by: 'u', note: null, quantity: 4 }] })],
});

// ---- 1. Waste History
let state = { days: [], isFetched: true, error: null, isLoading: false };
const { WasteHistoryScreen } = loadTs('src/features/reports/WasteHistoryScreen.tsx', {
  'react-native': rnw,
  '@react-native-vector-icons/ionicons': { __esModule: true, default: (p) => React.createElement('i', { 'data-icon': p.name }) },
  '@/components/GlyphIcon': { GlyphIcon: () => null },
  '@/components/ConstrainedWidth': { ConstrainedWidth: (p) => React.createElement('div', null, p.children) },
  '@/components/Pagination': { Pagination: () => React.createElement('nav', null, 'PAGER') },
  '@/components/Screen': { Screen: (p) => React.createElement('main', null, p.children) },
  '@/components/dashboard/ManagerFeedback': {
    EmptyState: (p) => React.createElement('div', null, `EMPTY:${p.title}|${p.message}`),
    ErrorState: () => React.createElement('div', null, 'ERROR'),
    LoadingState: () => React.createElement('div', null, 'LOADING'),
  },
  '@/components/dashboard/ManagerBottomSheet': { ManagerBottomSheet: () => null },
  '@/components/dashboard/ManagerScreenHeader': { ManagerScreenHeader: (p) => React.createElement('header', null, p.title) },
  '@/features/reports/DateRangeFilter': { DateRangeFilter: () => React.createElement('div', null, 'RANGE'), resolveReportRange: () => ({ rpcRangeType: 'today', startIso: null, endIso: null }) },
  '@/features/auth/AuthProvider': { useAuth: () => ({ profile: { role: 'manager' } }) },
  '@/hooks/useClientPagination': { useClientPagination: (items) => ({ pageItems: items, showPagination: items.length > 5, page: 0, totalPages: 2, setPage() {} }) },
  '@/hooks/useShifts': { useShiftWaste: () => ({ data: { days: state.days }, isLoading: state.isLoading, error: state.error, isFetched: state.isFetched, refetch() {} }) },
});
const waste = (next) => { state = { days: [], isFetched: true, error: null, isLoading: false, ...next }; return flat(renderToStaticMarkup(React.createElement(WasteHistoryScreen))); };

// nothing wasted on any day: one centred message, not a list of identical lines (the screenshot)
let text = waste({ days: [quietDay('2026-11-12'), quietDay('2026-11-11')] });
assert.match(text, /RANGE\|EMPTY:No waste recorded\|No waste was recorded in this period\./, 'the date filter, then the shared empty state');
assert.doesNotMatch(text, /Nov 12, 2026|Nov 11, 2026/, 'no per-day "No waste recorded" lines');
assert.doesNotMatch(text, /PAGER/, 'no pager under an empty state');

// a single quiet day is the same
assert.match(waste({ days: [quietDay('2026-11-12')] }), /EMPTY:No waste recorded/);

// waste somewhere in the period: the day list stays, quiet days keep their one line
text = waste({ days: [wasteDay('2026-11-12'), quietDay('2026-11-11')] });
assert.doesNotMatch(text, /EMPTY:/);
assert.match(text, /Nov 11, 2026\|No waste recorded\|/, 'a quiet day among days with waste is still one line');
assert.match(text, /Nov 12, 2026\|Total waste\|4 stock units/);

// a shift still pending is not "no waste": the list explains it
text = waste({ days: [quietDay('2026-11-12', 'pending'), quietDay('2026-11-11')] });
assert.doesNotMatch(text, /EMPTY:/);
assert.match(text, /Nov 12, 2026\|Pending\|/);

// the other states are unchanged
assert.match(waste({ days: [] }), /EMPTY:No waste history\|No reconciliation-aware closed shifts in this range\./);
assert.match(waste({ days: [], error: new Error('x') }), /ERROR/);
assert.doesNotMatch(waste({ days: [quietDay('2026-11-12')], error: new Error('x') }), /EMPTY:No waste recorded/, 'an error is never shown as "no waste"');
assert.match(waste({ days: [], isLoading: true, isFetched: false }), /LOADING/);
assert.doesNotMatch(waste({ days: [quietDay('2026-11-12')], isFetched: false }), /EMPTY:No waste recorded/, 'not before the data has loaded');

// ---- 2. the report screens let the message fill the space under the filter (so it is centred)
const grow = [
  ['src/features/reports/WasteHistoryScreen.tsx', /column: \{ flexGrow: 1,/],
  ['src/features/reports/ShiftRemittanceScreen.tsx', /column: \{ flexGrow: 1,/],
  ['src/features/reports/ShiftRemittanceDetailScreen.tsx', /column: \{ flexGrow: 1,/],
  ['src/features/reports/ReportsScreens.tsx', /column: \{ flexGrow: 1,/],
  ['src/features/reports/BranchPerformanceScreens.tsx', /column: \{ flexGrow: 1,/],
  ['src/features/reports/DiscrepancyReportsScreens.tsx', /column: \{ flexGrow: 1,/],
  ['src/features/reports/InventoryReconciliationScreen.tsx', /column: \{ flexGrow: 1,/],
  ['app/(manager)/manager/reports/product-sales.tsx', /column: \{ flexGrow: 1,/],
];
for (const [file, pattern] of grow) {
  const src = read(file);
  assert.match(src, pattern, `${file}: the column grows`);
  assert.match(src, /screenContent: \{ flexGrow: 1|screen: \{ flexGrow: 1/, `${file}: and so does the screen content it sits in`);
}
// ...and the rows that sit above that message must NOT grow with it. A horizontal ScrollView fills spare height by default, which
// pushed the date pills to the middle of the screen with big gaps around them.
const pills = read('src/features/reports/DateRangeFilter.tsx');
assert.match(pills, /<ScrollView horizontal[^>]*style=\{styles\.rowScroll\}/, 'the date-range pills');
assert.match(pills, /rowScroll: \{ flexGrow: 0 \}/);
const chips = read('src/components/dashboard/FilterChipRow.tsx');
assert.match(chips, /style=\{\[styles\.scroll, bleed > 0/, 'every chip row');
assert.match(chips, /scroll: \{ flexGrow: 0 \}/);
// no other horizontal ScrollView sits in a report column without being kept to its own height
for (const [file] of grow) {
  const src = read(file);
  for (const match of src.matchAll(/<ScrollView\b[^>]*horizontal[^>]*>/g)) assert.match(match[0], /flexGrow|styles\.\w*[Ss]croll/, `${file}: a horizontal ScrollView stays its own height`);
}

// the shared state itself centres within whatever room it is given
const feedback = read('src/components/Feedback.tsx');
assert.match(feedback, /center: \{ flex: 1, minHeight: 220, alignItems: 'center', justifyContent: 'center'/);

// ---- 3. cashier screens that used loose text now use the shared states
for (const file of ['app/(cashier)/cashier/inventory.tsx', 'app/(cashier)/cashier/payment-totals.tsx']) {
  const src = read(file);
  assert.match(src, /from '@\/components\/dashboard\/ManagerFeedback'/, `${file}: the shared states`);
  assert.doesNotMatch(src, /<Text>(Loading (stock|sales)…|No active shift\.|No matching branch stock items\.)<\/Text>/, `${file}: no loose status text`);
  assert.doesNotMatch(src, /label="Unable to load (stock|sales) · Retry"/, `${file}: no button posing as an error message`);
}
const inv = read('app/(cashier)/cashier/inventory.tsx');
assert.match(inv, /<LoadingState label="Loading stock…" \/>/);
assert.match(inv, /<ErrorState message=\{getErrorMessage\(error\)\} onRetry=/);
assert.match(inv, /title=\{search \? 'No matching stock' : 'No stock recorded'\}/);
assert.match(read('app/(cashier)/cashier/payment-totals.tsx'), /<EmptyState title="No active shift" message="Start a shift to see its sales\." \/>/);

console.log('Empty state consistency passed: Waste History, report screens, and the cashier screens with loose text.');
