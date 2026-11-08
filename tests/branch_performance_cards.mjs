import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire, registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { transformSync } from '@babel/core';

import {
  inventoryPreview,
  remittanceSummary,
  toggleExpandedBranch,
  transfersInWindow,
  windowEndsBeforeNow,
} from '../src/features/reports/branchPerformanceCards.ts';

// --- Pure helpers -----------------------------------------------------------------------------
{
  let open = new Set();
  open = toggleExpandedBranch(open, 'a');
  assert.deepEqual([...open], ['a'], 'tap opens');
  open = toggleExpandedBranch(open, 'b');
  assert.deepEqual([...open].sort(), ['a', 'b'], 'cards open independently');
  const before = open;
  open = toggleExpandedBranch(open, 'a');
  assert.deepEqual([...open], ['b'], 'second tap closes');
  assert.deepEqual([...before].sort(), ['a', 'b'], 'previous set not mutated');

  const transfers = [
    { id: 't1', transfer_number: 'TR-1', status: 'received', sent_at: '2026-11-08T16:00:00.000Z', received_at: null, items_count: 1 },
    { id: 't2', transfer_number: 'TR-2', status: 'received', sent_at: '2026-11-09T15:59:59.999Z', received_at: null, items_count: 1 },
    { id: 't3', transfer_number: 'TR-3', status: 'received', sent_at: '2026-11-09T16:00:00.000Z', received_at: null, items_count: 1 },
    { id: 't4', transfer_number: 'TR-4', status: 'draft', sent_at: null, received_at: null, items_count: 1 },
  ];
  const day = { start: '2026-11-09T00:00:00+08:00', end: '2026-11-10T00:00:00+08:00' };
  assert.deepEqual(transfersInWindow(transfers, day).map((t) => t.id), ['t1', 't2'], 'start inclusive, end exclusive, unsent excluded');
  assert.deepEqual(transfersInWindow(transfers, {}).map((t) => t.id), ['t1', 't2', 't3', 't4'], 'All Time keeps every row');

  const now = Date.parse('2026-11-09T04:00:00Z');
  assert.equal(windowEndsBeforeNow(day, now), false, 'a window running to tomorrow is complete');
  assert.equal(windowEndsBeforeNow({ start: '2026-10-01T00:00:00+08:00', end: '2026-10-02T00:00:00+08:00' }, now), true);
  assert.equal(windowEndsBeforeNow({}, now), false);

  assert.deepEqual(remittanceSummary(undefined), { remitted: null, reconciledShifts: 0, pendingShifts: 0, pendingExpected: 0 });
  assert.deepEqual(
    remittanceSummary({
      days: [
        { actual_remitted: 0.1, reconciled_shift_count: 1, pending_shift_count: 0, pending_expected_cash: 0 },
        { actual_remitted: 0.2, reconciled_shift_count: 2, pending_shift_count: 1, pending_expected_cash: 50.05 },
        { actual_remitted: null, reconciled_shift_count: 0, pending_shift_count: 1, pending_expected_cash: '10.00' },
      ],
    }),
    { remitted: 0.3, reconciledShifts: 3, pendingShifts: 2, pendingExpected: 60.05 },
    'cents-exact sum; days with no reconciled shift add nothing',
  );
  assert.equal(
    remittanceSummary({ days: [{ actual_remitted: null, reconciled_shift_count: 0, pending_shift_count: 2, pending_expected_cash: 80 }] }).remitted,
    null,
    'nothing remitted yet is not ₱0',
  );

  const inv = (n, q) => ({ product_id: `p${n}`, product_name: `P${n}`, product_sku: `S${n}`, quantity_on_hand: q });
  const preview = inventoryPreview([inv(1, 3), inv(2, 0), inv(3, 1), inv(4, 2)], 2);
  assert.deepEqual(preview.shown.map((i) => i.product_id), ['p1', 'p3']);
  assert.equal(preview.moreStocked, 1);
  assert.equal(preview.zeroCount, 1);
}

// --- Rendering the real screen ----------------------------------------------------------------
// Data hooks, routing, icons, gradients, the Screen shell, header, bottom sheet and ManagerActionButton are
// stubbed. react-native is react-native-web with Pressable props recorded so taps can be fired. The screen
// module's useState persists across server renders so expand/collapse and filter taps behave like a live app.
const root = process.cwd();
const require = createRequire(`${root}/package.json`);
const stubDir = `${root}/tests/__branch_perf_stubs__/`;
const rnwUrl = pathToFileURL(require.resolve('react-native-web')).href;
const reactUrl = pathToFileURL(require.resolve('react')).href;

