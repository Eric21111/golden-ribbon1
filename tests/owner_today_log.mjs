import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

import { closeShiftExact } from './_close_shift_helper.mjs';
import {
  activityDetail,
  describeActivity,
  formatManilaTime,
  sortActivitiesNewestFirst,
} from '../src/features/reports/todayLog.ts';

// --- Pure helpers -----------------------------------------------------------------------------
{
  assert.equal(formatManilaTime('2026-11-08T00:05:00Z'), '8:05 AM');
  assert.equal(formatManilaTime('2026-11-08T04:00:00Z'), '12:00 PM');
  assert.equal(formatManilaTime('2026-11-08T16:00:00Z'), '12:00 AM', 'Manila midnight');
  assert.equal(formatManilaTime('2026-11-08T15:59:00Z'), '11:59 PM');
  assert.equal(formatManilaTime('not a date'), '—');

  const rows = [
    { id: 'a', occurred_at: '2026-11-08T01:00:00Z' },
    { id: 'b', occurred_at: '2026-11-08T03:00:00Z' },
    { id: 'c', occurred_at: '2026-11-08T02:00:00Z' },
    { id: 'd', occurred_at: '2026-11-08T03:00:00Z' },
  ];
  assert.deepEqual(sortActivitiesNewestFirst(rows).map((r) => r.id), ['b', 'd', 'c', 'a'], 'ties keep server order');

  assert.equal(
    activityDetail({ action: 'transfer_sent', detail: { reference: 'TR-1', counterpart_branch_name: 'SM1', item_count: 1 } }),
    'TR-1 · to SM1 · 1 item',
  );
  assert.equal(
    activityDetail({ action: 'return_received', detail: { reference: 'RET-1', counterpart_branch_name: 'SM1', item_count: 2, with_issue: true } }),
    'RET-1 · from SM1 · 2 items · with discrepancy',
  );
  assert.equal(activityDetail({ action: 'opening_stock_set', detail: { product_count: 3 } }), '3 products');
  assert.equal(activityDetail({ action: 'shift_started', detail: {} }), null);
  const described = describeActivity({
    id: 'x', action: 'shift_started', occurred_at: '2026-11-08T00:30:00Z',
    actor_id: '1', actor_name: 'Ana', actor_role: 'cashier', branch_id: '2', branch_name: 'SM1', detail: {},
  });
  assert.deepEqual(described, { time: '8:30 AM', action: 'Started shift', employee: 'Ana · Cashier', branch: 'SM1', detail: null });
}

