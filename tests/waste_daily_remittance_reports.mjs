import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

assert.match(readFileSync('src/services/shiftService.ts', 'utf8'), /p_range_type: rangeType/);
assert.match(readFileSync('src/features/reports/ShiftRemittanceScreen.tsx', 'utf8'), /useState<DateFilterType>\('today'\)/);
assert.match(readFileSync('src/features/reports/WasteHistoryScreen.tsx', 'utf8'), /useState<DateFilterType>\('today'\)/);
assert.match(readFileSync('src/features/reports/WasteHistoryScreen.tsx', 'utf8'), /Waste History/);
assert.match(readFileSync('src/features/reports/WasteHistoryScreen.tsx', 'utf8'), /formatPcsQty|pcs waste|quantity/);
assert.doesNotMatch(readFileSync('src/features/reports/WasteHistoryScreen.tsx', 'utf8'), /Waste Inventory|Waste units|Waste servings|KG-meal/);
assert.match(readFileSync('src/services/shiftService.ts', 'utf8'), /enrichWasteReportQuantities|shift_waste_occurrences/);

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

const signatures = (
  await db.query(`
    select pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'report_branch_shift_remittances'
    order by 1
  `)
).rows;
assert.equal(signatures.length, 1);
assert.equal(
  signatures[0].args,
  'p_branch_id uuid, p_range_type text, p_start_date timestamp with time zone, p_end_date timestamp with time zone',
);

const id = (n) => `28100000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1);
const mainMgr = id(2);
const cashierA = id(3);
const cashierB = id(4);
const cashierC = id(5);
const main = id(10);
const sm1 = id(11);
const sm2 = id(12);
const buttered = id(20);
const buffalo = id(21);
const coke = id(22);

await db.exec(`
  insert into auth.users values
    ('${owner}','owner@test'),('${mainMgr}','main@test'),
    ('${cashierA}','a@test'),('${cashierB}','b@test'),('${cashierC}','c@test');
  insert into public.branches(id,name,code,is_main_branch) values
    ('${main}','Main','MAIN',true),
    ('${sm1}','SM 1','SM1',false),
    ('${sm2}','SM 2','SM2',false);
  insert into public.profiles(id,full_name,role,branch_id) values
    ('${owner}','Owner','owner',null),
    ('${mainMgr}','Main Manager','manager','${main}'),
    ('${cashierA}','Cashier A','cashier','${sm1}'),
    ('${cashierB}','Cashier B','cashier','${sm1}'),
    ('${cashierC}','Cashier C','cashier','${sm2}');
  insert into public.products(id,name,sku,selling_price,is_active,inventory_mode) values
    ('${buttered}','Buttered Chicken','BCHK',80,true,'kg_meal'),
    ('${buffalo}','Buffalo Chicken','BUFF',90,true,'kg_meal'),
    ('${coke}','Coke','COKE',20,true,'piece_stock');
  insert into public.branch_products(branch_id,product_id,selling_price,is_active) values
    ('${sm1}','${buttered}',80,true),('${sm1}','${buffalo}',90,true),('${sm1}','${coke}',20,true),
    ('${sm2}','${buttered}',80,true),('${sm2}','${coke}',20,true);
`);

const asUser = async (userId, work) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false);`);
  try {
    return await work();
  } finally {
    await db.exec('reset role');
  }
};

const remit = async (branchId = null, rangeType = null, start = null, end = null) => {
  const sql =
    rangeType == null
      ? 'select public.report_branch_shift_remittances($1) result'
      : 'select public.report_branch_shift_remittances($1,$2,$3,$4) result';
  const params = rangeType == null ? [branchId] : [branchId, rangeType, start, end];
  return (await asUser(owner, () => db.query(sql, params))).rows[0].result;
};

const waste = async (branchId = null, rangeType = 'all_time', start = null, end = null) =>
  (await asUser(owner, () =>
    db.query('select public.report_branch_shift_waste($1,$2,$3,$4) result', [branchId, rangeType, start, end]),
  )).rows[0].result;

const flattenShifts = (report) => (report?.days ?? []).flatMap((day) => day.shifts);
const dayOf = (report, date) => (report?.days ?? []).find((day) => String(day.business_date).startsWith(date));
const num = (value) => (value == null ? null : Number(value));

let saleSeq = 0;
const insertSale = async (shiftId, branchId, cashierId, amount) => {
  saleSeq += 1;
  const key = `waste-report-sale-${String(saleSeq).padStart(4, '0')}xx`;
  await db.exec(`
    insert into public.sales(
      sale_number, branch_id, shift_id, cashier_id,
      subtotal, total_amount, amount_paid, change_amount,
      status, idempotency_key, request_items
    ) values (
      'SALE-${saleSeq}', '${branchId}', '${shiftId}', '${cashierId}',
      ${amount}, ${amount}, ${amount}, 0,
      'completed', '${key}', '[]'::jsonb
    )
  `);
};