const stubs = {
  'react-native': `
    import { createElement } from 'react';
    import * as RNW from '${rnwUrl}';
    export * from '${rnwUrl}';
    export const presses = [];
    export function Pressable(props) {
      presses.push(props);
      return createElement(RNW.Pressable, props);
    }
  `,
  'react@screen': `
    import * as R from '${reactUrl}';
    export * from '${reactUrl}';
    export default R.default;
    export const harness = (globalThis.__branchPerfHarness ??= { slots: [], index: 0, dirty: false });
    export function useState(initial) {
      const i = harness.index++;
      if (!(i in harness.slots)) harness.slots[i] = typeof initial === 'function' ? initial() : initial;
      const set = (value) => {
        const next = typeof value === 'function' ? value(harness.slots[i]) : value;
        if (!Object.is(next, harness.slots[i])) {
          harness.slots[i] = next;
          harness.dirty = true;
        }
      };
      return [harness.slots[i], set];
    }
  `,
  'expo-router': `
    export const pushed = [];
    export const router = { push: (path) => pushed.push(path) };
    export const params = { id: '' };
    export const useLocalSearchParams = () => params;
  `,
  '@react-native-vector-icons/ionicons': `export default function Ionicons() { return null; }`,
  'expo-linear-gradient': `
    import { createElement } from 'react';
    import { View } from 'react-native';
    export function LinearGradient({ colors, start, end, ...props }) { return createElement(View, props); }
  `,
  'react-native-safe-area-context': `export const useSafeAreaInsets = () => ({ top: 0, bottom: 0, left: 0, right: 0 });`,
  '@/components/Screen': `
    import { createElement } from 'react';
    import { View } from 'react-native';
    export function Screen({ children }) { return createElement(View, null, children); }
  `,
  '@/components/dashboard/ManagerScreenHeader': `
    import { createElement } from 'react';
    import { Text } from 'react-native';
    export function ManagerScreenHeader({ title }) { return createElement(Text, null, '[header:' + title + ']'); }
  `,
  '@/components/dashboard/ManagerBottomSheet': `export function ManagerBottomSheet() { return null; }`,
  '@/features/reports/CalendarRangePicker': `export function CalendarRangePicker() { return null; }`,
  '@/components/dashboard/ManagerActionButton': `
    import { createElement } from 'react';
    import { Text } from 'react-native';
    export const buttons = [];
    export function ManagerActionButton(props) {
      buttons.push(props);
      return createElement(Text, null, '[button:' + props.label + ']');
    }
  `,
  '@/hooks/useReconciliation': `
    export const state = { list: null, details: {}, calls: { list: [], details: [] } };
    export const useBranchPerformance = (...args) => { state.calls.list.push(args); return state.list; };
    export const useBranchPerformanceDetails = (...args) => {
      state.calls.details.push(args);
      return state.details[args[0]];
    };
  `,
  '@/hooks/useShifts': `
    export const state = { remit: {}, calls: [] };
    export const useShiftRemittances = (...args) => { state.calls.push(args); return state.remit[args[3]]; };
  `,
  '@/hooks/useProducts': `
    export const useProducts = () => ({
      data: [{ id: 'p-cake', inventory_mode: 'piece_stock' }, { id: 'p-tea', inventory_mode: 'piece_stock' }],
      isFetched: true,
      isLoading: false,
    });
  `,
};

const stubNames = Object.keys(stubs);
const stubUrl = (name) => pathToFileURL(`${stubDir}stub-${stubNames.indexOf(name)}.mjs`).href;
const stubSourceFor = (url) => {
  const match = /stub-(\d+)\.mjs$/.exec(url);
  return match ? stubs[stubNames[Number(match[1])]] : undefined;
};
const tryFiles = (base) =>
  [`${base}.tsx`, `${base}.ts`, `${base}/index.tsx`, `${base}/index.ts`, base].find(
    (candidate) => existsSync(candidate) && !candidate.endsWith('/'),
  );

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'react' && context.parentURL?.endsWith('/BranchPerformanceScreens.tsx')) {
      return { url: stubUrl('react@screen'), shortCircuit: true };
    }
    if (specifier in stubs) return { url: stubUrl(specifier), shortCircuit: true };
    if (specifier.startsWith('@/')) {
      const file = tryFiles(`${root}/src/${specifier.slice(2)}`);
      if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
    }
    if (specifier.startsWith('.') && context.parentURL?.startsWith('file:') && !context.parentURL.includes('node_modules')) {
      const file = tryFiles(fileURLToPath(new URL(specifier, context.parentURL)));
      if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith(pathToFileURL(stubDir).href)) {
      return { format: 'module', source: stubSourceFor(url), shortCircuit: true };
    }
    if (/\.(tsx?)$/.test(url) && !url.includes('node_modules')) {
      const filename = fileURLToPath(url);
      const { code } = transformSync(readFileSync(filename, 'utf8'), {
        filename,
        babelrc: false,
        configFile: false,
        plugins: [
          ['@babel/plugin-transform-typescript', { isTSX: filename.endsWith('.tsx'), allowDeclareFields: true }],
          ['@babel/plugin-transform-react-jsx', { runtime: 'automatic' }],
        ],
      });
      return { format: 'module', source: code, shortCircuit: true };
    }
    return next(url, context);
  },
});

