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
const { gcashResult, remittanceTenderTotals, remittanceAmountLabel, remittanceSummaryAmountLabel, shouldStackRemittanceKpis, NO_REMITTANCE_RECORDED } = loadTs('src/features/reports/reportDisplay.ts');
assert.deepEqual(gcashResult(100, 100), { shortage: 0, excess: 0 }, 'exact');
assert.deepEqual(gcashResult(100, 80), { shortage: 20, excess: 0 }, 'received less: shortage');
assert.deepEqual(gcashResult(100, 125.5), { shortage: 0, excess: 25.5 }, 'received more: excess');
assert.deepEqual(gcashResult('100.10', '100.1'), { shortage: 0, excess: 0 }, 'numeric strings from the server');
assert.deepEqual(gcashResult(0.3, 0.1 + 0.2), { shortage: 0, excess: 0 }, 'no floating-point noise');
assert.equal(gcashResult(100, null), null, 'not remitted yet: pending');
assert.equal(gcashResult(null, 50), null, 'no GCash expected');
assert.equal(gcashResult(100, undefined), null);
assert.equal(gcashResult('x', 5), null, 'garbage is not a result');
assert.deepEqual(remittanceTenderTotals(undefined), { cash: null, gcash: null, hasGcash: false });
assert.deepEqual(
  remittanceTenderTotals({
    days: [
      { expected_gcash: 100, actual_gcash: 80, actual_remitted: 48 },
      { expected_gcash: 50, actual_gcash: null, actual_remitted: 20 },
    ],
  }),
  { cash: 68, gcash: 80, hasGcash: true },
);
assert.equal(NO_REMITTANCE_RECORDED, 'No remittance recorded');
assert.equal(remittanceAmountLabel(null), NO_REMITTANCE_RECORDED);
assert.equal(remittanceAmountLabel(undefined), NO_REMITTANCE_RECORDED);
assert.equal(remittanceAmountLabel(0), '₱0.00');
assert.equal(remittanceAmountLabel(17025), '₱17,025.00');
assert.equal(remittanceAmountLabel(null, 'loading'), '—');
assert.equal(remittanceAmountLabel(48, 'error'), '—');
assert.equal(remittanceSummaryAmountLabel(null), '₱0.00', 'summary missing data is a display-only ₱0.00');
assert.equal(remittanceSummaryAmountLabel(undefined), '₱0.00');
assert.equal(remittanceSummaryAmountLabel(0), '₱0.00');
assert.equal(remittanceSummaryAmountLabel(17025), '₱17,025.00');
assert.equal(remittanceSummaryAmountLabel(null, 'loading'), '—');
assert.notEqual(remittanceAmountLabel(null), remittanceSummaryAmountLabel(null), 'null vs zero stays distinct outside summary KPIs');
assert.equal(shouldStackRemittanceKpis('₱363.00', '₱0.00', 360), false, 'short GCash/zero stay 2-col on a phone');
assert.equal(shouldStackRemittanceKpis('₱17,025.00', '₱5,000.00', 800), false, 'tablet 2-col when both values are short money');
assert.equal(shouldStackRemittanceKpis('₱355,397.00', '₱363.00', 360), true, '₱355,397.00 cannot fit a phone half-tile');
assert.equal(shouldStackRemittanceKpis('₱100,000.00', '₱363.00', 360), true, '₱100,000+ stacks on a phone');
assert.equal(shouldStackRemittanceKpis('₱10,000,000.00', '₱100,000.00', 360), true, '₱10,000,000 stacks on a phone');
assert.equal(shouldStackRemittanceKpis('₱10,000,000.00', '₱100,000.00', 800), false, 'millions still fit 2-col on tablet');
assert.equal(shouldStackRemittanceKpis('₱17,025.00', '₱5,000.00', 300, 1.5), true, 'very narrow / large text scale stacks');
assert.equal(shouldStackRemittanceKpis('1474', '₱105,607.00', 360), true, 'product revenue stacks on a phone');
assert.equal(shouldStackRemittanceKpis('107', '₱355,760.00', 360), true, 'sales remittance stacks on a phone');

