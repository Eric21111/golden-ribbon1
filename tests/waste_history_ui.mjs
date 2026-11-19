// Waste History branch detail: date-range pills, SUMMARY CARD per day, compact rows (shift or Main
// inventory), products one tap away in a details sheet. Quiet days stay one line.
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

const occ = (id, name, quantity, note = null) => ({
  occurrence_id: id,
  product_id: id,
  product_name: name,
  recorded_at: '2026-11-08T11:00:00Z',
  recorded_by: 'u',
  recorded_by_name: 'Cashier 1',
  note,
  quantity,
});
const shift = (id, date, start, end, waste_status, occurrences, extra = {}) => ({
  shift_id: id,
  business_date: date,
  branch_id: 'b',
  branch_name: 'SM 1',
  cashier_id: 'c',
  cashier_name: 'Cashier 1',
  started_at: start,
  ended_at: end,
  entry_kind: 'shift',
  waste_status,
  occurrences,
  ...extra,
});
const days = [
  {
    business_date: '2026-11-09',
    occurrence_count: 0,
    distinct_product_count: 0,
    shifts: [shift('s0', '2026-11-09', '2026-11-08T15:05:00Z', '2026-11-08T23:39:00Z', 'no_waste', [])],
  },
  {
    business_date: '2026-11-08',
    occurrence_count: 3,
    distinct_product_count: 3,
    shifts: [
      shift('s1', '2026-11-08', '2026-11-08T11:28:00Z', '2026-11-08T13:00:00Z', 'waste_recorded', [
        occ('coke', 'Coke Mismo', 9),
      ]),
      shift('s2', '2026-11-08', '2026-11-08T11:18:00Z', '2026-11-08T11:25:00Z', 'waste_recorded', [
        occ('curry', 'Beef Curry', 9),
        occ('kulma', 'Beef kulma', 1, 'dropped'),
      ]),
      shift('s3', '2026-11-08', '2026-11-08T03:00:00Z', '2026-11-08T05:00:00Z', 'no_waste', []),
      shift('s4', '2026-11-08', '2026-11-08T01:00:00Z', null, 'pending', []),
    ],
  },
  {
    business_date: '2026-11-06',
    occurrence_count: 1,
    distinct_product_count: 1,
    shifts: [
      shift('s5', '2026-11-06', '2026-11-05T15:27:00Z', '2026-11-06T13:00:00Z', 'waste_recorded', [
        occ('x', 'Rice', 160),
      ]),
    ],
  },
  {
    business_date: '2026-11-05',
    occurrence_count: 0,
    distinct_product_count: 0,
    shifts: [shift('s6', '2026-11-05', '2026-11-05T01:00:00Z', null, 'pending', [])],
  },
];

const screen = loadTs('src/features/reports/WasteHistoryScreen.tsx', {
  'react-native': rnw,
  'expo-router': { useLocalSearchParams: () => ({ branchId: 'b' }) },
  '@react-native-vector-icons/ionicons': {
    __esModule: true,
    default: (p) => React.createElement('i', { 'data-icon': p.name }),
  },
  '@/components/GlyphIcon': { GlyphIcon: (p) => React.createElement('i', { 'data-glyph': p.name }) },
  '@/components/ConstrainedWidth': { ConstrainedWidth: (p) => React.createElement('div', null, p.children) },
  '@/components/Pagination': { Pagination: () => null },
  '@/components/Screen': { Screen: (p) => React.createElement('main', null, p.children) },
  '@/components/dashboard/ManagerFeedback': {
    EmptyState: (p) => React.createElement('div', null, `EMPTY:${p.title}`),
    ErrorState: () => null,
    LoadingState: () => null,
  },
  '@/components/dashboard/ManagerBottomSheet': {
    ManagerBottomSheet: (p) => React.createElement('section', { 'data-sheet': p.title }, p.children),
  },
  '@/components/dashboard/ManagerScreenHeader': {
    ManagerScreenHeader: (p) => React.createElement('header', null, p.title),
  },
  '@/features/reports/DateRangeFilter': {
    DateRangeFilter: () => React.createElement('div', null, 'RANGE'),
    resolveReportRange: () => ({ rpcRangeType: 'today', startIso: null, endIso: null }),
  },
  '@/hooks/useShifts': {
    useShiftWaste: (_r, _s, _e, branchId) => {
      assert.equal(branchId, 'b');
      return { data: { days }, isLoading: false, error: null, isFetched: true, refetch() {} };
    },
  },
});
const html = renderToStaticMarkup(React.createElement(screen.WasteHistoryScreen, { branchId: 'b' }));
const text = flat(html);

