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
  await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8').replace(/create extension if not exists pgcrypto;/g, ''));
}

const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1);
const manager = id(2);
const cashier = id(3);
const main = id(10);
const branch = id(11);
const p1 = id(20);
const p2 = id(21);
const shift = id(30);
const sale = id(40);
const stockReturn = id(50);
const returnItem = id(51);

await db.exec(`
  insert into auth.users values ('${owner}','owner@test'),('${manager}','manager@test'),('${cashier}','cashier@test');
  insert into public.branches(id,name,code,is_main_branch) values
    ('${main}','Main','MAIN',true),('${branch}','Branch','BR1',false);
  insert into public.profiles(id,full_name,role,branch_id) values
    ('${owner}','Owner','owner',null),('${manager}','Manager','manager','${branch}'),('${cashier}','Cashier','cashier','${branch}');
  insert into public.products(id,name,sku,selling_price) values
    ('${p1}','Product One','P1',10),('${p2}','Product Two','P2',20);
  insert into public.shifts(id,branch_id,cashier_id,status) values ('${shift}','${branch}','${cashier}','open');
  insert into public.sales(id,sale_number,branch_id,shift_id,cashier_id,subtotal,total_amount,amount_paid,change_amount,idempotency_key,request_items)
    values ('${sale}','SALE-HARDEN-1','${branch}','${shift}','${cashier}',50,50,50,0,'sale-hardening-key-0001','[]');
  insert into public.sale_items(sale_id,product_id,quantity,unit_price,subtotal) values
    ('${sale}','${p1}',1,10,10),('${sale}','${p2}',2,20,40);
`);

const businessTables = [
  'profiles','branches','products','branch_inventory','inventory_movements','stock_transfers',
  'stock_transfer_items','transfer_discrepancies','shifts','sales','sale_items','stock_returns',
  'stock_return_items','return_discrepancies','audit_logs',
];
const rls = await db.query(`select relname from pg_class where relname = any($1::text[]) and relrowsecurity`, [businessTables]);
assert.deepEqual(new Set(rls.rows.map((row) => row.relname)), new Set(businessTables));

const unsafeDefiners = await db.query(`
  select p.proname
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prosecdef
    and not exists (
      select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) setting
      where setting like 'search_path=%'
    )
`);
assert.equal(unsafeDefiners.rows.length, 0, 'Every SECURITY DEFINER fixes search_path');

await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${owner}',false);`);
const performance = (await db.query(`select public.report_branch_performance('all_time') result`)).rows[0].result[0];
assert.equal(performance.transaction_count, 1);
assert.equal(Number(performance.total_sales), 50, 'Sale total must not be multiplied by item count');
assert.equal(performance.quantity_sold, 3);

const details = (await db.query(`select public.get_branch_performance_details('${branch}', 'all_time') result`)).rows[0].result;
assert.equal(details.metrics.transaction_count, 1);
assert.equal(Number(details.metrics.total_sales), 50, 'Branch details sale total must not be multiplied by item count');
assert.equal(details.metrics.quantity_sold, 3);
assert.equal(details.products_sold.length, 2);
assert.equal(Number(details.products_sold.find((item) => item.product_id === p1).total_revenue), 10,
  'Branch details must use the historical sale-item subtotal');

const detailsDefinition = (await db.query(`
  select pg_get_functiondef('public.get_branch_performance_details(uuid,text,timestamptz,timestamptz)'::regprocedure) definition
`)).rows[0].definition;
assert.doesNotMatch(
  detailsDefinition,
  /jsonb_(?:agg|build_object)[\s\S]{0,500}(?:sum|count)\s*\(/i,
  'Branch details JSON construction must not contain nested aggregate calls',
);

await db.exec(`select set_config('request.jwt.claim.sub','${cashier}',false);`);
const firstClose = (await db.query(`select public.end_cashier_shift('${shift}') result`)).rows[0].result;
const retryClose = (await db.query(`select public.end_cashier_shift('${shift}') result`)).rows[0].result;
assert.equal(firstClose.status, 'closed');
assert.equal(retryClose.ended_at, firstClose.ended_at, 'End Shift retry is idempotent');

await db.exec('reset role;');
await assert.rejects(db.exec(`update public.sales set amount_paid=999 where id='${sale}'`), /immutable/);
await assert.rejects(db.exec(`update public.sale_items set unit_price=1 where sale_id='${sale}'`), /immutable/);

await db.exec(`
  insert into public.stock_returns(
    id,return_number,from_branch_id,to_branch_id,status,created_by,returned_by,
    from_branch_name,to_branch_name,returned_by_name,idempotency_key,request_items
  ) values (
    '${stockReturn}','RET-HARDEN-1','${branch}','${main}','in_transit','${manager}','${manager}',
    'Branch','Main','Manager','return-hardening-key-0001','[]'
  );
  insert into public.stock_return_items(id,stock_return_id,product_id,quantity_returned,product_name,product_sku)
    values ('${returnItem}','${stockReturn}','${p1}',2,'Product One','P1');
`);
await assert.rejects(db.exec(`update public.stock_returns set status='draft' where id='${stockReturn}'`), /Invalid stock return status transition/);
await assert.rejects(db.exec(`update public.stock_return_items set quantity_returned=3 where id='${returnItem}'`), /one-time received quantity/);
await db.exec(`update public.stock_return_items set quantity_received=2 where id='${returnItem}'`);
await assert.rejects(db.exec(`update public.stock_return_items set quantity_received=1 where id='${returnItem}'`), /one-time received quantity/);

await db.close();
console.log('Milestone 10 database hardening tests passed: RLS coverage, SECURITY DEFINER search paths, report aggregation, end-shift idempotency, immutable sales, and return transitions.');
