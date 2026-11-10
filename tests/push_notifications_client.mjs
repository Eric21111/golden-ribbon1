import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire, registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { transformSync } from '@babel/core';

// Client side of push notifications: pure routing/badge helpers, the real RoleNavigation badge rendering,
// the real recipient gating hook, and source wiring for screens, sign-out, web stub and config.

const root = process.cwd();
const require = createRequire(`${root}/package.json`);
const stubDir = `${root}/tests/__push_client_stubs__/`;
const rnwUrl = pathToFileURL(require.resolve('react-native-web')).href;

const stubs = {
  'expo-router': `
    export const state = { pathname: '/' };
    export const usePathname = () => state.pathname;
    export function Link({ children }) { return children; }
  `,
  '@react-native-vector-icons/ionicons': `export default function Ionicons() { return null; }`,
  'react-native-safe-area-context': `
    import { createElement } from 'react';
    import { View } from 'react-native';
    export function SafeAreaView({ edges, ...props }) { return createElement(View, props); }
  `,
  '@/hooks/useKeyboardBottomInset': `export const useKeyboardBottomInset = () => 0;`,
  '@/hooks/useNotifications': `
    export const state = { counts: { transfer_pending: 0, return_submitted: 0 } };
    export const useUnreadNotificationCounts = () => state.counts;
  `,
  '@/features/auth/AuthProvider': `
    export const state = { session: null, profile: null };
    export const useAuth = () => ({ session: state.session, profile: state.profile });
  `,
  '@/lib/supabase': `
    export const isSupabaseConfigured = true;
    export const supabase = { rpc: async () => ({ data: null, error: null }) };
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
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
const routes = await import('../src/features/notifications/notificationRoutes.ts');
const settings = await import('../src/features/notifications/pushSettings.ts');

// --- Pure helpers ---------------------------------------------------------------------------------
{
  const { formatBadgeCount, normalizeUnreadCounts, routeForNotification } = routes;
  assert.equal(formatBadgeCount(0), null);
  assert.equal(formatBadgeCount(undefined), null);
  assert.equal(formatBadgeCount(-2), null);
  assert.equal(formatBadgeCount(1), '1');
  assert.equal(formatBadgeCount(9), '9');
  assert.equal(formatBadgeCount(10), '9+');
  assert.equal(formatBadgeCount(250), '9+');
  assert.deepEqual(normalizeUnreadCounts({ transfer_pending: '3', return_submitted: null }), { transfer_pending: 3, return_submitted: 0 });
  assert.deepEqual(normalizeUnreadCounts(null), { transfer_pending: 0, return_submitted: 0 });

  const me = '11111111-1111-4111-8111-111111111111';
  const entity = '22222222-2222-4222-8222-222222222222';
  const transfer = { kind: 'transfer_pending', entity_id: entity, recipient_id: me, url: '/owner/employees' };
  const ret = { kind: 'return_submitted', entity_id: entity, recipient_id: me };
  assert.equal(routeForNotification(transfer, { userId: me, role: 'cashier' }), '/cashier/incoming', 'payload url is ignored');
  assert.equal(routeForNotification(ret, { userId: me, role: 'manager' }), `/manager/returns/${entity}`);
  assert.equal(routeForNotification(transfer, { userId: 'someone-else', role: 'cashier' }), null, 'previous account’s push is not opened');
  assert.equal(routeForNotification(transfer, { userId: null, role: 'cashier' }), null);
  assert.equal(routeForNotification(transfer, { userId: me, role: 'manager' }), null, 'wrong role');
  assert.equal(routeForNotification(ret, { userId: me, role: 'cashier' }), null, 'wrong role');
  assert.equal(routeForNotification(ret, { userId: me, role: 'owner' }), null);
  assert.equal(routeForNotification({ ...ret, entity_id: '../../owner' }, { userId: me, role: 'manager' }), null, 'entity must be a UUID');
  assert.equal(routeForNotification({ ...ret, kind: 'other' }, { userId: me, role: 'manager' }), null);
  assert.equal(routeForNotification(null, { userId: me, role: 'manager' }), null);

  const { pushSettingState, pushPermissionExplanation } = settings;
  assert.equal(pushSettingState({ status: 'undetermined', canAskAgain: true }).action, 'enable');
  assert.equal(pushSettingState({ status: 'undetermined', canAskAgain: true }).label, 'Enable Notifications');
  assert.equal(pushSettingState({ status: 'denied', canAskAgain: true }).action, 'enable');
  assert.equal(pushSettingState({ status: 'denied', canAskAgain: false }).action, 'settings', 'never re-prompts once the OS blocks it');
  assert.match(pushSettingState({ status: 'denied', canAskAgain: false }).detail, /Badges in the app still update/);
  assert.equal(pushSettingState({ status: 'granted', canAskAgain: true }).action, null);
  assert.equal(pushSettingState({ status: 'unsupported', canAskAgain: false }).action, null);
  assert.equal(pushSettingState(null).action, null);
  assert.match(pushPermissionExplanation('cashier'), /sends stocks to your branch/);
  assert.match(pushPermissionExplanation('manager'), /submits leftover stocks for return/);
}

// --- RoleNavigation badges (real component) ---------------------------------------------------------
{
  const router = await import('expo-router');
  const notifications = await import('@/hooks/useNotifications');
  const { RoleNavigation } = await import('../src/components/RoleNavigation.tsx');
  const render = (role, pathname, counts) => {
    router.state.pathname = pathname;
    notifications.state.counts = counts;
    return renderToStaticMarkup(createElement(RoleNavigation, { role }, null));
  };
  const badges = (html) => [...html.matchAll(/aria-label="([^"]+), (\d+) unread"/g)].map((m) => [m[1], Number(m[2])]);
  const badgeTexts = (html) => [...html.matchAll(/>(\d\+?|9\+)<\/div>/g)].map((m) => m[1]);

  let html = render('cashier', '/cashier/dashboard', { transfer_pending: 3, return_submitted: 7 });
  assert.deepEqual(badges(html), [['Incoming', 3]], 'cashier: only Incoming shows a badge');
  assert.deepEqual(badgeTexts(html), ['3']);

  html = render('cashier', '/cashier/incoming', { transfer_pending: 12, return_submitted: 0 });
  assert.deepEqual(badges(html), [['Incoming', 12]]);
  assert.deepEqual(badgeTexts(html), ['9+'], 'capped at 9+');

  html = render('manager', '/manager/dashboard', { transfer_pending: 4, return_submitted: 2 });
  assert.deepEqual(badges(html), [['Returns', 2]], 'manager: only Returns shows a badge');
  assert.deepEqual(badgeTexts(html), ['2']);

  for (const [role, path] of [['cashier', '/cashier/dashboard'], ['manager', '/manager/dashboard'], ['owner', '/owner/dashboard']]) {
    html = render(role, path, { transfer_pending: 0, return_submitted: 0 });
    assert.deepEqual(badges(html), [], `${role}: no badge at zero`);
    assert.deepEqual(badgeTexts(html), []);
  }
  html = render('owner', '/owner/dashboard', { transfer_pending: 5, return_submitted: 5 });
  assert.deepEqual(badges(html), [], 'owner tabs never show these badges');
}

// --- Recipient gating (real hook): only the signed-in, active cashier/manager -----------------------
{
  const auth = await import('@/features/auth/AuthProvider');
  const { useNotificationRecipientId } = await import('../src/hooks/useNotifications.ts');
  const Probe = () => createElement('span', null, String(useNotificationRecipientId()));
  const probe = (session, profile) => {
    auth.state.session = session;
    auth.state.profile = profile;
    return renderToStaticMarkup(
      createElement(QueryClientProvider, { client: new QueryClient() }, createElement(Probe)),
    ).replace(/<\/?span>/g, '');
  };
  const session = { user: { id: 'u1' } };
  assert.equal(probe(session, { id: 'u1', role: 'cashier', is_active: true }), 'u1');
  assert.equal(probe(session, { id: 'u1', role: 'manager', is_active: true }), 'u1');
  assert.equal(probe(session, { id: 'u1', role: 'owner', is_active: true }), 'null');
  assert.equal(probe(session, { id: 'u1', role: 'cashier', is_active: false }), 'null', 'deactivated');
  assert.equal(probe(session, { id: 'previous-user', role: 'cashier', is_active: true }), 'null', 'stale profile after account switch');
  assert.equal(probe(null, { id: 'u1', role: 'cashier', is_active: true }), 'null', 'signed out');
}

// --- Source wiring ------------------------------------------------------------------------------------
{
  const read = (path) => readFileSync(path, 'utf8');

  const incoming = read('app/(cashier)/cashier/incoming.tsx');
  assert.match(incoming, /useMarkNotificationsReviewed\('transfer_pending', null, pending\.isSuccess \? pending\.dataUpdatedAt : 0\)/);
  const returnDetail = read('app/(manager)/manager/returns/[id].tsx');
  assert.match(returnDetail, /useMarkNotificationsReviewed\('return_submitted', returnId, returnId && query\.data \? query\.dataUpdatedAt : 0\)/);
  for (const source of [incoming, returnDetail]) {
    assert.doesNotMatch(source, /mark_notifications_read|update.*status/i, 'reviewing only marks notifications read');
  }

  const authProvider = read('src/features/auth/AuthProvider.tsx');
  const signOut = authProvider.slice(authProvider.indexOf('const signOut'), authProvider.indexOf('const value'));
  assert.ok(
    signOut.indexOf('await unregisterThisDeviceForPush()') > -1 &&
      signOut.indexOf('await unregisterThisDeviceForPush()') < signOut.indexOf('supabase.auth.signOut'),
    'device is unregistered while the session is still valid',
  );
  assert.match(signOut, /clearDeliveredNotifications\(\)/, 'previous account’s notifications leave the tray');
  assert.match(read('src/features/notifications/pushRegistration.ts'), /setTimeout\(resolve, timeoutMs\)/, 'sign-out never hangs on the network');

  const bridge = read('src/features/notifications/NotificationsBridge.tsx');
  assert.doesNotMatch(bridge, /requestPushPermission/, 'no automatic permission prompt');
  assert.match(bridge, /routeForNotification\(pendingTap, \{ userId: recipientId, role: profile\.role \}\)/);
  assert.match(bridge, /filter: `recipient_id=eq\.\$\{recipientId\}`/);
  assert.match(bridge, /getLaunchNotificationData\(\)/, 'cold-start tap handled');
  assert.match(read('app/_layout.tsx'), /<NotificationsBridge \/>/);

  const callers = ['src/features/notifications/PushNotificationsCard.tsx', 'src/features/notifications/NotificationsBridge.tsx', 'src/features/auth/AuthProvider.tsx']
    .filter((path) => /requestPushPermission\(/.test(read(path)));
  assert.deepEqual(callers, ['src/features/notifications/PushNotificationsCard.tsx'], 'only the explicit Enable action prompts');
  const card = read('src/features/notifications/PushNotificationsCard.tsx');
  assert.ok(card.indexOf('confirmAction(') < card.indexOf('requestPushPermission()'), 'explanation shown before the native prompt');
  assert.match(card, /Linking\.openSettings\(\)/);
  for (const profile of ['app/(cashier)/cashier/profile.tsx', 'app/(manager)/manager/profile.tsx']) {
    assert.match(read(profile), /<PushNotificationsCard role=\{profile\.role\} \/>/);
  }
  assert.doesNotMatch(read('app/(owner)/owner/profile.tsx'), /PushNotificationsCard/);

  // Web builds use the stub; it must expose the same API without importing expo-notifications.
  const exportsOf = (source) => [...source.matchAll(/export (?:async )?(?:function|const|type) (\w+)/g)].map((m) => m[1]).sort();
  const native = read('src/features/notifications/pushNotifications.ts');
  const web = read('src/features/notifications/pushNotifications.web.ts');
  assert.deepEqual(exportsOf(web), exportsOf(native));
  assert.doesNotMatch(web, /expo-notifications|expo-constants/);
  assert.match(native, /setNotificationChannelAsync\('default'|CHANNEL_ID = 'default'/);
  assert.match(native, /shouldShowBanner: true/);

  const app = JSON.parse(read('app.json')).expo;
  const plugin = app.plugins.find((entry) => (Array.isArray(entry) ? entry[0] : entry) === 'expo-notifications');
  assert.ok(Array.isArray(plugin) && plugin[1].defaultChannel === 'default', 'plugin default channel matches the pushed channelId');
  assert.ok(app.extra.eas.projectId, 'existing EAS project ID is used');
  assert.match(read('package.json'), /"expo-notifications": "~57\./);

  assert.match(read('supabase/config.toml'), /\[functions\.push-dispatch\]\s*\n(#[^\n]*\n)*verify_jwt = false/);
  const fn = read('supabase/functions/push-dispatch/index.ts');
  assert.match(fn, /isAuthorizedKey\(provided, keys\)/, 'only callers holding the project secret key');
  assert.doesNotMatch(fn, /PUBLISHABLE|ANON/, 'no client-grade key');
  for (const rpc of ['claim_push_deliveries', 'record_push_tickets', 'claim_push_receipts', 'record_push_receipts']) {
    assert.match(fn, new RegExp(`'${rpc}'`));
  }
  for (const path of ['src/services/notificationService.ts', 'src/features/notifications/pushRegistration.ts']) {
    assert.doesNotMatch(read(path), /exp\.host|claim_push|record_push|SECRET/, 'clients never send pushes or touch the queue');
  }
}

console.log(
  'Push notification client tests passed: badge text and 9+ cap, Incoming/Returns badges only for their roles, validated tap routing (recipient, role, UUID), recipient gating, review-to-clear wiring, permission explained before prompting and never auto-requested, sign-out cleanup, web stub parity, config.',
);
