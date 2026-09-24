import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const source = readFileSync('src/features/reports/InventoryReconciliationScreen.tsx', 'utf8');
assert.match(source, /export function hasVisibleReconciliationIssue/);
assert.match(source, /export function reconciliationIssueBadge/);
assert.match(source, /Return issue/);
assert.match(source, /auditDiscrepancySummary/);
assert.match(source, /Return issues/);
assert.match(source, /after Main receives/);
assert.match(source, /hasVisibleReconciliationIssue\(item\)/);
assert.doesNotMatch(source, /has_reconciliation_issue\)\.length/);

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
const mainMgr = id(2);
const cashier = id(3);
const main = id(10);
const branch = id(11);
const product = id(20);

await db.exec(`
  insert into auth.users values ('${owner}','o@test'),('${mainMgr}','m@test'),('${cashier}','c@test');
  insert into public.branches(id,name,code,is_main_branch) values
    ('${main}','Main','MAIN',true),('${branch}','SM1','SM1',false);
  insert into public.profiles(id,full_name,role,branch_id) values
    ('${owner}','Owner','owner',null),
    ('${mainMgr}','Main Manager','manager','${main}'),
    ('${cashier}','Cashier','cashier','${branch}');
  insert into public.products(id,name,sku,selling_price,is_active) values ('${product}','Chicken','CH',80,true);
  insert into public.branch_products(branch_id,product_id,selling_price,is_active) values ('${branch}','${product}',80,true);
  insert into public.branch_inventory(branch_id,product_id,quantity_on_hand) values
    ('${branch}','${product}',12),('${main}','${product}',40);
  insert into public.inventory_movements(branch_id,product_id,movement_type,quantity,reference_type,created_by)
  values ('${branch}','${product}','opening_stock',12,'opening_stock','${owner}');
`);

const asUser = async (userId, work) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false);`);
  try {
    return await work();
  } finally {
    await db.exec('reset role');
  }
};

const leftoverId = (
  await asUser(cashier, () => db.query("select public.return_leftover_stock(null,'recon-leftover-key01') id"))
).rows[0].id;

const leftoverItem = (
  await db.query('select id, quantity_returned from public.stock_return_items where stock_return_id=$1', [leftoverId])
).rows[0];
assert.equal(Number(leftoverItem.quantity_returned), 12);

await asUser(mainMgr, () =>
  db.query('select public.receive_stock_return($1,$2::jsonb,null,$3)', [
    leftoverId,
    JSON.stringify([{ stock_return_item_id: leftoverItem.id, quantity_received: 10 }]),
    'recon-receive-short-01',
  ]),
);

await asUser(owner, async () => {
  const beforeExpandWouldHide = (
    await db.query(`select public.report_inventory_reconciliation($1) result`, [branch])
  ).rows[0].result;
  const chicken = beforeExpandWouldHide.find((row) => row.product_id === product);
  assert.ok(chicken);
  assert.equal(Number(chicken.variance), 0);
  assert.equal(chicken.has_reconciliation_issue, false);
  assert.equal(Number(chicken.return_missing_qty), 2);
  assert.equal(Number(chicken.return_excess_qty), 0);
  assert.equal(Number(chicken.current_stock), 0);
  assert.equal(Number(chicken.calculated_stock), 0);
});

await db.close();
console.log('Inventory reconciliation return-issue tests passed: leftover count shows without ledger variance.');
