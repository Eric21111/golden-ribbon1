import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { closeShiftExact, backdateClosedShiftToYesterday } from './_close_shift_helper.mjs';

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
    readFileSync(`supabase/migrations/${file}`, 'utf8').replace(
      /create extension if not exists pgcrypto;/g,
      '',
    ),
  );
}

const id = (n) => `28000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1);
const mainMgr = id(2);
const cashierA = id(3);
const cashierB = id(4);
const cashierC = id(5);
const main = id(10);
const branch1 = id(11);
const branch2 = id(12);
const coke = id(20);
const historical = id(30);
const alreadyReconciled = id(31);
const pendingOld = id(32);
const pendingNew = id(33);

await db.exec(`
  insert into auth.users values
    ('${owner}','owner@test'),('${mainMgr}','main@test'),
    ('${cashierA}','a@test'),('${cashierB}','b@test'),('${cashierC}','c@test');
  insert into public.branches(id,name,code,is_main_branch) values
    ('${main}','Main','MAIN',true),
    ('${branch1}','Branch 1','B1',false),
    ('${branch2}','Branch 2','B2',false);
  insert into public.profiles(id,full_name,role,branch_id) values
    ('${owner}','Owner','owner',null),
    ('${mainMgr}','Main Manager','manager','${main}'),
    ('${cashierA}','Cashier A','cashier','${branch1}'),
    ('${cashierB}','Cashier B','cashier','${branch1}'),
    ('${cashierC}','Cashier C','cashier','${branch2}');
  insert into public.products(id,name,sku,selling_price,is_active) values
    ('${coke}','Coke','COKE',20,true);
  insert into public.branch_products(branch_id,product_id,selling_price,is_active) values
    ('${branch1}','${coke}',20,true),('${branch2}','${coke}',20,true);
  insert into public.branch_inventory(branch_id,product_id,quantity_on_hand) values
    ('${main}','${coke}',100),('${branch1}','${coke}',20),('${branch2}','${coke}',20);
`);

const asUser = async (userId, work) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false);`);
  try {
    return await work();
  } finally {
    await db.exec('reset role');
  }
};

const flagOf = async (shiftId) =>
  (await db.query('select reconciliation_required from public.shifts where id=$1', [shiftId])).rows[0]
    .reconciliation_required;

const remittanceCount = async (shiftId) =>
  Number(
    (await db.query('select count(*)::int as n from public.shift_reconciliations where shift_id=$1', [shiftId]))
      .rows[0].n,
  );

const pendingOf = async (userId) =>
  (await asUser(userId, () => db.query('select public.get_my_pending_shift_reconciliation() result'))).rows[0]
    .result;

const reportRows = async () => {
  const payload = (
    await asUser(owner, () => db.query('select public.report_branch_shift_remittances(null) rows'))
  ).rows[0].rows;
  return (payload?.days ?? []).flatMap((day) => day.shifts);
};

const reportFor = async (shiftId) => (await reportRows()).find((row) => row.shift_id === shiftId);

const backdateOpenForOverdue = async (shiftId) => {
  await db.exec(`
    alter table public.shifts disable trigger shifts_protect_lifecycle;
    update public.shifts
    set started_at = (
      case
        when timezone('Asia/Manila', now()) < (timezone('Asia/Manila', now()))::date + time '21:00'
          then (timezone('Asia/Manila', now()))::date - 1
        else (timezone('Asia/Manila', now()))::date
      end + time '21:00'
    ) at time zone 'Asia/Manila' - interval '2 hours'
    where id = '${shiftId}' and status = 'open';
    alter table public.shifts enable trigger shifts_protect_lifecycle;
  `);
};

await db.exec(`
  insert into public.shifts(
    id, branch_id, cashier_id, status, started_at, ended_at, reconciliation_required
  ) values (
    '${historical}','${branch1}','${cashierA}','closed',
    now() - interval '10 days', now() - interval '10 days' + interval '4 hours',
    false
  );
`);

const pendingA = await pendingOf(cashierA);
assert.equal(pendingA, null);
assert.equal(await reportFor(historical), undefined);
await asUser(cashierA, () =>
  assert.rejects(
    db.query('select public.reconcile_closed_shift($1,$2,$3::jsonb)', [historical, '0', '[]']),
    /This historical shift does not require reconciliation/,
  ),
);

const startedB = await asUser(cashierB, () => db.query('select public.start_cashier_shift() id'));
const overdueId = startedB.rows[0].id;
assert.equal(await flagOf(overdueId), true);
await backdateOpenForOverdue(overdueId);
const overdue = (await db.query('select public.close_overdue_shifts() result')).rows[0].result;
assert.equal(Number(overdue.closed_count), 1);
assert.equal(await flagOf(overdueId), true);
assert.equal(await remittanceCount(overdueId), 0);
const pendingB = await pendingOf(cashierB);
assert.equal(pendingB.status, 'pending');
assert.equal(pendingB.shift_id, overdueId);
assert.equal((await reportFor(overdueId)).status, 'pending');

