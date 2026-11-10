import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

import {
  chunk,
  isAuthorizedKey,
  receiptResults,
  ticketResults,
  toExpoMessages,
} from '../supabase/functions/push-dispatch/expo.ts';

// --- Edge Function helpers (pure) ---------------------------------------------------------------
{
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  const deliveries = [
    { delivery_id: 'd1', to: 'ExponentPushToken[aaaaaaaaaaaa]', title: 'T', body: 'B', data: { kind: 'transfer_pending' } },
    { delivery_id: 'd2', to: 'ExponentPushToken[bbbbbbbbbbbb]', title: 'T', body: 'B', data: {} },
  ];
  assert.deepEqual(toExpoMessages(deliveries)[0], {
    to: 'ExponentPushToken[aaaaaaaaaaaa]', title: 'T', body: 'B', data: { kind: 'transfer_pending' },
    sound: 'default', priority: 'high', channelId: 'default',
  });
  assert.deepEqual(
    ticketResults(deliveries, true, {
      data: [{ status: 'ok', id: 'tk1' }, { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } }],
    }),
    [{ delivery_id: 'd1', ticket_id: 'tk1' }, { delivery_id: 'd2', error: 'DeviceNotRegistered', message: 'gone' }],
  );
  assert.deepEqual(
    ticketResults(deliveries, false, { errors: [{ code: 'PUSH_TOO_MANY_EXPERIENCE_IDS', message: 'x' }] }).map((r) => r.error),
    ['PUSH_TOO_MANY_EXPERIENCE_IDS', 'PUSH_TOO_MANY_EXPERIENCE_IDS'],
    'a failed request records an error for every delivery in the batch',
  );
  assert.equal(ticketResults(deliveries, true, { data: [{ status: 'ok', id: 'tk1' }] })[1].error, 'MissingTicket');
  assert.equal(
    ticketResults(deliveries.slice(0, 1), true, { data: [{ status: 'error', id: 'tk9', details: { error: 'MessageTooBig' } }] })[0].error,
    'MessageTooBig',
    'an error ticket is never treated as sent',
  );
  assert.deepEqual(
    receiptResults(
      [{ delivery_id: 'd1', ticket_id: 'tk1' }, { delivery_id: 'd2', ticket_id: 'tk2' }, { delivery_id: 'd3', ticket_id: 'tk3' }],
      { data: { tk1: { status: 'ok' }, tk2: { status: 'error', message: 'm', details: { error: 'MessageRateExceeded' } } } },
    ),
    [{ delivery_id: 'd1', status: 'ok' }, { delivery_id: 'd2', status: 'error', error: 'MessageRateExceeded', message: 'm' }],
    'receipts not yet available are left for the next sweep',
  );
  assert.equal(isAuthorizedKey('sb_secret_abc', ['sb_secret_xyz', 'sb_secret_abc']), true);
  assert.equal(isAuthorizedKey('sb_secret_ab', ['sb_secret_abc']), false);
  assert.equal(isAuthorizedKey(null, ['sb_secret_abc']), false);
  assert.equal(isAuthorizedKey('', ['']), false);
}

// --- Database: real migrations and real operation RPCs ----------------------------------------
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
  -- Supabase's default grants: every new public table/function is granted to anon and authenticated, so only
  -- explicit revokes in the migration keep clients out.
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`);
for (const file of readdirSync('supabase/migrations').filter((name) => name.endsWith('.sql')).sort()) {
  await db.exec(
    readFileSync(`supabase/migrations/${file}`, 'utf8').replace(/create extension if not exists pgcrypto;/g, ''),
  );
}

const id = (n) => `33000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const [owner, mainMgr, cashier1, cashier1b, cashier2, sellingMgr, inactiveCashier, inactiveMainMgr] = [1, 2, 3, 4, 5, 6, 7, 8].map(id);
const [main, sm1, sm2] = [id(10), id(11), id(12)];
const [piece, drink] = [id(20), id(21)];

