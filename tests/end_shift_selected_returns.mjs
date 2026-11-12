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

await db.exec('reset role');
const keep=id(7), blocked=id(8);
for(const [pid,name,nonReturnable] of [[keep,'Keep',false],[blocked,'Carryover',true]]) {
  await db.query("insert into public.products(id,name,sku,selling_price,closing_stock_behavior,is_non_returnable) values($1,$2,$2,10,'record_as_unsold',$3)",[pid,name,nonReturnable]);
  await db.query('insert into public.branch_inventory(branch_id,product_id,quantity_on_hand) values($1,$2,4)',[branch,pid]);
}
await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${cashier}',false)`);
async function checkCatalogParity() {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[cashier]);
  const cashierStock=(await db.query('select * from public.list_cashier_day_stock()')).rows;
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[manager]);
  const managerStock=(await db.query('select * from public.manager_branch_stock($1)',[branch])).rows;
  for (const row of cashierStock) {
    const match=managerStock.find(item=>item.product_id===row.product_id);
    assert.ok(match);
    assert.deepEqual([match.on_hand,match.held,match.available].map(Number),
      [row.on_hand,row.awaiting_return,row.available].map(Number));
  }
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[cashier]);
}
const shift=(await db.query('select public.start_cashier_shift() id')).rows[0].id;
const change = async(action, qty, before, key, pid=product) =>
  (await db.query("select public.record_branch_stock_action($1,$2,$3,$4,$5,'Physical count',$6) receipt",
    [shift,pid,action,qty,before,key])).rows[0].receipt;
const addKey='branch-stock-add-001';
const add=await change('add',3,5,addKey);
assert.equal(await change('add',3,5,addKey),add);
await assert.rejects(change('add',2,5,addKey));
await assert.rejects(change('waste',9,8,'branch-stock-waste-extra'));
await assert.rejects(change('waste',1,5,'branch-stock-waste-stale'));
await assert.rejects(change('add',1,0,'branch-stock-not-carried',id(999)));
await change('waste',1,8,'branch-stock-waste-001');
await change('waste',2,7,'branch-stock-waste-002');
await db.query("select public.confirm_sale($1,$2::jsonb,10,'close-test-checkout-001','standard','gcash')",[shift,JSON.stringify([{product_id:product,quantity:1}])]);
await checkCatalogParity();
await assert.rejects(db.query('select public.begin_cashier_shift_close($1)',[shift]),/permission denied/);
await assert.rejects(db.query('select public.begin_verified_cashier_close($1,$2)',[shift,cashier]),/permission denied/);
await db.exec("set role service_role; select set_config('request.jwt.claim.sub','',false)");
await assert.rejects(db.query('select public.begin_verified_cashier_close($1,$2)',[shift,manager]));
const preview=(await db.query('select public.begin_verified_cashier_close($1,$2) p',[shift,cashier])).rows[0].p;
await db.exec('set role authenticated');
await db.query("select set_config('request.jwt.claim.sub',$1,false)",[cashier]);
assert.equal(preview.supports_selected_returns,true);
assert.equal(preview.products.find(p=>p.product_id===product).already_recorded_waste,3);
await assert.rejects(change('add',1,4,'branch-stock-after-cutoff'));
assert.equal(await change('add',3,5,addKey),add);
assert.equal(preview.products.find(p=>p.product_id===blocked).returnable,false);
const close=async(ids,waste={})=>(await db.query("select public.close_shift_with_returns($1,'0','10',$2::uuid[],$3::jsonb) r",[shift,ids,JSON.stringify(waste)])).rows[0].r;
await assert.rejects(close([blocked]));
await assert.rejects(close([id(99)]));
await assert.rejects(close([product,product]));
await assert.rejects(close([product],{[product]:5}));
await db.exec('reset role');
assert.equal((await db.query('select count(*)::int n from public.shift_reconciliations where shift_id=$1',[shift])).rows[0].n,0);
await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${manager}',false)`);
await assert.rejects(close([product]));
await db.exec(`select set_config('request.jwt.claim.sub','${cashier}',false)`);
// Exercise all/none and late failures inside isolated transactions using the same pending shift.
await db.exec('begin');
const empty = await close([]);
assert.equal(empty.return_id,null);
assert.equal((await close([])).idempotent,true);
await db.exec('rollback');
await db.exec('begin');
const all = await close([product,keep]);
assert.equal((await db.query('select count(*)::int n from public.stock_return_items where stock_return_id=$1',[all.return_id])).rows[0].n,2);
await db.exec('rollback');
await db.exec(`reset role;
  create function public.fail_test_dispatch() returns trigger language plpgsql as $$ begin raise exception 'Test failure during dispatch'; end $$;
  create trigger fail_test_dispatch before insert on public.stock_return_items for each row execute function public.fail_test_dispatch();
  set role authenticated`);