const { createElement } = await import('react');
const { renderToStaticMarkup } = await import('react-dom/server');
const { BranchPerformanceReportScreen, BranchPerformanceDetailScreen } = await import(
  '../src/features/reports/BranchPerformanceScreens.tsx'
);
const { getThisMonthRangeManila, getThisWeekRangeManila } = await import('../src/lib/format.ts');
const rn = await import('react-native');
const routing = await import('expo-router');
const recon = await import('@/hooks/useReconciliation');
const shifts = await import('@/hooks/useShifts');
const actions = await import('@/components/dashboard/ManagerActionButton');
const harness = globalThis.__branchPerfHarness;

const query = (overrides = {}) => ({
  data: undefined,
  error: null,
  isLoading: false,
  isFetching: false,
  isFetched: true,
  refetch: async () => {},
  ...overrides,
});
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

let lastText = '';
const render = (Component = BranchPerformanceReportScreen) => {
  for (let pass = 0; pass < 5; pass += 1) {
    harness.index = 0;
    harness.dirty = false;
    rn.presses.length = 0;
    actions.buttons.length = 0;
    const html = renderToStaticMarkup(createElement(Component));
    if (!harness.dirty) return (lastText = text(html));
  }
  throw new Error('render did not settle');
};
const resetScreen = () => {
  harness.slots.length = 0;
  recon.state.calls.list.length = 0;
  recon.state.calls.details.length = 0;
  shifts.state.calls.length = 0;
};
const header = (branchName) => {
  const found = rn.presses.find((p) => p.accessibilityHint && p.accessibilityLabel?.startsWith(`${branchName},`));
  assert.ok(found, `${branchName} card header is a button`);
  return found;
};
const tap = (pressable) => {
  pressable.onPress();
  return render();
};
const chip = (label) => {
  const found = rn.presses.find((p) => p.accessibilityState && p.children?.props?.children === label);
  assert.ok(found, `filter chip ${label}`);
  return found;
};
const cardSlice = (t, branchName) => {
  const start = t.indexOf(`${branchName} ₱`);
  assert.ok(start >= 0, `${branchName} card rendered`);
  const rest = t.slice(start + 1);
  const nextCard = rest.search(/#\d /);
  return nextCard >= 0 ? t.slice(start, start + 1 + nextCard) : t.slice(start);
};

const SM1 = 'b-sm1';
const SM2 = 'b-sm2';
const listData = [
  {
    branch_id: SM1, branch_name: 'SM1', transaction_count: 3, total_sales: 480, quantity_sold: 7,
    transfer_missing_qty: 2, transfer_excess_qty: 0, return_missing_qty: 0, return_excess_qty: 0,
    total_missing_qty: 2, total_excess_qty: 0,
  },
  {
    branch_id: SM2, branch_name: 'SM2', transaction_count: 4, total_sales: 520, quantity_sold: 9,
    transfer_missing_qty: 0, transfer_excess_qty: 0, return_missing_qty: 0, return_excess_qty: 1,
    total_missing_qty: 0, total_excess_qty: 1,
  },
];
const nowIso = new Date().toISOString();
const longAgoIso = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
const detailsFor = (branchId, label) => ({
  branch: { id: branchId, name: label },
  metrics: { transaction_count: 3, total_sales: 480, quantity_sold: 7, transfer_missing_qty: 2, transfer_excess_qty: 0, return_missing_qty: 0, return_excess_qty: 0, total_missing_qty: 2, total_excess_qty: 0 },
  current_inventory: [
    { product_id: 'p-cake', product_name: `${label} Cake`, product_sku: 'CAKE', quantity_on_hand: 12 },
    { product_id: 'p-tea', product_name: `${label} Tea`, product_sku: 'TEA', quantity_on_hand: 0 },
  ],
  products_sold: [{ product_id: 'p-cake', product_name: `${label} Cake`, product_sku: 'CAKE', quantity_sold: 7, total_revenue: 480 }],
  transfer_discrepancies: [
    { id: `td-${label}`, stock_transfer_id: 'st1', transfer_number: `TR-${label}-9`, product_id: 'p-cake', product_name: `${label} Cake`, product_sku: 'CAKE', quantity_expected: 10, quantity_received: 8, difference: 2, discrepancy_type: 'missing', created_at: nowIso, notes: null },
  ],
  return_discrepancies: [],
  recent_transfers: [
    { id: `rt-new-${label}`, transfer_number: `TR-${label}-NEW`, status: 'received', sent_at: nowIso, received_at: nowIso, items_count: 2 },
    { id: `rt-old-${label}`, transfer_number: `TR-${label}-OLD`, status: 'pending_receipt', sent_at: longAgoIso, received_at: null, items_count: 1 },
  ],
  recent_returns: [{ id: `rr-${label}`, return_number: `RET-${label}-1`, status: 'received', returned_at: nowIso, received_at: nowIso, items_count: 1 }],
});
const remitFor = (amount) => ({
  days: [
    { business_date: '2026-11-08', expected_cash: 500, actual_remitted: amount, total_shortage: 0, total_excess: 0, reconciled_shift_count: 1, pending_shift_count: 1, pending_expected_cash: 75, shifts: [] },
  ],
});

recon.state.list = query({ data: listData });
recon.state.details[SM1] = query({ data: detailsFor(SM1, 'SM1') });
recon.state.details[SM2] = query({ data: detailsFor(SM2, 'SM2') });
shifts.state.remit[SM1] = query({ data: remitFor(430) });
shifts.state.remit[SM2] = query({ data: remitFor(515.5) });

// 1. All Time by default; every card collapsed; no detail or remittance queries run.
{
  const t = render();
  assert.deepEqual(recon.state.calls.list.at(-1), ['all_time', undefined, undefined]);
  assert.match(t, /COMPANY TOTALS ₱\s*1,000\.00 Total sales 7 Completed orders 16 Total items sold/);
  assert.ok(t.indexOf('#1 SM2') < t.indexOf('#2 SM1'), 'ranked by sales');
  assert.match(cardSlice(t, 'SM2'), /52%.*4 Transactions 9 Items sold/);
  assert.match(cardSlice(t, 'SM1'), /48%.*3 Transactions 7 Items sold/);
  assert.equal(header('SM1').accessibilityState.expanded, false);
  assert.equal(header('SM2').accessibilityState.expanded, false);
  assert.match(cardSlice(t, 'SM1'), /Items sold Transfer discrepancies 2 missing Return discrepancies None/, 'summary badges while collapsed');
  assert.match(cardSlice(t, 'SM2'), /Items sold Transfer discrepancies None Return discrepancies 1 excess/);
  assert.doesNotMatch(t, /None in this range/, 'older-return hint only outside All Time');
  assert.doesNotMatch(
    t,
    /CASH REMITTANCE|CURRENT INVENTORY|RECENT STOCK TRANSFERS|DISCREPANCY DETAILS|TR-SM1-9|SM1 Cake|Open full branch report/,
    'detailed lists hidden while collapsed',
  );
  assert.equal(recon.state.calls.details.length, 0, 'no detail fetch while collapsed');
  assert.equal(shifts.state.calls.length, 0, 'no remittance fetch while collapsed');
  assert.equal(routing.pushed.length, 0);
}

// 2. Tap SM1: only SM1 expands, with SM1's data for the selected range.
{
  const t = tap(header('SM1'));
  assert.equal(header('SM1').accessibilityState.expanded, true);
  assert.equal(header('SM2').accessibilityState.expanded, false);
  assert.deepEqual(recon.state.calls.details.at(-1), [SM1, 'all_time', undefined, undefined]);
  assert.ok(recon.state.calls.details.every(([id]) => id === SM1), 'SM2 details not fetched');
  assert.deepEqual(shifts.state.calls.at(-1), ['all_time', undefined, undefined, SM1]);
  const sm1 = cardSlice(t, 'SM1');
  assert.match(sm1, /CASH REMITTANCE Cash remitted ₱\s*430\.00/);
  assert.match(sm1, /Counted at shift close for 1 shift that ended in this period\. Not the same as sales\./);
  assert.match(sm1, /1 awaiting remittance \(₱\s*75\.00 expected\)/);
  assert.match(sm1, /Transfer discrepancies 2 missing Return discrepancies None/, 'summary badges stay on the card');
  assert.equal(sm1.split('Transfer discrepancies').length - 1, 1, 'transfer badge not duplicated in details');
  assert.equal(sm1.split('Return discrepancies').length - 1, 1, 'return badge not duplicated in details');
  assert.match(sm1, /DISCREPANCY DETAILS TR-SM1-9 · SM1 Cake Sent 10 · Received 8/);
  assert.match(sm1, /CURRENT INVENTORY \(NOW\) SM1 Cake 12/);
  assert.match(sm1, /1 at zero\. See the full branch report\./);
  assert.match(sm1, /RECENT STOCK TRANSFERS TR-SM1-NEW Received · 2 products/);
  assert.match(sm1, /TR-SM1-OLD Pending Receipt · 1 products/, 'All Time lists every recent transfer');
  assert.match(sm1, /\[button:Open full branch report\]/);
  assert.doesNotMatch(t, /SM2 Cake|TR-SM2/, "no other branch's details");
  assert.doesNotMatch(sm1, /Cash remitted ₱\s*480/, 'remittance is not the sales figure');

  rn.presses.find((p) => p.accessibilityLabel === 'TR-SM1-9 · SM1 Cake, 2 missing').onPress();
  assert.equal(routing.pushed.at(-1), '/owner/reports/discrepancies/transfer/td-SM1');
  actions.buttons.find((b) => b.label === 'Open full branch report').onPress();
  assert.equal(routing.pushed.at(-1), `/owner/reports/branch-performance/${SM1}`);
}

// 3. Cards are independent; tapping an open card collapses it.
{
  let t = tap(header('SM2'));
  assert.match(cardSlice(t, 'SM2'), /Cash remitted ₱\s*515\.50/);
  assert.match(cardSlice(t, 'SM2'), /Return discrepancies 1 excess/);
  assert.match(cardSlice(t, 'SM1'), /CASH REMITTANCE/, 'SM1 stays open');
  t = tap(header('SM1'));
  assert.equal(header('SM1').accessibilityState.expanded, false);
  assert.doesNotMatch(cardSlice(t, 'SM1'), /CASH REMITTANCE|SM1 Cake/, 'second tap collapses');
  assert.match(cardSlice(t, 'SM2'), /CASH REMITTANCE/);
}

// 4. Today: the list refetches for today, cards collapse again, details and transfers follow the range.
{
  let t = tap(chip('Today'));
  assert.deepEqual(recon.state.calls.list.at(-1), ['today', undefined, undefined]);
  assert.doesNotMatch(t, /CASH REMITTANCE|DISCREPANCY DETAILS/, 'changing the filter collapses every card');
  assert.match(cardSlice(t, 'SM1'), /Return discrepancies None None in this range\./, 'older-return hint on the collapsed card');
  assert.doesNotMatch(cardSlice(t, 'SM2'), /None in this range/, 'no hint when the branch has a return issue');
  t = tap(header('SM1'));
  assert.deepEqual(recon.state.calls.details.at(-1), [SM1, 'today', undefined, undefined]);
  assert.deepEqual(shifts.state.calls.at(-1), ['today', undefined, undefined, SM1]);
  const sm1 = cardSlice(t, 'SM1');
  assert.match(sm1, /TR-SM1-NEW/);
  assert.doesNotMatch(sm1, /TR-SM1-OLD/, 'transfer sent 40 days ago is outside Today');
  assert.doesNotMatch(sm1, /5 latest transfers/, 'no completeness note for a range that runs to now');
}

// 5. This Week and This Month send the shared Manila ranges to every query.
for (const [label, range] of [
  ['This Week', getThisWeekRangeManila()],
  ['This Month', getThisMonthRangeManila()],
]) {
  tap(chip(label));
  assert.deepEqual(recon.state.calls.list.at(-1), ['custom', range.start, range.end], `${label} list range`);
  const t = tap(header('SM1'));
  assert.deepEqual(recon.state.calls.details.at(-1), [SM1, 'custom', range.start, range.end], `${label} details range`);
  assert.deepEqual(shifts.state.calls.at(-1), ['custom', range.start, range.end, SM1], `${label} remittance range`);
  assert.match(cardSlice(t, 'SM1'), /TR-SM1-NEW/);
  assert.doesNotMatch(cardSlice(t, 'SM1'), /TR-SM1-OLD/, `${label} excludes a transfer from 40 days ago`);
}

// 6. Loading states (list, then the expanded card's details and remittance).
resetScreen();
recon.state.list = query({ isLoading: true, isFetched: false });
assert.match(render(), /Calculating branch performance…/);
recon.state.list = query({ data: listData });
recon.state.details[SM1] = query({ isLoading: true, isFetched: false });
shifts.state.remit[SM1] = query({ isLoading: true, isFetched: false });
render();
{
  const t = tap(header('SM1'));
  const sm1 = cardSlice(t, 'SM1');
  assert.match(sm1, /Loading remittance…/);
  assert.match(sm1, /Loading branch details…/);
  assert.match(sm1, /Transfer discrepancies 2 missing/, 'summary badges come from the list row while details load');
  assert.doesNotMatch(sm1, /Cash remitted|CURRENT INVENTORY|DISCREPANCY DETAILS/);
}

// 7. Error states: list error, then per-card errors with Retry; no amounts shown in place of errors.
resetScreen();
recon.state.list = query({ error: new Error('Network request failed'), isFetched: true });
{
  const t = render();
  assert.match(t, /Unable to connect/);
}
recon.state.list = query({ data: listData });
let detailRetries = 0;
let remitRetries = 0;
recon.state.details[SM1] = query({ error: new Error('boom'), refetch: async () => void (detailRetries += 1) });
shifts.state.remit[SM1] = query({ error: new Error('boom'), refetch: async () => void (remitRetries += 1) });
render();
{
  const t = tap(header('SM1'));
  const sm1 = cardSlice(t, 'SM1');
  assert.match(sm1, /Couldn't load remittance\./);
  assert.match(sm1, /Couldn't load branch details\./);
  assert.doesNotMatch(sm1, /Cash remitted|None yet|CURRENT INVENTORY/, 'no figures while queries fail');
  assert.match(cardSlice(t, 'SM2'), /SM2/, 'other cards unaffected');
  const retries = rn.presses.filter((p) => p.children?.props?.children === 'Retry');
  assert.equal(retries.length, 2);
  retries.forEach((r) => r.onPress());
  assert.deepEqual([remitRetries, detailRetries], [1, 1]);
}

// 8. Empty states.
resetScreen();
recon.state.list = query({ data: [] });
assert.match(render(), /No selling branches/);
recon.state.list = query({ data: listData });
recon.state.details[SM1] = query({
  data: { ...detailsFor(SM1, 'SM1'), current_inventory: [], transfer_discrepancies: [], recent_transfers: [] },
});
shifts.state.remit[SM1] = query({ data: { days: [] } });
render();
{
  const sm1 = cardSlice(tap(header('SM1')), 'SM1');
  assert.match(sm1, /Cash remitted None yet/);
  assert.match(sm1, /DISCREPANCY DETAILS No transfer or return discrepancies in this period\./);
  assert.match(sm1, /No stock on hand at this branch\./);
  assert.match(sm1, /No stock transfers sent to this branch in this period\./);
}

// 9. Full branch report (existing detail page) still shows product sales, returns and the rest.
resetScreen();
routing.params.id = SM1;
recon.state.details[SM1] = query({ data: detailsFor(SM1, 'SM1') });
{
  const t = render(BranchPerformanceDetailScreen);
  assert.deepEqual(recon.state.calls.details.at(-1), [SM1, 'all_time', undefined, undefined]);
  for (const section of [
    'BRANCH SUMMARY',
    'CURRENT INVENTORY (READ-ONLY)',
    'PRODUCTS SOLD (SELECTED PERIOD)',
    'TRANSFER DISCREPANCIES',
    'RETURN DISCREPANCIES',
    'RECENT STOCK TRANSFERS',
    'RECENT STOCK RETURNS',
  ]) {
    assert.ok(t.includes(section), `detail page keeps ${section}`);
  }
  assert.match(t, /SM1 Cake CAKE Sold: 7 ₱\s*480\.00/);
  assert.match(t, /RET-SM1-1/);
}

console.log(
  'Branch Performance card tests passed: collapsed by default with summary discrepancy badges, independent expand/collapse, per-branch details, range-driven queries, loading/error/empty states, remittance kept apart from sales, navigation preserved.',
);