await db.exec(`
  insert into auth.users values
    ('${owner}','o@t'),('${mainMgr}','m@t'),('${cashier1}','c1@t'),('${cashier1b}','c1b@t'),('${cashier2}','c2@t'),
    ('${sellingMgr}','sm@t'),('${inactiveCashier}','ic@t'),('${inactiveMainMgr}','im@t');
  insert into public.branches(id,name,code,is_main_branch,is_active,receiving_mode) values
    ('${main}','Main Branch','MAIN',true,true,'counted'),
    ('${sm1}','SM1','SM1',false,true,'cashier_confirm'),
    ('${sm2}','SM2','SM2',false,true,'cashier_confirm');
  insert into public.profiles(id,full_name,role,branch_id,is_active) values
    ('${owner}','Owner','owner',null,true),
    ('${mainMgr}','Mara Main','manager','${main}',true),
    ('${cashier1}','Cara One','cashier','${sm1}',true),
    ('${cashier1b}','Cleo OneB','cashier','${sm1}',true),
    ('${cashier2}','Cody Two','cashier','${sm2}',true),
    ('${sellingMgr}','Sam Seller','manager','${sm1}',true),
    ('${inactiveCashier}','Ivy Gone','cashier','${sm1}',false),
    ('${inactiveMainMgr}','Ian Gone','manager','${main}',false);
  insert into public.products(id,name,sku,selling_price,is_active,inventory_mode,closing_stock_behavior) values
    ('${piece}','Piece Cake','PIECE',50,true,'piece_stock','keep_at_branch'),
    ('${drink}','Bottled Drink','DRINK',25,true,'piece_stock','keep_at_branch');
  insert into public.branch_products(branch_id,product_id,selling_price,is_active) values
    ('${sm1}','${piece}',50,true),('${sm1}','${drink}',25,true),
    ('${sm2}','${piece}',50,true),('${sm2}','${drink}',25,true);
`);

