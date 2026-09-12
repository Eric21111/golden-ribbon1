import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';

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
for (const file of readdirSync('supabase/migrations').filter((file) => file.endsWith('.sql')).sort()) {
  await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8').replace('create extension if not exists pgcrypto;', ''));
}

const owner = '10000000-0000-4000-8000-000000000001';
const mainMgr = '10000000-0000-4000-8000-000000000002';
const cashier = '10000000-0000-4000-8000-000000000003';
const main = '20000000-0000-4000-8000-000000000001';
const branch = '20000000-0000-4000-8000-000000000002';
const product = '30000000-0000-4000-8000-000000000001';

await db.exec(`
  insert into auth.users values ('${owner}','owner@test'),('${mainMgr}','mainmgr@test'),('${cashier}','cashier@test');
  insert into public.branches(id,name,code,is_main_branch,is_active) values
    ('${main}','Main Branch','MAIN',true,true),
    ('${branch}','Branch 1','BR-01',false,true);
  insert into public.profiles(id,full_name,role,branch_id) values
    ('${owner}','Owner','owner',null),
    ('${mainMgr}','Main Manager','manager','${main}'),
    ('${cashier}','Cashier','cashier','${branch}');
  insert into public.products(id,name,sku,selling_price,is_active) values
    ('${product}','Chicken Butter','CB',80,true);
  insert into public.branch_inventory(branch_id,product_id,quantity_on_hand)
    values ('${branch}','${product}',5);
`);

assert.equal((await db.query(`select to_regclass('public.audit_logs') as rel`)).rows[0].rel, null);
assert.equal((await db.query(`
  select count(*)::int as n
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('write_audit_log','list_audit_logs','get_audit_log_detail','products_audit_trigger_fn')
`)).rows[0].n, 0);
assert.equal((await db.query(`
  select count(*)::int as n
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and t.tgname in ('products_audit_after_change','audit_logs_immutable')
`)).rows[0].n, 0);

await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${mainMgr}',false);`);
await db.query(`select public.initialize_main_branch_inventory('[{"product_id":"${product}","quantity":100}]'::jsonb, 'opening')`);
await db.exec(`update public.products set selling_price = 85 where id = '${product}'`);
const transferId = (await db.query(
  `select public.send_stock_transfer('${branch}','[{"product_id":"${product}","quantity_sent":10}]'::jsonb,null,'audit-gone-send-key001') id`,
)).rows[0].id;
assert.ok(transferId);

await db.exec(`select set_config('request.jwt.claim.sub','${cashier}',false);`);
const shift = (await db.query('select public.start_cashier_shift() id')).rows[0].id;
const sale = (await db.query(
  'select (public.confirm_sale($1,$2::jsonb,$3,$4)).*',
  [shift, JSON.stringify([{ product_id: product, quantity: 1 }]), '85.00', 'audit-gone-sale-key001'],
)).rows[0];
assert.equal(Number(sale.total_amount), 85);
await db.query('select public.end_cashier_shift($1)', [shift]);

await db.exec('reset role');
assert.equal((await db.query('select * from public.sales')).rows.length, 1);
assert.equal((await db.query(`select to_regclass('public.audit_logs') as rel`)).rows[0].rel, null);

await db.close();
console.log('Milestone 9 audit cleanup tests passed: audit subsystem removed and operations still succeed.');
