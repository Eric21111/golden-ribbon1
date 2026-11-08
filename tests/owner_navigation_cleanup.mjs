import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire, registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { transformSync } from '@babel/core';

// Renders the real Owner Dashboard and Owner Reports hub with NavTile stubbed to record its props,
// then presses every tile to prove each label still routes to its original destination.

const root = process.cwd();
const require = createRequire(`${root}/package.json`);
const stubDir = `${root}/tests/__owner_nav_stubs__/`;
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
  '@/components/dashboard/ManagerScreenHeader': `
    import { createElement } from 'react';
    import { Text } from 'react-native';
    export function ManagerScreenHeader({ title }) { return createElement(Text, null, title); }
  `,
  '@/components/dashboard/ManagerActionButton': `
    import { createElement } from 'react';
    import { Text } from 'react-native';
    export function ManagerActionButton(props) { return createElement(Text, null, '[button:' + props.label + ']'); }
  `,
  '@/components/dashboard/NavTile': `
    import { createElement } from 'react';
    import { Text } from 'react-native';
    export const tiles = [];
    export function NavTile(props) {
      tiles.push(props);
      return createElement(Text, null, '[tile:' + props.title + ']');
    }
  `,
  '@/features/auth/AuthProvider': `export const useAuth = () => ({ profile: { full_name: 'Test Owner' } });`,
  '@/hooks/useArchive': `
    export const useArchiveStatus = () => ({ data: null, isRefetching: false, refetch: async () => {} });
    export const useDismissArchiveReminder = () => ({ isPending: false, mutateAsync: async () => {} });
  `,
  '@/hooks/useSales': `
    const ok = (data) => ({ data, error: null, isError: false, isLoading: false, isFetching: false, isRefetching: false, refetch: async () => {} });
    export const useOwnerDashboardMetrics = () => ok({
      today_sales: 0, today_transactions: 0, today_units_sold: 0, active_products_count: 0,
      pending_transfers_count: 0, in_transit_returns_count: 0, transfer_discrepancies_count: 0, return_discrepancies_count: 0,
    });
    export const useOwnerDailyProductSummary = () => ok([]);
    export const useOwnerTodayBranchSales = () => ok({ business_date: '2026-11-09', branches: [] });
  `,
  '@/hooks/useOwnerTodayLog': `
    export const useOwnerTodayActivityLog = () => ({
      data: { business_date: '2026-11-09', total_count: 0, truncated: false, activities: [] },
      error: null, isError: false, isLoading: false, isFetching: false, isRefetching: false, refetch: async () => {},
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
    if (specifier in stubs) return { url: stubUrl(specifier), shortCircuit: true };
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
const { default: OwnerReportsHub } = await import('../app/(owner)/owner/reports/index.tsx');
const { tiles } = await import('@/components/dashboard/NavTile');
const routing = await import('expo-router');

const renderTiles = (Component) => {
  tiles.length = 0;
  routing.pushed.length = 0;
  const html = renderToStaticMarkup(createElement(Component));
  return { html, tiles: [...tiles] };
};

const routesOf = (rendered) =>
  rendered.map((tile) => {
    routing.pushed.length = 0;
    tile.onPress();
    assert.equal(routing.pushed.length, 1, `${tile.title} navigates exactly once`);
    return [tile.title, routing.pushed[0]];
  });

// Owner Dashboard
{
  const { html, tiles: rendered } = renderTiles(OwnerDashboard);
  assert.deepEqual(routesOf(rendered), [
    ['Sales by Branch', '/owner/reports/sales-by-branch'],
    ['Product Sales', '/owner/reports/product-sales'],
    ['Branch Performance', '/owner/reports/branch-performance'],
    ['Discrepancies Reconciliation', '/owner/reports/inventory-reconciliation'],
    ['Discrepancy Analytics', '/owner/reports/discrepancies'],
    ['Employees', '/owner/employees'],
    ['Data Archive', '/owner/data-archive'],
  ]);
  assert.ok(rendered.every((tile) => tile.layout === 'tile'), 'dashboard keeps the compact tile layout');
  assert.doesNotMatch(html, /Inventory Summary/);
  assert.doesNotMatch(html, /\[tile:Reconciliation\]/, 'old short label gone');

  // Tiles share rows in pairs; the lone tile in the last REPORTS row keeps half width via a spacer.
  const source = readFileSync('app/(owner)/owner/dashboard.tsx', 'utf8');
  const reports = source.slice(source.indexOf('<Section title="REPORTS">'), source.indexOf('<Section title="ADMINISTRATION">'));
  const rows = reports.split('<Row>').slice(1).map((row) => ({
    tiles: (row.match(/<NavTile/g) ?? []).length,
    spacers: (row.match(/<View style=\{styles\.half\} \/>/g) ?? []).length,
  }));
  assert.deepEqual(rows, [
    { tiles: 2, spacers: 0 },
    { tiles: 2, spacers: 0 },
    { tiles: 1, spacers: 1 },
  ]);
  assert.match(source, /half: \{ flex: 1 \}/);
}

// Owner Reports hub
{
  const { html, tiles: rendered } = renderTiles(OwnerReportsHub);
  assert.deepEqual(routesOf(rendered), [
    ['Sales by Branch', '/owner/reports/sales-by-branch'],
    ['Shift remittances', '/owner/reports/shift-remittances'],
    ['Waste History', '/owner/reports/waste-history'],
    ['Product Sales Performance', '/owner/reports/product-sales'],
    ['Branch Performance', '/owner/reports/branch-performance'],
    ['Discrepancies Reconciliation', '/owner/reports/inventory-reconciliation'],
    ['Discrepancy Analytics', '/owner/reports/discrepancies'],
  ]);
  assert.doesNotMatch(html, /Inventory Summary|Inventory Reconciliation/);
  assert.equal(
    rendered.find((tile) => tile.title === 'Discrepancies Reconciliation').description,
    'Physical stock versus the movement ledger',
  );
}

// Inventory Summary is only de-duplicated from these screens: route, screen and sidebar entry remain.
{
  assert.ok(existsSync('app/(owner)/owner/inventory-by-branch.tsx'), 'inventory summary screen still exists');
  assert.match(readFileSync('app/(owner)/_layout.tsx', 'utf8'), /name="owner\/inventory-by-branch"/);
  assert.match(
    readFileSync('src/components/dashboard/ManagerSidebar.tsx', 'utf8'),
    /href: '\/owner\/inventory-by-branch'/,
  );
  assert.ok(existsSync('app/(owner)/owner/reports/inventory-reconciliation.tsx'), 'reconciliation route still exists');
}

console.log(
  'Owner navigation cleanup tests passed: Inventory Summary tiles removed, Discrepancies Reconciliation label, protected destinations unchanged, dashboard rows paired.',
);