// ---- 2. the detail screen
let detail;
const Pass = (props) => React.createElement('div', null, props.children);
const Detail = loadTs('src/features/reports/ShiftRemittanceDetailScreen.tsx', {
  '@/lib/supabase': {supabase:{}},
  '@/features/auth/AuthProvider': {useAuth:()=>({profile:{role:'manager'}})},
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
  '@/components/dashboard/ManagerBottomSheet': { ManagerBottomSheet: Pass },
  '@/components/dashboard/ManagerScreenHeader': { ManagerScreenHeader: () => null },
  '@/components/dashboard/theme': { managerColors: { ink: '#111', subtext: '#667', royalBlue: '#13c', green: '#0a0', goldMuted: '#a80', cardBorder: '#ddd', cardSurface: '#f4f6fa' } },
  '@/hooks/useClientPagination': { useClientPagination: () => ({ pageItems: [], showPagination: false, page: 0, totalPages: 1, setPage: () => {} }) },
  '@/hooks/useSales': { useShiftSales: () => ({ data: [], isLoading: false, error: null, refetch: () => {} }) },
  '@/hooks/useShifts': {
    useManagerShiftPayments: () => ({ data: [], isLoading: false, error: null }),
    useShiftCloseReportDetail: () => ({ data: detail, isLoading: false, error: null, refetch: () => {} }),
    useManagerShiftPayments: () => ({ data: [], isLoading: false, error: null, refetch: () => {} }),
  },
  '@/lib/errors': { getErrorMessage: (e) => String(e) },
  '@tanstack/react-query': { useQuery: () => ({ data: null, isSuccess: true }) },
  '@/services/stockUnitCutoverService': { getEggHalfUnitCutoverAt: async () => null },
}).ShiftRemittanceDetailScreen;
const base = {
  branch_name: 'SM1', cashier_name: 'SM1-Cashier', started_at: '2026-11-12T07:32:00+08:00', ended_at: '2026-11-12T08:34:00+08:00', sales_cutoff_at: '2026-11-12T08:34:00+08:00',
  expected_cash: 48, actual_cash: 48, cash_status: 'reconciled', cash_result: 'exact', difference: 0, products: [],
};
const renderDetail = (over) => { detail = { ...base, ...over }; return renderToStaticMarkup(React.createElement(Detail)); };
assert.match(flat(renderDetail({selected_return_close:true,return_number:'RET-123'})), /View return.*RET-123/);
const money = (n) => `₱\\s?${n.toFixed(2).replace('.', '\\.')}`;

// exact: Cash card, then a GCash card built the same way
let text = flat(renderDetail({ expected_gcash: 100, actual_gcash: 100 }));
assert.match(text, new RegExp(`Cash\\|Expected cash\\|${money(48)}\\|Cash remitted\\|${money(48)}\\|Exact match`));
assert.match(text, new RegExp(`GCash\\|Expected GCash\\|${money(100)}\\|GCash remitted\\|${money(100)}\\|Exact match`));
assert.ok(text.indexOf('Expected cash') < text.indexOf('Expected GCash'), 'Cash first, like the list screen');
assert.doesNotMatch(text, /Sales Breakdown/, 'sales breakdown removed from detail');
assert.doesNotMatch(text, /Expected:|Received:|Exact ·/, 'no plain-text lines');
assert.match(renderDetail({ expected_gcash: 100, actual_gcash: 100 }), /data-icon="phone-portrait-outline"/, 'a GCash icon chip');

// shortage / excess on GCash use the same pill as cash
assert.match(flat(renderDetail({ expected_gcash: 100, actual_gcash: 80 })), new RegExp(`GCash remitted\\|${money(80)}\\|${money(20)} shortage`));
assert.match(flat(renderDetail({ expected_gcash: 100, actual_gcash: 125.5 })), new RegExp(`${money(25.5)} excess`));
// the two cards are independent: cash short, GCash exact
text = flat(renderDetail({ cash_result: 'shortage', difference: -5, actual_cash: 43, expected_gcash: 100, actual_gcash: 100 }));
assert.match(text, new RegExp(`${money(5)} shortage`));
assert.match(text, new RegExp(`GCash\\|Expected GCash\\|${money(100)}\\|GCash remitted\\|${money(100)}\\|Exact match`));

// GCash not remitted yet
text = flat(renderDetail({ expected_gcash: 100, actual_gcash: null }));
assert.match(text, /GCash remitted\|—\|GCash is still pending\./);

function renderSummaryCards({ width = 360, fontScale = 1, cash, gcash, hasGcash = true }) {
  const { RemittanceSummaryCards } = loadTs('src/features/reports/RemittanceSummaryCards.tsx', {
    'react-native': {
      ...rnw,
      useWindowDimensions: () => ({ width, height: 800, fontScale, scale: 2 }),
    },
    '@/components/dashboard/StatTile': {
      StatTile: (p) =>
        React.createElement(
          'div',
          { 'data-layout': p.layout === 'wide' ? 'wide' : p.compact ? 'compact' : 'square' },
          `${p.label}:${p.value}`,
        ),
    },
  });
  return renderToStaticMarkup(
    React.createElement(RemittanceSummaryCards, {
      combined: '₱17,025.00',
      pending: 1,
      reconciled: 1,
      cash,
      gcash,
      hasGcash,
    }),
  );
}