await assert.rejects(close([product]),/Test failure during dispatch/);
await db.exec('reset role');
assert.equal((await db.query('select count(*)::int n from public.shift_reconciliations where shift_id=$1',[shift])).rows[0].n,0);
assert.equal((await db.query('select count(*)::int n from public.stock_returns')).rows[0].n,0);
await db.exec('drop trigger fail_test_dispatch on public.stock_return_items; set role authenticated');
const result=await close([product],{[product]:1});
assert.ok(result.return_number);
await checkCatalogParity();
assert.equal((await close([product],{[product]:1})).return_id,result.return_id);
await assert.rejects(close([]),/different details/);
await db.exec(`select set_config('request.jwt.claim.sub','${manager}',false)`);
const wasteReport=(await db.query("select public.report_branch_shift_waste($1,'all_time') report",[branch])).rows[0].report;
const occurrences=wasteReport.days.flatMap(d=>d.shifts).find(s=>s.shift_id===shift).occurrences;
assert.equal(occurrences.length,3);
assert.equal(new Set(occurrences.map(o=>o.occurrence_id)).size,3);
assert.equal(occurrences.reduce((sum,o)=>sum+Number(o.quantity),0),4);
assert.equal(occurrences.filter(o=>o.note==='Physical count').length,2);
const corrections=(await db.query('select public.list_stock_count_corrections(0) list')).rows[0].list;
assert.equal(corrections.length,1);
assert.equal(corrections[0].details.after,8);
const totals=(await db.query('select * from public.manager_today_payments($1)',[branch])).rows;
assert.equal(totals.length,1);assert.equal(Number(totals[0].amount),10);assert.equal(totals[0].method,'gcash');
assert.equal(Number((await db.query('select public.get_manager_dashboard_metrics() m')).rows[0].m.today_sales),10);
const stocks=(await db.query('select * from public.manager_branch_stock($1)',[branch])).rows;
assert.equal(Number(stocks.find(p=>p.product_id===keep).available),4);
const ret=(await db.query('select status,to_branch_id from public.stock_returns where id=$1',[result.return_id])).rows[0];
assert.equal(ret.to_branch_id,main);
assert.equal(ret.status,'in_transit');
const lines=(await db.query('select id,product_id,quantity_returned from public.stock_return_items where stock_return_id=$1',[result.return_id])).rows;
assert.deepEqual(lines.map(x=>[x.product_id,Number(x.quantity_returned)]),[[product,3]]);
const report=(await db.query('select public.get_shift_remittance_detail($1) r',[shift])).rows[0].r;
assert.equal(report.return_number,result.return_number);
assert.equal((await db.query('select id from public.stock_returns where return_number=$1',[report.return_number])).rows[0].id,result.return_id);
assert.equal(report.selected_return_close,true);
const received=(await db.query("select public.receive_stock_return($1,$2::jsonb,null,'test-receive-close-return') status",
  [result.return_id,JSON.stringify([{stock_return_item_id:lines[0].id,quantity_received:2}])])).rows[0].status;
assert.equal(received,'received_with_discrepancy');
await db.exec('reset role');
assert.equal((await db.query('select count(*)::int n from public.return_discrepancies where stock_return_id=$1',[result.return_id])).rows[0].n,1);
const stock=(await db.query('select product_id,quantity_on_hand::int qty,quantity_awaiting_return::int held from public.branch_inventory where branch_id=$1',[branch])).rows;
assert.equal(stock.find(s=>s.product_id===product).qty,0);
assert.equal(stock.find(s=>s.product_id===keep).qty,4);
assert.equal(stock.find(s=>s.product_id===keep).held,0);
assert.equal((await db.query("select count(*)::int n from public.inventory_movements where movement_type='return_out'")).rows[0].n,1);
assert.equal(Number((await db.query('select expected_gcash from public.shift_reconciliations where shift_id=$1',[shift])).rows[0].expected_gcash),10);
await db.close();
console.log('Selected end-shift return and remittance passed.');

