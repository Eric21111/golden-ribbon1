// Waste History, in the same pattern as the other report screens (Shift remittances): the date-range pills, a SUMMARY CARD per day (total
// waste big, "occurrences" / "products" as small tags), ONE compact row per shift (branch, time, cashier, total pcs, "n products", chevron) and
// the products one tap away in a details sheet. A day with no waste is one quiet line. Real renders with stubs for data and navigation.
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

const occ = (id, name, quantity, note = null) => ({ occurrence_id: id, product_id: id, product_name: name, recorded_at: '2026-11-08T11:00:00Z', recorded_by: 'u', note, quantity });
const shift = (id, date, start, end, waste_status, occurrences) => ({ shift_id: id, business_date: date, branch_id: 'b', branch_name: 'SM 1', cashier_id: 'c', cashier_name: 'Cashier 1', started_at: start, ended_at: end, waste_status, occurrences });
const days = [
  { business_date: '2026-11-09', occurrence_count: 0, distinct_product_count: 0, shifts: [shift('s0', '2026-11-09', '2026-11-08T15:05:00Z', '2026-11-08T23:39:00Z', 'no_waste', [])] },
  {
    business_date: '2026-11-08', occurrence_count: 3, distinct_product_count: 3,
    shifts: [
      shift('s1', '2026-11-08', '2026-11-08T11:28:00Z', '2026-11-08T13:00:00Z', 'waste_recorded', [occ('coke', 'Coke Mismo', 9)]),
      shift('s2', '2026-11-08', '2026-11-08T11:18:00Z', '2026-11-08T11:25:00Z', 'waste_recorded', [occ('curry', 'Beef Curry', 9), occ('kulma', 'Beef kulma', 1, 'dropped')]),
      shift('s3', '2026-11-08', '2026-11-08T03:00:00Z', '2026-11-08T05:00:00Z', 'no_waste', []),
      shift('s4', '2026-11-08', '2026-11-08T01:00:00Z', null, 'pending', []),
    ],
  },
  { business_date: '2026-11-06', occurrence_count: 1, distinct_product_count: 1, shifts: [shift('s5', '2026-11-06', '2026-11-05T15:27:00Z', '2026-11-06T13:00:00Z', 'waste_recorded', [occ('x', 'Rice', 160)])] },
  { business_date: '2026-11-05', occurrence_count: 0, distinct_product_count: 0, shifts: [shift('s6', '2026-11-05', '2026-11-05T01:00:00Z', null, 'pending', [])] },
];

const screen = loadTs('src/features/reports/WasteHistoryScreen.tsx', {
  'react-native': rnw,
  '@react-native-vector-icons/ionicons': { __esModule: true, default: (p) => React.createElement('i', { 'data-icon': p.name }) },
  '@/components/GlyphIcon': { GlyphIcon: (p) => React.createElement('i', { 'data-glyph': p.name }) },
  '@/components/ConstrainedWidth': { ConstrainedWidth: (p) => React.createElement('div', null, p.children) },
  '@/components/Pagination': { Pagination: () => null },
  '@/components/Screen': { Screen: (p) => React.createElement('main', null, p.children) },
  '@/components/dashboard/ManagerFeedback': { EmptyState: (p) => React.createElement('div', null, `EMPTY:${p.title}`), ErrorState: () => null, LoadingState: () => null },
  '@/components/dashboard/ManagerBottomSheet': { ManagerBottomSheet: (p) => React.createElement('section', { 'data-sheet': p.title }, p.children) },
  '@/components/dashboard/ManagerScreenHeader': { ManagerScreenHeader: (p) => React.createElement('header', null, p.title) },
  '@/features/reports/DateRangeFilter': { DateRangeFilter: () => React.createElement('div', null, 'RANGE'), resolveReportRange: () => ({ rpcRangeType: 'today', startIso: null, endIso: null }) },
  '@/features/auth/AuthProvider': { useAuth: () => ({ profile: { role: 'owner' } }) },
  '@/hooks/useShifts': { useShiftWaste: () => ({ data: { days }, isLoading: false, error: null, isFetched: true, refetch() {} }) },
});
const html = renderToStaticMarkup(React.createElement(screen.WasteHistoryScreen));
const text = flat(html);

