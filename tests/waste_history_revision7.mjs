import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { loadTs } from './_load_ts.mjs';

const helpers = loadTs('src/features/reports/wasteHistoryBranches.ts', {
  '@/types/models': {},
  '@/features/reports/DateRangeFilter': {},
});

assert.deepEqual(
  helpers
    .buildWasteHistoryBranchRows(
      [
        { id: 'main', name: 'Main', is_main_branch: true, is_active: true },
        { id: 'sm1', name: 'SM 1', is_main_branch: false, is_active: true },
        { id: 'sm2', name: 'SM 2', is_main_branch: false, is_active: false },
        { id: 'sm3', name: 'SM 3', is_main_branch: false, is_active: false },
      ],
      {
        days: [
          {
            business_date: '2026-11-08',
            occurrence_count: 3,
            distinct_product_count: 3,
            shifts: [
              {
                shift_id: 's1',
                branch_id: 'sm1',
                branch_name: 'SM 1',
                waste_status: 'waste_recorded',
                occurrences: [{ product_id: 'p1' }, { product_id: 'p2' }],
              },
              {
                shift_id: 's2',
                branch_id: 'sm2',
                branch_name: 'SM 2',
                waste_status: 'waste_recorded',
                occurrences: [{ product_id: 'p4' }],
              },
              {
                shift_id: null,
                branch_id: 'main',
                branch_name: 'Main',
                entry_kind: 'main_inventory',
                waste_status: 'waste_recorded',
                occurrences: [{ product_id: 'p3' }],
              },
            ],
          },
        ],
      },
    )
    .map((row) => ({ id: row.branchId, n: row.occurrenceCount, main: row.isMain, active: row.isActive })),
  [
    { id: 'sm1', n: 2, main: false, active: true },
    { id: 'sm2', n: 1, main: false, active: false }, // inactive but still listed when it has waste
    { id: 'main', n: 1, main: true, active: true },
    // sm3 inactive with no waste stays hidden
  ],
);

assert.deepEqual(
  helpers
    .buildWasteHistoryBranchRows(
      [
        { id: 'main', name: 'Main', is_main_branch: true, is_active: true },
        { id: 'sm1', name: 'SM 1', is_main_branch: false, is_active: true },
      ],
      { days: [] },
    )
    .map((row) => row.branchId),
  ['sm1', 'main'],
  'active branches with no waste still appear on the hub',
);

assert.deepEqual(
  helpers.summarizeWasteHistory({
    days: [
      {
        business_date: '2026-11-08',
        occurrence_count: 4,
        distinct_product_count: 4,
        shifts: [
          { branch_id: 'sm1', waste_status: 'waste_recorded', occurrences: [{}, {}] },
          { branch_id: 'main', waste_status: 'waste_recorded', occurrences: [{}] },
          { branch_id: 'sm1', waste_status: 'no_waste', occurrences: [] },
        ],
      },
      {
        business_date: '2026-11-09',
        occurrence_count: 1,
        distinct_product_count: 1,
        shifts: [{ branch_id: 'sm1', waste_status: 'waste_recorded', occurrences: [{}] }],
      },
    ],
  }),
  { occurrences: 4, daysWithWaste: 2, branchesWithWaste: 2 },
  'company totals count unique days, not per-branch day sums, and skip mixed quantity',
);

assert.match(helpers.wasteHistoryBranchHref({ role: 'manager', branchId: 'sm1', rangeType: 'all_time' }), /\/manager\/reports\/waste-history\/sm1\?range=all_time/);
assert.match(
  readFileSync('app/(manager)/manager/reports/waste-history/index.tsx', 'utf8'),
  /WasteHistoryBranchesScreen/,
);
assert.match(
  readFileSync('app/(manager)/manager/reports/waste-history/[branchId].tsx', 'utf8'),
  /WasteHistoryScreen/,
);
assert.match(
  readFileSync('supabase/migrations/20261117150000_waste_history_branch_and_main.sql', 'utf8'),
  /scope' = 'main'/,
);
assert.match(
  readFileSync('supabase/migrations/20261117150000_waste_history_branch_and_main.sql', 'utf8'),
  /main_inventory/,
);

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth; create table auth.users(id uuid primary key, email text);
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

const id = (n) => `91700000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1);
const manager = id(2);
const cashier = id(3);
const product = id(20);
const shiftId = id(30);

await db.exec(`
  insert into auth.users values ('${owner}','o@test'),('${manager}','m@test'),('${cashier}','c@test');
  insert into public.branches(id,name,code,is_main_branch) values
    ('${id(9)}','Main','MAIN',true),('${id(10)}','SM 1','SM1',false)
  on conflict do nothing;
