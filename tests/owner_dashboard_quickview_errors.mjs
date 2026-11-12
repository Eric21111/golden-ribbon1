import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire, registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { transformSync } from '@babel/core';
import { QueryClient, QueryObserver } from '@tanstack/query-core';

// Renders the real Owner Dashboard (react-dom/server + react-native-web) with scripted query states.
// Only data hooks, routing, icons, gradients, safe-area insets, the Screen shell and ManagerActionButton
// (to capture onPress) are stubbed; StatTile, ListRowCard, bottom sheet and feedback components are real.

const root = process.cwd();
const require = createRequire(`${root}/package.json`);
const stubDir = `${root}/tests/__dashboard_stubs__/`;
const rnwUrl = pathToFileURL(require.resolve('react-native-web')).href;

const stubs = {
  'expo-router': `
    export const pushed = [];
    export const router = { push: (path) => pushed.push(path) };
  `,
  '@react-native-vector-icons/ionicons': `export default function Ionicons() { return null; }`,
  'expo-linear-gradient': `
    import { createElement } from 'react';
    import { View } from 'react-native';
    export function LinearGradient({ colors, start, end, ...props }) { return createElement(View, props); }
  `,
  'react-native-safe-area-context': `
    export const useSafeAreaInsets = () => ({ top: 0, bottom: 0, left: 0, right: 0 });
  `,
  '@/components/Screen': `
    import { createElement } from 'react';
    import { View } from 'react-native';
    export function Screen({ children }) { return createElement(View, null, children); }
  `,
  '@/components/dashboard/HamburgerButton': `export function HamburgerButton() { return null; }`,
  '@/components/dashboard/ManagerActionButton': `
    import { createElement } from 'react';
    import { Text } from 'react-native';
    export const buttons = [];
    export function ManagerActionButton(props) {
      buttons.push(props);
      return createElement(Text, null, '[button:' + props.label + (props.loading ? ':loading' : '') + ']');
    }
  `,
  '@/features/auth/AuthProvider': `export const useAuth = () => ({ profile: { full_name: 'Test Owner' } });`,
  '@/hooks/useArchive': `
    export const state = { archive: null };
    export const useArchiveStatus = () => ({ data: state.archive, isRefetching: false, refetch: async () => {} });
    export const useDismissArchiveReminder = () => ({ isPending: false, mutateAsync: async () => {} });
  `,
  '@/hooks/useSales': `
    export const state = {};
    export const useOwnerDashboardMetrics = () => state.metrics;
    export const useOwnerDailyProductSummary = () => state.summary;
    export const useOwnerTodayBranchSales = () => state.branchSales;
  `,
  '@/hooks/useOwnerTodayLog': `
    export const state = {};
    export const useOwnerTodayActivityLog = () => state.log;
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
    if (specifier in stubs) {
      return { url: stubUrl(specifier), shortCircuit: true };
    }
    if (specifier === 'react-native') return { url: rnwUrl, shortCircuit: true };
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
const { default: OwnerDashboard } = await import('../app/(owner)/owner/dashboard.tsx');
const { todayQuickviewStatus } = await import('../src/features/reports/todayQuickview.ts');
const sales = await import('@/hooks/useSales');
const archive = await import('@/hooks/useArchive');
const actions = await import('@/components/dashboard/ManagerActionButton');
const routing = await import('expo-router');
const todayLogHook = await import('@/hooks/useOwnerTodayLog');

const query = (overrides) => ({
  data: undefined,
  error: null,
  isError: false,
  isLoading: false,
  isFetching: false,
  isRefetching: false,
  refetch: async () => {},
  ...overrides,
});
const metricsData = {
  today_sales: 560,
  today_transactions: 4,
  today_units_sold: 7,
  active_products_count: 3,
  pending_transfers_count: 0,
  in_transit_returns_count: 0,
  transfer_discrepancies_count: 2,
  return_discrepancies_count: 1,
};
const summaryData = [{ product_id: 'p1', product_name: 'Chicken', quantity_sold: 7, quantity_returned: 0, revenue: 560 }];
const branchData = {
  business_date: '2026-11-08',
  branches: [
    { branch_id: 'b1', branch_name: 'SM1', transaction_count: 3, total_sales: '480.00', is_active: true },
    { branch_id: 'b2', branch_name: 'SM2', transaction_count: 1, total_sales: '80.00', is_active: false },
  ],
};

const render = () => {
  actions.buttons.length = 0;
  return renderToStaticMarkup(createElement(OwnerDashboard));
};
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&apos;/g, "'").replace(/\s+/g, ' ');
const quickviewSlice = (t) => t.slice(t.indexOf('Today Quickview'), t.indexOf('Today Log'));
const assertUnrelatedSections = (t) => {
  assert.match(t, /Hi, Test Owner/);
  assert.match(t, /Quantity discrepancy reported/);
  assert.match(t, /2 transfer issues · 1 return issue/);
  assert.match(t, /\[button:Review discrepancies\]/);
  assert.match(t, /Data Archive Due/);
  assert.match(t, /\[button:Export &amp; review\]|\[button:Export & review\]/);
  assert.doesNotMatch(t, /TODAY'S PRODUCT PERFORMANCE/);
  assert.doesNotMatch(t, /Chicken/);
  assert.match(t, /Sales by Branch/);
  assert.match(t, /Product Sales/);
  assert.match(t, /Branch Performance/);
  assert.match(t, /Reconciliation/);
  assert.match(t, /Discrepancy Analytics/);
  assert.match(t, /ADMINISTRATION/);
  assert.match(t, /Employees/);
  assert.match(t, /Data Archive/);
};

archive.state.archive = { reminder_visible: true, retention_days: 90 };
todayLogHook.state.log = query({ data: { business_date: '2026-11-08', total_count: 0, truncated: false, activities: [] } });
sales.state.metrics = query({ data: metricsData });
sales.state.summary = query({ data: summaryData });

// 1. Branch revenue fails on first load: only Today Quickview shows an inline error; the rest renders.
let refetchCalls = 0;
const failure = new Error('Network request failed');
sales.state.branchSales = query({ error: failure, isError: true, refetch: async () => void (refetchCalls += 1) });
{
  const t = text(render());
  assertUnrelatedSections(t);
  assert.doesNotMatch(t, /Unable to load/, 'no full-dashboard error state');
  const qv = quickviewSlice(t);
  assert.match(qv, /Couldn't load today's branch revenue\./);
  assert.match(qv, /Unable to connect\. Check your internet connection/, 'message from getErrorMessage');
  assert.match(qv, /\[button:Retry\]/);
  assert.doesNotMatch(qv, /₱/, 'no revenue figure (and no ₱0.00) while the query has failed');
  assert.match(qv, /—/, 'total shows a dash, not ₱0');
  assert.doesNotMatch(qv, /SM1|SM2|Loading branch revenue/);

  const retry = actions.buttons.find((b) => b.label === 'Retry');
  retry.onPress();
  assert.equal(refetchCalls, 1, 'Retry refetches only the branch revenue query');
}

// 2. Retry in progress: still no stale or zero revenue, the button shows its loading state.
sales.state.branchSales = query({ error: failure, isError: true, isFetching: true, isRefetching: true });
{
  const qv = quickviewSlice(text(render()));
  assert.match(qv, /\[button:Retry:loading\]/);
  assert.doesNotMatch(qv, /₱/);
}

// 3. Recovery: successful retry shows the same revenue calculations as before.
sales.state.branchSales = query({ data: branchData });
{
  const t = text(render());
  assertUnrelatedSections(t);
  const qv = quickviewSlice(t);
  assert.doesNotMatch(qv, /Couldn't load|\[button:Retry/);
  assert.match(qv, /₱\s*560\.00/, 'total = sum of branches');
  assert.match(qv, /SM1/);
  assert.match(qv, /₱\s*480\.00/);
  assert.match(qv, /Inactive · SM2/);
  assert.match(qv, /₱\s*80\.00/);
  assert.doesNotMatch(qv, /\[button:Transactions & items sold\]|\[button:Transactions &amp; items sold\]/);
}

// 4. A failed background refetch keeps old data in the cache; it must not be shown as today's revenue.
sales.state.branchSales = query({ data: branchData, error: failure, isError: true });
{
  const qv = quickviewSlice(text(render()));
  assert.match(qv, /Couldn't load today's branch revenue\./);
  assert.doesNotMatch(qv, /₱|SM1|SM2/, 'cached revenue hidden while the latest fetch failed');
}

// 5. Loading stays local to Today Quickview.
sales.state.branchSales = query({ isLoading: true, isFetching: true });
{
  const t = text(render());
  assertUnrelatedSections(t);
  assert.match(quickviewSlice(t), /Loading branch revenue…/);
}

// 6. Unchanged: a metrics failure still uses the existing full-dashboard error state.
sales.state.branchSales = query({ data: branchData });
sales.state.metrics = query({ error: new Error('metrics down'), isError: true });
{
  const t = text(render());
  assert.match(t, /Unable to load/);
  assert.match(t, /Try again/);
  assert.doesNotMatch(t, /Today Quickview/);
}
sales.state.metrics = query({ data: metricsData });

// 7. Details sheet source: rows only when ready, inline error reused there.
{
  const source = readFileSync('app/(owner)/owner/dashboard.tsx', 'utf8');
  const sheet = source.slice(source.indexOf('<ManagerBottomSheet'), source.indexOf('</ManagerBottomSheet>'));
  assert.match(sheet, /\{quickviewError\}/);
  assert.match(sheet, /\(quickviewReady \? quickview\.branches : \[\]\)\.map/);
  assert.match(source, /\{metricsQuery\.error \? \(/, 'branch query not in the global gate');
}

// 8. Real React Query semantics: first failure -> error, retry success -> ready, failed refetch -> error.
{
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let attempt = 0;
  const outcomes = ['fail', 'ok', 'fail'];
  const observer = new QueryObserver(client, {
    queryKey: ['dashboard', 'owner', 'today-branch-sales'],
    queryFn: async () => {
      if (outcomes[attempt++] === 'fail') throw new Error('boom');
      return branchData;
    },
  });
  const unsubscribe = observer.subscribe(() => {});
  while (observer.getCurrentResult().fetchStatus !== 'idle') await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(attempt, 1, 'initial fetch on subscribe');
  assert.equal(todayQuickviewStatus(observer.getCurrentResult()), 'error');
  await observer.refetch();
  assert.equal(todayQuickviewStatus(observer.getCurrentResult()), 'ready', 'retry recovers');
  await observer.refetch().catch(() => {});
  const afterFailedRefetch = observer.getCurrentResult();
  assert.ok(afterFailedRefetch.data, 'React Query keeps the stale data');
  assert.equal(todayQuickviewStatus(afterFailedRefetch), 'error', 'but the quickview treats it as an error');
  unsubscribe();
  client.clear();
}

// 9. Today Log: loading, error + retry, empty, rows (newest first, Manila time), preview cap, truncation note.
{
  const logSlice = (t) => t.slice(t.indexOf('Today Log'), t.indexOf('REPORTS'));
  const logData = (activities, extra = {}) => ({
    business_date: '2026-11-08',
    total_count: activities.length,
    truncated: false,
    activities,
    ...extra,
  });
  const activity = (id, action, occurred_at, actor_name, actor_role, branch_name, detail = null) => ({
    id,
    action,
    occurred_at,
    actor_id: `u-${id}`,
    actor_name,
    actor_role,
    branch_id: `b-${branch_name}`,
    branch_name,
    detail,
  });

  todayLogHook.state.log = query({ isLoading: true, isFetching: true });
  {
    const t = text(render());
    assertUnrelatedSections(t);
    assert.match(logSlice(t), /Loading today's activity…/);
  }

  let logRefetches = 0;
  todayLogHook.state.log = query({
    error: new Error('Network request failed'),
    isError: true,
    refetch: async () => void (logRefetches += 1),
  });
  {
    const t = text(render());
    assertUnrelatedSections(t);
    assert.match(quickviewSlice(t), /₱\s*560\.00/, 'Quickview unaffected by a Today Log failure');
    const log = logSlice(t);
    assert.match(log, /Couldn't load today's activity\./);
    assert.match(log, /\[button:Retry\]/);
    actions.buttons.find((b) => b.label === 'Retry').onPress();
    assert.equal(logRefetches, 1, 'Retry refetches only the Today Log query');
  }

  todayLogHook.state.log = query({ data: logData([]) });
  assert.match(logSlice(text(render())), /No employee activity yet today\./);

  // Server order deliberately scrambled to prove the dashboard sorts newest first.
  const rows = [
    activity('a', 'opening_stock_set', '2026-11-07T22:30:00Z', 'Mara Main', 'manager', 'Main', { product_count: 2 }),
    activity('c', 'shift_started', '2026-11-08T01:00:00Z', 'Cara One', 'cashier', 'SM1'),
    activity('b', 'transfer_sent', '2026-11-08T00:15:00Z', 'Mara Main', 'manager', 'Main', {
      reference: 'TR-000001',
      counterpart_branch_name: 'SM1',
      item_count: 3,
    }),
    activity('d', 'transfer_received', '2026-11-08T01:30:00Z', 'Cara One', 'cashier', 'SM1', {
      reference: 'TR-000001',
      counterpart_branch_name: 'Main',
      item_count: 3,
      with_issue: true,
    }),
    activity('g', 'return_received', '2026-11-08T10:45:00Z', 'Mara Main', 'manager', 'Main', {
      reference: 'RT-000001',
      counterpart_branch_name: 'SM1',
    }),
    activity('f', 'return_sent', '2026-11-08T10:00:00Z', 'Cara One', 'cashier', 'SM1', {
      reference: 'RT-000001',
      counterpart_branch_name: 'Main',
    }),
    activity('e', 'shift_ended', '2026-11-08T09:55:00Z', 'Cara One', 'cashier', 'SM1'),
  ];
  todayLogHook.state.log = query({ data: logData(rows) });
  {
    const t = text(render());
    assertUnrelatedSections(t);
    const log = logSlice(t);
    const expected = [
      ['Received returned stock', 'Mara Main · Manager', 'Main · RT-000001 · from SM1', '6:45 PM'],
      ['Returned stock', 'Cara One · Cashier', 'SM1 · RT-000001 · to Main', '6:00 PM'],
      ['Ended shift', 'Cara One · Cashier', 'SM1', '5:55 PM'],
      ['Received stock', 'Cara One · Cashier', 'SM1 · TR-000001 · from Main · 3 items · with discrepancy', '9:30 AM'],
      ['Started shift', 'Cara One · Cashier', 'SM1', '9:00 AM'],
      ['Sent stock out for delivery', 'Mara Main · Manager', 'Main · TR-000001 · to SM1 · 3 items', '8:15 AM'],
      ['Set opening stock', 'Mara Main · Manager', 'Main · 2 products', '6:30 AM'],
    ];
    let cursor = 0;
    for (const [action, employee, meta, time] of expected) {
      const at = log.indexOf(action, cursor);
      assert.ok(at >= cursor, `${action} appears after the previous (newer) row`);
      const segment = log.slice(at, at + action.length + employee.length + meta.length + time.length + 10);
      assert.ok(segment.includes(employee), `${action}: employee shown`);
      assert.ok(segment.includes(meta), `${action}: branch/detail shown (${segment})`);
      assert.ok(segment.includes(time), `${action}: Manila time shown (${segment})`);
      cursor = at + action.length;
    }
    assert.doesNotMatch(log, /Show all|Show fewer|Showing the latest/, 'no toggle or note for a short log');
  }

  const many = Array.from({ length: 10 }, (_, i) =>
    activity(`s${i}`, 'shift_started', `2026-11-08T0${i}:00:00Z`, `Cashier ${i}`, 'cashier', 'SM2'),
  );
  todayLogHook.state.log = query({ data: logData(many, { total_count: 650, truncated: true }) });
  {
    const log = logSlice(text(render()));
    assert.equal((log.match(/Started shift/g) ?? []).length, 8, 'preview shows the 8 newest');
    assert.match(log, /Cashier 9 /);
    assert.doesNotMatch(log, /Cashier 0 |Cashier 1 /, 'oldest rows hidden behind the toggle');
    assert.match(log, /\[button:Show all 10\]/);
    assert.match(log, /Showing the latest 10 of 650 activities\./);
  }
  todayLogHook.state.log = query({ data: logData([]) });
}

assert.ok(routing.pushed.length === 0, 'rendering does not navigate');
console.log(
  'Owner dashboard quickview error tests passed: inline error + retry, unrelated sections render, recovery, stale data hidden, loading isolated; Today Log states, ordering, attribution and preview.',
);