const insertClosed = async ({
  shiftId,
  branchId,
  cashierId,
  endedAt,
  required,
  remittance,
  salesTotal,
}) => {
  await db.exec(`
    insert into public.shifts(
      id, branch_id, cashier_id, status, started_at, ended_at, reconciliation_required
    ) values (
      '${shiftId}', '${branchId}', '${cashierId}', 'closed',
      '${endedAt}'::timestamptz - interval '4 hours',
      '${endedAt}'::timestamptz,
      ${required}
    )
  `);
  if (salesTotal != null) await insertSale(shiftId, branchId, cashierId, salesTotal);
  if (remittance) {
    await db.exec(`
      insert into public.shift_reconciliations(
        shift_id, branch_id, expected_cash, actual_cash, difference, result, recorded_by, reconciled_at
      ) values (
        '${shiftId}', '${branchId}',
        ${remittance.expected}, ${remittance.actual},
        ${remittance.expected - remittance.actual},
        '${remittance.expected === remittance.actual ? 'exact' : remittance.expected > remittance.actual ? 'shortage' : 'excess'}',
        '${cashierId}',
        '${remittance.reconciledAt ?? endedAt}'::timestamptz
      )
    `);
  }
};

const sept28 = '2026-09-28 13:00:00+00';
const a = id(30);
const b = id(31);
const pending = id(32);
const legacy = id(33);
const prePart1 = id(34);
const wasteShift = id(35);
const noWaste = id(36);
const pendingWaste = id(37);
const nextDay = id(38);
const utcBefore = id(39);
const utcAfter = id(40);
const filterEarly = id(41);
const filterLate = id(42);
const sm2Shift = id(43);
const zeroActual = id(44);
const allPendingA = id(45);
const allPendingB = id(46);
const todayShift = id(47);

await insertClosed({
  shiftId: a,
  branchId: sm1,
  cashierId: cashierA,
  endedAt: sept28,
  required: true,
  remittance: { expected: 7500, actual: 7300 },
});
await insertClosed({
  shiftId: b,
  branchId: sm1,
  cashierId: cashierB,
  endedAt: '2026-09-28 12:30:00+00',
  required: true,
  remittance: { expected: 6000, actual: 6150 },
});
await insertClosed({
  shiftId: pending,
  branchId: sm1,
  cashierId: cashierA,
  endedAt: '2026-09-28 12:00:00+00',
  required: true,
  salesTotal: 1800,
});

const sept28Report = await remit(null, 'custom', '2026-09-28T00:00:00+08:00', '2026-09-29T00:00:00+08:00');
const sept28Day = dayOf(sept28Report, '2026-09-28');
assert.equal(num(sept28Day.expected_cash), 15300);
assert.equal(num(sept28Day.actual_remitted), 13450);
assert.equal(num(sept28Day.total_shortage), 200);
assert.equal(num(sept28Day.total_excess), 150);
assert.equal(Number(sept28Day.pending_shift_count), 1);
assert.equal(num(sept28Day.pending_expected_cash), 1800);
assert.equal(Number(sept28Day.reconciled_shift_count), 2);
assert.equal(sept28Day.shifts.find((row) => row.shift_id === pending).actual_cash, null);

await insertClosed({
  shiftId: legacy,
  branchId: sm1,
  cashierId: cashierA,
  endedAt: sept28,
  required: false,
});
const afterLegacy = await remit(null, 'custom', '2026-09-28T00:00:00+08:00', '2026-09-29T00:00:00+08:00');
assert.equal(flattenShifts(afterLegacy).some((row) => row.shift_id === legacy), false);
assert.equal(flattenShifts(await waste(null)).some((row) => row.shift_id === legacy), false);

await insertClosed({
  shiftId: prePart1,
  branchId: sm1,
  cashierId: cashierB,
  endedAt: '2026-09-27 13:00:00+00',
  required: false,
  remittance: { expected: 500, actual: 500 },
});
const pre = flattenShifts(await remit()).find((row) => row.shift_id === prePart1);
assert.equal(pre.status, 'reconciled');
assert.equal(num(dayOf(await remit(null, 'custom', '2026-09-27T00:00:00+08:00', '2026-09-28T00:00:00+08:00'), '2026-09-27').expected_cash), 500);

