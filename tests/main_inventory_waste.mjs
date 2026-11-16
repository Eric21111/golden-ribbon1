import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth; create table auth.users(id uuid primary key, email text);
  create function auth.uid() returns uuid language sql as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema public, auth to authenticated;
  grant execute on function auth.uid() to authenticated;
`);
for (const file of readdirSync('supabase/migrations').filter((name) => name.endsWith('.sql')).sort()) {
  await db.exec(
    readFileSync(`supabase/migrations/${file}`, 'utf8').replace(/create extension if not exists pgcrypto;/g, ''),
  );
}

const id = (n) => `91200000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1);
const manager = id(2);
const cashier = id(3);
const selling = id(10);
const product = id(20);
const sharedExtra = id(21);
const rice = id(22);

await db.exec(`
  insert into auth.users values ('${owner}','o@test'),('${manager}','m@test'),('${cashier}','c@test');
  insert into public.branches(id,name,code,is_main_branch) values
    ('${id(9)}','Main','MAIN',true),('${selling}','SM1','SM1',false)
  on conflict do nothing;
`);
const main = (await db.query('select id from public.branches where is_main_branch')).rows[0].id;
await db.exec(`
  insert into public.profiles(id,full_name,role,branch_id) values
    ('${owner}','Owner','owner',null),
    ('${manager}','Main Manager','manager','${main}'),
    ('${cashier}','Cashier','cashier','${selling}');
  insert into public.products(id,name,sku,selling_price,inventory_mode,is_active) values
    ('${product}','Chicken','CH',80,'piece_stock',true),
    ('${rice}','Rice','RI',40,'piece_stock',true),
    ('${sharedExtra}','Extra Rice','ER',10,'piece_stock',true);
  insert into public.branch_inventory(branch_id,product_id,quantity_on_hand) values
    ('${main}','${product}',20),
    ('${main}','${rice}',50);
`);

const asUser = async (userId, work) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false);`);
  try {
    return await work();
  } finally {
    await db.exec('reset role');
  }
};

const onHand = async (productId) =>
  Number(
    (
      await db.query(
        'select quantity_on_hand::numeric q from public.branch_inventory where branch_id=$1 and product_id=$2',
        [main, productId],
      )
    ).rows[0].q,
  );

const waste = (userId, args) =>
  asUser(userId, () =>
    db.query('select public.record_main_inventory_waste($1,$2,$3,$4,$5) id', args),
  );

const key = 'main-waste-test-key-001';
const first = await waste(manager, [product, 3, 20, 'Spoiled', key]);
assert.ok(first.rows[0].id);
assert.equal(await onHand(product), 17);

// Idempotent retry
const retry = await waste(manager, [product, 3, 20, 'Spoiled', key]);
assert.equal(retry.rows[0].id, first.rows[0].id);
assert.equal(await onHand(product), 17);
assert.equal(
  Number(
    (
      await db.query(
        `select count(*)::int n from public.inventory_movements
         where branch_stock_action->>'key'=$1`,
        [key],
      )
    ).rows[0].n,
  ),
  1,
);

await assert.rejects(waste(manager, [product, 3, 20, 'Damaged', key]), /Confirmation details changed/);
await assert.rejects(waste(manager, [product, 5, 20, 'Spoiled', 'main-waste-stale-key-01']), /Stock changed/);
await assert.rejects(waste(manager, [product, 100, 17, 'Spoiled', 'main-waste-over-key-01']), /exceeds/);
await assert.rejects(waste(cashier, [product, 1, 17, 'Spoiled', 'main-waste-cash-key-01']), /Main Branch Manager/);
await assert.rejects(waste(owner, [product, 1, 17, 'Spoiled', 'main-waste-own-key-01']), /Main Branch Manager/);

const movement = (
  await db.query(
    `select movement_type::text, quantity::numeric, branch_stock_action
     from public.inventory_movements where branch_stock_action->>'key'=$1`,
    [key],
  )
).rows[0];
assert.equal(movement.movement_type, 'adjustment');
assert.equal(Number(movement.quantity), -3);
assert.equal(movement.branch_stock_action.request.scope, 'main');
assert.equal(movement.branch_stock_action.request.action, 'waste');

// Second waste succeeds with fresh key + expected qty
await waste(manager, [product, 2, 17, 'Expired', 'main-waste-test-key-002']);
const afterSecondWaste = 15;
assert.equal(await onHand(product), afterSecondWaste);

// Leftover receive must not restock Main; Main waste only deducts sellable on-hand.
await db.exec(`
  insert into public.branch_inventory(branch_id,product_id,quantity_on_hand)
  values ('${selling}','${product}',80)
  on conflict (branch_id, product_id) do update set quantity_on_hand = excluded.quantity_on_hand;
`);
const returnId = (
  await asUser(cashier, () =>
    db.query('select public.create_stock_return($1::jsonb,$2,$3) id', [
      JSON.stringify([{ product_id: product, quantity_returned: 10 }]),
      null,
      'main-waste-return-create01',
    ]),
  )
).rows[0].id;
const returnItem = (
  await db.query('select id from public.stock_return_items where stock_return_id=$1', [returnId])
).rows[0];
await asUser(manager, () =>
  db.query('select public.receive_stock_return($1,$2::jsonb,null,$3) status', [
    returnId,
    JSON.stringify([{ stock_return_item_id: returnItem.id, quantity_received: 10 }]),
    'main-waste-return-recv0001',
  ]),
);
assert.equal(await onHand(product), afterSecondWaste, 'receive_stock_return must not restock Main');
assert.equal(
  Number(
    (
      await db.query(
        "select count(*)::int n from public.inventory_movements where reference_id=$1 and movement_type='return_in'",
        [returnId],
      )
    ).rows[0].n,
  ),
  0,
);

await waste(manager, [product, 4, afterSecondWaste, 'Damaged', 'main-waste-after-return-01']);
assert.equal(await onHand(product), afterSecondWaste - 4, 'Main waste deducts only existing Main stock');

const mainWaste = (
  await db.query(
    `select branch_stock_action from public.inventory_movements
     where branch_stock_action->>'key'='main-waste-after-return-01'`,
  )
).rows[0].branch_stock_action;
assert.equal(mainWaste.request.scope, 'main');
assert.equal(mainWaste.request.action, 'waste');
assert.equal(mainWaste.request.shift_id, undefined, 'Main waste has no shift_id; history can query by scope/action');

await db.close();
console.log(
  'main_inventory_waste: deduct once, idempotent, auth, concurrency, audit trail, no return restock — PASS',
);