const asRole = async (role, userId, work) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub','${userId ?? ''}',false);`);
  try {
    return await work();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false);`);
  }
};
const asUser = (userId, work) => asRole('authenticated', userId, work);
const asService = (work) => asRole('service_role', null, work);
const rows = async (sql, params = []) => (await db.query(sql, params)).rows;
const notificationsFor = (userId) =>
  rows(`select kind, entity_id, title, body, read_at from public.notifications where recipient_id=$1 order by created_at, id`, [userId]);
const recipientsOf = async (entityId) =>
  (await rows(`select recipient_id from public.notifications where entity_id=$1 order by recipient_id`, [entityId])).map((r) => r.recipient_id);
const myVisible = (userId) => asUser(userId, () => rows('select kind, entity_id, title from public.notifications order by created_at, id'));
const myCounts = (userId) => asUser(userId, async () => (await rows('select public.get_my_unread_notification_counts() c'))[0].c);
const markRead = (userId, kind, entityId = null) =>
  asUser(userId, async () => (await rows('select public.mark_notifications_read($1,$2) n', [kind, entityId]))[0].n);
const register = (userId, token, platform = 'android') =>
  asUser(userId, () => db.query('select public.register_push_device($1,$2)', [token, platform]));
const send = (to, items, key) =>
  asUser(mainMgr, async () =>
    (await rows('select public.send_stock_transfer($1,$2::jsonb,$3,$4) id', [to, JSON.stringify(items), null, key]))[0].id,
  );
const createReturn = (cashier, items, key) =>
  asUser(cashier, async () =>
    (await rows('select public.create_stock_return($1::jsonb,$2,$3) id', [JSON.stringify(items), 'leftover', key]))[0].id,
  );
const tokenA = 'ExponentPushToken[cashier1-device-aaaa]';
const tokenB = 'ExponentPushToken[cashier2-device-bbbb]';
const tokenM = 'ExpoPushToken[main-manager-phone-mmmm]';

await asUser(mainMgr, () =>
  db.query('select public.initialize_main_branch_inventory($1::jsonb, null)', [
    JSON.stringify([{ product_id: piece, quantity: '100' }, { product_id: drink, quantity: '40' }]),
  ]),
);

// --- Device registration ----------------------------------------------------------------------
await register(cashier1, tokenA);
await register(cashier2, tokenB, 'ios');
await register(mainMgr, tokenM);
await register(cashier1, tokenA); // re-registering the same install is an upsert
assert.equal((await rows('select count(*)::int n from public.push_devices'))[0].n, 3);
await assert.rejects(() => register(cashier1, 'not-a-token'), /Invalid push token/);
await assert.rejects(() => register(cashier1, 'ExponentPushToken[aaaaaaaaaaaa]', 'web'), /Unsupported device platform/);
await assert.rejects(() => register(inactiveCashier, 'ExponentPushToken[inactive-device-1]'), /active account is required/);
for (const sql of ['select * from public.push_devices', 'select * from public.push_deliveries']) {
  await assert.rejects(() => asUser(cashier1, () => db.query(sql)), /permission denied/, `clients cannot read ${sql}`);
}

// --- Feature 1: transfer awaiting receipt notifies the receiving branch's active cashiers only ----
const t1 = await send(sm1, [{ product_id: piece, quantity_sent: '6' }], 'push-send-t1-00000001');
assert.equal((await rows('select status from public.stock_transfers where id=$1', [t1]))[0].status, 'pending_receipt');
assert.deepEqual(await recipientsOf(t1), [cashier1, cashier1b].sort(), 'active SM1 cashiers only');
assert.deepEqual(await notificationsFor(cashier1), [
  {
    kind: 'transfer_pending', entity_id: t1, title: 'Incoming Shipment',
    body: 'New stocks from Main Branch are awaiting receipt at SM1.', read_at: null,
  },
]);
for (const other of [cashier2, inactiveCashier, sellingMgr, mainMgr, owner]) {
  assert.deepEqual(await notificationsFor(other), [], `${other} is not notified of an SM1 shipment`);
}
{
  const deliveries = await rows(
    `select d.status, dev.expo_push_token from public.push_deliveries d join public.push_devices dev on dev.id=d.device_id`,
  );
  assert.deepEqual(deliveries, [{ status: 'pending', expo_push_token: tokenA }], 'one push queued for the device of cashier1 (cashier1b has no device)');
}

// Duplicate replay (same idempotency key) and a failed send create nothing new.
assert.equal(await send(sm1, [{ product_id: piece, quantity_sent: '6' }], 'push-send-t1-00000001'), t1);
await assert.rejects(() => send(sm1, [{ product_id: piece, quantity_sent: '100000' }], 'push-send-fail-000001'));
assert.equal((await rows('select count(*)::int n from public.notifications'))[0].n, 2, 'no duplicate or failed-transfer notifications');
assert.equal((await rows('select count(*)::int n from public.push_deliveries'))[0].n, 1);

// Draft transfers do not notify; the draft -> pending_receipt transition does, exactly once.
// Rolled back so the deferred "transfer has items" check never runs; row triggers fire immediately.
await db.exec(`
  begin;
  create temp table draft_copy as select * from public.stock_transfers where id='${t1}';
  update draft_copy set id='${id(90)}', status='draft', transfer_number='TRF-DRAFT-1', send_idempotency_key='push-draft-0000000001';
  insert into public.stock_transfers select * from draft_copy;
