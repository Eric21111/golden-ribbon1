import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { PGlite } from '@electric-sql/pglite';
import { loadTs } from './_load_ts.mjs';

const require = createRequire(import.meta.url);
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const rnw = require('react-native-web');

const {
  buildTotalSalesBranchRows,
  remittanceByBranch,
  salesByBranchHref,
  totalRemittance,
} = loadTs('src/features/reports/totalSalesDashboard.ts');

assert.equal(
  salesByBranchHref({ branchId: 'b1', rangeType: 'this_week' }),
  '/owner/reports/sales-overview/b1?range=this_week',
);
assert.equal(
  salesByBranchHref({ branchId: 'b1', rangeType: 'custom', customStart: '2026-11-01', customEnd: '2026-11-10' }),
  '/owner/reports/sales-overview/b1?range=custom&start=2026-11-01&end=2026-11-10',
);

assert.deepEqual(totalRemittance(undefined), {
  remitted: null,
  reconciledShifts: 0,
  pendingShifts: 0,
  pendingExpected: 0,
});

const remittance = {
  days: [
    {
      business_date: '2026-11-16',
      expected_cash: 500,
      actual_remitted: 480,
      actual_gcash: 100,
      total_shortage: 20,
      total_excess: 0,
      reconciled_shift_count: 1,
      pending_shift_count: 1,
      pending_expected_cash: 50,
      pending_gcash: 0,
      shifts: [
        {
          shift_id: 's1',
          branch_id: 'b1',
          branch_name: 'SM1',
          cashier_id: 'c1',
          cashier_name: 'Cashier',
          started_at: '2026-11-16T08:00:00+08:00',
          ended_at: '2026-11-16T16:00:00+08:00',
          status: 'reconciled',
          expected_cash: 500,
          actual_cash: 480,
          actual_gcash: 100,
          difference: -20,
          result: 'shortage',
          reconciled_at: '2026-11-16T16:05:00+08:00',
        },
        {
          shift_id: 's2',
          branch_id: 'b2',
          branch_name: 'SM2',
          cashier_id: 'c2',
          cashier_name: 'Cashier 2',
          started_at: '2026-11-16T08:00:00+08:00',
          ended_at: null,
          status: 'pending',
          expected_cash: 50,
          actual_cash: null,
          difference: null,
          result: null,
          reconciled_at: null,
        },
      ],
    },
  ],
};

assert.equal(totalRemittance(remittance).remitted, 580);
assert.equal(remittanceByBranch(remittance).get('b1').remitted, 580);

const rows = buildTotalSalesBranchRows(
  [
    { branch_id: 'b1', branch_name: 'SM1', total_sales: 900, transaction_count: 4, is_active: true },
    { branch_id: 'b-inactive', branch_name: 'Old SM', total_sales: 80, transaction_count: 1, is_active: false },
  ],
  remittance,
);
assert.equal(rows[0].branchId, 'b1');
assert.equal(rows.find((row) => row.branchId === 'b-inactive').isActive, false);

const dashboard = readFileSync('app/(owner)/owner/dashboard.tsx', 'utf8');
assert.match(dashboard, /\/owner\/reports\/sales-overview/);
assert.match(dashboard, /\/owner\/reports\/branch\/\$\{branch\.branchId\}/);
assert.doesNotMatch(dashboard, /ManagerBottomSheet/);
assert.match(readFileSync('app/(owner)/owner/reports/total-sales.tsx', 'utf8'), /Redirect|sales-overview/);
assert.match(readFileSync('app/(owner)/owner/reports/sales-by-branch.tsx', 'utf8'), /Redirect|sales-overview/);

