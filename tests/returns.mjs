import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role;
create schema auth; create table auth.users(id uuid primary key,email text);
create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema public,auth to authenticated; grant execute on function auth.uid() to authenticated;`);
for (const file of readdirSync('supabase/migrations').filter(f => f.endsWith('.sql')).sort()) {
  await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8').replace('create extension if not exists pgcrypto;', ''));
}
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const [manager,other,owner,cashier,main,branch,otherBranch,p1,p2] = [1,2,3,4,5,6,7,8,9].map(uuid);
await db.exec(`insert into auth.users values ('${manager}','m@test'),('${other}','o@test'),('${owner}','owner@test'),('${cashier}','c@test');
insert into public.branches(id,name,code,is_main_branch) values ('${main}','Main','MAIN',true),('${branch}','Branch 1','B1',false),('${otherBranch}','Branch 2','B2',false);
insert into public.profiles(id,full_name,role,branch_id) values ('${manager}','Manager','manager','${branch}'),('${other}','Other','manager','${otherBranch}'),('${owner}','Owner','owner',null),('${cashier}','Cashier','cashier','${branch}');
insert into public.products(id,name,sku,selling_price,is_active) values ('${p1}','Chicken','CH',80,true),('${p2}','Inactive beef','BF',100,false);
insert into public.branch_inventory(branch_id,product_id,quantity_on_hand) values ('${branch}','${p1}',30),('${branch}','${p2}',18),('${main}','${p1}',100),('${otherBranch}','${p1}',7);
set role authenticated; select set_config('request.jwt.claim.sub','${manager}',false);`);
const items = [{product_id:p1,quantity_returned:20},{product_id:p2,quantity_returned:18}];
const send = (key, data=items, notes=null) => db.query('select public.create_stock_return($1::jsonb,$2,$3) id',[JSON.stringify(data),notes,key]);
assert.equal((await db.query('select * from public.list_return_inventory()')).rows.length,2);
await assert.rejects(send('invalid-empty-return',[]), /1 to 200/);
await assert.rejects(send('invalid-zero-return',[{product_id:p1,quantity_returned:0}]), /positive/);
await assert.rejects(send('invalid-fraction-return',[{product_id:p1,quantity_returned:1.5}]), /positive/);
await assert.rejects(send('insufficient-stock-return',[{product_id:p1,quantity_returned:31}]), /Insufficient stock/);
await db.exec(`reset role;
create function public.fail_return_movement() returns trigger language plpgsql as $$ begin raise exception 'injected failure'; end $$;
create trigger fail_return before insert on public.inventory_movements for each row execute function public.fail_return_movement();
set role authenticated;`);
await assert.rejects(send('rollback-return-check'), /injected failure/);
assert.equal((await db.query('select * from public.stock_returns')).rows.length,0);
assert.equal((await db.query('select * from public.stock_return_items')).rows.length,0);
assert.equal(Number((await db.query('select quantity_on_hand from public.list_return_inventory() where product_id=$1',[p1])).rows[0].quantity_on_hand),30);
await db.exec('reset role; drop trigger fail_return on public.inventory_movements; set role authenticated;');
const id = (await send('duplicate-return-check')).rows[0].id;
assert.equal((await send('duplicate-return-check')).rows[0].id,id);
await assert.rejects(send('duplicate-return-check',items,'different notes'), /different return/);
await assert.rejects(send('duplicate-return-check',[{product_id:p1,quantity_returned:1}]), /different return/);
await assert.rejects(send('competing-stock-return',[{product_id:p1,quantity_returned:11}]), /Insufficient stock/);
const receiveItems = (await db.query('select id, quantity_returned from public.stock_return_items')).rows.map((row) => ({
  stock_return_item_id: row.id,
  quantity_received: Number(row.quantity_returned),
}));
await assert.rejects(
  db.query('select public.receive_stock_return($1,$2::jsonb,null,$3)', [id, JSON.stringify(receiveItems), 'selling-manager-cannot-receive']),
  /only Main Branch managers or owners/
);
for (const sql of ["update public.stock_returns set status='received'",'update public.stock_return_items set quantity_received=18','delete from public.stock_returns','update public.branch_inventory set quantity_on_hand=1000',"insert into public.stock_returns(return_number) values ('FAKE')"])
  await assert.rejects(db.exec(sql), /permission denied/);
await db.exec(`select set_config('request.jwt.claim.sub','${other}',false);`);
assert.equal((await db.query('select * from public.stock_returns')).rows.length,0);
assert.equal((await db.query('select * from public.stock_return_items')).rows.length,0);
await assert.rejects(send('other-branch-stock-return',[{product_id:p2,quantity_returned:1}]), /Insufficient stock/);
await db.exec(`select set_config('request.jwt.claim.sub','${cashier}',false);`);
await assert.rejects(send('cashier-denied-return'), /Manager/);
const shift = (await db.query('select public.start_cashier_shift() id')).rows[0].id;
await assert.rejects(db.query('select public.confirm_sale($1,$2::jsonb,1000,$3)',[shift,JSON.stringify([{product_id:p1,quantity:11}]),'sale-after-return-check']), /Insufficient stock/);
await db.exec(`select set_config('request.jwt.claim.sub','${owner}',false);`);
assert.equal((await db.query('select * from public.stock_returns')).rows.length,1);
assert.equal((await db.query('select * from public.stock_return_items')).rows.length,2);
await db.exec(`reset role; update public.profiles set is_active=false where id='${manager}'; set role authenticated; select set_config('request.jwt.claim.sub','${manager}',false);`);
await assert.rejects(send('inactive-manager-return'), /Manager/);
assert.equal((await db.query('select * from public.stock_returns')).rows.length,0);
await db.exec('reset role');
const header = (await db.query('select * from public.stock_returns')).rows[0];
assert.match(header.return_number,/^RET-\d{6,}$/);
assert.equal(header.status,'in_transit'); assert.equal(header.received_at,null);
assert.equal(header.from_branch_id,branch); assert.equal(header.to_branch_id,main);
assert.equal(Number((await db.query('select quantity_on_hand from public.branch_inventory where branch_id=$1 and product_id=$2',[main,p1])).rows[0].quantity_on_hand),100);
assert.equal(Number((await db.query('select quantity_on_hand from public.branch_inventory where branch_id=$1 and product_id=$2',[branch,p1])).rows[0].quantity_on_hand),10);
const movements = (await db.query("select * from public.inventory_movements where reference_type='stock_return' order by product_id")).rows;
assert.deepEqual(movements.map(row=>Number(row.quantity)),[-20,-18]);
assert.ok(movements.every(row=>row.reference_id===id && row.branch_id===branch && row.movement_type==='return_out'));
assert.ok((await db.query('select * from public.stock_return_items')).rows.every(row=>row.quantity_received===null));
await db.close();
console.log('Return tests passed: inactive stock, validation, full rollback, idempotency, competing sale/return stock limits, branch isolation, permissions, source-only deduction and pending receipt.');
