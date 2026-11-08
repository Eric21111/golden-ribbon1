import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

import { closeShiftExact } from './_close_shift_helper.mjs';
import {
  buildTodayQuickview,
  manilaBusinessDate,
  msUntilNextManilaDay,
} from '../src/features/reports/todayQuickview.ts';

// --- Pure helper -------------------------------------------------------------------------------

{
  const empty = buildTodayQuickview(undefined);
  assert.deepEqual(empty, { totalRevenue: 0, totalTransactions: 0, branches: [] });

  const zero = buildTodayQuickview([
    { branch_id: 'a', branch_name: 'SM1', transaction_count: 0, total_sales: 0 },
    { branch_id: 'b', branch_name: 'SM2', transaction_count: 0, total_sales: 0 },
  ]);
  assert.equal(zero.totalRevenue, 0);
  assert.equal(zero.totalTransactions, 0);
  assert.deepEqual(zero.branches.map((b) => [b.branchName, b.revenue]), [['SM1', 0], ['SM2', 0]]);

  // PostgREST returns numerics as strings or numbers; float sums must not drift.
  const mixed = buildTodayQuickview([
    { branch_id: 'a', branch_name: 'SM1', transaction_count: '3', total_sales: '0.10' },
    { branch_id: 'b', branch_name: 'SM2', transaction_count: 1, total_sales: 0.2 },
    { branch_id: 'c', branch_name: 'SM3', transaction_count: 2, total_sales: '1234.55' },
    { branch_id: 'a', branch_name: 'SM1 duplicate', transaction_count: 9, total_sales: 999 },
  ]);
  assert.equal(mixed.totalRevenue, 1234.85);
  assert.equal(mixed.totalTransactions, 6);
  assert.equal(mixed.branches.length, 3, 'duplicate branch rows are not double counted');
  assert.equal(mixed.branches[0].revenue, 0.1);
  assert.ok(mixed.branches.every((b) => b.isActive), 'rows without is_active (fallback RPC) count as active');

  const inactive = buildTodayQuickview([
    { branch_id: 'a', branch_name: 'SM1', transaction_count: 1, total_sales: 80, is_active: false },
  ]);
  assert.equal(inactive.branches[0].isActive, false);
  assert.equal(inactive.totalRevenue, 80);

  // Manila date math (UTC+8, no DST). 2026-11-08T15:59:59.999Z is 23:59:59.999 Manila on Nov 8.
  const beforeMidnight = Date.parse('2026-11-08T15:59:59.999Z');
  assert.equal(manilaBusinessDate(beforeMidnight), '2026-11-08');
  assert.equal(manilaBusinessDate(beforeMidnight + 1), '2026-11-09');
  assert.equal(msUntilNextManilaDay(beforeMidnight), 1);
  assert.equal(msUntilNextManilaDay(beforeMidnight + 1), 24 * 60 * 60 * 1000, 'exactly midnight: next is a full day away');
  // 07:59 Manila is still the previous UTC date.
  assert.equal(manilaBusinessDate(Date.parse('2026-11-08T23:59:00Z')), '2026-11-09');
  assert.equal(manilaBusinessDate(Date.parse('2026-12-31T16:00:00Z')), '2027-01-01', 'year rollover');
}

// --- Dashboard source -------------------------------------------------------------------------