await insertClosed({
  shiftId: wasteShift,
  branchId: sm1,
  cashierId: cashierA,
  endedAt: sept28,
  required: true,
  remittance: { expected: 100, actual: 100 },
});
await db.exec(`
  insert into public.shift_waste_occurrences(shift_id, branch_id, product_id, recorded_by, note)
  values
    ('${wasteShift}','${sm1}','${buttered}','${cashierA}','skin left'),
    ('${wasteShift}','${sm1}','${buffalo}','${cashierA}',null);
`);
const wasteDay = dayOf(await waste(null, 'custom', '2026-09-28T00:00:00+08:00', '2026-09-29T00:00:00+08:00'), '2026-09-28');
const wasteRow = wasteDay.shifts.find((row) => row.shift_id === wasteShift);
assert.equal(wasteRow.waste_status, 'waste_recorded');
assert.equal(wasteRow.branch_name, 'SM 1');
assert.equal(wasteRow.cashier_name, 'Cashier A');
assert.ok(wasteRow.started_at && wasteRow.ended_at);
assert.equal(wasteRow.occurrences.length, 2);
assert.deepEqual(wasteRow.occurrences.map((item) => item.product_name).sort(), ['Buffalo Chicken', 'Buttered Chicken']);
assert.equal(wasteRow.occurrences.every((item) => item.quantity == null && item.kg == null), true);
assert.equal(Number(wasteDay.occurrence_count) >= 2, true);
assert.equal(Number(wasteDay.distinct_product_count) >= 2, true);

await insertClosed({
  shiftId: noWaste,
  branchId: sm1,
  cashierId: cashierB,
  endedAt: sept28,
  required: true,
  remittance: { expected: 50, actual: 50 },
});
assert.equal(
  flattenShifts(await waste()).find((row) => row.shift_id === noWaste).waste_status,
  'no_waste',
);

await insertClosed({
  shiftId: pendingWaste,
  branchId: sm1,
  cashierId: cashierA,
  endedAt: sept28,
  required: true,
});
assert.equal(
  flattenShifts(await waste()).find((row) => row.shift_id === pendingWaste).waste_status,
  'pending',
);

await insertClosed({
  shiftId: nextDay,
  branchId: sm1,
  cashierId: cashierB,
  endedAt: sept28,
  required: true,
  remittance: { expected: 80, actual: 80, reconciledAt: '2026-09-29 00:00:00+00' },
});
await db.exec(`
  insert into public.shift_waste_occurrences(shift_id, branch_id, product_id, recorded_by, created_at)
  values ('${nextDay}','${sm1}','${buttered}','${cashierB}','2026-09-29 00:05:00+00');
`);
assert.ok(flattenShifts(await remit(null, 'custom', '2026-09-28T00:00:00+08:00', '2026-09-29T00:00:00+08:00')).some((row) => row.shift_id === nextDay));
assert.equal(flattenShifts(await remit(null, 'custom', '2026-09-29T00:00:00+08:00', '2026-09-30T00:00:00+08:00')).some((row) => row.shift_id === nextDay), false);
assert.ok(flattenShifts(await waste(null, 'custom', '2026-09-28T00:00:00+08:00', '2026-09-29T00:00:00+08:00')).some((row) => row.shift_id === nextDay));
assert.equal(flattenShifts(await waste(null, 'custom', '2026-09-29T00:00:00+08:00', '2026-09-30T00:00:00+08:00')).some((row) => row.shift_id === nextDay), false);

await insertClosed({
  shiftId: utcBefore,
  branchId: sm1,
  cashierId: cashierA,
  endedAt: '2026-09-27 15:30:00+00',
  required: true,
  remittance: { expected: 10, actual: 10 },
});
await insertClosed({
  shiftId: utcAfter,
  branchId: sm1,
  cashierId: cashierB,
  endedAt: '2026-09-27 16:30:00+00',
  required: true,
  remittance: { expected: 11, actual: 11 },
});
assert.ok(flattenShifts(await remit(null, 'custom', '2026-09-27T00:00:00+08:00', '2026-09-28T00:00:00+08:00')).some((row) => row.shift_id === utcBefore));
assert.equal(flattenShifts(await remit(null, 'custom', '2026-09-27T00:00:00+08:00', '2026-09-28T00:00:00+08:00')).some((row) => row.shift_id === utcAfter), false);
assert.ok(flattenShifts(await remit(null, 'custom', '2026-09-28T00:00:00+08:00', '2026-09-29T00:00:00+08:00')).some((row) => row.shift_id === utcAfter));