let summaryHtml = renderSummaryCards({
  width: 360,
  cash: '₱17,025.00',
  gcash: '₱0.00',
});
assert.match(summaryHtml, /Total remitted collections:₱17,025\.00/);
assert.doesNotMatch(summaryHtml, /Combined collections/);
assert.match(summaryHtml, /Pending shifts:1/);
assert.match(summaryHtml, /Reconciled shifts:1/);
assert.match(summaryHtml, /data-layout="compact">Pending shifts:1/);
assert.match(summaryHtml, /data-layout="wide">Cash remitted:₱17,025\.00/);
assert.match(summaryHtml, /data-layout="wide">GCash remitted:₱0\.00/);
assert.doesNotMatch(summaryHtml, /No remittance/);
assert.doesNotMatch(summaryHtml, /₱17,025\.\.\./);

summaryHtml = renderSummaryCards({
  width: 360,
  cash: '₱355,397.00',
  gcash: '₱363.00',
});
assert.match(summaryHtml, /data-layout="wide">Cash remitted:₱355,397\.00/);
assert.match(summaryHtml, /data-layout="wide">GCash remitted:₱363\.00/);
assert.doesNotMatch(summaryHtml, /₱355,397\.\.\./);

summaryHtml = renderSummaryCards({
  width: 360,
  cash: '₱10,000,000.00',
  gcash: '₱100,000.00',
});
assert.match(summaryHtml, /Cash remitted:₱10,000,000\.00/);
assert.match(summaryHtml, /GCash remitted:₱100,000\.00/);
assert.doesNotMatch(summaryHtml, /\.\.\./);

summaryHtml = renderSummaryCards({
  width: 800,
  cash: '₱17,025.00',
  gcash: '₱5,000.00',
});
assert.match(summaryHtml, /data-layout="compact">Cash remitted:₱17,025\.00/);
assert.match(summaryHtml, /data-layout="compact">GCash remitted:₱5,000\.00/);

summaryHtml = renderSummaryCards({
  width: 800,
  cash: '₱0.00',
  gcash: '₱0.00',
});
assert.match(summaryHtml, /data-layout="compact">GCash remitted:₱0\.00/, '₱0.00 stays a compact amount, not the empty-state copy');

// no GCash on this shift (older shifts): exactly as before
text = flat(renderDetail({ expected_gcash: null, actual_gcash: null }));
assert.match(text, /Remittance\|Expected remittance/);
assert.doesNotMatch(text, /GCash/);

// ---- 3. the list screen
let days;
const List = loadTs('src/features/reports/ShiftRemittanceScreen.tsx', {
  'react-native': rnw,
  '@react-native-vector-icons/ionicons': { __esModule: true, default: (p) => React.createElement('i', { 'data-icon': p.name }) },
  'expo-router': {
    router: { push() {} },
    useFocusEffect: (callback) => callback(),
    useLocalSearchParams: () => ({ branchId: 'b1', range: 'today' }),
  },
  '@/components/ConstrainedWidth': { ConstrainedWidth: Pass },
  '@/components/Pagination': { Pagination: () => null },
  '@/components/Screen': { Screen: Pass },
  '@/components/dashboard/ManagerFeedback': { EmptyState: () => null, ErrorState: () => null, LoadingState: () => null },
  '@/components/dashboard/ManagerScreenHeader': { ManagerScreenHeader: () => null },
  '@/components/dashboard/StatTile': {
    StatTile: (p) => React.createElement('div', null, `${p.label}:${p.value}`),
  },
  '@/components/dashboard/theme': {
    managerColors: { ink: '#111', subtext: '#667', royalBlue: '#13c', green: '#0a0', goldMuted: '#a80', cardBorder: '#ddd', cardSurface: '#f4f6fa', pageCanvas: '#f4f6fb' },
  },
  '@/features/reports/ReportSectionHeading': {
    ReportSectionHeading: (p) => React.createElement('div', null, p.title),
  },
  '@/features/reports/DateRangeFilter': { DateRangeFilter: () => null, resolveReportRange: () => ({ rpcRangeType: 'today', startIso: null, endIso: null }) },
  '@/features/auth/AuthProvider': { useAuth: () => ({ profile: { role: 'manager' } }) },
  '@/hooks/useBranches': { useBranches: () => ({ data: [{ id: 'b1', name: 'SM1' }], isLoading: false, error: null, refetch: () => {} }) },
  '@/hooks/useClientPagination': { useClientPagination: (items) => ({ pageItems: items, showPagination: false, page: 0, totalPages: 1, setPage: () => {} }) },
  '@/hooks/useShifts': { useShiftRemittances: () => ({ data: { days }, isLoading: false, error: null, isFetched: true, refetch: () => {} }) },
  '@/lib/errors': { getErrorMessage: (e) => String(e) },
}).ShiftRemittanceScreen;
const shift = { shift_id: 's1', branch_id: 'b1', branch_name: 'SM1', cashier_name: 'SM1-Cashier', started_at: '2026-11-12T07:32:00+08:00', ended_at: '2026-11-12T08:34:00+08:00', status: 'reconciled', result: 'exact', difference: 0, expected_cash: 48, actual_cash: 48 };
const day = (over = {}, shiftOver = {}) => ({
  business_date: '2026-11-12', total_shortage: 0, total_excess: 0, pending_expected_cash: 0, pending_shift_count: 0, reconciled_shift_count: 1,
  expected_cash: 48, actual_remitted: 48, shifts: [{ ...shift, ...shiftOver }], ...over,
});
const renderList = (d) => {
  days = [d];
  return renderToStaticMarkup(React.createElement(List, { branchId: 'b1', branchName: 'SM1' }));
};

