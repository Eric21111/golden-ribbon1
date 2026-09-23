import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const source = readFileSync('src/features/reports/ReportsScreens.tsx', 'utf8');
const branchCard = source.slice(source.indexOf('function BranchSalesCard'), source.indexOf('function ProductSalesRow'));
assert.match(branchCard, /DAILY SALES LOG/);
assert.match(branchCard, /useBranchSalesLog/);
assert.match(branchCard, /sale_number/);
assert.match(branchCard, /cashier\?\.full_name/);
assert.doesNotMatch(branchCard, /barPercent|share\.toFixed|width: `\$\{Math\.max\(share/);
assert.match(source, /transaction_count\) > 0/);
assert.match(source, /Selling branches have no completed sales/);

const service = readFileSync('src/services/saleService.ts', 'utf8');
assert.match(service, /export async function listBranchSalesLog/);
assert.match(service, /getTodayRangeManila/);
assert.match(service, /status', 'completed'/);

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

const id = (n) => `28000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1);
const cashier1 = id(2);
const cashier2 = id(3);
const main = id(10);
const branch1 = id(11);
const branch2 = id(12);
const product = id(20);

await db.exec(`
  insert into auth.users values ('${owner}','o@test'),('${cashier1}','c1@test'),('${cashier2}','c2@test');
  insert into public.branches(id,name,code,is_main_branch) values
    ('${main}','Main','MAIN',true),('${branch1}','SM1','SM1',false),('${branch2}','SM2','SM2',false);
  insert into public.profiles(id,full_name,role,branch_id) values
    ('${owner}','Owner','owner',null),
    ('${cashier1}','Cashier One','cashier','${branch1}'),
    ('${cashier2}','Cashier Two','cashier','${branch2}');
  insert into public.products(id,name,sku,selling_price,is_active) values ('${product}','Chicken','CH',80,true);
  insert into public.branch_products(branch_id,product_id,selling_price,is_active) values
    ('${branch1}','${product}',80,true),('${branch2}','${product}',80,true);
  insert into public.branch_inventory(branch_id,product_id,quantity_on_hand) values
    ('${branch1}','${product}',10),('${branch2}','${product}',10);
`);

const asUser = async (userId, work) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false);`);
  try {
    return await work();
  } finally {
    await db.exec('reset role');
  }
};

const sale1 = await asUser(cashier1, async () => {
  const shift = (await db.query('select public.start_cashier_shift() id')).rows[0].id;
  const sale = (
    await db.query('select (public.confirm_sale($1,$2::jsonb,$3,$4)).*', [
      shift,
      JSON.stringify([{ product_id: product, quantity: 2 }]),
      '160.00',
      'sales-log-branch1-key01',
    ])
  ).rows[0];
  await db.query('select public.end_cashier_shift($1)', [shift]);
  return sale;
});

await asUser(owner, async () => {
  const report = (await db.query(`select public.report_sales_by_branch('today', null, null) result`)).rows[0].result;
  const withSales = report.filter((row) => Number(row.transaction_count) > 0);
  assert.equal(withSales.length, 1);
  assert.equal(withSales[0].branch_id, branch1);
  assert.equal(Number(withSales[0].transaction_count), 1);
  assert.equal(Number(withSales[0].total_sales), 160);

  const log = (
    await db.query(
      `select sale_number, total_amount, cashier_id from public.sales
       where branch_id=$1 and status='completed' order by sold_at desc`,
      [branch1],
    )
  ).rows;
  assert.equal(log.length, 1);
  assert.equal(log[0].sale_number, sale1.sale_number);
  assert.equal(Number(log[0].total_amount), 160);
  assert.equal(log[0].cashier_id, cashier1);

  const empty = (
    await db.query(`select id from public.sales where branch_id=$1 and status='completed'`, [branch2])
  ).rows;
  assert.equal(empty.length, 0);
});

await asUser(cashier2, async () => {
  const hidden = (await db.query('select id from public.sales')).rows;
  assert.equal(hidden.length, 0);
});

await db.close();
console.log('Sales by Branch log tests passed: no share %, daily log fields, only branches with sales.');
