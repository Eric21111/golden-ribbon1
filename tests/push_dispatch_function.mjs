import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { PGlite } from '@electric-sql/pglite';

// Runs the real push-dispatch Edge Function handler (supabase/functions/push-dispatch/index.ts) under Node:
// Deno.serve/Deno.env are shimmed, the Supabase client executes each RPC as service_role against the real
// migrations in PGlite, and the Expo Push API is mocked. Local Edge Runtime needs Docker, which is unavailable.

// --- Database ---------------------------------------------------------------------------------------
const db = new PGlite();
await db.exec(`
  create role anon;
  create role authenticated;
  create role service_role;
  create schema auth;
  create table auth.users(id uuid primary key, email text);
  create function auth.uid() returns uuid language sql as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema public, auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`);
for (const file of readdirSync('supabase/migrations').filter((name) => name.endsWith('.sql')).sort()) {
  await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8').replace(/create extension if not exists pgcrypto;/g, ''));
}

const id = (n) => `34000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const [mainMgr, cashier1, cashier2] = [id(1), id(2), id(3)];
const [main, sm1] = [id(10), id(11)];
await db.exec(`
  insert into auth.users values ('${mainMgr}','m@t'),('${cashier1}','c1@t'),('${cashier2}','c2@t');
  insert into public.branches(id,name,code,is_main_branch,is_active,receiving_mode) values
    ('${main}','Main Branch','MAIN',true,true,'counted'), ('${sm1}','SM1','SM1',false,true,'cashier_confirm');
  insert into public.profiles(id,full_name,role,branch_id,is_active) values
    ('${mainMgr}','Mara','manager','${main}',true), ('${cashier1}','Cara','cashier','${sm1}',true),
    ('${cashier2}','Cody','cashier','${sm1}',true);
`);
const rows = async (sql, params = []) => (await db.query(sql, params)).rows;
const tokens = {
  c1: 'ExponentPushToken[cashier-one-phone-1]',
  c2: 'ExponentPushToken[cashier-two-phone-2]',
  m: 'ExponentPushToken[main-manager-phone-3]',
};
await db.exec(`
  insert into public.push_devices(user_id, expo_push_token, platform) values
    ('${cashier1}', '${tokens.c1}', 'android'), ('${cashier2}', '${tokens.c2}', 'ios'), ('${mainMgr}', '${tokens.m}', 'android');
`);
let entitySeq = 100;
const notify = async (recipient, role, branch, kind) => {
  const entity = id(entitySeq++);
  await db.query(
    `insert into public.notifications(recipient_id, recipient_role, recipient_branch_id, kind, entity_id, title, body)
     values ($1, $2, $3, $4, $5, 'T', 'B')`,
    [recipient, role, branch, kind, entity],
  );
  return entity;
};
const deliveries = () =>
  rows(`select d.id, d.status, d.attempts, d.ticket_id, d.last_error, d.next_attempt_at > now() delayed, dev.expo_push_token token,
               dev.enabled, n.entity_id
        from public.push_deliveries d join public.push_devices dev on dev.id = d.device_id
        join public.notifications n on n.id = d.notification_id order by d.created_at, dev.expo_push_token`);
const byToken = async () => Object.fromEntries((await deliveries()).map((d) => [d.token, d]));
const settle = async () => db.exec(`update public.push_deliveries set next_attempt_at = now() where status = 'pending'`);

// --- Function harness -------------------------------------------------------------------------------
const SECRET = 'sb_secret_TESTONLY_0123456789abcdef';
const LEGACY = 'eyJ-legacy-service-role-TESTONLY';
const PUBLISHABLE = 'sb_publishable_TESTONLY_0123456789';
const env = {
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_SECRET_KEYS: JSON.stringify({ default: SECRET }),
  SUPABASE_SERVICE_ROLE_KEY: LEGACY,
  SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: PUBLISHABLE }),
};
let handler;
globalThis.Deno = { env: { get: (key) => env[key] }, serve: (fn) => { handler = fn; } };

const clientKeys = [];
globalThis.__pushRpc = async (name, args) => {
  const entries = Object.entries(args ?? {});
  const params = entries.map(([key, value], i) => `${key} => $${i + 1}${typeof value === 'object' ? '::jsonb' : '::int'}`);
  try {
    await db.exec('set role service_role');
    const result = await db.query(
      `select public.${name}(${params.join(', ')}) r`,
      entries.map(([, value]) => (typeof value === 'object' ? JSON.stringify(value) : value)),
    );
    return { data: result.rows[0]?.r ?? null, error: null };
  } catch (error) {
    return { data: null, error: { message: error.message } };
  } finally {
    await db.exec('reset role');
  }
};
const clientStub = `
  export function createClient(url, key) {
    globalThis.__pushClientKeys?.push({ url, key });
    return { rpc: (name, args) => globalThis.__pushRpc(name, args) };
  }
