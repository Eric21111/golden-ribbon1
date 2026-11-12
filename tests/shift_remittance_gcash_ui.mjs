// Shift remittances: GCash looks like Cash. The detail screen gets a GCash card built like the Cash card (icon chips, big amounts, a result
// pill), the list's day card gets the same two rows instead of a plain sentence, and the plain-text lines are gone.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { loadTs } from './_load_ts.mjs';

const require = createRequire(import.meta.url);
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const rnw = require('react-native-web');
const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const flat = (html) => html.replace(/<[^>]+>/g, '|').replace(/\|+/g, '|').replace(/ /g, ' ');

// ---- 1. the GCash result
const { gcashResult } = loadTs('src/features/reports/reportDisplay.ts');
assert.deepEqual(gcashResult(100, 100), { shortage: 0, excess: 0 }, 'exact');
assert.deepEqual(gcashResult(100, 80), { shortage: 20, excess: 0 }, 'received less: shortage');
assert.deepEqual(gcashResult(100, 125.5), { shortage: 0, excess: 25.5 }, 'received more: excess');
assert.deepEqual(gcashResult('100.10', '100.1'), { shortage: 0, excess: 0 }, 'numeric strings from the server');
assert.deepEqual(gcashResult(0.3, 0.1 + 0.2), { shortage: 0, excess: 0 }, 'no floating-point noise');
assert.equal(gcashResult(100, null), null, 'not remitted yet: pending');
assert.equal(gcashResult(null, 50), null, 'no GCash expected');
assert.equal(gcashResult(100, undefined), null);
assert.equal(gcashResult('x', 5), null, 'garbage is not a result');

// ---- 2. the detail screen
let detail;
const Pass = (props) => React.createElement('div', null, props.children);
const Detail = loadTs('src/features/reports/ShiftRemittanceDetailScreen.tsx', {
  'react-native': rnw,
  '@react-native-vector-icons/ionicons': { __esModule: true, default: (p) => React.createElement('i', { 'data-icon': p.name }) },
  'expo-router': { useLocalSearchParams: () => ({ id: 's1' }) },
  '@/components/StockUnitHint': { StockUnitHint: () => null },
  '@/components/ConstrainedWidth': { ConstrainedWidth: Pass },
  '@/components/Pagination': { Pagination: () => null },
  '@/components/Screen': { Screen: Pass },
  '@/components/dashboard/FilterChipRow': { FilterChipRow: () => null },
  '@/components/dashboard/ManagerBadge': { ManagerBadge: () => null },
  '@/components/dashboard/ManagerFeedback': { EmptyState: () => null, ErrorState: () => null, LoadingState: () => null },
  '@/components/dashboard/ManagerScreenHeader': { ManagerScreenHeader: () => null },
  '@/components/dashboard/theme': { managerColors: { ink: '#111', subtext: '#667', royalBlue: '#13c', green: '#0a0', goldMuted: '#a80', cardBorder: '#ddd', cardSurface: '#f4f6fa' } },
  '@/hooks/useClientPagination': { useClientPagination: () => ({ pageItems: [], showPagination: false, page: 0, totalPages: 1, setPage: () => {} }) },
  '@/hooks/useShifts': { useShiftCloseReportDetail: () => ({ data: detail, isLoading: false, error: null, refetch: () => {} }) },
  '@/lib/errors': { getErrorMessage: (e) => String(e) },
}).ShiftRemittanceDetailScreen;
const base = {
  branch_name: 'SM1', cashier_name: 'SM1-Cashier', started_at: '2026-11-12T07:32:00+08:00', ended_at: '2026-11-12T08:34:00+08:00', sales_cutoff_at: '2026-11-12T08:34:00+08:00',
  expected_cash: 48, actual_cash: 48, cash_status: 'reconciled', cash_result: 'exact', difference: 0, products: [],
};
const renderDetail = (over) => { detail = { ...base, ...over }; return renderToStaticMarkup(React.createElement(Detail)); };
const money = (n) => `₱\\s?${n.toFixed(2).replace('.', '\\.')}`;

// exact: Cash card, then a GCash card built the same way
let text = flat(renderDetail({ expected_gcash: 100, actual_gcash: 100 }));
assert.match(text, new RegExp(`Cash\\|Expected Cash\\|${money(48)}\\|Actual Cash\\|${money(48)}\\|Exact match\\|GCash\\|Expected GCash\\|${money(100)}\\|Actual GCash\\|${money(100)}\\|Exact match`), 'Cash card, then a GCash card with the same rows and pill');
assert.ok(text.indexOf('Expected Cash') < text.indexOf('Expected GCash'), 'Cash first, like the list screen');
assert.doesNotMatch(text, /Expected:|Received:|Exact ·/, 'no plain-text lines');
assert.match(renderDetail({ expected_gcash: 100, actual_gcash: 100 }), /data-icon="phone-portrait-outline"/, 'a GCash icon chip');

// shortage / excess on GCash use the same pill as cash
assert.match(flat(renderDetail({ expected_gcash: 100, actual_gcash: 80 })), new RegExp(`Actual GCash\\|${money(80)}\\|${money(20)} shortage`));
assert.match(flat(renderDetail({ expected_gcash: 100, actual_gcash: 125.5 })), new RegExp(`${money(25.5)} excess`));
// the two cards are independent: cash short, GCash exact
text = flat(renderDetail({ cash_result: 'shortage', difference: -5, actual_cash: 43, expected_gcash: 100, actual_gcash: 100 }));
assert.match(text, new RegExp(`${money(5)} shortage\\|GCash\\|Expected GCash\\|${money(100)}\\|Actual GCash\\|${money(100)}\\|Exact match`));