const screenSrc = readFileSync('src/features/reports/SalesOverviewScreen.tsx', 'utf8');
assert.match(screenSrc, /useOwnerSalesByBranch/);
assert.match(screenSrc, /branchHubHref/);
assert.doesNotMatch(screenSrc, /salesByBranchHref/);
assert.match(screenSrc, /Inactive ·/);
assert.match(screenSrc, /Sales Overview/);
assert.match(screenSrc, /Completed transactions/);
assert.doesNotMatch(screenSrc, /Remittance \(shift close\)/);
assert.doesNotMatch(screenSrc, /OwnerSummaryKpiPair/);
assert.doesNotMatch(screenSrc, /No remittance recorded/);
assert.doesNotMatch(screenSrc, /shift-remittances/);
assert.doesNotMatch(screenSrc, /useShiftRemittances/);
assert.doesNotMatch(screenSrc, /awaiting remittance/);
assert.doesNotMatch(screenSrc, /useSalesByBranch\(/);

const branchDetailSrc = readFileSync('src/features/reports/BranchSalesDetailScreen.tsx', 'utf8');
assert.match(branchDetailSrc, /useLocalSearchParams/);
assert.match(branchDetailSrc, /useOwnerSalesByBranch/);
assert.match(branchDetailSrc, /shouldShowBranchOrderLog/);
assert.match(branchDetailSrc, /Inactive ·/);

let salesState = { data: undefined, isLoading: true, isFetched: false, isError: false, error: null, isRefetching: false, refetch: () => {} };
const Pass = (props) => React.createElement('div', null, props.children);
const Screen = loadTs('src/features/reports/SalesOverviewScreen.tsx', {
  'react-native': rnw,
  'expo-router': { router: { push() {} }, useLocalSearchParams: () => ({}) },
  'expo-linear-gradient': {
    LinearGradient: (p) => React.createElement('div', null, p.children),
  },
  '@react-native-vector-icons/ionicons': { __esModule: true, default: () => null },
  '@/components/ConstrainedWidth': { ConstrainedWidth: Pass },
  '@/components/Screen': { Screen: Pass },
  '@/components/dashboard/CurrencyText': {
    CurrencyText: (p) => React.createElement('span', null, p.value),
  },
  '@/components/dashboard/ManagerFeedback': {
    EmptyState: (p) => React.createElement('div', null, `EMPTY:${p.title}`),
    ErrorState: (p) => React.createElement('div', null, `ERROR:${p.message}`),
    LoadingState: (p) => React.createElement('div', null, `LOADING:${p.label}`),
  },
  '@/components/dashboard/ManagerScreenHeader': { ManagerScreenHeader: () => null },
  '@/components/dashboard/StatTile': {
    StatTile: (p) => React.createElement('div', null, `${p.label}:${p.value}`),
  },
  '@/components/dashboard/theme': {
    managerColors: { ink: '#111', subtext: '#667', royalBlue: '#13c', green: '#0a0', goldMuted: '#a80', cardBorder: '#ddd', cardSurface: '#f4f6fa', pageCanvas: '#f4f6fb' },
    statChipColors: { blue: { chip: '#def', icon: '#13c' } },
  },
  '@/features/reports/RankProgressRow': {
    RankProgressRow: (p) => React.createElement('div', null, `${p.title}:${p.amount}:${p.meta ?? ''}:${p.share}%`),
  },
  '@/features/reports/ReportSectionHeading': {
    ReportSectionHeading: (p) => React.createElement('div', null, p.title),
  },
  '@/features/reports/DateRangeFilter': {
    DateRangeFilter: () => null,
    resolveReportRange: () => ({ rpcRangeType: 'today', startIso: null, endIso: null }),
  },
  '@/features/reports/reportAccents': {
    accentForRank: () => ({ icon: '#13c', gradient: ['#def', '#fff'] }),
  },
  '@/hooks/useSales': { useOwnerSalesByBranch: () => salesState },
  '@/lib/errors': { getErrorMessage: (e) => String(e.message || e) },
  '@/lib/nameAccent': { accentForName: () => 'blue' },
}).SalesOverviewScreen;

const flat = (html) => html.replace(/<[^>]+>/g, '|').replace(/\|+/g, '|');
assert.match(flat(renderToStaticMarkup(React.createElement(Screen))), /LOADING:Loading company sales…/);

salesState = {
  data: [
    { branch_id: 'b1', branch_name: 'SM1', total_sales: 900, transaction_count: 4, is_active: true },
    { branch_id: 'b2', branch_name: 'SM2', total_sales: 100, transaction_count: 1, is_active: false },
  ],
  isLoading: false,
  isFetched: true,
  isError: false,
  error: null,
  isRefetching: false,
  refetch: () => {},
};
let text = flat(renderToStaticMarkup(React.createElement(Screen)));
assert.match(text, /Total sales revenue:₱1,000\.00/);
assert.match(text, /Completed transactions:5/);
assert.doesNotMatch(text, /Remittance \(shift close\)/);
assert.doesNotMatch(text, /Total remittance:/);
assert.match(text, /Inactive · SM2/);
assert.match(text, /4 sales|1 sale/);
assert.match(text, /90%|10%/);
assert.doesNotMatch(text, /Remitted none yet/);

salesState = {
  data: undefined,
  isLoading: false,
  isFetched: true,
  isError: true,
  error: new Error('sales down'),
  isRefetching: false,
  refetch: () => {},
};
text = flat(renderToStaticMarkup(React.createElement(Screen)));
assert.match(text, /Total sales revenue:—/);
assert.match(text, /ERROR:sales down/);
assert.doesNotMatch(text, /Total sales revenue:₱0\.00/);
assert.doesNotMatch(text, /Remittance \(shift close\)/);

// --- SQL: owner sales includes inactive-with-sales; active-only report does not ----------------
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

const id = (n) => `41000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1);
const cashierActive = id(2);
const cashierRetired = id(3);
const main = id(10);
const active = id(11);
const retired = id(12);
const product = id(20);

await db.exec(`
  insert into auth.users values ('${owner}','o@test'),('${cashierActive}','c@test'),('${cashierRetired}','c2@test');
  insert into public.branches(id,name,code,is_main_branch,is_active) values
    ('${main}','Main','MAIN',true,true),
    ('${active}','SM1','SM1',false,true),
    ('${retired}','Old SM','OLD',false,true);
  insert into public.profiles(id,full_name,role,branch_id) values
    ('${owner}','Owner','owner',null),
    ('${cashierActive}','Cashier SM1','cashier','${active}'),
    ('${cashierRetired}','Cashier Old','cashier','${retired}');
  insert into public.products(id,name,sku,selling_price,is_active) values ('${product}','Chicken','CH',80,true);
  insert into public.branch_products(branch_id,product_id,selling_price,is_active) values
    ('${active}','${product}',80,true),('${retired}','${product}',80,true);
`);

const asUser = async (userId, work) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false);`);
  try {
    return await work();
  } finally {
    await db.exec('reset role');
  }
};