// --- Source wiring ----------------------------------------------------------------------------
{
  const dashboard = readFileSync('app/(owner)/owner/dashboard.tsx', 'utf8');
  assert.match(dashboard, /<Section title="Today Log">/);
  assert.match(dashboard, /useOwnerTodayActivityLog\(\)/);
  assert.match(dashboard, /Loading today's activity…/);
  assert.match(dashboard, /No employee activity yet today\./);
  assert.match(dashboard, /Couldn't load today's activity\./);
  assert.match(dashboard, /useManilaDayRefresh\(\(\) => \{[\s\S]*?todayLogQuery\.refetch\(\)/);
  assert.match(dashboard, /\{metricsQuery\.error \|\| summaryQuery\.error \? \(/, 'log errors stay out of the global gate');
  const keys = readFileSync('src/lib/queryKeys.ts', 'utf8');
  assert.match(keys, /ownerTodayActivityLog: \['dashboard', 'owner', 'today-activity-log'\]/);
  const service = readFileSync('src/services/activityLogService.ts', 'utf8');
  assert.match(service, /rpc\('get_owner_today_activity_log'\)/);
  assert.doesNotMatch(service, /from\('/, 'no direct table reads from the client');
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
  grant usage on schema public, auth to authenticated;
  grant execute on function auth.uid() to authenticated;
`);
for (const file of readdirSync('supabase/migrations').filter((name) => name.endsWith('.sql')).sort()) {
  await db.exec(
    readFileSync(`supabase/migrations/${file}`, 'utf8').replace(/create extension if not exists pgcrypto;/g, ''),
  );
}

const id = (n) => `31000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const [owner, mainMgr, cashier1, cashier2, sellingMgr, inactiveOwner] = [id(1), id(2), id(3), id(4), id(5), id(6)];
const [main, sm1, sm2] = [id(10), id(11), id(12)];
const [piece, drink, cookie, water] = [id(20), id(21), id(22), id(23)];

await db.exec(`
  insert into auth.users values
    ('${owner}','o@t'),('${mainMgr}','m@t'),('${cashier1}','c1@t'),('${cashier2}','c2@t'),
    ('${sellingMgr}','sm@t'),('${inactiveOwner}','io@t');
  insert into public.branches(id,name,code,is_main_branch,is_active,receiving_mode) values
    ('${main}','Main','MAIN',true,true,'counted'),
    ('${sm1}','SM1','SM1',false,true,'cashier_confirm'),
    ('${sm2}','SM2','SM2',false,true,'cashier_confirm');
  insert into public.profiles(id,full_name,role,branch_id,is_active) values
    ('${owner}','Owner','owner',null,true),
    ('${mainMgr}','Mara Main','manager','${main}',true),
    ('${cashier1}','Cara One','cashier','${sm1}',true),
    ('${cashier2}','Cody Two','cashier','${sm2}',true),
    ('${sellingMgr}','Sam Seller','manager','${sm1}',true),
    ('${inactiveOwner}','Old Owner','owner',null,false);
  insert into public.products(id,name,sku,selling_price,is_active,inventory_mode,closing_stock_behavior) values
    ('${piece}','Piece Cake','PIECE',50,true,'piece_stock','keep_at_branch'),
    ('${drink}','Bottled Drink','DRINK',25,true,'piece_stock','keep_at_branch'),
    ('${cookie}','Cookie','COOKIE',15,true,'piece_stock','keep_at_branch');
  insert into public.products(id,name,sku,selling_price,is_active,inventory_mode,closing_stock_behavior,is_non_returnable) values
    ('${water}','Local Water','WATER',20,true,'piece_stock','keep_at_branch',true);
  insert into public.branch_products(branch_id,product_id,selling_price,is_active) values
    ('${sm1}','${piece}',50,true),('${sm1}','${drink}',25,true),
    ('${sm2}','${piece}',50,true),('${sm2}','${drink}',25,true);
`);

const asUser = async (userId, work) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false);`);
  try {
    return await work();
  } finally {
    await db.exec('reset role');
  }
};
const readLog = () =>
  asUser(owner, async () => (await db.query('select public.get_owner_today_activity_log() r')).rows[0].r);

// Empty day.
{
  const log = await readLog();
  assert.deepEqual(log.activities, []);
  assert.equal(log.total_count, 0);
  assert.equal(log.truncated, false);
  const today = (await db.query(`select (timezone('Asia/Manila', now()))::date::text d`)).rows[0].d;
  assert.equal(String(log.business_date), today);
}

// Operations, in order. Failed attempts are made along the way and must not appear.
await asUser(mainMgr, () =>
  db.query('select public.initialize_main_branch_inventory($1::jsonb, null)', [
    JSON.stringify([{ product_id: piece, quantity: '100' }, { product_id: drink, quantity: '40' }]),
  ]),
);
await asUser(mainMgr, () =>
  assert.rejects(
    () => db.query('select public.initialize_main_branch_inventory($1::jsonb, null)', [JSON.stringify([{ product_id: piece, quantity: '1.5' }])]),
    /whole numbers/i,
  ),
);
await asUser(mainMgr, () =>
  db.query('select public.initialize_main_branch_inventory($1::jsonb, $2)', [
    JSON.stringify([{ product_id: piece, quantity: '10' }]),
    'second delivery',
  ]),
);
// One submission mixing a repeat addition (piece) and a first-time opening (cookie): one log row.
await asUser(mainMgr, () =>
  db.query('select public.initialize_main_branch_inventory($1::jsonb, null)', [
    JSON.stringify([{ product_id: piece, quantity: '5' }, { product_id: cookie, quantity: '20' }]),
  ]),
);
const t1 = (
  await asUser(mainMgr, () =>
    db.query('select public.send_stock_transfer($1,$2::jsonb,$3,$4) id', [
      sm1,
      JSON.stringify([{ product_id: piece, quantity_sent: '6' }, { product_id: drink, quantity_sent: '2' }]),
      null,
      'log-send-t1-000000001',
    ]),
  )
).rows[0].id;
await asUser(mainMgr, () =>
  assert.rejects(
    () =>
      db.query('select public.send_stock_transfer($1,$2::jsonb,$3,$4) id', [
        sm2, JSON.stringify([{ product_id: piece, quantity_sent: '99999' }]), null, 'log-send-fail-0000001',
      ]),
    /Insufficient|stock/i,
  ),
);
await asUser(cashier1, () => db.query('select public.confirm_shipment_arrival($1,$2)', [t1, 'log-arrive-t1-0000001']));
const t2 = (
  await asUser(mainMgr, () =>
    db.query('select public.send_stock_transfer($1,$2::jsonb,$3,$4) id', [
      sm2, JSON.stringify([{ product_id: drink, quantity_sent: '3' }, { product_id: piece, quantity_sent: '2' }]), null, 'log-send-t2-000000001',
    ]),
  )
).rows[0].id;
const t2Items = (await db.query('select id, product_id from public.stock_transfer_items where stock_transfer_id=$1', [t2])).rows;
await asUser(cashier2, () =>
  db.query('select public.report_shipment_issue($1,$2::jsonb,$3,$4)', [
    t2,
    JSON.stringify(t2Items.map((item) => ({ stock_transfer_item_id: item.id, quantity_received: item.product_id === drink ? '2' : '2' }))),
    'one drink short',
    'log-issue-t2-00000001',
  ]),
);
// Unrelated inventory adjustment: a selling-branch local purchase (movement_type 'adjustment').
await asUser(cashier2, () =>
  db.query('select public.record_branch_local_purchase($1::jsonb,$2,$3)', [
    JSON.stringify([{ product_id: water, quantity: '5' }]), 'bought nearby', 'log-local-buy-000001',
  ]),
);
const shift1 = (await asUser(cashier1, () => db.query('select public.start_cashier_shift() id'))).rows[0].id;
const shift2 = (await asUser(cashier2, () => db.query('select public.start_cashier_shift() id'))).rows[0].id;
const ret1 = (
  await asUser(cashier1, () =>
    db.query('select public.create_stock_return($1::jsonb,$2,$3) id', [
      JSON.stringify([{ product_id: piece, quantity_returned: 2 }, { product_id: drink, quantity_returned: 1 }]),
      'leftover',
      'log-return-r1-0000001',
    ]),
  )
).rows[0].id;
await asUser(cashier1, () =>
  assert.rejects(
    () =>
      db.query('select public.create_stock_return($1::jsonb,$2,$3) id', [
        JSON.stringify([{ product_id: piece, quantity_returned: 999 }]), 'too many', 'log-return-fail-00001',
      ]),
    /Insufficient stock/i,
  ),
);
const ret1Items = (await db.query('select id, quantity_returned from public.stock_return_items where stock_return_id=$1', [ret1])).rows;
await asUser(mainMgr, () =>
  db.query('select public.receive_stock_return($1,$2::jsonb,$3,$4)', [
    ret1,
    JSON.stringify(ret1Items.map((item) => ({ stock_return_item_id: item.id, quantity_received: String(item.quantity_returned) }))),
    null,
    'log-return-recv-00001',
  ]),
);
// Manual close with a count shortage: writes a shift-close 'adjustment' movement at SM1 (unrelated to opening stock).
await asUser(cashier1, async () => {
  const preview = (await db.query('select public.begin_cashier_shift_close($1) p', [shift1])).rows[0].p;
  const products = preview.products.map((p) => ({
    product_id: p.product_id,
    actual_remaining: String(Number(p.system_balance_before_waste) - (p.product_id === piece ? 1 : 0)),
    waste_quantity: '0',
  }));
  await db.query('select public.finalize_cashier_shift_reconciliation($1,$2,$3::jsonb)', [shift1, '0', JSON.stringify(products)]);
});
{
  const adjustments = (
    await db.query(`
      select b.name, m.reference_type, count(*)::int n from public.inventory_movements m
      join public.branches b on b.id = m.branch_id
      where m.movement_type = 'adjustment' group by 1, 2 order by 1, 2`)
  ).rows;
  assert.deepEqual(
    adjustments,
    [
      { name: 'Main', reference_type: 'adjustment', n: 2 },
      { name: 'SM1', reference_type: 'adjustment', n: 1 },
      { name: 'SM2', reference_type: 'local_purchase', n: 1 },
    ],
    'fixture has repeat-opening, shift-close and local-purchase adjustments',
  );
}

const expectedOrder = [
  ['opening_stock_set', mainMgr, main],
  ['opening_stock_set', mainMgr, main],
  ['opening_stock_set', mainMgr, main],
  ['transfer_sent', mainMgr, main],
  ['transfer_received', cashier1, sm1],
  ['transfer_sent', mainMgr, main],
  ['transfer_received', cashier2, sm2],
  ['shift_started', cashier1, sm1],
  ['shift_started', cashier2, sm2],
  ['return_sent', cashier1, sm1],
  ['return_received', mainMgr, main],
  ['shift_ended', cashier1, sm1],
];

const log = await readLog();
const rows = log.activities;
const extra = rows.filter((r) => !['opening_stock_set', 'transfer_sent', 'transfer_received', 'shift_started', 'shift_ended', 'return_sent', 'return_received'].includes(r.action));
assert.deepEqual(extra, [], 'only the seven activity types');

// Every activity type, once per successful operation, newest first.
assert.deepEqual(
  rows.map((r) => [r.action, r.actor_id, r.branch_id]),
  [...expectedOrder].reverse(),
  'one row per successful operation, newest first; failed attempts are absent',
);
assert.equal(log.total_count, expectedOrder.length);
assert.equal(new Set(rows.map((r) => r.id)).size, rows.length, 'no duplicate rows');
for (let i = 1; i < rows.length; i += 1) {
  assert.ok(Date.parse(rows[i - 1].occurred_at) >= Date.parse(rows[i].occurred_at), 'non-increasing time');
}
assert.deepEqual(sortActivitiesNewestFirst(rows).map((r) => r.id), rows.map((r) => r.id), 'client sort agrees');

// Attribution: names, roles, branches, details.
const names = { [mainMgr]: ['Mara Main', 'manager'], [cashier1]: ['Cara One', 'cashier'], [cashier2]: ['Cody Two', 'cashier'] };
const branchNames = { [main]: 'Main', [sm1]: 'SM1', [sm2]: 'SM2' };
for (const row of rows) {
  assert.equal(row.actor_name, names[row.actor_id][0], `${row.action} actor name`);
  assert.equal(row.actor_role, names[row.actor_id][1], `${row.action} actor role`);
  assert.equal(row.branch_name, branchNames[row.branch_id], `${row.action} branch name`);
}
const byAction = (action) => rows.filter((r) => r.action === action).reverse();
const openings = byAction('opening_stock_set');
assert.equal(openings.length, 3, 'three successful submissions; local purchase and shift-close adjustments excluded');
assert.ok(openings.every((r) => r.branch_id === main && r.actor_id === mainMgr));
const [opening1, opening2, opening3] = openings;
assert.deepEqual([opening1.detail.product_count, opening1.detail.added_count], [2, 0], 'first-time: 2 products, one row');
assert.deepEqual([opening2.detail.product_count, opening2.detail.added_count], [1, 1], 'repeat addition is its own row');
assert.deepEqual([opening3.detail.product_count, opening3.detail.added_count], [2, 1], 'mixed submission: one row');
assert.equal(describeActivity(opening1).detail, '2 products');
assert.equal(describeActivity(opening2).detail, '1 product · added to existing stock');
assert.equal(describeActivity(opening3).detail, '2 products · 1 added to existing stock');
const movementTimes = (
  await db.query(`
    select distinct m.created_at from public.inventory_movements m join public.branches b on b.id = m.branch_id
    where b.is_main_branch and m.reference_type in ('opening_stock', 'adjustment') order by 1`)
).rows.map((r) => r.created_at.getTime());
assert.deepEqual(openings.map((r) => Date.parse(r.occurred_at)), movementTimes, 'row time = submission time');
const [sent1, sent2] = byAction('transfer_sent');
const transferNumbers = Object.fromEntries(
  (await db.query('select id, transfer_number from public.stock_transfers')).rows.map((r) => [r.id, r.transfer_number]),
);
assert.equal(sent1.detail.reference, transferNumbers[t1]);
assert.equal(sent1.detail.counterpart_branch_name, 'SM1');
assert.equal(Number(sent1.detail.item_count), 2, 'multi-product transfer: one row, 2 items');
assert.equal(sent2.detail.counterpart_branch_name, 'SM2');
assert.equal(Number(sent2.detail.item_count), 2);
const [recv1, recv2] = byAction('transfer_received');
assert.equal(recv1.detail.with_issue, false);
assert.equal(recv1.detail.counterpart_branch_name, 'Main');
assert.equal(recv1.detail.reference, transferNumbers[t1]);
assert.equal(recv2.detail.reference, transferNumbers[t2]);
assert.equal(recv2.detail.with_issue, true, 'report_shipment_issue shows as received with discrepancy');
const returnNumber = (await db.query('select return_number from public.stock_returns where id=$1', [ret1])).rows[0].return_number;
const [returnSent] = byAction('return_sent');
assert.equal(returnSent.detail.counterpart_branch_name, 'Main');
assert.equal(returnSent.detail.reference, returnNumber);
assert.equal(Number(returnSent.detail.item_count), 2, 'multi-product return: one row, 2 items');
const [returnReceived] = byAction('return_received');
assert.equal(returnReceived.detail.counterpart_branch_name, 'SM1');
assert.equal(returnReceived.detail.reference, returnNumber);
assert.equal(returnReceived.detail.with_issue, false);
assert.equal(byAction('shift_started').length, 2);
assert.ok(byAction('shift_started').every((r) => r.detail.reopened === false));
assert.equal(byAction('shift_ended').length, 1, 'only the closed shift has an end row');
const [manualEnd] = byAction('shift_ended');
assert.equal(manualEnd.detail.possibly_automatic, false, 'started after the latest 9 PM cutoff: provably the cashier');
assert.equal(describeActivity(manualEnd).action, 'Ended shift');
assert.equal(describeActivity(manualEnd).employee, 'Cara One · Cashier');
// Source timestamps for transfers and returns.
const transferTimes = (await db.query('select id, sent_at, received_at from public.stock_transfers')).rows;
for (const t of transferTimes) {
  assert.equal(Date.parse(rows.find((r) => r.id === `transfer_sent:${t.id}`).occurred_at), t.sent_at.getTime());
  assert.equal(Date.parse(rows.find((r) => r.id === `transfer_received:${t.id}`).occurred_at), t.received_at.getTime());
}
const returnTimes = (await db.query('select returned_at, received_at from public.stock_returns where id=$1', [ret1])).rows[0];
assert.equal(Date.parse(returnSent.occurred_at), returnTimes.returned_at.getTime());
assert.equal(Date.parse(returnReceived.occurred_at), returnTimes.received_at.getTime());
assert.deepEqual(
  describeActivity(sent2),
  { time: formatManilaTime(sent2.occurred_at), action: 'Sent stock out for delivery', employee: 'Mara Main · Manager', branch: 'Main', detail: `${transferNumbers[t2]} · to SM2 · 2 items` },
);

// Event times come from the source records.
const shiftTimes = (await db.query('select started_at, ended_at from public.shifts where id=$1', [shift1])).rows[0];
assert.equal(Date.parse(byAction('shift_started')[0].occurred_at), shiftTimes.started_at.getTime());
assert.equal(Date.parse(byAction('shift_ended')[0].occurred_at), shiftTimes.ended_at.getTime());

// Renaming an employee later shows the current name; returns fall back to their stored name snapshot.
await db.exec(`update public.profiles set full_name = 'Cara One-Reyes' where id = '${cashier1}'`);
assert.ok((await readLog()).activities.filter((r) => r.actor_id === cashier1).every((r) => r.actor_name === 'Cara One-Reyes'));

// Asia/Manila business-day boundaries (shift 2 is still open; move its start).
const moveShift2 = (expr) =>
  db.exec(`
    alter table public.shifts disable trigger shifts_protect_lifecycle;
    update public.shifts set started_at = ${expr} where id = '${shift2}';
    alter table public.shifts enable trigger shifts_protect_lifecycle;
  `);
const manilaMidnight = `((timezone('Asia/Manila', now()))::date::timestamp at time zone 'Asia/Manila')`;
await moveShift2(manilaMidnight);
{
  const l = await readLog();
  const row = l.activities.find((r) => r.id === `shift_started:${shift2}`);
  assert.ok(row, '00:00 Manila today is included');
  assert.equal(formatManilaTime(row.occurred_at), '12:00 AM');
  assert.equal(l.activities.at(-1).id, `shift_started:${shift2}`, 'and sorts as the oldest');
}
await moveShift2(`${manilaMidnight} - interval '1 millisecond'`);
{
  const l = await readLog();
  assert.ok(!l.activities.some((r) => r.id === `shift_started:${shift2}`), '23:59:59.999 yesterday is excluded');
  assert.equal(l.total_count, expectedOrder.length - 1);
}

// Automatic 9 PM close (close_overdue_shifts, as the cron runs it). Shift 2 starts before the latest cutoff.
const latestCutoff = `(((timezone('Asia/Manila', now()) - interval '21 hours')::date + time '21:00') at time zone 'Asia/Manila')`;
await moveShift2(`${latestCutoff} - interval '1 hour'`);
{
  const result = (await db.query('select public.close_overdue_shifts() r')).rows[0].r;
  assert.equal(result.closed_count, 1);
  const l = await readLog();
  const autoEnd = l.activities.find((r) => r.id === `shift_ended:${shift2}`);
  assert.ok(autoEnd, 'auto-closed shift has an end row today');
  assert.equal(autoEnd.actor_id, cashier2, 'the shift owner, not an invented actor');
  assert.equal(autoEnd.branch_id, sm2);
  assert.equal(autoEnd.detail.possibly_automatic, true);
  const described = describeActivity(autoEnd);
  assert.equal(described.action, 'Shift closed', 'not labeled as the cashier ending the shift');
  assert.equal(described.employee, 'Shift of Cody Two · Cashier');
  assert.equal(described.detail, 'Automatic 9 PM close or cashier (not recorded)');
  const ended = (await db.query('select ended_at from public.shifts where id=$1', [shift2])).rows[0].ended_at;
  assert.equal(Date.parse(autoEnd.occurred_at), ended.getTime());
  assert.equal(l.activities.find((r) => r.id === `shift_ended:${shift1}`).detail.possibly_automatic, false);
}

// Reopened POS session after the completed remittance: flagged on its start row.
const shift3 = (await asUser(cashier1, () => db.query('select public.reopen_cashier_shift($1) id', ['Late customer at counter']))).rows[0].id;
{
  const l = await readLog();
  const reopened = l.activities.find((r) => r.id === `shift_started:${shift3}`);
  assert.equal(reopened.detail.reopened, true);
  assert.equal(reopened.actor_id, cashier1);
  assert.equal(describeActivity(reopened).action, 'Started shift');
  assert.equal(describeActivity(reopened).detail, 'Reopened after remittance');
}

// Limitation: a cashier closing a shift that started before the cutoff, at or after 9 PM, cannot be told apart
// from the automatic close; it is shown neutrally, never as a definite cashier or system action.
await db.exec(`
  alter table public.shifts disable trigger shifts_protect_lifecycle;
  update public.shifts set started_at = ${latestCutoff} - interval '1 minute' where id = '${shift3}';
  alter table public.shifts enable trigger shifts_protect_lifecycle;
`);
await asUser(cashier1, () => db.query('select public.begin_cashier_shift_close($1)', [shift3]));
{
  const row = (await readLog()).activities.find((r) => r.id === `shift_ended:${shift3}`);
  assert.equal(row.detail.possibly_automatic, true);
  assert.equal(describeActivity(row).action, 'Shift closed');
}

// Owner-only.
for (const [label, user] of [
  ['Main Branch Manager', mainMgr],
  ['selling-branch manager', sellingMgr],
  ['cashier', cashier1],
  ['inactive owner', inactiveOwner],
]) {
  await asUser(user, () =>
    assert.rejects(() => db.query('select public.get_owner_today_activity_log()'), /Owner access required/, `${label} refused`),
  );
}
await assert.rejects(
  async () => {
    await db.exec('set role anon');
    try {
      await db.query('select public.get_owner_today_activity_log()');
    } finally {
      await db.exec('reset role');
    }
  },
  /permission denied/,
);
const fn = (
  await db.query(`
    select prosecdef, provolatile, proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'get_owner_today_activity_log'
  `)
).rows;
assert.equal(fn.length, 1);
assert.equal(fn[0].prosecdef, true);
assert.equal(fn[0].provolatile, 's');
assert.deepEqual(fn[0].proconfig, ['search_path=""']);

await db.close();
console.log(
  'Owner Today Log tests passed: all 7 activity types, one row per submission (first-time, repeat, mixed opening), unrelated adjustments excluded, manual vs possibly-automatic close, reopen, references, attribution, newest-first sorting, Manila boundaries, owner-only access.',
);