`;
globalThis.__pushClientKeys = clientKeys;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'npm:@supabase/supabase-js@2') {
      return { url: `data:text/javascript,${encodeURIComponent(clientStub)}`, shortCircuit: true };
    }
    return next(specifier, context);
  },
});

const expoCalls = [];
let expo = () => {
  throw new Error('unexpected Expo call');
};
globalThis.fetch = async (url, init) => {
  const call = { url: String(url), headers: init.headers, body: JSON.parse(init.body), signal: init.signal };
  expoCalls.push(call);
  return expo(call);
};
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

await import('../supabase/functions/push-dispatch/index.ts');
assert.equal(typeof handler, 'function', 'index.ts registers its handler with Deno.serve');

const invoke = async (headers = {}, method = 'POST') => {
  const res = await handler(new Request('http://127.0.0.1:54321/functions/v1/push-dispatch', { method, headers }));
  return { status: res.status, body: await res.json() };
};
const asServer = () => invoke({ apikey: SECRET });

// --- 1. Unauthorized callers -------------------------------------------------------------------------
await notify(cashier1, 'cashier', sm1, 'transfer_pending');
const userJwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIiwicm9sZSI6ImF1dGhlbnRpY2F0ZWQifQ.sig';
for (const [label, headers] of [
  ['no credentials', {}],
  ['publishable key', { apikey: PUBLISHABLE }],
  ['publishable key + user JWT', { apikey: PUBLISHABLE, Authorization: `Bearer ${userJwt}` }],
  ['user JWT only', { Authorization: `Bearer ${userJwt}` }],
  ['secret key prefix', { apikey: SECRET.slice(0, -1) }],
  ['secret key with extra char', { apikey: `${SECRET}x` }],
  ['empty apikey', { apikey: '' }],
]) {
  const res = await invoke(headers);
  assert.equal(res.status, 401, label);
  assert.deepEqual(res.body, { message: 'Unauthorized.' }, `${label}: no details leaked`);
}
assert.equal((await invoke({ apikey: SECRET }, 'GET')).status, 405);
assert.equal(expoCalls.length, 0, 'rejected callers never reach Expo');
assert.equal(clientKeys.length, 0, 'rejected callers never get a database client');
assert.equal((await deliveries())[0].status, 'pending', 'queue untouched by rejected calls');

// --- 2. Valid server auth + Expo success ------------------------------------------------------------
await notify(mainMgr, 'manager', main, 'return_submitted');
expo = (call) => {
  assert.equal(call.url, 'https://exp.host/--/api/v2/push/send');
  return json(200, { data: call.body.map((_, i) => ({ status: 'ok', id: `ticket-${expoCalls.length}-${i}` })) });
};
{
  const res = await asServer();
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { sent: 2, failed: 0, receipts_checked: 0 });
  assert.equal(expoCalls.length, 1, 'one batched request');
  const [call] = expoCalls;
  assert.deepEqual(call.body.map((m) => m.to).sort(), [tokens.c1, tokens.m].sort());
  for (const message of call.body) {
    assert.equal(message.channelId, 'default');
    assert.equal(message.priority, 'high');
    assert.ok(['/cashier/incoming', `/manager/returns/${message.data.entity_id}`].includes(message.data.url));
  }
  assert.equal(call.headers.Authorization, undefined, 'no Expo access token configured: no Authorization header');
  assert.ok(!JSON.stringify(call).includes(SECRET) && !JSON.stringify(call).includes(LEGACY), 'Supabase keys never sent to Expo');
  assert.ok(call.signal instanceof AbortSignal, 'Expo request is bounded by a timeout signal');
  assert.deepEqual(clientKeys.at(-1), { url: env.SUPABASE_URL, key: SECRET });
  assert.deepEqual((await deliveries()).map((d) => d.status), ['sent', 'sent']);
}
{
  const before = expoCalls.length;
  assert.deepEqual((await asServer()).body, { sent: 0, failed: 0, receipts_checked: 0 }, 'duplicate invocation sends nothing');
  assert.equal(expoCalls.length, before);
}
{
  const before = expoCalls.length;
  env.EXPO_ACCESS_TOKEN = 'expo-access-TESTONLY';
  await notify(cashier2, 'cashier', sm1, 'transfer_pending');
  assert.equal((await invoke({ Authorization: `Bearer ${LEGACY}` })).status, 200, 'legacy service-role key in Authorization accepted');
  assert.equal(expoCalls[before].headers.Authorization, 'Bearer expo-access-TESTONLY');
  delete env.EXPO_ACCESS_TOKEN;
}

// --- 3. Per-ticket errors ------------------------------------------------------------------------------
await db.exec(`delete from public.push_deliveries`);
await notify(cashier1, 'cashier', sm1, 'transfer_pending');
await notify(cashier2, 'cashier', sm1, 'transfer_pending');
await notify(mainMgr, 'manager', main, 'return_submitted');
expo = (call) =>
  json(200, {
    data: call.body.map((m) =>
      m.to === tokens.c1
        ? { status: 'error', message: 'not registered', details: { error: 'DeviceNotRegistered' } }
        : m.to === tokens.c2
          ? { status: 'error', message: 'slow down', details: { error: 'MessageRateExceeded' } }
          : { status: 'ok', id: 'ticket-m' },
    ),
  });
{
  const res = await asServer();
  assert.deepEqual(res.body, { sent: 1, failed: 2, receipts_checked: 0 });
  const d = await byToken();
  assert.deepEqual([d[tokens.c1].status, d[tokens.c1].enabled, d[tokens.c1].last_error], ['failed', false, 'DeviceNotRegistered']);
  assert.deepEqual([d[tokens.c2].status, d[tokens.c2].delayed, d[tokens.c2].attempts], ['pending', true, 1], 'rate limit backs off');
  assert.equal(d[tokens.m].status, 'sent');
}

// --- 4. Whole-request failures: HTTP 500, network error, timeout -------------------------------------
await db.exec(`update public.push_devices set enabled = true`);
await db.exec(`delete from public.push_deliveries`);
await notify(cashier1, 'cashier', sm1, 'transfer_pending');
for (const [label, behavior, expectedError] of [
  ['HTTP 500', () => json(500, { errors: [{ code: 'INTERNAL_SERVER_ERROR', message: 'boom' }] }), 'INTERNAL_SERVER_ERROR: boom'],
  ['network error', () => { throw new TypeError('fetch failed'); }, 'NetworkError: TypeError: fetch failed'],
  ['timeout', () => { throw new DOMException('The operation timed out.', 'TimeoutError'); }, 'Timeout: TimeoutError: The operation timed out.'],
  ['non-JSON 502', () => new Response('<html>bad gateway</html>', { status: 502 }), 'RequestFailed: Expo push request failed.'],
]) {
  await settle();
  expo = behavior;
  const res = await asServer();
  assert.equal(res.status, 200, `${label}: the function itself still completes`);
  assert.equal(res.body.failed, 1, label);
  const [d] = await deliveries();
  assert.deepEqual([d.status, d.delayed, d.last_error], ['pending', true, expectedError], `${label}: retried later with backoff`);
}
{
  // 5th failed attempt is final: no infinite retry loop.
  await settle();
  const [d] = await deliveries();
  assert.equal(d.attempts, 4);
  expo = () => json(503, { errors: [{ code: 'UNAVAILABLE', message: 'down' }] });
  await asServer();
  assert.deepEqual((await deliveries()).map((x) => [x.status, x.attempts]), [['failed', 5]]);
  await settle();
  const before = expoCalls.length;
  await asServer();
  assert.equal(expoCalls.length, before, 'failed deliveries are never retried');
}

// --- 5. Receipts --------------------------------------------------------------------------------------
await db.exec(`delete from public.push_deliveries`);
await notify(cashier1, 'cashier', sm1, 'transfer_pending');
await notify(cashier2, 'cashier', sm1, 'transfer_pending');
await notify(mainMgr, 'manager', main, 'return_submitted');
expo = (call) => json(200, { data: call.body.map((m) => ({ status: 'ok', id: `r-${m.to}` })) });
await asServer();
{
  const before = expoCalls.length;
  await asServer();
  assert.equal(expoCalls.length, before, 'receipts are not fetched before 15 minutes');
}
await db.exec(`update public.push_deliveries set sent_at = now() - interval '16 minutes'`);
expo = () => json(500, {});
{
  const res = await asServer();
  assert.equal(res.body.receipts_checked, 0);
  assert.deepEqual((await deliveries()).map((d) => d.status), ['sent', 'sent', 'sent'], 'receipt endpoint failure leaves rows for the next sweep');
}
expo = (call) => {
  assert.equal(call.url, 'https://exp.host/--/api/v2/push/getReceipts');
  assert.deepEqual(call.body.ids.sort(), Object.values(tokens).map((t) => `r-${t}`).sort());
  return json(200, {
    data: {
      [`r-${tokens.c1}`]: { status: 'ok' },
      [`r-${tokens.c2}`]: { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } },
      // manager's receipt not ready yet
    },
  });
};
{
  const res = await asServer();
  assert.equal(res.body.receipts_checked, 2);
  const d = await byToken();
  assert.equal(d[tokens.c1].status, 'accepted');
  assert.deepEqual([d[tokens.c2].status, d[tokens.c2].enabled], ['failed', false], 'DeviceNotRegistered receipt disables the device');
  assert.equal(d[tokens.m].status, 'sent', 'missing receipt checked again later');
}
expo = () => json(200, { data: { [`r-${tokens.m}`]: { status: 'error', message: 'slow', details: { error: 'MessageRateExceeded' } } } });
await asServer();
{
  const d = await byToken();
  assert.deepEqual([d[tokens.m].status, d[tokens.m].ticket_id, d[tokens.m].delayed], ['pending', null, true], 'receipt rate limit re-queues');
}

// --- 6. Expired and deactivated-recipient deliveries are skipped, never sent --------------------------------------
await db.exec(`update public.push_devices set enabled = true; delete from public.push_deliveries;`);
await notify(cashier1, 'cashier', sm1, 'transfer_pending');
await db.exec(`update public.push_deliveries set created_at = now() - interval '25 hours'`);
await notify(cashier2, 'cashier', sm1, 'transfer_pending');
await db.exec(`update public.profiles set is_active = false where id = '${cashier2}'`);
{
  const before = expoCalls.length;
  const res = await asServer();
  assert.deepEqual(res.body, { sent: 0, failed: 0, receipts_checked: 0 });
  assert.equal(expoCalls.length, before);
  assert.deepEqual((await deliveries()).map((d) => [d.status, d.last_error]), [
    ['skipped', 'Expired before delivery'],
    ['skipped', 'Recipient no longer assigned'],
  ]);
}

await db.close();
console.log(
  'push-dispatch Edge Function handler tests passed: unauthorized/anonymous/user-JWT rejection without DB or Expo access, secret and legacy server keys, batched Expo send with timeout signal and no key leakage, ticket errors (DeviceNotRegistered, rate limit), HTTP 500/network/timeout/non-JSON retry with backoff and a hard 5-attempt stop, receipt success/error/missing/endpoint failure, expired and reassigned skips, idempotent re-invocation.',
);