`);
assert.deepEqual(await recipientsOf(id(90)), [], 'draft: no notification');
await db.exec(`update public.stock_transfers set status='pending_receipt' where id='${id(90)}'`);
assert.equal((await recipientsOf(id(90))).length, 2, 'draft -> pending_receipt notifies');
await db.exec(`update public.stock_transfers set notes='edited', status='pending_receipt' where id='${id(90)}'`);
assert.equal((await recipientsOf(id(90))).length, 2, 'later updates never duplicate');
await db.exec('rollback');
assert.deepEqual(await recipientsOf(id(90)), []);

// A notification failure never fails the transfer.
await db.exec(`alter table public.notifications add constraint force_failure check (false) not valid`);
const tFail = await send(sm2, [{ product_id: drink, quantity_sent: '1' }], 'push-send-nf-00000001');
assert.equal((await rows('select status from public.stock_transfers where id=$1', [tFail]))[0].status, 'pending_receipt');
assert.deepEqual(await recipientsOf(tFail), [], 'notification skipped, transfer committed');
await db.exec(`alter table public.notifications drop constraint force_failure`);

// --- Feature 2: submitted return notifies the active Main Branch Manager only -------------------
await asUser(cashier1, () => db.query('select public.confirm_shipment_arrival($1,$2)', [t1, 'push-arrive-t1-000001']));
const r1 = await createReturn(cashier1, [{ product_id: piece, quantity_returned: 2 }], 'push-return-r1-000001');
assert.deepEqual(await recipientsOf(r1), [mainMgr], 'only the active Main Branch Manager');
assert.deepEqual((await notificationsFor(mainMgr)).map((n) => [n.kind, n.title, n.body]), [
  ['return_submitted', 'Stock Return Submitted', 'SM1 has returned leftover stocks for review.'],
]);
assert.equal(await createReturn(cashier1, [{ product_id: piece, quantity_returned: 2 }], 'push-return-r1-000001'), r1);
await assert.rejects(() => createReturn(cashier1, [{ product_id: piece, quantity_returned: 9999 }], 'push-return-fail-0001'));
assert.equal((await rows(`select count(*)::int n from public.notifications where kind='return_submitted'`))[0].n, 1);
for (const other of [sellingMgr, owner, inactiveMainMgr, cashier1, cashier2]) {
  assert.equal((await notificationsFor(other)).filter((n) => n.kind === 'return_submitted').length, 0);
}

// Defense in depth: a return addressed to a selling branch never notifies that branch's manager.
await db.exec(`
  begin;
  create temp table return_copy as select * from public.stock_returns where id='${r1}';
  update return_copy set id='${id(91)}', return_number='RET-COPY-1', idempotency_key='push-return-copy-0001',
    from_branch_id='${sm2}', to_branch_id='${sm1}';
  insert into public.stock_returns select * from return_copy;