await insertClosed({
  shiftId: filterEarly,
  branchId: sm1,
  cashierId: cashierA,
  endedAt: '2026-09-27 13:00:00+00',
  required: true,
  remittance: { expected: 1, actual: 1 },
});
await insertClosed({
  shiftId: filterLate,
  branchId: sm1,
  cashierId: cashierB,
  endedAt: '2026-09-30 17:00:00+00',
  required: true,
  remittance: { expected: 2, actual: 2 },
});
const range = flattenShifts(await remit(null, 'custom', '2026-09-28T00:00:00+08:00', '2026-10-01T00:00:00+08:00'));
assert.equal(range.some((row) => row.shift_id === filterEarly), false);
assert.equal(range.some((row) => row.shift_id === filterLate), false);
assert.ok(range.some((row) => row.shift_id === a));

await insertClosed({
  shiftId: sm2Shift,
  branchId: sm2,
  cashierId: cashierC,
  endedAt: sept28,
  required: true,
  remittance: { expected: 300, actual: 300 },
});
const sm1Only = flattenShifts(await remit(sm1, 'all_time'));
assert.equal(sm1Only.every((row) => row.branch_id === sm1), true);
assert.equal(sm1Only.some((row) => row.shift_id === sm2Shift), false);
assert.ok(flattenShifts(await remit()).some((row) => row.shift_id === sm2Shift));

await asUser(cashierA, () =>
  assert.rejects(db.query('select public.report_branch_shift_remittances(null)'), /Owner or Main Branch Manager/),
);
await asUser(cashierA, () =>
  assert.rejects(db.query('select public.report_branch_shift_waste(null)'), /Owner or Main Branch Manager/),
);

const beforeCounts = (
  await db.query(`
    select
      (select count(*)::int from public.shifts) as shifts,
      (select count(*)::int from public.shift_reconciliations) as remits,
      (select count(*)::int from public.shift_waste_occurrences) as waste,
      (select count(*)::int from public.sales) as sales
  `)
).rows[0];
await remit();
await waste();
const afterCounts = (
  await db.query(`
    select
      (select count(*)::int from public.shifts) as shifts,
      (select count(*)::int from public.shift_reconciliations) as remits,
      (select count(*)::int from public.shift_waste_occurrences) as waste,
      (select count(*)::int from public.sales) as sales
  `)
).rows[0];
assert.deepEqual(afterCounts, beforeCounts);

await insertClosed({
  shiftId: allPendingA,
  branchId: sm2,
  cashierId: cashierC,
  endedAt: '2026-09-26 13:00:00+00',
  required: true,
  salesTotal: 4000,
});
await insertClosed({
  shiftId: allPendingB,
  branchId: sm2,
  cashierId: cashierC,
  endedAt: '2026-09-26 12:00:00+00',
  required: true,
  salesTotal: 5000,
});
const unknown = dayOf(await remit(sm2, 'custom', '2026-09-26T00:00:00+08:00', '2026-09-27T00:00:00+08:00'), '2026-09-26');
assert.equal(Number(unknown.reconciled_shift_count), 0);
assert.equal(unknown.actual_remitted, null);
assert.equal(num(unknown.expected_cash), 9000);
assert.equal(Number(unknown.pending_shift_count), 2);

await insertClosed({
  shiftId: zeroActual,
  branchId: sm2,
  cashierId: cashierC,
  endedAt: '2026-09-25 13:00:00+00',
  required: true,
  remittance: { expected: 0, actual: 0 },
});
const zeroDay = dayOf(await remit(sm2, 'custom', '2026-09-25T00:00:00+08:00', '2026-09-26T00:00:00+08:00'), '2026-09-25');
assert.equal(Number(zeroDay.reconciled_shift_count), 1);
assert.equal(num(zeroDay.actual_remitted), 0);

await db.exec(`
  insert into public.shifts(
    id, branch_id, cashier_id, status, started_at, ended_at, reconciliation_required
  ) values (
    '${todayShift}', '${sm1}', '${cashierA}', 'closed',
    now() - interval '2 hours', now() - interval '1 hour', true
  );
  insert into public.shift_reconciliations(
    shift_id, branch_id, expected_cash, actual_cash, difference, result, recorded_by
  ) values (
    '${todayShift}', '${sm1}', 25, 25, 0, 'exact', '${cashierA}'
  );
`);
const allTime = flattenShifts(await remit(null));
const todayOnly = flattenShifts(await remit(null, 'today'));
assert.ok(allTime.some((row) => row.shift_id === zeroActual));
assert.ok(allTime.some((row) => row.shift_id === todayShift));
assert.ok(todayOnly.some((row) => row.shift_id === todayShift));
assert.equal(todayOnly.some((row) => row.shift_id === zeroActual), false);

await db.close();
console.log('waste daily remittance report tests passed');
