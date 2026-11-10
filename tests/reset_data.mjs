process.on('uncaughtException', e => { console.error(e.message, e.detail ?? '', e.where ?? '', e.stack?.split('\n').slice(-3).join('\n')); process.exit(1); });
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
await db.query('select public.confirm_sale($1,$2::jsonb,20,$3)',[shift,JSON.stringify([{product_id:product,quantity:2}]),'reset-test-sale-key-001']);
await db.query('select public.create_stock_return($1::jsonb,$2,$3)',[JSON.stringify([{product_id:product,quantity_returned:1}]),null,'reset-test-return-key-001']);
await db.exec('reset role');
const script=readFileSync('docs/reset-keep-owner-and-main-branch.sql','utf8');
const execute=script.replace('true, -- PREVIEW ONLY','false, -- PREVIEW ONLY')
 .replace('null, -- Owner UUID',`'${owner}', -- Owner UUID`)
 .replace('null, -- Main Branch Manager UUID',`'${manager}', -- Main Branch Manager UUID`)
 .replace('null, -- Main Branch UUID',`'${main}', -- Main Branch UUID`)
 .replace("'' -- For execution:","'BACKUP VERIFIED - DELETE TEST DATA' -- For execution:");
const snapshot=async()=>{
 const tables=(await db.query("select schemaname,tablename from pg_tables where schemaname in ('public','auth') order by schemaname,tablename")).rows;
 return Promise.all(tables.map(async t=>[t.schemaname,t.tablename,(await db.query(`select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]'::jsonb) data from ${t.schemaname}.${t.tablename} x`)).rows[0].data]));
};
const before=await snapshot();
const preview=await db.exec(script);
assert.equal(preview.at(-2).rows[0].result,'PREVIEW ONLY - NO DATA DELETED');
assert.deepEqual(await snapshot(),before);
const fails=async(sql,pattern)=>{await assert.rejects(db.exec(sql),pattern); await db.exec('rollback'); assert.deepEqual(await snapshot(),before);};
await fails(script.replace('true, -- PREVIEW ONLY','false, -- PREVIEW ONLY'),/requires all three/);
await fails(execute.replace(`'${owner}', -- Owner UUID`,`'${cashier}', -- Owner UUID`),/UUIDs do not match/);
await db.exec('create table public.unreviewed_table(id int)');
await assert.rejects(db.exec(execute),/Unreviewed public/); await db.exec('rollback; drop table public.unreviewed_table');
await db.exec('alter table public.archive_settings rename to unexpected_settings');
await assert.rejects(db.exec(execute),/Unreviewed public/); await db.exec('rollback; alter table public.unexpected_settings rename to archive_settings');
await db.exec('create schema outside; create table outside.account_link(user_id uuid references auth.users(id) on delete cascade)');
await fails(execute,/Unreviewed account\/branch dependencies/); await db.exec('drop schema outside cascade');
await db.exec('create schema storage; create table storage.objects(id int); insert into storage.objects values(1)');
await fails(execute,/Storage contains/); await db.exec('drop schema storage cascade');
await db.exec('create schema external; create table external.dependent(product_id uuid references public.products(id))');
await fails(execute,/Unreviewed foreign-key/); await db.exec('drop schema external cascade');
// A failure after TRUNCATE must roll back all application data and Auth changes.
await db.exec(`create function public.test_reject_delete() returns trigger language plpgsql as $$ begin raise exception 'Injected late failure'; end $$;
create trigger test_reject_delete before delete on auth.users for each row execute function public.test_reject_delete();`);
await fails(execute,/Injected late failure/);
await db.exec('drop trigger test_reject_delete on auth.users; drop function public.test_reject_delete()');
await db.exec(execute.replace(/commit;\s*$/,'rollback;'));
assert.deepEqual(await snapshot(),before,'execution rehearsal rolls back');
const metadata=async()=> (await db.query(`select c.relname,c.relrowsecurity,c.relacl::text,
(select jsonb_agg(pg_get_triggerdef(t.oid) order by t.tgname) from pg_trigger t where t.tgrelid=c.oid) triggers
from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' order by c.relname`)).rows;
const security=await metadata();
const result=await db.exec(execute);
assert.equal(result.at(-2).rows[0].result,'RESET COMPLETED');
for(const row of result.at(-2).rows[0].table_summary) if(row.action==='clear') assert.equal(row.after,0,row.table);
assert.deepEqual(await metadata(),security);
assert.deepEqual((await db.query('select id from auth.users order by id')).rows.map(r=>r.id),[owner,manager]);
assert.equal((await db.query('select count(*)::int n from auth.identities')).rows[0].n,2);
assert.equal((await db.query('select count(*)::int n from auth.sessions')).rows[0].n,2);
assert.equal((await db.query('select encrypted_password from auth.users where id=$1',[owner])).rows[0].encrypted_password,'owner-hash');
await db.exec(execute); // safe on already-empty business tables
await db.close();
console.log('Reset tests passed: preview, explicit IDs, drift/storage/FK guards, late-failure rollback, rehearsal, preservation, Auth cascades and repeat execution.');
