import { verifiedClose } from './_verified_cashier_close.mjs';
process.on('uncaughtException', e => { console.error(e.message, e.detail ?? '', e.where ?? '', e.stack?.split('\n').slice(-3).join('\n')); process.exit(1); });
import { loadTs } from './_load_ts.mjs';
import assert from 'node:assert/strict';
import { readFileSync,readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const db=new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role;
create schema auth; create table auth.users(id uuid primary key,email text,encrypted_password text);
create table auth.identities(id uuid primary key,user_id uuid references auth.users on delete cascade);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users on delete cascade);
create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema public,auth to authenticated; grant execute on function auth.uid() to authenticated;`);
for(const file of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort())
 await db.exec(readFileSync(`supabase/migrations/${file}`,'utf8').replace(/create extension if not exists pgcrypto;/g,''));
const id=n=>`81100000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const owner=id(1),manager=id(2),cashier=id(3),branch=id(4),product=id(5);
await db.exec("insert into public.branches(name,code,is_main_branch) values ('Main Branch','MAIN',true) on conflict do nothing");
const main=(await db.query('select id from public.branches where is_main_branch')).rows[0].id;
await db.exec(`insert into auth.users values ('${owner}','owner@test','owner-hash'),('${manager}','manager@test','manager-hash'),('${cashier}','cashier@test','cashier-hash');
insert into auth.identities select id,id from auth.users; insert into auth.sessions select id,id from auth.users;
insert into public.branches(id,name,code) values ('${branch}','Test booth','TB');
insert into public.profiles(id,full_name,role,branch_id) values ('${owner}','Test Owner','owner','${main}'),('${manager}','Test Manager','manager','${main}'),('${cashier}','Test Cashier','cashier','${branch}');
insert into public.products(id,name,sku,selling_price,closing_stock_behavior) values ('${product}','Test Product','TP',10,'keep_at_branch');
insert into public.branch_products(branch_id,product_id,selling_price) values ('${branch}','${product}',10);
insert into public.branch_inventory(branch_id,product_id,quantity_on_hand) values ('${branch}','${product}',5);
set role authenticated; select set_config('request.jwt.claim.sub','${cashier}',false);`);
const shift=(await db.query('select public.start_cashier_shift() id')).rows[0].id;
const items = JSON.stringify([{ product_id: product, quantity: 1 }]);
const sell = (method, paid, key) => db.query('select public.confirm_sale($1,$2::jsonb,$3,$4,$5,$6)', [shift, items, paid, key, 'standard', method]);
await assert.rejects(sell('gcash', 12, 'payment-method-incorrect'), /exact amount/);
await sell('cash', 20, 'payment-method-cash-001');
await sell('cash', 20, 'payment-method-cash-001');
await assert.rejects(sell('gcash', 10, 'payment-method-cash-001'));
await sell('gcash', 10, 'payment-method-gcash-001');
const stock = (await db.query('select * from public.list_cashier_day_stock()')).rows;
assert.equal(Number(stock.find(row => row.product_id === product).available), 3);
const preview = (await verifiedClose(db,shift)).rows[0].p;
assert.equal(preview.expected_cash, 10);
assert.equal(preview.expected_gcash, 10);
const products = JSON.stringify(preview.products.map(p => ({ product_id: p.product_id, actual_remaining: String(p.system_balance_before_waste) })));
const finish = gcash => db.query('select public.finalize_cashier_shift_reconciliation($1,$2,$3::jsonb,$4) r', [shift, '9', products, gcash]);
await assert.rejects(finish(null), /GCash/);
const result = (await finish('11')).rows[0].r;
assert.equal(result.actual_cash, 9);
assert.equal(result.actual_gcash, 11);
await finish('11');
await assert.rejects(finish('10'));
await db.exec(`select set_config('request.jwt.claim.sub','${owner}',false)`);
const report = (await db.query('select public.report_branch_shift_remittances($1) r', [branch])).rows[0].r.days[0];
assert.equal(report.actual_gcash, 11);
assert.equal(report.total_shortage, 1);
assert.equal(report.total_excess, 1);
const detail = (await db.query('select public.get_shift_remittance_detail($1) r', [shift])).rows[0].r;
assert.equal(detail.expected_gcash, 10);
assert.deepEqual((await db.query('select * from public.list_cashier_day_stock()')).rows, []);
const { paymentBreakdown } = loadTs('src/features/sales/paymentMethods.ts');
const receipt = (program, amount, method='gcash', status='completed') => ({
  pricing_program: program, total_amount: amount, payment_method: method, status
});
const receipts = [
  receipt('standard', 10.01), receipt('pwd', 8.02), receipt('back_office_guard', 5.03),
  receipt('employee_meal', 0), receipt('standard', 1, 'cash'), receipt('standard', 9, null),
  receipt('standard', 15, 'gcash', 'voided')
];
assert.deepEqual(paymentBreakdown(receipts, 'gcash'), {
  groups: {standard: 1001, pwd: 802, back_office_guard: 503, employee_meal: 0},
  total: 2306, orders: 4, employeeMeals: 1
});
assert.equal(paymentBreakdown(receipts, 'unrecorded').total, 900);
await db.close();
console.log('Cash and GCash checkout, retry safety, shift close, and remittance reports passed.');