// 7C: cannot start a new shift while inventory reconciliation is pending.
await asUser(cashierB, async () => {
  await assert.rejects(
    () => db.query('select public.start_cashier_shift()'),
    /pending inventory|Complete pending/i,
  );
});

const overdueFinalize = await asUser(cashierB, async () => closeShiftExact(db, overdueId, '0'));
assert.equal(overdueFinalize.result.status, 'reconciled');
assert.equal(await flagOf(overdueId), false);
assert.equal(await remittanceCount(overdueId), 1);
assert.equal(await pendingOf(cashierB), null);
assert.equal((await reportFor(overdueId)).status, 'reconciled');

await backdateClosedShiftToYesterday(db, overdueId);

const closedC = await asUser(cashierB, async () => {
  const shift = (await db.query('select public.start_cashier_shift() id')).rows[0].id;
  const { result } = await closeShiftExact(db, shift, '0');
  return { shift, result };
});
assert.equal(await flagOf(closedC.shift), false);
assert.equal(await remittanceCount(closedC.shift), 1);
assert.equal(closedC.result.status, 'reconciled');
assert.equal(await pendingOf(cashierB), null);
assert.equal((await reportFor(closedC.shift)).status, 'reconciled');
await backdateClosedShiftToYesterday(db, closedC.shift);

const startedC = await asUser(cashierC, () => db.query('select public.start_cashier_shift() id'));
const overdueC = startedC.rows[0].id;
assert.equal(await flagOf(overdueC), true);
await backdateOpenForOverdue(overdueC);
const overdueFalse = (await db.query('select public.close_overdue_shifts() result')).rows[0].result;
assert.equal(Number(overdueFalse.closed_count), 1);
assert.equal(await flagOf(overdueC), true);
assert.equal(await remittanceCount(overdueC), 0);
assert.equal((await pendingOf(cashierC)).shift_id, overdueC);

// New auto-close is PCS inventory+cash; reconcile_closed_shift is legacy cash-only only.
await asUser(cashierC, async () => {
  await assert.rejects(
    () => db.query('select public.reconcile_closed_shift($1,$2,$3::jsonb)', [overdueC, '0', '[]']),
    /finalize cashier shift reconciliation/i,
  );
  await closeShiftExact(db, overdueC, '0');
});
assert.equal(await flagOf(overdueC), false);
assert.equal(await remittanceCount(overdueC), 1);
await backdateClosedShiftToYesterday(db, overdueC);

const closedD = await asUser(cashierC, async () => {
  const shift = (await db.query('select public.start_cashier_shift() id')).rows[0].id;
  const { result } = await closeShiftExact(db, shift, '0');
  return { shift, result };
});
assert.equal(await flagOf(closedD.shift), false);
assert.equal(await remittanceCount(closedD.shift), 1);
assert.equal(await pendingOf(cashierC), null);

await db.exec(`
  insert into public.shifts(
    id, branch_id, cashier_id, status, started_at, ended_at, reconciliation_required
  ) values (
    '${alreadyReconciled}','${branch1}','${cashierA}','closed',
    now() - interval '8 days', now() - interval '8 days' + interval '3 hours',
    false
  );
  insert into public.shift_reconciliations(
    shift_id, branch_id, expected_cash, actual_cash, difference, result, recorded_by
  ) values (
    '${alreadyReconciled}','${branch1}',0,0,0,'exact','${cashierA}'
  );
`);
assert.equal(await flagOf(alreadyReconciled), false);
assert.equal((await reportFor(alreadyReconciled)).status, 'reconciled');
assert.equal(await reportFor(historical), undefined);

await db.exec(`
  insert into public.shifts(
    id, branch_id, cashier_id, status, started_at, ended_at, reconciliation_required
  ) values
    (
      '${pendingOld}','${branch1}','${cashierA}','closed',
      now() - interval '6 hours', now() - interval '5 hours',
      true
    ),
    (
      '${pendingNew}','${branch1}','${cashierA}','closed',
      now() - interval '2 hours', now() - interval '1 hour',
      true
    );
`);
const firstPending = await pendingOf(cashierA);
assert.equal(firstPending.shift_id, pendingOld);
assert.equal(await pendingOf(cashierC), null);
await asUser(cashierC, () =>
  assert.rejects(
    db.query('select public.reconcile_closed_shift($1,$2,$3::jsonb)', [pendingOld, '0', '[]']),
    /Unable to access this shift/,
  ),
);
await asUser(cashierA, () =>
  db.query('select public.reconcile_closed_shift($1,$2,$3::jsonb)', [pendingOld, '0', '[]']),
);
assert.equal((await pendingOf(cashierA)).shift_id, pendingNew);

await db.close();
console.log('legacy shift reconciliation tests passed');