assert.doesNotMatch(text, /RANGE\|/, 'date-range pills removed from waste history');
assert.match(
  text,
  /Nov 8, 2026\|Total waste\|19 stock units\|3 occurrences\|3 products\|/,
  'date, summary card: total waste, then the two tags',
);
assert.match(text, /Nov 6, 2026\|Total waste\|160 stock units\|1 occurrence\|1 product\|/, 'singular');
assert.equal((html.match(/data-icon="trash-outline"/g) ?? []).length, 2, 'one icon chip per summary card');
assert.doesNotMatch(text, /Occurrences\|Products\|Total waste\|/, 'the old three-box strip is gone');
assert.doesNotMatch(text, /mixed items/, 'no mixed-items suffix');

assert.match(text, /Cashier 1\|9\|1 product\|/, 'time title, cashier, short qty');
assert.match(text, /Cashier 1\|10\|2 products\|/);
assert.doesNotMatch(text, /Coke Mismo|Beef Curry|Beef kulma|Rice/, 'products stay in the sheet');
assert.equal((html.match(/data-icon="chevron-forward"/g) ?? []).length, 3, 'chevron on each waste row');
assert.equal((html.match(/aria-label="Waste details for /g) ?? []).length, 3, 'those rows are buttons');
assert.doesNotMatch(text, /Waste recorded/, 'no redundant Waste recorded badge on quantified rows');
assert.match(text, /No waste\|/);
assert.match(text, /Pending\|/);

assert.match(text, /Nov 9, 2026\|No waste recorded\|/, 'no empty summary card');
assert.match(text, /Nov 5, 2026\|Pending\|/, 'pending-only day');
assert.doesNotMatch(text, /Nov 9, 2026\|Total waste/);
assert.equal((text.match(/Total waste/g) ?? []).length, 2, 'summary cards only for days with waste');

{
  const body = renderToStaticMarkup(React.createElement(screen.WasteDetailsBody, { shift: days[1].shifts[1] }));
  assert.match(flat(body), /SM 1\|[^|]*\|Cashier 1\|Beef Curry\|/);
  assert.match(flat(body), /9 pcs\|Beef kulma\|/);
  assert.match(flat(body), /Reason: dropped\|1 pcs\|Total\|10 stock units\|$/);
  const one = flat(renderToStaticMarkup(React.createElement(screen.WasteDetailsBody, { shift: days[2].shifts[0] })));
  assert.match(one, /Rice\|/);
  assert.match(one, /160 pcs\|Total\|160 stock units\|$/);

  const mainShift = shift(null, '2026-11-08', '2026-11-08T02:00:00Z', '2026-11-08T02:05:00Z', 'waste_recorded', [
    { ...occ('ch', 'Chicken', 3, 'Spoiled'), recorded_by_name: 'Main Manager' },
  ], { entry_kind: 'main_inventory', cashier_name: 'Main inventory', branch_name: 'Main' });
  const mainBody = flat(renderToStaticMarkup(React.createElement(screen.WasteDetailsBody, { shift: mainShift })));
  assert.match(mainBody, /Main\|Main inventory write-off\|Chicken\|/);
  assert.match(mainBody, /Main Manager/);
  assert.match(mainBody, /Reason: Spoiled\|3 pcs/);
}

const src = read('src/features/reports/WasteHistoryScreen.tsx');
assert.ok(src.includes('<ManagerBottomSheet visible={selected != null} title="Waste details" scroll onClose={() => setSelected(null)}>'));
assert.ok(src.includes('onPress={() => setSelected(shift)}'), 'tapping a row opens it');
assert.ok(src.includes('metaItemText: { flexShrink: 1,'));
assert.ok(src.includes("shiftTrail: { alignItems: 'flex-end', gap: 2, flexShrink: 0"));
assert.doesNotMatch(src, /ListRowCard|statStrip|statIconChip|shiftBlock/, 'old stacked cards stay gone');
assert.ok(src.includes('formatPcsQty('), 'quantities use stock units');
assert.ok(src.includes('useShiftWaste(rpcRangeType, startIso, endIso, branchId'), 'detail is branch-scoped');

const hub = read('src/features/reports/WasteHistoryBranchesScreen.tsx');
assert.match(hub, /WasteHistoryBranchesScreen/);
assert.match(hub, /buildWasteHistoryBranchRows/);
assert.match(hub, /BRANCHES/);
assert.doesNotMatch(hub, /<DateRangeFilter/);
assert.match(read('src/features/reports/wasteHistoryBranches.ts'), /wasteHistoryBranchHref/);
assert.match(read('src/features/reports/WasteHistoryScreen.tsx'), /all_time/);
assert.doesNotMatch(read('src/features/reports/WasteHistoryScreen.tsx'), /<DateRangeFilter/);

console.log('waste_history_ui: ALL PASS');
