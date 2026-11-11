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
const sell = async (quantity,key) => (await db.query(
  'select (public.confirm_sale($1,$2::jsonb,$3,$4,$5,$6)).id id',
  [shift,JSON.stringify([{product_id:product,quantity}]),quantity*10,key,'standard','gcash']
)).rows[0].id;
const sale = await sell(3,'void-test-checkout-001');
const item = (await db.query('select id from public.sale_items where sale_id=$1',[sale])).rows[0].id;
const submit = (n,expected,reason='Wrong quantity',note='') => db.query('select public.void_cashier_sale_item($1,$2,$3,$4,$5)',[item,n,expected,reason,note]);
const balance = async () => Number((await db.query('select available from public.list_cashier_day_stock() where product_id=$1',[product])).rows[0].available);
assert.equal(await balance(),2);
await assert.rejects(submit(1,3,'Other',' '));
await assert.rejects(submit(4,3));
const otherCashier=id(12);
await db.exec(`reset role;
  insert into auth.users(id,email) values ('${otherCashier}','other@test');
  insert into public.profiles(id,full_name,role,branch_id) values ('${otherCashier}','Other','cashier','${branch}');
  set role authenticated; select set_config('request.jwt.claim.sub','${otherCashier}',false)`);
await assert.rejects(submit(1,3),/Receipt unavailable/);
await db.exec(`select set_config('request.jwt.claim.sub','${manager}',false)`);
await assert.rejects(submit(1,3));
await db.exec(`select set_config('request.jwt.claim.sub','${cashier}',false)`);
await submit(1,3);
await assert.rejects(submit(1,3));
assert.equal(await balance(),3);
const header=(await db.query('select * from public.sales where id=$1',[sale])).rows[0];
assert.equal(Number(header.total_amount),20);
assert.equal(Number(header.amount_paid),30);
assert.equal(Number(header.change_amount),0);
assert.equal(header.status,'completed');
const row=(await db.query('select * from public.sale_items where id=$1',[item])).rows[0];
assert.equal(Number(row.quantity),2);
assert.equal(row.void_history[0].quantity,1);
await submit(2,2,'Other','Entered twice');
assert.equal(await balance(),5);
assert.equal((await db.query('select status from public.sales where id=$1',[sale])).rows[0].status,'voided');
// A discounted Cash meal uses two stock units per serving; kitchen changes its recipe after checkout.
const ingredient=id(9);
await db.exec(`reset role;
  insert into public.products(id,name,sku,selling_price) values ('${ingredient}','Ingredient','ING',1);
  insert into public.branch_inventory(branch_id,product_id,quantity_on_hand) values ('${branch}','${ingredient}',10);
  insert into public.product_stock_uses(product_id,ingredient_product_id,quantity) values ('${product}','${ingredient}',2);
  set role authenticated;`);
const meal=(await db.query(
  "select (public.confirm_sale($1,$2::jsonb,20,'void-test-meal-001','pwd','cash')).id id",
  [shift,JSON.stringify([{product_id:product,quantity:2}])]
)).rows[0].id;
const mealLine=(await db.query('select id,unit_price from public.sale_items where sale_id=$1',[meal])).rows[0];
await db.exec(`reset role; update public.product_stock_uses set quantity=3 where product_id='${product}'; set role authenticated`);
await db.query("select public.void_cashier_sale_item($1,1,2,'Customer changed order','')",[mealLine.id]);
assert.equal(Number((await db.query('select available from public.list_cashier_day_stock() where product_id=$1',[ingredient])).rows[0].available),8);
assert.equal(Number((await db.query('select total_amount from public.sales where id=$1',[meal])).rows[0].total_amount),Number(mealLine.unit_price));
const another=await sell(1,'void-test-checkout-002');
const otherItem=(await db.query('select id from public.sale_items where sale_id=$1',[another])).rows[0].id;
const preview=(await db.query('select public.begin_cashier_shift_close($1) p',[shift])).rows[0].p;
assert.equal(preview.expected_gcash,10);
assert.equal(preview.expected_cash,Number(mealLine.unit_price));
await assert.rejects(db.query("select public.void_cashier_sale_item($1,1,1,'Wrong item','')",[otherItem]));
await db.close();
console.log('Partial and full item voids, authorization, duplicate submissions, stock, remittance and shift cutoff passed.');
