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

const id = (n) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1);
const manager = id(2);
const cashier = id(3);
const main = id(10);
const branch = id(11);
const nuggets = id(20);
const inactive = id(21);

await db.exec(`
  insert into auth.users values
    ('${owner}','owner@test'),('${manager}','mgr@test'),('${cashier}','cash@test');
  insert into public.branches(id,name,code,is_main_branch,is_active) values
    ('${main}','Main Branch','MAIN',true,true),
    ('${branch}','Branch 1','BR-01',false,true);
  insert into public.profiles(id,full_name,role,branch_id) values
    ('${owner}','Owner','owner',null),
    ('${manager}','Manager','manager','${branch}'),
    ('${cashier}','Cashier','cashier','${branch}');
  insert into public.products(id,name,sku,selling_price,is_active) values
    ('${nuggets}','Chicken Nuggets','NUG',80,true),
    ('${inactive}','Old Item','OLD',10,false);
  insert into public.branch_products(branch_id,product_id,selling_price,is_active) values
    ('${branch}','${nuggets}',80,true),
    ('${branch}','${inactive}',10,true);
  insert into public.branch_inventory(branch_id,product_id,quantity_on_hand) values
    ('${branch}','${nuggets}',18),
    ('${branch}','${inactive}',40);
`);

const asUser = async (userId, fn) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false);`);
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
  }
};

const source = readFileSync('app/(cashier)/cashier/dashboard.tsx', 'utf8');
assert.match(source, /authoritativePosBranchId/);
assert.match(source, /listCashierPosInventory/);
assert.match(source, /invalidateQueries/);
assert.doesNotMatch(source, /useInventory\(profile\?\.branch/);

await asUser(cashier, async () => {
  const visible = (await db.query('select product_id, quantity_on_hand from public.branch_inventory')).rows;
  assert.equal(visible.length, 0, 'cashier RLS hides branch_inventory before an open shift');

  const catalog = (await db.query('select id from public.products where is_active')).rows;
  const buggy = catalog.map((product) => ({
    product_id: product.id,
    quantity_on_hand: Number(visible.find((row) => row.product_id === product.id)?.quantity_on_hand ?? 0),
  }));
  assert.equal(
    buggy.some((row) => row.quantity_on_hand > 0),
    false,
    'old POS gate treated RLS-hidden stock as all out of stock',
  );

  const pos = (await db.query('select * from public.list_cashier_pos_inventory()')).rows;
  assert.equal(pos.length, 1);
  assert.equal(pos[0].product_id, nuggets);
  assert.equal(pos[0].branch_id, branch);
  assert.equal(Number(pos[0].quantity_on_hand), 18);
  assert.ok(pos.every((row) => row.product_id !== inactive));
});

await asUser(manager, async () => {
  await assert.rejects(db.query('select * from public.list_cashier_pos_inventory()'), /cashier access/);
});

await asUser(owner, async () => {
  await assert.rejects(db.query('select * from public.list_cashier_pos_inventory()'), /cashier access/);
});

await asUser(cashier, async () => {
  const shiftId = (await db.query('select public.start_cashier_shift() id')).rows[0].id;
  const pos = (await db.query('select * from public.list_cashier_pos_inventory()')).rows;
  assert.equal(pos[0].branch_id, branch);
  assert.equal(Number(pos[0].quantity_on_hand), 18);

  await assert.rejects(
    db.query(
      `select public.confirm_sale('${shiftId}','[{"product_id":"${nuggets}","quantity":99}]'::jsonb, 8000, 'oversell-pos-stock-01')`,
    ),
    /insufficient|stock|enough/i,
  );
  assert.equal(
    Number((await db.query(
      `select quantity_on_hand from public.branch_inventory where branch_id='${branch}' and product_id='${nuggets}'`,
    )).rows[0].quantity_on_hand),
    18,
  );
});

console.log('cashier POS stock tests passed');