`);
const main = (await db.query('select id from public.branches where is_main_branch')).rows[0].id;
const sm1 = (await db.query("select id from public.branches where code='SM1'")).rows[0].id;
await db.exec(`
  insert into public.profiles(id,full_name,role,branch_id) values
    ('${owner}','Owner','owner',null),
    ('${manager}','Main Manager','manager','${main}'),
    ('${cashier}','Cashier A','cashier','${sm1}');
  insert into public.products(id,name,sku,selling_price,inventory_mode,is_active)
    values ('${product}','Chicken','CH',80,'piece_stock',true);
  insert into public.branch_inventory(branch_id,product_id,quantity_on_hand) values
    ('${main}','${product}',40),('${sm1}','${product}',20);
  insert into public.shifts(id,branch_id,cashier_id,status,started_at,ended_at,reconciliation_required)
    values ('${shiftId}','${sm1}','${cashier}','closed',
      '2026-11-08 01:00:00+00','2026-11-08 09:00:00+00',true);
  insert into public.shift_reconciliations(shift_id,branch_id,expected_cash,actual_cash,difference,result,recorded_by,reconciled_at)
    values ('${shiftId}','${sm1}',100,100,0,'exact','${cashier}','2026-11-08 09:00:00+00');
  insert into public.shift_waste_occurrences(shift_id,branch_id,product_id,recorded_by,note,quantity,created_at)
    values ('${shiftId}','${sm1}','${product}','${cashier}','dropped',2,'2026-11-08 08:50:00+00');
  insert into public.inventory_movements(
    branch_id,product_id,movement_type,quantity,reference_type,reference_id,created_by,notes,branch_stock_action,created_at
  ) values (
    '${sm1}','${product}','adjustment',-1,'adjustment',gen_random_uuid(),'${cashier}',
    'Recorded waste: Spilled',
    jsonb_build_object(
      'key','waste-hist-mid-shift-key01',
      'request', jsonb_build_object(
        'shift_id','${shiftId}','branch_id','${sm1}','product_id','${product}',
        'action','waste','quantity',1,'available',20,'reason','Spilled'
      )
    ),
    '2026-11-08 07:00:00+00'
  );
`);

const asUser = async (userId, work) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false);`);
  try {
    return await work();
  } finally {
    await db.exec('reset role');
  }
};

const report = async (branchId = null) =>
  (
    await asUser(manager, () =>
      db.query('select public.report_branch_shift_waste($1,$2,$3,$4) result', [
        branchId,
        'custom',
        '2026-11-08T00:00:00+08:00',
        '2026-11-09T00:00:00+08:00',
      ]),
    )
  ).rows[0].result;

const beforeMain = await report();
const selling = beforeMain.days[0].shifts.find((row) => row.shift_id === shiftId);
assert.ok(selling);
assert.equal(selling.occurrences.length, 2, 'close waste + mid-shift waste, no duplicate of one event');
assert.equal(
  selling.occurrences.reduce((sum, item) => sum + Number(item.quantity), 0),
  3,
);
assert.equal(beforeMain.days[0].shifts.some((row) => row.entry_kind === 'main_inventory'), false);

// Insert Main waste audit in the same shape as record_main_inventory_waste (immutable ledger; set created_at on insert).
await db.exec(`
  update public.branch_inventory set quantity_on_hand = 36
  where branch_id = '${main}' and product_id = '${product}';
  insert into public.inventory_movements(
    branch_id, product_id, movement_type, quantity, reference_type, reference_id,
    created_by, notes, branch_stock_action, created_at
  ) values (
    '${main}', '${product}', 'adjustment', -4, 'adjustment', gen_random_uuid(),
    '${manager}', 'Main inventory waste: Spoiled',
    jsonb_build_object(
      'key', 'waste-hist-main-key-0001',
      'request', jsonb_build_object(
        'scope', 'main', 'action', 'waste', 'branch_id', '${main}',
        'product_id', '${product}', 'quantity', 4, 'available', 40, 'reason', 'Spoiled'
      )
    ),
    '2026-11-08 10:00:00+00'
  );
`);

const withMain = await report();
const mainRow = withMain.days[0].shifts.find((row) => row.entry_kind === 'main_inventory');
assert.ok(mainRow, 'Main inventory waste appears without a shift_id');
assert.equal(mainRow.shift_id, null);
assert.equal(mainRow.occurrences.length, 1);
assert.equal(Number(mainRow.occurrences[0].quantity), 4);
assert.equal(mainRow.occurrences[0].note, 'Spoiled');
assert.equal(mainRow.occurrences[0].recorded_by_name, 'Main Manager');
assert.equal(withMain.days[0].occurrence_count, 3);

const mainOnly = await report(main);
assert.equal(mainOnly.days[0].shifts.length, 1);
assert.equal(mainOnly.days[0].shifts[0].entry_kind, 'main_inventory');
assert.equal(mainOnly.days[0].shifts.some((row) => row.shift_id === shiftId), false);

const sm1Only = await report(sm1);
assert.equal(sm1Only.days[0].shifts.every((row) => row.branch_id === sm1), true);
assert.equal(sm1Only.days[0].shifts.some((row) => row.entry_kind === 'main_inventory'), false);