// GCash not remitted yet
text = flat(renderDetail({ expected_gcash: 100, actual_gcash: null }));
assert.match(text, /Actual GCash\|—\|GCash is still pending\./);

// no GCash on this shift (older shifts): exactly as before
text = flat(renderDetail({ expected_gcash: null, actual_gcash: null }));
assert.match(text, /Collections\|Expected Cash/);
assert.doesNotMatch(text, /GCash/);

// ---- 3. the list screen
let days;
const List = loadTs('src/features/reports/ShiftRemittanceScreen.tsx', {
  'react-native': rnw,
  '@react-native-vector-icons/ionicons': { __esModule: true, default: (p) => React.createElement('i', { 'data-icon': p.name }) },
  'expo-router': { router: { push() {} } },
  '@/components/ConstrainedWidth': { ConstrainedWidth: Pass },
  '@/components/Pagination': { Pagination: () => null },
  '@/components/Screen': { Screen: Pass },
  '@/components/dashboard/ListRowCard': { ListRowCard: (p) => React.createElement('div', null, p.title, p.metaRow, p.trailing) },
  '@/components/dashboard/ManagerFeedback': { EmptyState: () => null, ErrorState: () => null, LoadingState: () => null },
  '@/components/dashboard/ManagerScreenHeader': { ManagerScreenHeader: () => null },
  '@/components/dashboard/theme': { managerColors: { ink: '#111', subtext: '#667', royalBlue: '#13c', green: '#0a0', goldMuted: '#a80', cardBorder: '#ddd', cardSurface: '#f4f6fa' } },
  '@/features/reports/DateRangeFilter': { DateRangeFilter: () => null, resolveReportRange: () => ({ rpcRangeType: 'today', startIso: null, endIso: null }) },
  '@/features/auth/AuthProvider': { useAuth: () => ({ profile: { role: 'manager' } }) },
  '@/hooks/useClientPagination': { useClientPagination: (items) => ({ pageItems: items, showPagination: false, page: 0, totalPages: 1, setPage: () => {} }) },
  '@/hooks/useShifts': { useShiftRemittances: () => ({ data: { days }, isLoading: false, error: null, refetch: () => {} }) },
  '@/lib/errors': { getErrorMessage: (e) => String(e) },
  '@/lib/nameAccent': { accentForName: () => 'blue' },
}).ShiftRemittanceScreen;
const shift = { shift_id: 's1', branch_name: 'SM1', cashier_name: 'SM1-Cashier', started_at: '2026-11-12T07:32:00+08:00', ended_at: '2026-11-12T08:34:00+08:00', status: 'reconciled', result: 'exact', difference: 0, expected_cash: 48, actual_cash: 48 };
const day = (over = {}, shiftOver = {}) => ({
  business_date: '2026-11-12', total_shortage: 0, total_excess: 0, pending_expected_cash: 0, pending_shift_count: 0, reconciled_shift_count: 1,
  expected_cash: 48, actual_remitted: 48, shifts: [{ ...shift, ...shiftOver }], ...over,
});
const renderList = (d) => { days = [d]; return renderToStaticMarkup(React.createElement(List)); };

text = flat(renderList(day({ expected_gcash: 100, actual_gcash: 100, pending_gcash: 0 }, { expected_gcash: 100, actual_gcash: 100 })));
assert.match(text, new RegExp(`Expected Cash\\|${money(48)}\\|Cash remitted\\|${money(48)}\\|Expected GCash\\|${money(100)}\\|GCash remitted\\|${money(100)}`), 'the day card has GCash rows like Cash');
assert.doesNotMatch(text, /GCash expected|Remitted ₱|Pending ₱/, 'the plain sentence is gone');
assert.doesNotMatch(text, /GCash pending/, 'no pending note when nothing is pending');
assert.match(text, new RegExp(`GCash ${money(100)} / ${money(100)}`), 'each shift keeps its GCash received / expected');
assert.match(renderList(day({ expected_gcash: 100, actual_gcash: 100, pending_gcash: 0 })), /data-icon="phone-portrait-outline"/);

// pending GCash is called out like pending cash
text = flat(renderList(day({ expected_gcash: 100, actual_gcash: null, pending_gcash: 100 }, { expected_gcash: 100, actual_gcash: null })));
assert.match(text, new RegExp(`GCash remitted\\|—`));
assert.match(text, new RegExp(`${money(100)} GCash pending`));
assert.match(text, new RegExp(`GCash — / ${money(100)}`));

// shifts without GCash: no GCash anywhere
text = flat(renderList(day({ expected_gcash: null })));
assert.doesNotMatch(text, /GCash/);
assert.match(text, /Expected Cash/);

// ---- 4. source: no unstyled text left for GCash on either screen
for (const file of ['src/features/reports/ShiftRemittanceDetailScreen.tsx', 'src/features/reports/ShiftRemittanceScreen.tsx']) {
  const src = read(file);
  assert.doesNotMatch(src, /<Text>(GCash|Expected:|Received:)/, `${file}: no unstyled GCash text`);
}

console.log('Shift remittance GCash UI passed: GCash result, matching card on the detail screen, matching rows on the list, pending and no-GCash cases.');
