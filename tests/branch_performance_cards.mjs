// Load native web before the screen-specific module hooks intercept its CommonJS imports.
import 'react-native-web';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire, registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { transformSync } from '@babel/core';

import {
  branchOperationsIssueQty,
  branchOperationsMeta,
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

  assert.deepEqual(
    branchOperationsIssueQty({
      transfer_missing_qty: 2, transfer_excess_qty: 1, return_missing_qty: 1, return_excess_qty: 3,
    }),
    { missing: 3, excess: 4 },
  );
  assert.equal(branchOperationsMeta(1, 1), '1 item · 1 sale');
  assert.equal(branchOperationsMeta(498, 28), '498 items · 28 sales');
  assert.deepEqual(
    branchOperationsIssueQty({
      transfer_missing_qty: 0, transfer_excess_qty: 0, return_missing_qty: 0, return_excess_qty: 0,
    }),
    { missing: 0, excess: 0 },
  );
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
const { shouldStackSummaryKpis } = await import('../src/features/reports/reportDisplay.ts');
{
  // 360px Android, 20px page padding → 320px KPI row. Short ops figures stay 2-col.
  assert.equal(shouldStackSummaryKpis('47', '21', 320), false, 'typical ops KPIs stay side-by-side on 360px');
  assert.equal(shouldStackSummaryKpis('794', '47', 320), false);
  assert.equal(shouldStackSummaryKpis('355397.00', '21', 320), true, 'long figures still stack instead of clipping');
}
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
  const found = rn.presses.find((p) => p.accessibilityHint?.includes('Branch Hub') && p.accessibilityLabel?.startsWith(`${branchName},`));
  assert.ok(found, `${branchName} card header is a button`);
  return found;
};
const issuesBadge = (branchName) => {
  const found = rn.presses.find(
    (p) => p.accessibilityHint?.includes('Transfer and Return Issues') && p.accessibilityLabel?.startsWith(branchName),
  );
  assert.ok(found, `${branchName} issues badge is a button`);
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
  const start = t.indexOf(branchName);
  assert.ok(start >= 0, `${branchName} card rendered`);
  const rest = t.slice(start + 1);
  const nextCard = rest.search(/\bSM[123]\b/);
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

// 1. All Time by default: company comparison, compact cards — no unlabeled share bar or dumps.
{
  const t = render();
  assert.deepEqual(recon.state.calls.list.at(-1), ['all_time', undefined, undefined]);
  assert.match(t, /\[header:Branch Operations\]/);
  assert.match(t, /COMPANY OPERATIONS 16 Total items sold 7 Completed sales 3 Discrepancy units/);
  assert.doesNotMatch(t, /Transfer & return, including resolved/);
  assert.doesNotMatch(t, /Live receipts for archived days|Issue qty counts missing|After archive cleanup|Completed orders|Open issue|Completed transactions/);
  assert.ok(t.indexOf('SM2') < t.indexOf('SM1'), 'ranked by sales');
  assert.match(cardSlice(t, 'SM2'), /9 items · 4 sales/);
  assert.match(cardSlice(t, 'SM1'), /7 items · 3 sales/);
  assert.doesNotMatch(t, /52%|48%|Share of/);
  assert.match(cardSlice(t, 'SM1'), /2 missing/);
  assert.match(cardSlice(t, 'SM2'), /1 excess/);
  assert.doesNotMatch(t, /Transfer discrepancies|Return discrepancies|None in this range/);
  assert.doesNotMatch(cardSlice(t, 'SM1'), /Product Sales|Issues >/);
  assert.doesNotMatch(cardSlice(t, 'SM2'), /Product Sales/);
  assert.doesNotMatch(
    t,
    /CASH REMITTANCE|STOCK SNAPSHOT|RECENT STOCK TRANSFERS|DISCREPANCY DETAILS|TR-SM1-9|SM1 Cake|Open full branch report|CURRENT INVENTORY|\[button:Product Sales\]/,
    'duplicate dumps and oversized action buttons stay off the scorecard',
  );
  assert.equal(recon.state.calls.details.length, 0, 'list does not fetch branch-performance details');
  assert.equal(shifts.state.calls.length, 0, 'remittance not loaded from Branch Operations');
  assert.equal(routing.pushed.length, 0);
}

// 2. Card header and issue badges keep branch + All Time on the destination.
{
  tap(header('SM1'));
  assert.equal(routing.pushed.at(-1), `/owner/reports/branch/${SM1}?range=all_time`);
  assert.equal(recon.state.calls.details.length, 0, 'opening Branch Hub does not fetch performance details');
  tap(issuesBadge('SM1'));
  assert.equal(routing.pushed.at(-1), `/owner/reports/discrepancies?branchId=${SM1}&range=all_time`);
  tap(issuesBadge('SM2'));
  assert.equal(routing.pushed.at(-1), `/owner/reports/discrepancies?branchId=${SM2}&range=all_time`);
}

// 3. Today: list refetches; outbound links keep Today.
{
  tap(chip('Today'));
  assert.deepEqual(recon.state.calls.list.at(-1), ['today', undefined, undefined]);
  const t = render();
  assert.match(t, /BRANCHES Today/);
  assert.doesNotMatch(t, /None in this range|Open the branch|Product Sales/);
  tap(header('SM1'));
  assert.equal(routing.pushed.at(-1), `/owner/reports/branch/${SM1}?range=today`);
  tap(issuesBadge('SM1'));
  assert.equal(routing.pushed.at(-1), `/owner/reports/discrepancies?branchId=${SM1}&range=today`);
  assert.equal(shifts.state.calls.length, 0, 'Today still skips remittance');
}

// 4. This Week and This Month send the shared Manila ranges to the list and preserve the UI range on links.
for (const [label, range] of [
  ['This Week', getThisWeekRangeManila()],
  ['This Month', getThisMonthRangeManila()],
]) {
  tap(chip(label));
  assert.deepEqual(recon.state.calls.list.at(-1), ['custom', range.start, range.end], `${label} list range`);
  const key = label === 'This Week' ? 'this_week' : 'this_month';
  assert.match(render(), new RegExp(`BRANCHES ${label}`));
  tap(issuesBadge('SM1'));
  assert.equal(routing.pushed.at(-1), `/owner/reports/discrepancies?branchId=${SM1}&range=${key}`, `${label} issues`);
  assert.equal(shifts.state.calls.length, 0, `${label} skips remittance`);
  assert.equal(recon.state.calls.details.length, 0, `${label} does not open details RPC`);
}

// 5. Loading and error/empty states stay on the company list.
resetScreen();
recon.state.list = query({ isLoading: true, isFetched: false });
assert.match(render(), /Calculating branch operations…/);

resetScreen();
recon.state.list = query({ error: new Error('Network request failed'), isFetched: true });
assert.match(render(), /Unable to connect/);

resetScreen();
recon.state.list = query({ data: [] });
assert.match(render(), /No selling branches/);
assert.doesNotMatch(render(), /STOCK SNAPSHOT|CURRENT INVENTORY|DISCREPANCY DETAILS/);

// 6. Detail route is a summary + compact report rows, not a third inventory/transfer hub.
resetScreen();
routing.params.id = SM1;
recon.state.details[SM1] = query({ data: detailsFor(SM1, 'SM1') });
{
  const t = render(BranchPerformanceDetailScreen);
  assert.deepEqual(recon.state.calls.details.at(-1), [SM1, 'all_time', undefined, undefined]);
  assert.match(t, /\[header:SM1\]|\[header:Branch Operations\]/);
  assert.match(t, /Items sold/);
  assert.match(t, /Completed sales/);
  assert.match(t, /Discrepancy units/);
  assert.doesNotMatch(t, /CURRENT INVENTORY|TRANSFER DISCREPANCIES|RETURN DISCREPANCIES|RECENT STOCK TRANSFERS|RECENT STOCK RETURNS|PRODUCTS SOLD|SM1 Cake|RET-SM1-1|\[button:/);
  assert.match(t, /Branch Hub/);
  assert.match(t, /Product Sales/);
  assert.match(t, /Transfer & Return Issues/);
  assert.match(t, /Inventory Reconciliation/);
  const rows = rn.presses.filter((p) => typeof p.onPress === 'function' && p.accessibilityRole === 'button');
  const byTitle = (title) => {
    const found = rows.find((p) => p.accessibilityLabel === title);
    assert.ok(found, `${title} row`);
    return found;
  };
  byTitle('Branch Hub').onPress();
  assert.equal(routing.pushed.at(-1), `/owner/reports/branch/${SM1}?range=all_time`);
  byTitle('Product Sales').onPress();
  assert.equal(routing.pushed.at(-1), `/owner/reports/product-sales/${SM1}?range=all_time`);
  byTitle('Transfer & Return Issues').onPress();
  assert.equal(routing.pushed.at(-1), `/owner/reports/discrepancies?branchId=${SM1}&range=all_time`);
  byTitle('Inventory Reconciliation').onPress();
  assert.equal(routing.pushed.at(-1), `/owner/reports/inventory-reconciliation?branchId=${SM1}`);
}

console.log(
  'Branch Operations card tests passed: compact KPIs, issue badges, text links with range, no remittance/product/inventory dumps.',
);