// ---------------------------------------------------------------- 1. the same pattern as the other reports
assert.match(text, /RANGE\|/, 'the date-range pills are first, as on every report');
// a day with waste: heading, then the summary card (total big, two small tags)
assert.match(text, /Nov 8, 2026\|Total waste\|19 pcs\|3 occurrences\|3 products\|/, 'date, summary card: total waste, then the two tags');
assert.match(text, /Nov 6, 2026\|Total waste\|160 pcs\|1 occurrence\|1 product\|/, 'singular');
assert.equal((html.match(/data-icon="trash-outline"/g) ?? []).length, 2, 'one icon chip per summary card, none per product');
assert.doesNotMatch(text, /Occurrences\|Products\|Total waste\|/, 'the old three-box strip is gone');

// ---------------------------------------------------------------- 2. one compact row per shift: no products inline
assert.match(text, /SM 1\|[^|]*\|Cashier 1\|9 pcs\|1 product\|/, 'branch, time, cashier, total, "n products"');
assert.match(text, /SM 1\|[^|]*\|Cashier 1\|10 pcs\|2 products\|/);
assert.doesNotMatch(text, /Coke Mismo|Beef Curry|Beef kulma|Rice/, 'the products are NOT on the list: one tap away');
assert.equal((html.match(/data-icon="chevron-forward"/g) ?? []).length, 3, 'a chevron on each shift that has waste to open');
assert.equal((html.match(/aria-label="Waste details for SM 1"/g) ?? []).length, 3, 'those rows are buttons');
assert.doesNotMatch(text, /Waste recorded/, 'no "Waste recorded" tag on a row whose total already says it');
assert.match(text, /No waste\|/);
assert.match(text, /Pending\|/);

// ---------------------------------------------------------------- 3. a day with no waste is one quiet line
assert.match(text, /Nov 9, 2026\|No waste recorded\|/, 'no empty summary card');
assert.match(text, /Nov 5, 2026\|Pending\|/, 'a day whose only shift is still pending says so');
assert.doesNotMatch(text, /Nov 9, 2026\|Total waste/);
assert.equal((text.match(/Total waste/g) ?? []).length, 2, 'summary cards only for the two days that have waste');

// ---------------------------------------------------------------- 4. the details sheet
{
  const body = renderToStaticMarkup(React.createElement(screen.WasteDetailsBody, { shift: days[1].shifts[1] }));
  assert.match(flat(body), /SM 1\|[^|]*\|Cashier 1\|Beef Curry\|9 pcs\|Beef kulma\|dropped\|1 pcs\|Total\|10 pcs\|$/, 'the shift, each product with its pcs and note, and the total');
  const one = flat(renderToStaticMarkup(React.createElement(screen.WasteDetailsBody, { shift: days[2].shifts[0] })));
  assert.match(one, /Rice\|160 pcs\|Total\|160 pcs\|$/);
}
const src = read('src/features/reports/WasteHistoryScreen.tsx');
assert.ok(src.includes('<ManagerBottomSheet visible={selected != null} title="Waste details" scroll onClose={() => setSelected(null)}>'));
assert.ok(src.includes('onPress={() => setSelected(shift)}'), 'tapping a row opens it');
// nothing overlaps: the time text shrinks and wraps, the total sits in its own column
assert.ok(src.includes('metaItemText: { flexShrink: 1,') && src.includes("shiftTrail: { alignItems: 'flex-end', gap: 2, flexShrink: 0 },"));
assert.doesNotMatch(src, /ListRowCard|statStrip|statIconChip|shiftBlock/, 'the old stacked product cards and stat strip are gone');
assert.ok(src.includes('formatPcsQty('), 'quantities are formatted the same way');
console.log('waste_history_ui: ALL PASS');