// Seed completed sales with Manila timestamps in SQL, then deactivate the retired branch.
await db.exec(`
  do $$
  declare
    v_sold_at timestamptz :=
      (timezone('Asia/Manila', now()))::date::timestamp at time zone 'Asia/Manila' + interval '10 hours';
  begin
    insert into public.shifts(id,branch_id,cashier_id,status,started_at,ended_at,sales_cutoff_at)
    values
      ('${id(30)}','${active}','${cashierActive}','closed',v_sold_at,v_sold_at,v_sold_at),
      ('${id(31)}','${retired}','${cashierRetired}','closed',v_sold_at,v_sold_at,v_sold_at);
    insert into public.sales(
      id,sale_number,branch_id,shift_id,cashier_id,subtotal,total_amount,amount_paid,change_amount,
      status,sold_at,idempotency_key,request_items
    )
    values
      ('${id(40)}','S-ACT','${active}','${id(30)}','${cashierActive}',160,160,160,0,'completed',v_sold_at,'sale-act-key-000001','[]'::jsonb),
      ('${id(41)}','S-RET','${retired}','${id(31)}','${cashierRetired}',80,80,80,0,'completed',v_sold_at,'sale-ret-key-000001','[]'::jsonb);
    insert into public.sale_items(sale_id,product_id,quantity,unit_price,subtotal) values
      ('${id(40)}','${product}',2,80,160),
      ('${id(41)}','${product}',1,80,80);
  end $$;
  update public.branches set is_active = false where id = '${retired}';
`);

const activeOnly = (
  await asUser(owner, () => db.query(`select public.report_sales_by_branch('today') result`))
).rows[0].result;
assert.equal(activeOnly.some((row) => row.branch_id === retired), false, 'active-only report excludes inactive');
assert.equal(activeOnly.find((row) => row.branch_id === active)?.total_sales, 160);

const ownerReport = (
  await asUser(owner, () => db.query(`select public.report_owner_sales_by_branch('today') result`))
).rows[0].result;
assert.ok(ownerReport.find((row) => row.branch_id === active));
const retiredRow = ownerReport.find((row) => row.branch_id === retired);
assert.ok(retiredRow, 'owner report keeps inactive branch with sales');
assert.equal(retiredRow.is_active, false);
assert.equal(Number(retiredRow.total_sales), 80);
assert.equal(
  ownerReport.reduce((sum, row) => sum + Number(row.total_sales), 0),
  240,
  'company total includes inactive sales',
);

const todayQuickview = (
  await asUser(owner, () => db.query(`select public.get_owner_today_branch_sales() result`))
).rows[0].result;
assert.equal(
  todayQuickview.branches.reduce((sum, row) => sum + Number(row.total_sales), 0),
  ownerReport.reduce((sum, row) => sum + Number(row.total_sales), 0),
  'Today Total Sales matches Today Quickview company total',
);

await assert.rejects(
  asUser(cashierActive, () => db.query(`select public.report_owner_sales_by_branch('today')`)),
  /Owner access required/,
);

await db.close();
console.log(
  'Total Sales dashboard tests passed: inactive-with-sales RPC, date-preserving href, safe error totals, Today vs Quickview.',
);