{
  const source = readFileSync('app/(owner)/owner/dashboard.tsx', 'utf8');
  const quickviewStart = source.indexOf('<Section title="Today Quickview">');
  assert.ok(quickviewStart > 0, 'section renamed to Today Quickview');
  const quickviewSection = source.slice(quickviewStart, source.indexOf('</Section>', quickviewStart));
  assert.match(source, /useOwnerTodayBranchSales/);
  assert.match(source, /buildTodayQuickview/);
  assert.match(quickviewSection, /quickview\.totalRevenue/);
  assert.match(quickviewSection, /quickview\.branches/);
  assert.doesNotMatch(quickviewSection, /label="Transactions"|label="Items sold"/, 'moved out of the quickview');
  assert.doesNotMatch(source, /'SM1'|'SM2'|"SM1"|"SM2"/, 'no hardcoded branch names');
  const sheet = source.slice(source.indexOf('<ManagerBottomSheet'), source.indexOf('</ManagerBottomSheet>'));
  assert.match(sheet, /label="Transactions"/);
  assert.match(sheet, /label="Items sold"/);
  assert.match(source, /transfer_discrepancies_count/);
  assert.match(source, /TODAY'S PRODUCT PERFORMANCE/);
  assert.match(source, /reminder_visible/);

  assert.match(source, /buildTodayQuickview\(branchSalesQuery\.data\?\.branches\)/);
  assert.match(source, /useManilaDayRefresh\(\(\) => \{[\s\S]*?branchSalesQuery\.refetch\(\)/);
  assert.match(source, /`Inactive · \$\{branch\.branchName\}`/, 'inactive marker comes first so long names cannot hide it');

  const hooks = readFileSync('src/hooks/useSales.ts', 'utf8');
  assert.match(hooks, /queryKey: queryKeys\.ownerTodayBranchSales,\s*queryFn: getOwnerTodayBranchSales/);
  const service = readFileSync('src/services/saleService.ts', 'utf8');
  assert.match(service, /rpc\('get_owner_today_branch_sales'\)/);
  assert.match(service, /missingDeployedFunction\(error, 'get_owner_today_branch_sales'\)[\s\S]*?reportSalesByBranch\('today'\)/);
  const keys = readFileSync('src/lib/queryKeys.ts', 'utf8');
  assert.match(keys, /ownerTodayBranchSales: \['dashboard', 'owner', /, 'refreshed by completed-sale invalidation');
}

// --- Database: real migrations, real RPCs -----------------------------------------------------

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

const id = (n) => `29000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1);
const cashierSm1 = id(2);
const cashierSm2 = id(3);
const cashierSm3 = id(4);
const main = id(10);
const sm1 = id(11);
const sm2 = id(12);
const sm3 = id(13);
const product = id(20);

await db.exec(`
  insert into auth.users values
    ('${owner}','o@test'),('${cashierSm1}','c1@test'),('${cashierSm2}','c2@test'),('${cashierSm3}','c3@test');
  insert into public.branches(id,name,code,is_main_branch) values
    ('${main}','Main','MAIN',true),('${sm1}','SM1','SM1',false),('${sm2}','SM2','SM2',false),('${sm3}','SM3 Annex','SM3',false);
  insert into public.profiles(id,full_name,role,branch_id) values
    ('${owner}','Owner','owner',null),
    ('${cashierSm1}','Cashier SM1','cashier','${sm1}'),
    ('${cashierSm2}','Cashier SM2','cashier','${sm2}'),
    ('${cashierSm3}','Cashier SM3','cashier','${sm3}');
  insert into public.products(id,name,sku,selling_price,is_active) values ('${product}','Chicken','CH',80,true);
  insert into public.branch_products(branch_id,product_id,selling_price,is_active) values
    ('${sm1}','${product}',80,true),('${sm2}','${product}',80,true),('${sm3}','${product}',80,true);
  insert into public.branch_inventory(branch_id,product_id,quantity_on_hand) values
    ('${sm1}','${product}',50),('${sm2}','${product}',50),('${sm3}','${product}',50);
`);

const asUser = async (userId, work) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false);`);
  try {
    return await work();
  } finally {
    await db.exec('reset role');
  }
};

const ownerQuickview = () =>
  asUser(owner, async () => {
    const result = (await db.query('select public.get_owner_today_branch_sales() result')).rows[0].result;
    const report = (await db.query(`select public.report_sales_by_branch('today', null, null) result`)).rows[0].result;
    const metrics = (await db.query('select public.get_owner_dashboard_metrics() result')).rows[0].result;
    const view = buildTodayQuickview(result.branches);
    const branchSum = view.branches.reduce((sum, b) => sum + Math.round(b.revenue * 100), 0) / 100;
    assert.equal(view.totalRevenue, branchSum, 'total equals the sum of the branch breakdown');
    return { result, report, metrics, view };
  });
const todayManila = (await db.query(`select (timezone('Asia/Manila', now()))::date::text d`)).rows[0].d;

const revenueOf = (view, branchId) => view.branches.find((b) => b.branchId === branchId)?.revenue;

let saleSeq = 0;
const sell = (cashier, shift, quantity) =>
  asUser(cashier, async () =>
    (
      await db.query('select (public.confirm_sale($1,$2::jsonb,$3,$4)).*', [
        shift,
        JSON.stringify([{ product_id: product, quantity }]),
        String(quantity * 80),
        `today-quickview-${++saleSeq}`,
      ])
    ).rows[0],
  );
const startShift = (cashier) =>
  asUser(cashier, async () => (await db.query('select public.start_cashier_shift() id')).rows[0].id);

// Zero sales: every active selling branch is listed at 0, Main is not.
{
  const { view, metrics, result } = await ownerQuickview();
  assert.equal(String(result.business_date), todayManila, 'server reports the Manila business date');
  assert.deepEqual(view.branches.map((b) => b.branchName), ['SM1', 'SM2', 'SM3 Annex']);
  assert.ok(!view.branches.some((b) => b.branchId === main), 'Main is not a selling branch');
  assert.ok(view.branches.every((b) => b.revenue === 0 && b.transactions === 0));
  assert.equal(view.totalRevenue, 0);
  assert.equal(Number(metrics.today_sales), 0);
}

const shiftSm1 = await startShift(cashierSm1);
const shiftSm2 = await startShift(cashierSm2);
const shiftSm3 = await startShift(cashierSm3);

const sm1SaleA = await sell(cashierSm1, shiftSm1, 1); // 80
await sell(cashierSm1, shiftSm1, 2); // 160
await sell(cashierSm2, shiftSm2, 3); // 240

// Multiple branches, one with no sales yet.
{
  const { view, metrics } = await ownerQuickview();
  assert.equal(revenueOf(view, sm1), 240);
  assert.equal(revenueOf(view, sm2), 240);
  assert.equal(revenueOf(view, sm3), 0);
  assert.equal(view.totalRevenue, 480);
  assert.equal(view.totalTransactions, 3);
  assert.equal(Number(metrics.today_sales), view.totalRevenue, 'matches company-wide completed sales');
  assert.equal(Number(metrics.today_transactions), view.totalTransactions);
  assert.equal(Number(metrics.today_units_sold), 6);
}

// A newly added branch is picked up without code changes.
await sell(cashierSm3, shiftSm3, 1); // 80
{
  const { view } = await ownerQuickview();
  assert.equal(revenueOf(view, sm3), 80);
  assert.equal(view.totalRevenue, 560);
}

// Cash remittance must not change sales revenue: close SM2 counting no cash at all (full shortage).
await asUser(cashierSm2, () => closeShiftExact(db, shiftSm2, '0'));
{
  const { view } = await ownerQuickview();
  assert.equal(revenueOf(view, sm2), 240, 'revenue is sales, not remitted cash');
  assert.equal(view.totalRevenue, 560);
}

// An archive summary row for a day that still has live sales is not added on top.
await db.exec(`
  insert into public.daily_branch_sales_summary(business_date, branch_id, transaction_count, quantity_sold, revenue)
  values ((timezone('Asia/Manila', now()))::date, '${sm1}', 5, 5, 999.00);
`);
{
  const { view } = await ownerQuickview();
  assert.equal(revenueOf(view, sm1), 240, 'no double count with daily archive summary');
  assert.equal(view.totalRevenue, 560);
}
await db.exec(`delete from public.daily_branch_sales_summary`);

// Asia/Manila business-day boundaries.
const setSoldAt = (saleId, expression) =>
  db.exec(`
    alter table public.sales disable trigger sales_immutable;
    update public.sales set sold_at = ${expression} where id = '${saleId}';
    alter table public.sales enable trigger sales_immutable;
  `);
const manilaToday = `((timezone('Asia/Manila', now()))::date::timestamp at time zone 'Asia/Manila')`;

const boundaryCases = [
  { label: 'exactly 00:00 Manila today', at: `${manilaToday}`, counted: true },
  { label: '07:59 Manila today (previous UTC date)', at: `${manilaToday} + interval '7 hours 59 minutes'`, counted: true },
  { label: '23:59:59.999 Manila yesterday', at: `${manilaToday} - interval '1 millisecond'`, counted: false },
  { label: '00:00 Manila tomorrow', at: `${manilaToday} + interval '1 day'`, counted: false },
];
for (const { label, at, counted } of boundaryCases) {
  await setSoldAt(sm1SaleA.id, at);
  const { view, metrics } = await ownerQuickview();
  const expectedSm1 = counted ? 240 : 160;
  assert.equal(revenueOf(view, sm1), expectedSm1, `SM1 revenue for sale at ${label}`);
  assert.equal(view.totalRevenue, expectedSm1 + 240 + 80, `total for sale at ${label}`);
  assert.equal(Number(metrics.today_sales), view.totalRevenue, `metrics agree for sale at ${label}`);
}

// Put SM1's boundary sale back inside today: SM1 240, SM2 240, SM3 80.
await setSoldAt(sm1SaleA.id, `${manilaToday} + interval '9 hours'`);

// A branch deactivated after selling today keeps its revenue in the quickview.
await asUser(cashierSm3, () => closeShiftExact(db, shiftSm3, '80'));
await db.exec(`update public.branches set is_active = false where id = '${sm3}'`);
{
  const { view, report, metrics } = await ownerQuickview();
  const sm3Row = view.branches.find((b) => b.branchId === sm3);
  assert.ok(sm3Row, 'deactivated branch with sales today is still listed');
  assert.equal(sm3Row.isActive, false);
  assert.equal(sm3Row.revenue, 80);
  assert.equal(sm3Row.transactions, 1);
  assert.equal(view.totalRevenue, 560, 'no revenue lost when a branch is deactivated');
  assert.equal(Number(metrics.today_sales), view.totalRevenue, 'matches company-wide completed sales');
  assert.equal(revenueOf(view, sm1), 240);
  assert.equal(revenueOf(view, sm2), 240);

  // report_sales_by_branch is unchanged: active selling branches only.
  assert.ok(!report.some((row) => row.branch_id === sm3), 'shared report still lists active branches only');
  assert.equal(report.reduce((sum, row) => sum + Number(row.total_sales), 0), 480);
}

// An inactive branch with no sales today is not listed; active branches with zero sales are.
const sm4 = id(14);
await db.exec(`
  insert into public.branches(id,name,code,is_main_branch) values ('${sm4}','SM4 Kiosk','SM4',false);
  insert into public.branches(id,name,code,is_main_branch,is_active) values ('${id(15)}','Old Stall','OLD',false,false);
`);
{
  const { view } = await ownerQuickview();
  assert.equal(revenueOf(view, sm4), 0, 'new active branch with no sales appears at 0');
  assert.ok(!view.branches.some((b) => b.branchId === id(15)), 'inactive branch without sales today is hidden');
  assert.equal(view.totalRevenue, 560);
}

// Midnight rollover: once today's sales belong to the previous Manila day, the new day starts at 0,
// active branches remain at 0, and the deactivated branch drops out. Historical reports keep the sales.
await db.exec(`
  alter table public.sales disable trigger sales_immutable;
  update public.sales set sold_at = sold_at - interval '1 day';
  alter table public.sales enable trigger sales_immutable;
`);
{
  const { view, metrics } = await ownerQuickview();
  assert.equal(view.totalRevenue, 0);
  assert.equal(Number(metrics.today_sales), 0);
  assert.deepEqual(view.branches.map((b) => b.branchName), ['SM1', 'SM2', 'SM4 Kiosk']);
  assert.ok(view.branches.every((b) => b.revenue === 0));

  const history = await asUser(owner, async () => {
    const start = `((timezone('Asia/Manila', now()))::date - 1)::timestamp at time zone 'Asia/Manila'`;
    const end = `(timezone('Asia/Manila', now()))::date::timestamp at time zone 'Asia/Manila'`;
    const range = (await db.query(`select ${start} s, ${end} e`)).rows[0];
    return (
      await db.query(`select public.report_sales_by_branch('custom', $1, $2) result`, [range.s, range.e])
    ).rows[0].result;
  });
  assert.equal(
    history.reduce((sum, row) => sum + Number(row.total_sales), 0),
    480,
    'yesterday in the shared report: active branches only, as before',
  );
}

// Only the owner may read today's branch sales.
for (const user of [cashierSm1, cashierSm2]) {
  await asUser(user, async () => {
    await assert.rejects(() => db.query('select public.get_owner_today_branch_sales()'), /Owner access required/);
    await assert.rejects(
      () => db.query(`select public.report_sales_by_branch('today', null, null)`),
      /Owner access required/,
    );
  });
}
await assert.rejects(
  async () => {
    await db.exec(`set role anon`);
    try {
      await db.query('select public.get_owner_today_branch_sales()');
    } finally {
      await db.exec('reset role');
    }
  },
  /permission denied/,
  'anon cannot execute',
);

await db.close();
console.log(
  'Owner Today Quickview tests passed: zero sales, per-branch totals, dynamic branches, deactivated branch kept, remittance separation, archive no double count, Manila boundaries, midnight rollover, owner-only access.',
);
