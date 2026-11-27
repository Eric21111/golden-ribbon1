import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
process.on('uncaughtException',e=>{console.error(e.message,e.where??'',e.stack);process.exit(1);});
const db=new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role;
create schema auth; create table auth.users(id uuid primary key,email text);
create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema public,auth to authenticated; grant execute on function auth.uid() to authenticated;`);
const target='20261127024853_egg_preparation_stock_mapping.sql';
const migration=readFileSync(`supabase/migrations/${target}`,'utf8');
for(const file of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')&&f!==target).sort())
 await db.exec(readFileSync(`supabase/migrations/${file}`,'utf8').replace(/create extension if not exists pgcrypto;/g,''));
await db.exec(migration); // no-op on a fresh database
const egg='9f0a71bf-3eaf-4edb-9a98-18177461f270',boiled='6bfe9edd-bab8-4435-80bf-2c9584a8d004',extra='82667279-eac5-45de-94cb-7e8974a42f0a';
const tapa='7c828877-be6a-46f3-b388-9f3016810485',tocino='ada45fda-5837-4fbe-a09a-40b3f6b4c531';
const id=n=>`99100000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const cashier=id(1),branch=id(2),other=id(3),rice=id(4);
await db.exec(`insert into auth.users values('${cashier}','cashier@test');
insert into public.branches(id,name,code) values('${branch}','SM1 test','SM1-EGG'),('${other}','SM2 test','SM2-EGG');
insert into public.profiles(id,full_name,role,branch_id) values('${cashier}','Cashier','cashier','${branch}');`);
for(const [pid,name,sku,price,active,pos] of [[egg,'Egg','EGG',20,false,false],[boiled,'Boiled Egg','BOILED-EGG',15,true,true],[extra,'Extra Egg','EXTRA-EGG',20,true,true],[tapa,'Beef Tapa','TAPA',90,true,true],[tocino,'Chicken Tocino','TOCINO',60,true,true],[rice,'Rice','RICE',15,true,false]]) {
 await db.query('insert into public.products(id,name,sku,selling_price,is_active,sell_in_pos) values($1,$2,$3,$4,$5,$6)',[pid,name,sku,price,active,pos]);
 for(const bid of [branch,other]) {
  await db.query('insert into public.branch_products(branch_id,product_id,selling_price) values($1,$2,$3)',[bid,pid,price]);
  await db.query('insert into public.branch_inventory(branch_id,product_id,quantity_on_hand) values($1,$2,$3)',[bid,pid,pid===egg?5:10]);
 }
}
const sources=[['d36959e1-4058-4234-94b4-c665dee13066',tapa,'w/ Rice & Fried/Boiled Egg',108,true],['d20ccdda-5e1b-4f40-9f14-62acdffb20ea',tocino,'Tocino with egg Only',60,false],['3a5b79cb-05cc-4700-8cdf-253b13e1709e',tocino,'Tocino with egg and rice',88,true]];
for(const [vid,pid,name,price,hasRice] of sources) {
 await db.query('insert into public.product_variants(id,product_id,name,default_price) values($1,$2,$3,$4)',[vid,pid,name,price]);
 for(const ingredient of [pid,egg,...(hasRice?[rice]:[])]) await db.query('insert into public.product_stock_uses(product_id,variant_id,ingredient_product_id,quantity) values($1,$2,$3,1)',[pid,vid,ingredient]);
 for(const bid of [branch,other]) await db.query('insert into public.branch_product_variants(branch_id,product_id,name,selling_price) values($1,$2,$3,$4)',[bid,pid,name,price+(bid===other?2:0)]);
}
await db.query('insert into public.product_stock_uses(product_id,ingredient_product_id,quantity) values($1,$2,1)',[extra,egg]);
await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${cashier}',false)`);
const shift=(await db.query('select public.start_cashier_shift() id')).rows[0].id;
const sale=async(lines,amount,key)=>(await db.query("select id from public.confirm_sale($1,$2::jsonb,$3,$4,'standard','cash')",[shift,JSON.stringify(lines),amount,`egg-migration-test-${key}`])).rows[0].id;
const oldSale=await sale([{product_id:extra,quantity:1}],20,'egg-old-sale');
await db.exec('reset role');
const snapshot=async()=>{
 const data={};
 for(const table of ['branch_inventory','sales','sale_items','inventory_movements']) data[table]=(await db.query(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) rows from public.${table} t`)).rows[0].rows;
 return data;
};
const before=await snapshot();
// Unexpected source recipes stop atomically, even after an earlier option was processed.
await db.exec('begin');
await db.query('update public.product_stock_uses set quantity=2 where variant_id=$1 and ingredient_product_id=$2',[sources[2][0],egg]);
await assert.rejects(db.exec(migration.replace(/^begin;$/m,'').replace(/^commit;$/m,'')),/Egg recipe\/options changed/);
await db.exec('rollback');
assert.equal((await db.query('select count(*)::int n from public.product_variants')).rows[0].n,3);
await db.exec(migration);
assert.deepEqual(await snapshot(),before,'migration never rewrites stock, movements, receipts, or sale lines');
assert.equal((await db.query('select count(*)::int n from public.product_variants where is_active')).rows[0].n,8);
assert.equal((await db.query('select count(*)::int n from public.branch_product_variants where is_active')).rows[0].n,16);
assert.equal((await db.query('select is_active,sell_in_pos from public.products where id=$1',[egg])).rows[0].is_active,true);
for(const [vid,pid,name,price,hasRice] of sources) {
 assert.equal((await db.query('select is_active from public.product_variants where id=$1',[vid])).rows[0].is_active,false);
 const newVariants=(await db.query('select id,name from public.product_variants where product_id=$1 and is_active',[pid])).rows;
 for(const v of newVariants) {
  const lines=(await db.query('select ingredient_product_id,quantity from public.product_stock_uses where variant_id=$1',[v.id])).rows;
  assert.ok(lines.some(l=>l.ingredient_product_id===pid));
  assert.ok(lines.some(l=>l.ingredient_product_id===(v.name.includes('Boiled')?boiled:egg)));
  assert.ok(lines.every(l=>Number(l.quantity)===1));
 }
 const branches=(await db.query('select * from public.branch_product_variants where product_id=$1 and lower(name)=lower($2)',[pid,name.replace('Fried/Boiled','Boiled').replace('egg','Boiled Egg')])).rows;
 assert.equal(branches.length,2);
 for(const row of branches) assert.equal(Number(row.selling_price),price+(row.branch_id===other?2:0));
}
const variant=async(pid,name)=>(await db.query('select id from public.branch_product_variants where branch_id=$1 and product_id=$2 and name=$3',[branch,pid,name])).rows[0].id;
const boiledOption=await variant(extra,'Boiled Egg'),friedOption=await variant(extra,'Fried Egg');
const oldOption=await variant(tapa,sources[0][2]);
const boiledTapa=await variant(tapa,'w/ Rice & Boiled Egg');
const stock=async(pid)=>Number((await db.query('select quantity_on_hand from public.branch_inventory where branch_id=$1 and product_id=$2',[branch,pid])).rows[0].quantity_on_hand);
await db.exec('set role authenticated');
await assert.rejects(sale([{product_id:extra,quantity:1}],20,'old-extra-cart'),/Select a meal option/);
await assert.rejects(sale([{product_id:tapa,variant_id:oldOption,quantity:1}],108,'old-tapa-cart'));
await sale([{product_id:extra,variant_id:boiledOption,quantity:1},{product_id:extra,variant_id:friedOption,quantity:1}],40,'mixed-egg-order');
await db.exec('reset role');
assert.equal(await stock(egg),3); assert.equal(await stock(boiled),9);
const oldItem=(await db.query('select id from public.sale_items where sale_id=$1',[oldSale])).rows[0].id;
await db.exec('set role authenticated');
await db.query("select public.void_cashier_sale_item($1,1,1,'Wrong quantity','')",[oldItem]);
await db.exec('reset role');
assert.equal(await stock(egg),4); assert.equal(await stock(boiled),9,'historical void restores original Egg, not current boiled choice');
await db.query('update public.branch_inventory set quantity_on_hand=0 where branch_id=$1 and product_id=$2',[branch,egg]);
await db.exec('set role authenticated');
const pos=(await db.query('select * from public.list_cashier_pos_inventory()')).rows.find(r=>r.product_id===extra);
assert.equal(Number(pos.variants.find(v=>v.name==='Fried Egg').sellable_quantity),0);
assert.equal(Number(pos.variants.find(v=>v.name==='Boiled Egg').sellable_quantity),9);
await assert.rejects(sale([{product_id:extra,variant_id:friedOption,quantity:1}],20,'empty-fried-stock'),/Insufficient stock/);
await sale([{product_id:extra,variant_id:boiledOption,quantity:1}],20,'boiled-stock-order');
await sale([{product_id:tapa,variant_id:boiledTapa,quantity:1}],108,'boiled-tapa-order');
await db.exec('reset role');
assert.equal(await stock(egg),0); assert.equal(await stock(boiled),7);
assert.equal(await stock(tapa),9); assert.equal(await stock(rice),9,'boiled preparation keeps all meal ingredients');
await db.close();
console.log('Egg migration: atomic guards, preserved history/prices, separate stock, checkout, stale carts and historical void passed.');