const mainStockBefore = Number(
  (await db.query('select quantity_on_hand from public.branch_inventory where branch_id=$1 and product_id=$2', [main, product]))
    .rows[0].quantity_on_hand,
);
await report();
const mainStockAfter = Number(
  (await db.query('select quantity_on_hand from public.branch_inventory where branch_id=$1 and product_id=$2', [main, product]))
    .rows[0].quantity_on_hand,
);
assert.equal(mainStockAfter, mainStockBefore, 'viewing the report must not change inventory');
assert.equal(mainStockAfter, 36);

// Date filter: Main waste outside the custom window is excluded.
await db.exec(`
  insert into public.inventory_movements(
    branch_id, product_id, movement_type, quantity, reference_type, reference_id,
    created_by, notes, branch_stock_action, created_at
  ) values (
    '${main}', '${product}', 'adjustment', -1, 'adjustment', gen_random_uuid(),
    '${manager}', 'Main inventory waste: Outside',
    jsonb_build_object(
      'key', 'waste-hist-main-outside01',
      'request', jsonb_build_object(
        'scope', 'main', 'action', 'waste', 'branch_id', '${main}',
        'product_id', '${product}', 'quantity', 1, 'available', 36, 'reason', 'Outside'
      )
    ),
    '2026-11-10 10:00:00+00'
  );
`);
const inWindow = await report(main);
assert.equal(inWindow.days[0].shifts[0].occurrences.length, 1);
assert.equal(inWindow.days[0].shifts[0].occurrences[0].note, 'Spoiled');
const later = (
  await asUser(manager, () =>
    db.query('select public.report_branch_shift_waste($1,$2,$3,$4) result', [
      main,
      'custom',
      '2026-11-10T00:00:00+08:00',
      '2026-11-11T00:00:00+08:00',
    ]),
  )
).rows[0].result;
assert.equal(later.days[0].shifts[0].occurrences[0].note, 'Outside');
assert.equal(
  (
    await asUser(manager, () =>
      db.query('select public.report_branch_shift_waste($1,$2,$3,$4) result', [
        main,
        'custom',
        '2026-11-11T00:00:00+08:00',
        '2026-11-12T00:00:00+08:00',
      ]),
    )
  ).rows[0].result.days.length,
  0,
);

// Historical waste on a later-deactivated selling branch remains queryable by deep-link branch id.
const sm2 = id(11);
const sm2Shift = id(31);
const cashierB = id(4);
await db.exec(`
  insert into auth.users values ('${cashierB}','c2@test');
  insert into public.branches(id,name,code,is_main_branch,is_active)
    values ('${sm2}','SM 2','SM2',false,true);
  insert into public.profiles(id,full_name,role,branch_id)
    values ('${cashierB}','Cashier B','cashier','${sm2}');
  insert into public.branch_inventory(branch_id,product_id,quantity_on_hand) values ('${sm2}','${product}',5);
  insert into public.shifts(id,branch_id,cashier_id,status,started_at,ended_at,reconciliation_required)
    values ('${sm2Shift}','${sm2}','${cashierB}','closed',
      '2026-11-08 01:00:00+00','2026-11-08 08:00:00+00',true);
  insert into public.shift_reconciliations(shift_id,branch_id,expected_cash,actual_cash,difference,result,recorded_by,reconciled_at)
    values ('${sm2Shift}','${sm2}',40,40,0,'exact','${cashierB}','2026-11-08 08:00:00+00');
  insert into public.shift_waste_occurrences(shift_id,branch_id,product_id,recorded_by,note,quantity,created_at)
    values ('${sm2Shift}','${sm2}','${product}','${cashierB}','old branch',1,'2026-11-08 07:30:00+00');
  update public.branches set is_active = false where id = '${sm2}';
`);
const inactive = await report(sm2);
assert.equal(inactive.days[0].shifts[0].branch_id, sm2);
assert.equal(inactive.days[0].shifts[0].occurrences[0].note, 'old branch');
assert.equal(
  (await db.query('select is_active from public.branches where id=$1', [sm2])).rows[0].is_active,
  false,
);

await asUser(owner, () =>
  db.query('select public.report_branch_shift_waste($1,$2,$3,$4)', [
    sm1,
    'custom',
    '2026-11-08T00:00:00+08:00',
    '2026-11-09T00:00:00+08:00',
  ]),
);
await assert.rejects(
  asUser(cashier, () =>
    db.query('select public.report_branch_shift_waste($1,$2,$3,$4)', [
      sm1,
      'custom',
      '2026-11-08T00:00:00+08:00',
      '2026-11-09T00:00:00+08:00',
    ]),
  ),
  /Owner or Main Branch Manager/,
);

assert.match(
  readFileSync('src/features/reports/WasteHistoryScreen.tsx', 'utf8'),
  /stock units/,
);
assert.doesNotMatch(
  readFileSync('src/features/reports/WasteHistoryScreen.tsx', 'utf8'),
  /mixed items/,
);
assert.match(readFileSync('src/features/reports/WasteHistoryScreen.tsx', 'utf8'), /formatPcsQty\(/);

await db.close();
console.log(
  'waste_history_revision7: dedupe, Main null shift, inactive history, date filters, auth — PASS',
);