`);
assert.deepEqual(await recipientsOf(id(91)), [], 'selling-branch manager is never a return recipient');
await db.exec('rollback');

// Automatic 9:00 PM leftover return uses its own wording.
const t2 = await send(sm2, [{ product_id: piece, quantity_sent: '4' }], 'push-send-t2-00000001');
await asUser(cashier2, () => db.query('select public.confirm_shipment_arrival($1,$2)', [t2, 'push-arrive-t2-000001']));
await asUser(cashier2, () => db.query('select public.confirm_shipment_arrival($1,$2)', [tFail, 'push-arrive-nf-000001']));
const autoReturn = (await rows(`select public.apply_leftover_return($1, null, 'auto-close-push-test-2026') id`, [cashier2]))[0].id;
assert.ok(autoReturn);
assert.deepEqual(
  (await rows('select body from public.notifications where entity_id=$1', [autoReturn])).map((r) => r.body),
  ['SM2 leftover stocks were returned automatically at 9:00 PM for review.'],
);

// --- RLS, unread counts, read state -------------------------------------------------------------
assert.deepEqual((await myVisible(cashier1)).map((n) => n.entity_id), [t1], 'cashier sees only own notifications');
assert.deepEqual((await myVisible(cashier2)).map((n) => n.entity_id), [t2], 'tFail notification was skipped');
assert.deepEqual((await myVisible(mainMgr)).map((n) => n.entity_id), [r1, autoReturn]);
assert.deepEqual(await myVisible(owner), []);
assert.deepEqual(await myCounts(cashier1), { transfer_pending: 1, return_submitted: 0 });
assert.deepEqual(await myCounts(mainMgr), { transfer_pending: 0, return_submitted: 2 });
for (const sql of [
  `insert into public.notifications(recipient_id,recipient_role,recipient_branch_id,kind,entity_id,title,body) values ('${cashier1}','cashier','${sm1}','transfer_pending','${id(99)}','x','y')`,
  `update public.notifications set read_at=now()`,
  `delete from public.notifications`,
]) {
  await assert.rejects(() => asUser(cashier1, () => db.query(sql)), /permission denied/, 'clients cannot forge or edit notifications');
}
await assert.rejects(() => markRead(cashier1, 'anything'), /Unknown notification type/);
assert.equal(await markRead(cashier2, 'transfer_pending', t1), 0, 'cannot mark someone else\u2019s notification');
assert.equal(await markRead(mainMgr, 'return_submitted', r1), 1, 'manager reviews one return');
assert.deepEqual(await myCounts(mainMgr), { transfer_pending: 0, return_submitted: 1 });
assert.equal(await markRead(mainMgr, 'return_submitted', r1), 0, 'already read');
assert.equal(await markRead(cashier1, 'transfer_pending'), 1, 'viewing Incoming clears transfer notifications');
assert.deepEqual(await myCounts(cashier1), { transfer_pending: 0, return_submitted: 0 });
assert.deepEqual(await myCounts(cashier1b), { transfer_pending: 1, return_submitted: 0 }, 'read state is per user');
assert.deepEqual(
  (await rows('select status::text s from public.stock_returns where id=$1', [r1])).map((r) => r.s),
  ['in_transit'],
  'reading never changes the return status',
);

// Reassignment and deactivation hide old notifications (account switch on the same device included).
await db.exec(`update public.profiles set branch_id='${sm2}' where id='${cashier1b}'`);
assert.deepEqual(await myVisible(cashier1b), [], 'moved to SM2: SM1 notifications hidden');
assert.deepEqual(await myCounts(cashier1b), { transfer_pending: 0, return_submitted: 0 });
assert.equal(await markRead(cashier1b, 'transfer_pending'), 0);
await db.exec(`update public.profiles set branch_id='${sm1}' where id='${cashier1b}'`);
assert.deepEqual(await myCounts(cashier1b), { transfer_pending: 1, return_submitted: 0 }, 'back at SM1');
await db.exec(`update public.profiles set role='manager' where id='${cashier1b}'`);
assert.deepEqual(await myVisible(cashier1b), [], 'role change: cashier notifications hidden');
assert.deepEqual(await myCounts(cashier1b), { transfer_pending: 0, return_submitted: 0 });
await db.exec(`update public.profiles set role='cashier' where id='${cashier1b}'`);
await db.exec(`update public.profiles set is_active=false where id='${mainMgr}'`);
assert.deepEqual(await myVisible(mainMgr), [], 'deactivated: nothing visible');
assert.deepEqual(await myCounts(mainMgr), { transfer_pending: 0, return_submitted: 0 });
await db.exec(`update public.profiles set is_active=true where id='${mainMgr}'`);
assert.equal((await myVisible(mainMgr)).length, 2, 'reactivated: history returns');

// Anonymous callers get nothing at all.
for (const sql of [
  'select * from public.notifications',
  'select * from public.push_devices',
  'select * from public.push_deliveries',
  'select public.get_my_unread_notification_counts()',
  `select public.mark_notifications_read('transfer_pending', null)`,
  `select public.register_push_device('ExponentPushToken[anonymous-device-1]', 'android')`,
  `select public.unregister_push_device('${tokenA}')`,
  'select public.claim_push_deliveries(10)',
  `select public.can_see_notification('${cashier1}', 'cashier', '${sm1}')`,
]) {
  await assert.rejects(() => asRole('anon', null, () => db.query(sql)), /permission denied/, `anon: ${sql}`);
}
// Every function the migration adds is closed to anon; only the intended ones are open to authenticated.
{
  const exposed = await rows(`
    select p.proname, has_function_privilege('anon', p.oid, 'execute') anon,
           has_function_privilege('authenticated', p.oid, 'execute') authed
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any($1::text[]) order by p.proname`,
    [[
      'can_see_notification', 'get_my_unread_notification_counts', 'mark_notifications_read', 'register_push_device',
      'unregister_push_device', 'claim_push_deliveries', 'record_push_tickets', 'claim_push_receipts', 'record_push_receipts',
      'request_push_dispatch', 'request_push_dispatch_if_due', 'push_deliveries_after_insert', 'notifications_queue_push',
      'notify_transfer_awaiting_receipt', 'notify_return_submitted',
    ]],
  );
  assert.equal(exposed.length, 15);
  assert.deepEqual(exposed.filter((f) => f.anon).map((f) => f.proname), []);
  assert.deepEqual(exposed.filter((f) => f.authed).map((f) => f.proname).sort(), [
    'can_see_notification', 'get_my_unread_notification_counts', 'mark_notifications_read', 'register_push_device', 'unregister_push_device',
  ]);
}
// Events cannot be forged by writing the stock tables directly; only the operation RPCs create them.
{
  const before = (await rows('select count(*)::int n from public.notifications'))[0].n;
  for (const [user, sql] of [
    [mainMgr, `insert into public.stock_transfers(transfer_number, from_branch_id, to_branch_id, status, created_by, sent_by, sent_at)
               values ('TRF-FORGED-1', '${main}', '${sm1}', 'pending_receipt', '${mainMgr}', '${mainMgr}', now())`],
    [cashier1, `insert into public.stock_returns(return_number, from_branch_id, to_branch_id, created_by, returned_by,
               from_branch_name, to_branch_name, returned_by_name, idempotency_key, request_items)
               values ('RET-FORGED-1', '${sm1}', '${main}', '${cashier1}', '${cashier1}', 'SM1', 'Main', 'x', 'forged-return-000001', '[]')`],
  ]) {
    await assert.rejects(() => asUser(user, () => db.query(sql)), /permission denied|row-level security/);
  }
  await asUser(mainMgr, () => db.query(`update public.stock_transfers set status = status where id = $1`, [t1])).catch(() => undefined);
  assert.equal((await rows('select count(*)::int n from public.notifications'))[0].n, before, 'no forged notifications');
}

// --- Feature 5: dispatcher RPCs are server-only ---------------------------------------------------
for (const sql of [
  'select public.claim_push_deliveries(10)',
  `select public.record_push_tickets('[]'::jsonb)`,
  'select public.claim_push_receipts(10)',
  `select public.record_push_receipts('[]'::jsonb)`,
  'select public.request_push_dispatch()',
]) {
  await assert.rejects(() => asUser(cashier1, () => db.query(sql)), /permission denied/, `${sql} is not client-callable`);
}

// Ticket handling: ok -> sent; DeviceNotRegistered disables the device; transient -> backoff.
const pushRows = () =>
  rows(`select d.id, d.status, d.attempts, d.ticket_id, d.last_error, d.next_attempt_at > now() as delayed, dev.expo_push_token token, dev.enabled
        from public.push_deliveries d join public.push_devices dev on dev.id=d.device_id order by dev.expo_push_token`);
{
  const claimed = await asService(async () => (await rows('select public.claim_push_deliveries(100) c'))[0].c);
  const byToken = Object.fromEntries(claimed.map((c) => [c.to, c]));
  assert.deepEqual(Object.keys(byToken).sort(), [tokenM, tokenA, tokenB].sort());
  assert.deepEqual(byToken[tokenA].data, {
    notification_id: byToken[tokenA].data.notification_id, recipient_id: cashier1, kind: 'transfer_pending', entity_id: t1, url: '/cashier/incoming',
  });
  assert.equal(byToken[tokenB].data.url, '/cashier/incoming');
  assert.equal(
    claimed.filter((c) => c.to === tokenM).every((c) => c.data.url === `/manager/returns/${c.data.entity_id}`),
    true,
  );
  assert.deepEqual(await asService(async () => (await rows('select public.claim_push_deliveries(100) c'))[0].c), [], 'claimed rows are locked');

  const managerDeliveries = claimed.filter((c) => c.to === tokenM);
  await asService(() =>
    db.query('select public.record_push_tickets($1::jsonb)', [
      JSON.stringify([
        { delivery_id: byToken[tokenA].delivery_id, ticket_id: 'ticket-a' },
        { delivery_id: byToken[tokenB].delivery_id, error: 'DeviceNotRegistered', message: 'gone' },
        { delivery_id: managerDeliveries[0].delivery_id, error: 'MessageRateExceeded' },
        { delivery_id: managerDeliveries[1].delivery_id, ticket_id: 'ticket-m' },
      ]),
    ]),
  );
  const state = await pushRows();
  const a = state.find((r) => r.token === tokenA);
  assert.deepEqual([a.status, a.ticket_id], ['sent', 'ticket-a']);
  const b = state.find((r) => r.token === tokenB);
  assert.deepEqual([b.status, b.enabled], ['failed', false], 'DeviceNotRegistered disables the device');
  const retry = state.find((r) => r.id === managerDeliveries[0].delivery_id);
  assert.deepEqual([retry.status, retry.attempts, retry.delayed], ['pending', 1, true], 'transient error backs off');
  assert.deepEqual(await asService(async () => (await rows('select public.claim_push_deliveries(100) c'))[0].c), [], 'not due yet');
}

// Receipts: due after 15 minutes; ok -> accepted; DeviceNotRegistered on receipt disables the device.
{
  assert.deepEqual(await asService(async () => (await rows('select public.claim_push_receipts(300) c'))[0].c), [], 'not due yet');
  await db.exec(`update public.push_deliveries set sent_at = now() - interval '16 minutes' where status='sent'`);
  const due = await asService(async () => (await rows('select public.claim_push_receipts(300) c'))[0].c);
  assert.deepEqual(due.map((r) => r.ticket_id).sort(), ['ticket-a', 'ticket-m']);
  const byTicket = Object.fromEntries(due.map((r) => [r.ticket_id, r.delivery_id]));
  await asService(() =>
    db.query('select public.record_push_receipts($1::jsonb)', [
      JSON.stringify([
        { delivery_id: byTicket['ticket-a'], status: 'ok' },
        { delivery_id: byTicket['ticket-m'], status: 'error', error: 'DeviceNotRegistered' },
      ]),
    ]),
  );
  const state = await pushRows();
  assert.equal(state.find((r) => r.id === byTicket['ticket-a']).status, 'accepted');
  assert.deepEqual(
    [state.find((r) => r.id === byTicket['ticket-m']).status, state.find((r) => r.token === tokenM).enabled],
    ['failed', false],
  );
  assert.deepEqual(await asService(async () => (await rows('select public.claim_push_receipts(300) c'))[0].c), []);
}

// A disabled device gets no new pushes; re-registering re-enables it.
const t3 = await send(sm2, [{ product_id: drink, quantity_sent: '1' }], 'push-send-t3-00000001');
assert.equal((await rows('select count(*)::int n from public.push_deliveries d join public.notifications n on n.id=d.notification_id where n.entity_id=$1', [t3]))[0].n, 0);
await register(cashier2, tokenB, 'ios');
assert.equal((await rows('select enabled from public.push_devices where expo_push_token=$1', [tokenB]))[0].enabled, true);

// Shared device / account switch: the token moves to the new account and the old account's queued push is skipped.
const t4 = await send(sm1, [{ product_id: drink, quantity_sent: '1' }], 'push-send-t4-00000001');
assert.equal((await rows(`select count(*)::int n from public.push_deliveries where status='pending' and next_attempt_at <= now()`))[0].n, 1, 'queued for cashier1');
await register(cashier2, tokenA);
assert.deepEqual(
  await asService(async () => (await rows('select public.claim_push_deliveries(100) c'))[0].c),
  [],
  'device moved to cashier2: cashier1 push is not sent to it',
);
assert.equal(
  (await rows(`select last_error from public.push_deliveries d join public.notifications n on n.id=d.notification_id where n.entity_id=$1`, [t4]))[0].last_error,
  'Device moved to another account',
);

// Sign out: only the owner of the token can disable it.
await asUser(cashier1, () => db.query('select public.unregister_push_device($1)', [tokenA]));
assert.equal((await rows('select enabled from public.push_devices where expo_push_token=$1', [tokenA]))[0].enabled, true, 'not cashier1\u2019s device anymore');
await asUser(cashier2, () => db.query('select public.unregister_push_device($1)', [tokenA]));
assert.deepEqual(
  (await rows('select enabled, disabled_reason from public.push_devices where expo_push_token=$1', [tokenA]))[0],
  { enabled: false, disabled_reason: 'signed_out' },
);

// Inactive recipient: queued push is skipped.
await register(cashier1, tokenA);
const t5 = await send(sm1, [{ product_id: drink, quantity_sent: '1' }], 'push-send-t5-00000001');
await db.exec(`update public.profiles set is_active=false where id='${cashier1}'`);
assert.deepEqual(await asService(async () => (await rows('select public.claim_push_deliveries(100) c'))[0].c), []);
assert.equal(
  (await rows(`select d.status, d.last_error from public.push_deliveries d join public.notifications n on n.id=d.notification_id where n.entity_id=$1`, [t5]))[0].last_error,
  'Recipient no longer assigned',
);
await db.exec(`update public.profiles set is_active=true where id='${cashier1}'`);

// Retry exhaustion: after 5 attempts a transient error is final.
{
  assert.equal(
    (await rows(`select count(*)::int n from public.push_deliveries where status='pending'`))[0].n,
    0,
    'the backed-off manager push was skipped once its device was disabled',
  );
  const t6 = await send(sm2, [{ product_id: drink, quantity_sent: '1' }], 'push-send-t6-00000001');
  const [retry] = await rows(
    `select d.id from public.push_deliveries d join public.notifications n on n.id=d.notification_id where n.entity_id=$1`,
    [t6],
  );
  await db.exec(`update public.push_deliveries set attempts=4, next_attempt_at=now() where id='${retry.id}'`);
  const [claim] = await asService(async () => (await rows('select public.claim_push_deliveries(100) c'))[0].c);
  assert.equal(claim.delivery_id, retry.id);
  await asService(() => db.query('select public.record_push_tickets($1::jsonb)', [JSON.stringify([{ delivery_id: retry.id, error: 'InvalidCredentials', message: 'bad' }])]));
  assert.deepEqual((await rows('select status, last_error from public.push_deliveries where id=$1', [retry.id]))[0], {
    status: 'failed', last_error: 'InvalidCredentials: bad',
  });
}

// A dispatcher that dies mid-send: recovered for retry, but never past the attempt limit.
{
  const t7 = await send(sm2, [{ product_id: drink, quantity_sent: '1' }], 'push-send-t7-00000001');
  const [stuck] = await rows(
    `select d.id from public.push_deliveries d join public.notifications n on n.id=d.notification_id where n.entity_id=$1`,
    [t7],
  );
  assert.equal((await asService(async () => (await rows('select public.claim_push_deliveries(100) c'))[0].c)).length, 1);
  await db.exec(`update public.push_deliveries set locked_at = now() - interval '11 minutes' where id='${stuck.id}'`);
  const [again] = await asService(async () => (await rows('select public.claim_push_deliveries(100) c'))[0].c);
  assert.equal(again.delivery_id, stuck.id, 'abandoned send is retried');
  await db.exec(`update public.push_deliveries set attempts = 5, locked_at = now() - interval '11 minutes' where id='${stuck.id}'`);
  assert.deepEqual(await asService(async () => (await rows('select public.claim_push_deliveries(100) c'))[0].c), []);
  assert.deepEqual((await rows('select status, last_error from public.push_deliveries where id=$1', [stuck.id]))[0], {
    status: 'failed', last_error: 'Dispatch interrupted; retry limit reached',
  });
}

// Wake-up helpers are no-ops without pg_net/Vault (local and PGlite).
await db.query('select public.request_push_dispatch_if_due()');
await db.query('select public.request_push_dispatch()');

// Transfer/return business statuses are untouched by notification work.
assert.deepEqual(
  (await rows(`select status::text s from public.stock_transfers where id = any($1::uuid[]) order by created_at`, [[t1, t2, t3, t4, t5]])).map((r) => r.s),
  ['received', 'received', 'pending_receipt', 'pending_receipt', 'pending_receipt'],
);

await db.close();
console.log(
  'Push notification tests passed: Expo ticket/receipt mapping, branch/role/active recipient targeting, idempotent server-side events (no draft/failed/duplicate), RLS and forged-write denial, unread counts and read state, reassignment/deactivation, device registration/sign-out/account switch, server-only dispatcher with retry, backoff and DeviceNotRegistered handling, notification failures isolated from transfers.',
);
