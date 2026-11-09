// A cashier's Local purchase and Create return lists show ONLY that cashier's branch: the on-hand number is the cashier's branch's
// balance, never another selling branch's and never Main's, and a product that is not enabled at the cashier's branch is not listed.
// Real PGlite database with every migration, TWO selling branches and Main, all holding different quantities of the same products.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const names = readdirSync('supabase/migrations').filter((n) => n.endsWith('.sql')).sort();
const { PGlite } = await import('@electric-sql/pglite');
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
for (const file of names) {
  await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8').replace(/create extension if not exists pgcrypto;/g, ''));
}

const id = (n) => `20111111-0000-4000-8000-${String(n).padStart(12, '0')}`;
const [mainMgr, cashier1, cashier2] = [id(2), id(3), id(4)];
const [main, sm1, sm2] = [id(10), id(11), id(12)];
const [water, coke, cheese, onlySm2, meal] = [id(20), id(21), id(22), id(23), id(24)];

await db.exec(`
  insert into auth.users values ('${mainMgr}','m@t'),('${cashier1}','c1@t'),('${cashier2}','c2@t');
  insert into public.branches(id,name,code,is_main_branch,is_active,receiving_mode) values
    ('${main}','Main','MAIN',true,true,'counted'),
    ('${sm1}','SM 1','SM1',false,true,'cashier_confirm'),
    ('${sm2}','SM 2','SM2',false,true,'cashier_confirm');
  insert into public.profiles(id,full_name,role,branch_id) values
    ('${mainMgr}','Main Mgr','manager','${main}'),
    ('${cashier1}','Cashier 1','cashier','${sm1}'),
    ('${cashier2}','Cashier 2','cashier','${sm2}');
  insert into public.products(id,name,sku,selling_price,is_active,inventory_mode,closing_stock_behavior,is_non_returnable) values
    ('${water}','Bottled Water','WATER',20,true,'piece_stock','keep_at_branch',true),
    ('${coke}','Coke Mismo','COKE',55,true,'piece_stock','keep_at_branch',true),
    ('${cheese}','Cheesestick','CHEESE',30,true,'piece_stock','keep_at_branch',true),
    ('${onlySm2}','SM2 Only Drink','ONLY2',25,true,'piece_stock','keep_at_branch',true),
    ('${meal}','Chicken Meal','MEAL',80,true,'piece_stock','record_as_unsold',false);
  -- enabled at SM 1: water, coke, cheese, meal.  enabled at SM 2: water, coke, only-SM2 drink, meal.
  insert into public.branch_products(branch_id,product_id,selling_price,is_active) values
    ('${sm1}','${water}',20,true),('${sm1}','${coke}',55,true),('${sm1}','${cheese}',30,true),('${sm1}','${meal}',80,true),
    ('${sm2}','${water}',20,true),('${sm2}','${coke}',55,true),('${sm2}','${onlySm2}',25,true),('${sm2}','${meal}',80,true);
  -- the same products hold very different quantities at each place
  insert into public.branch_inventory(branch_id,product_id,quantity_on_hand) values
    ('${main}','${water}',1000),('${main}','${coke}',2000),('${main}','${cheese}',3000),('${main}','${meal}',4000),
    ('${sm1}','${water}',57),('${sm1}','${coke}',48),('${sm1}','${cheese}',2),('${sm1}','${meal}',9),
    ('${sm2}','${water}',500),('${sm2}','${coke}',600),('${sm2}','${onlySm2}',700),('${sm2}','${meal}',800);
`);

const asUser = async (userId, work) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false);`);
  try {
    return await work();
  } finally {
    await db.exec('reset role');
  }
};
const catalog = async (userId) =>
  Object.fromEntries((await asUser(userId, () => db.query('select product_name, quantity_on_hand from public.list_cashier_local_purchase_catalog()'))).rows.map((r) => [r.product_name, Number(r.quantity_on_hand)]));
const returns = async (userId) =>
  Object.fromEntries((await asUser(userId, () => db.query('select product_name, quantity_on_hand from public.list_return_inventory()'))).rows.map((r) => [r.product_name, Number(r.quantity_on_hand)]));
const stock = async (branch, product) => Number((await db.query('select quantity_on_hand q from public.branch_inventory where branch_id=$1 and product_id=$2', [branch, product])).rows[0]?.q ?? 0);

// ---------------------------------------------------------------- 1. Local purchase: each cashier sees only their branch
{
  assert.deepEqual(await catalog(cashier1), { 'Bottled Water': 57, 'Coke Mismo': 48, Cheesestick: 2 }, 'SM 1: SM 1 quantities only (not SM 2\'s 500/600, not Main\'s 1000/2000/3000), only what is enabled at SM 1');
  assert.deepEqual(await catalog(cashier2), { 'Bottled Water': 500, 'Coke Mismo': 600, 'SM2 Only Drink': 700 }, 'SM 2: its own quantities, its own products');
  // a product enabled here but never counted here reads 0, not another branch's number
  await db.exec(`delete from public.branch_inventory where branch_id='${sm1}' and product_id='${cheese}'`);
  assert.equal((await catalog(cashier1)).Cheesestick, 0);
  await db.exec(`insert into public.branch_inventory(branch_id,product_id,quantity_on_hand) values ('${sm1}','${cheese}',2)`);
  console.log('1. local purchase list: ok');
}

// ---------------------------------------------------------------- 2. Recording a purchase touches only the cashier's own branch
{
  const before = { main: await stock(main, water), sm2: await stock(sm2, water) };
  await asUser(cashier1, () => db.query('select public.record_branch_local_purchase($1::jsonb,$2,$3)', [JSON.stringify([{ product_id: water, quantity: '3' }]), null, 'scope-local-purchase-0001']));
  assert.equal(await stock(sm1, water), 60, 'SM 1 +3');
  assert.equal(await stock(main, water), before.main, 'Main unchanged');
  assert.equal(await stock(sm2, water), before.sm2, 'SM 2 unchanged');
  assert.equal((await catalog(cashier1))['Bottled Water'], 60);
  assert.equal((await catalog(cashier2))['Bottled Water'], 500);
  // even a request for a product that SM 2 has and SM 1 does not (the app never offers it) only ever writes to the caller's branch
  const sm2Before = await stock(sm2, onlySm2);
  const mainBefore = await stock(main, onlySm2);
  await asUser(cashier1, () => db.query('select public.record_branch_local_purchase($1::jsonb,$2,$3)', [JSON.stringify([{ product_id: onlySm2, quantity: '1' }]), null, 'scope-local-purchase-0002']));
  assert.equal(await stock(sm2, onlySm2), sm2Before, 'SM 2\'s balance is never touched by SM 1\'s cashier');
  assert.equal(await stock(main, onlySm2), mainBefore, 'nor Main\'s');
  assert.deepEqual(await catalog(cashier2), { 'Bottled Water': 500, 'Coke Mismo': 600, 'SM2 Only Drink': 700 }, 'and SM 2 still reads its own numbers');
  console.log('2. recording a purchase: ok');
}

// ---------------------------------------------------------------- 3. Create return: the same scope (only the cashier's branch, only returnable products)
{
  assert.deepEqual(await returns(cashier1), { 'Chicken Meal': 9 }, 'SM 1: its own 9, not SM 2\'s 800 or Main\'s 4000; Keep-Unsold products never listed');
  assert.deepEqual(await returns(cashier2), { 'Chicken Meal': 800 });
  console.log('3. return list: ok');
}

console.log('local_purchase_branch_scope: ALL PASS');
