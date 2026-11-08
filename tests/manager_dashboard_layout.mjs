import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire, registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { transformSync } from '@babel/core';

// Renders the real Manager Dashboard with scripted profiles and metrics. NavTile is stubbed to record
// its props so every tile can be pressed; StatTile and feedback components are real.

const root = process.cwd();
const require = createRequire(`${root}/package.json`);
const stubDir = `${root}/tests/__manager_dash_stubs__/`;
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
  '@/components/dashboard/HamburgerButton': `
    import { createElement } from 'react';
    import { Text } from 'react-native';
    export function HamburgerButton() { return createElement(Text, null, '[hamburger]'); }
  `,
  '@/components/dashboard/ManagerActionButton': `
    import { createElement } from 'react';
    import { Text } from 'react-native';
    export const buttons = [];
    export function ManagerActionButton(props) {
      buttons.push(props);
      return createElement(Text, null, '[button:' + props.label + ']');
    }
  `,
  '@/components/dashboard/NavTile': `
    import { createElement } from 'react';
    import { Text } from 'react-native';
    export const tiles = [];
    export function NavTile(props) {
      tiles.push(props);
      return createElement(Text, null, '[tile:' + props.title + (props.value != null ? ':' + props.value : '') + ']');
    }
  `,
  '@/features/auth/AuthProvider': `
    export const state = { profile: null };
    export const useAuth = () => ({ profile: state.profile });
  `,
  '@/hooks/useSales': `
    export const state = {};
    export const useManagerDashboardMetrics = () => state.metrics;
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
const { default: ManagerDashboard } = await import('../app/(manager)/manager/dashboard.tsx');
const { tiles } = await import('@/components/dashboard/NavTile');
const auth = await import('@/features/auth/AuthProvider');
const sales = await import('@/hooks/useSales');
const routing = await import('expo-router');
const roles = await import('../src/features/auth/roles.ts');

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
const metrics = (overrides = {}) => ({
  today_sales: 1234.5,
  current_inventory_count: 12,
  pending_incoming_transfers_count: 0,
  returns_in_transit_count: 0,
  ...overrides,
});
const mainManager = {
  role: 'manager',
  full_name: 'Mara Main',
  branch_id: 'main',
  branch: { id: 'main', name: 'Main Branch', is_main_branch: true },
};
const unassignedManager = { role: 'manager', full_name: 'Una Assigned', branch_id: null, branch: null };

const render = () => {
  tiles.length = 0;
  routing.pushed.length = 0;
  const t = renderToStaticMarkup(createElement(ManagerDashboard))
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/\s+/g, ' ');
  return { t, tiles: [...tiles] };
};
const press = (tile) => {
  routing.pushed.length = 0;
  tile.onPress();
  return routing.pushed[0];
};
const statsSlice = (t) => t.slice(t.indexOf('Dashboard'), t.indexOf('NEEDS ATTENTION'));

// Main Branch Manager: renamed stats section, Needs Attention, Reports; no Quick Access.
assert.ok(roles.isMainBranchManager(mainManager));
auth.state.profile = mainManager;
sales.state.metrics = query({ data: metrics() });
{
  const { t, tiles: rendered } = render();
  assert.match(t, /\[hamburger\]/, 'main manager keeps the sidebar entry point');
  assert.doesNotMatch(t, /BRANCH SNAPSHOT/);
  assert.doesNotMatch(t, /QUICK ACCESS/);
  const order = ['Dashboard', 'NEEDS ATTENTION', 'REPORTS'].map((label) => t.indexOf(label));
  assert.ok(order.every((at, i) => at >= 0 && (i === 0 || at > order[i - 1])), `section order ${order}`);

  const stats = statsSlice(t);
  for (const [label, value] of [
    ["Today's Sales", '₱ 1,234.50'],
    ['Products in stock', '12'],
    ['Pending incoming', '0'],
    ['Returns in transit', '0'],
  ]) {
    assert.ok(stats.includes(`${value} ${label}`), `${label} shows ${value} (${stats})`);
  }

  assert.match(t, /Nothing needs attention/);
  assert.deepEqual(
    rendered.map((tile) => [tile.title, press(tile)]),
    [
      ['Shift remittances', '/manager/reports/shift-remittances'],
      ['Waste History', '/manager/reports/waste-history'],
    ],
    'only the Reports tiles remain; Quick Access tiles are gone',
  );
}

// Needs Attention behaviour unchanged: positive counts become alert tiles that route to their screens.
sales.state.metrics = query({ data: metrics({ pending_incoming_transfers_count: 3, returns_in_transit_count: 2 }) });
{
  const { t, tiles: rendered } = render();
  assert.doesNotMatch(t, /Nothing needs attention/);
  const alerts = rendered.filter((tile) => tile.variant === 'alert');
  assert.deepEqual(
    alerts.map((tile) => [tile.title, tile.value, press(tile)]),
    [
      ['Pending incoming', 3, '/manager/incoming'],
      ['Returns in transit', 2, '/manager/returns'],
    ],
  );
  assert.match(statsSlice(t), /3 Pending incoming 2 Returns in transit/);
}

// Loading and error states unchanged.
sales.state.metrics = query({ isLoading: true });
assert.match(render().t, /Loading dashboard…/);
sales.state.metrics = query({ error: new Error('metrics down'), isError: true });
assert.match(render().t, /Unable to load|metrics down/);

// Manager without an assigned branch (the only non-main manager that reaches this screen):
// no sidebar, no Reports, no Quick Access; stats and Needs Attention still render.
assert.ok(!roles.isMainBranchManager(unassignedManager) && !roles.isSellingBranchManager(unassignedManager));
auth.state.profile = unassignedManager;
sales.state.metrics = query({ data: metrics() });
{
  const { t, tiles: rendered } = render();
  assert.doesNotMatch(t, /\[hamburger\]|REPORTS|QUICK ACCESS|BRANCH SNAPSHOT/);
  assert.match(t, /Dashboard/);
  assert.match(t, /NEEDS ATTENTION/);
  assert.match(t, /Nothing needs attention/);
  assert.equal(rendered.length, 0);
}

// Selling-branch managers never reach the dashboard: the manager layout locks them out.
{
  const sellingManager = { role: 'manager', branch_id: 'sm1', branch: { id: 'sm1', is_main_branch: false } };
  assert.ok(roles.isSellingBranchManager(sellingManager));
  const layout = readFileSync('app/(manager)/_layout.tsx', 'utf8');
  assert.match(layout, /if \(isSellingBranchManager\(profile\)\) \{\s*return <SellingManagerLocked \/>;/);
}

// Former Quick Access destinations stay reachable for the Main Branch Manager via sidebar / tab bar.
{
  const sidebar = readFileSync('src/components/dashboard/ManagerSidebar.tsx', 'utf8');
  const mainMenu = sidebar.slice(sidebar.indexOf('items: isMain'), sidebar.indexOf(': [', sidebar.indexOf("label: 'Waste History'")));
  for (const href of ['/manager/products', '/manager/branches', '/manager/transfers', '/manager/returns']) {
    assert.ok(mainMenu.includes(`href: '${href}'`), `main-manager sidebar links ${href}`);
  }
  const tabs = readFileSync('src/components/RoleNavigation.tsx', 'utf8');
  for (const href of ['/manager/dashboard', '/manager/inventory', '/manager/transfers', '/manager/returns']) {
    assert.ok(tabs.includes(`menuHref('${href}')`), `manager tab bar links ${href}`);
  }
  const layout = readFileSync('app/(manager)/_layout.tsx', 'utf8');
  for (const screen of ['manager/products/index', 'manager/branches/index', 'manager/incoming/index', 'manager/inventory/index']) {
    assert.ok(layout.includes(`name="${screen}"`), `${screen} still registered`);
  }
}

console.log(
  'Manager dashboard layout tests passed: "Dashboard" heading, Quick Access removed, stats unchanged, Needs Attention and Reports intact, routes reachable.',
);