text = flat(renderList(day({ expected_gcash: 100, actual_gcash: 100, pending_gcash: 0 }, { expected_gcash: 100, actual_gcash: 100 })));
assert.match(text, new RegExp(`Expected Cash:\\|${money(48)}\\|Cash remitted:\\|${money(48)}`));
assert.match(text, new RegExp(`Expected GCash:\\|${money(100)}\\|GCash remitted:\\|${money(100)}`), 'GCash rows live in the day card');
assert.match(text, new RegExp(`Shortage: ${money(0)}`), 'shortage footer always shown');
assert.match(text, new RegExp(`Excess: ${money(0)}`), 'excess footer always shown');
assert.doesNotMatch(text, /GCash expected|Remitted ₱|Pending ₱/, 'the plain sentence is gone');
assert.doesNotMatch(text, /GCash pending/, 'no pending note when nothing is pending');
assert.doesNotMatch(text, /GCash remitted .* · expected/, 'shift rows do not repeat GCash remitted / expected');
assert.match(renderList(day({ expected_gcash: 100, actual_gcash: 100, pending_gcash: 0 })), /data-icon="phone-portrait-outline"/);

// pending GCash is called out like pending cash
text = flat(renderList(day({ expected_gcash: 100, actual_gcash: null, pending_gcash: 100 }, { expected_gcash: 100, actual_gcash: null })));
assert.match(text, new RegExp(`GCash remitted:\\|—`));
assert.match(text, new RegExp(`${money(100)} GCash pending`));
assert.doesNotMatch(text, /GCash remitted — · expected/);
assert.match(text, /GCash remitted:₱0\.00/, 'summary missing GCash is a display-only ₱0.00');
assert.doesNotMatch(text, /GCash remitted:No remittance recorded/);
assert.equal(
  remittanceTenderTotals({ days: [{ expected_gcash: 100, actual_gcash: null, actual_remitted: 48 }] }).gcash,
  null,
  'null GCash is still null internally',
);

text = flat(
  renderList(
    day(
      { pending_shift_count: 1, pending_expected_cash: 391, expected_gcash: null },
      { status: 'pending', result: null, actual_cash: null },
    ),
  ),
);
assert.doesNotMatch(text, /awaiting remittance/);

// shifts without GCash: no GCash anywhere; Difference row instead
text = flat(renderList(day({ expected_gcash: null })));
assert.doesNotMatch(text, /GCash/);
assert.match(text, /Expected Cash:/);
assert.match(text, /Difference:/);

// ---- 4. source: no unstyled text left for GCash on either screen
for (const file of ['src/features/reports/ShiftRemittanceDetailScreen.tsx', 'src/features/reports/ShiftRemittanceScreen.tsx']) {
  const src = read(file);
  assert.doesNotMatch(src, /<Text>(GCash|Expected:|Received:)/, `${file}: no unstyled GCash text`);
}

const branchesSrc = read('src/features/reports/ShiftRemittanceBranchesScreen.tsx');
assert.match(branchesSrc, /RemittanceSummaryCards/);
assert.match(branchesSrc, /remittanceSummaryAmountLabel/);
assert.doesNotMatch(branchesSrc, /maxWidth:\s*132/);
assert.match(read('src/features/reports/ShiftRemittanceScreen.tsx'), /RemittanceSummaryCards/);
assert.match(read('src/features/reports/ShiftRemittanceScreen.tsx'), /remittanceSummaryAmountLabel/);
assert.match(read('src/features/reports/RemittanceSummaryCards.tsx'), /OwnerSummaryKpiPair/);
assert.match(read('src/components/dashboard/StatTile.tsx'), /tileWideWrap/);

console.log('Shift remittance GCash UI passed: GCash result, matching card on the detail screen, matching rows on the list, pending and no-GCash cases.');
