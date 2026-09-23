import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const setupSource = readFileSync('src/features/inventory/InventorySetupScreen.tsx', 'utf8');
assert.match(setupSource, /Add quantity/);
assert.match(setupSource, /add more units/);
assert.doesNotMatch(setupSource, /Nothing left to set up/);
assert.doesNotMatch(setupSource, /router\.back\(\)/);

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

for (const file of readdirSync('supabase/migrations').filter((name) => name.endsWith('.sql')).sort()) {
  await db.exec(
    readFileSync(`supabase/migrations/${file}`, 'utf8').replace(
      /create extension if not exists pgcrypto;/g,
      '',
    ),
  );
}

const id = (n) => `26000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1);
const mainMgr = id(2);
const sellMgr = id(3);
const cashier = id(4);
const main = id(10);
const branch1 = id(11);
const chicken = id(20);
const extra = id(21);

await db.exec(`
  insert into auth.users values
    ('${owner}','owner@test'),('${mainMgr}','main@test'),
    ('${sellMgr}','sell@test'),('${cashier}','cash@test');
  insert into public.branches(id,name,code,is_main_branch,is_active) values
    ('${main}','Main Branch','MAIN',true,true),
    ('${branch1}','Branch 1','BR-01',false,true);
  insert into public.profiles(id,full_name,role,branch_id) values
    ('${owner}','Owner','owner',null),
    ('${mainMgr}','Main Manager','manager','${main}'),
    ('${sellMgr}','Selling Manager','manager','${branch1}'),
    ('${cashier}','Cashier','cashier','${branch1}');
  insert into public.products(id,name,sku,selling_price,is_active) values
    ('${chicken}','Chicken','CH',80,false),
    ('${extra}','Extra Rice','ER',20,false);
`);

const asUser = async (userId, fn) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false);`);
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
  }
};

const qty = async (branchId, productId) =>
  Number(
    (
      await db.query(
        'select quantity_on_hand from public.branch_inventory where branch_id=$1 and product_id=$2',
        [branchId, productId],
      )
    ).rows[0]?.quantity_on_hand ?? 0,
  );

await asUser(owner, async () => {
  await assert.rejects(
    db.query(`select public.initialize_main_branch_inventory('[{"product_id":"${chicken}","quantity":10}]'::jsonb, null)`),
    /Main Branch Manager/,
  );
});

await asUser(mainMgr, async () => {
  await db.query(
    `select public.initialize_main_branch_inventory('[{"product_id":"${chicken}","quantity":100}]'::jsonb, 'first opening')`,
  );
});
assert.equal(await qty(main, chicken), 100);
assert.equal(
  (await db.query(
    `select is_active from public.products where id='${chicken}'`,
  )).rows[0].is_active,
  true,
  'first opening activates the product',
);

await asUser(cashier, async () => {
  await db.query('select public.start_cashier_shift()');
});

await asUser(sellMgr, async () => {
  await assert.rejects(
    db.query(`select public.initialize_main_branch_inventory('[{"product_id":"${chicken}","quantity":5}]'::jsonb, null)`),
    /Main Branch Manager/,
  );
});

await asUser(mainMgr, async () => {
  await db.query(
    `select public.initialize_main_branch_inventory('[{"product_id":"${chicken}","quantity":25}]'::jsonb, 'after shift restock')`,
  );
});
assert.equal(await qty(main, chicken), 125, 'later opening adds to existing Main Branch stock');

const movements = (
  await db.query(
    `select movement_type, quantity from public.inventory_movements
     where branch_id='${main}' and product_id='${chicken}'
     order by created_at, movement_type`,
  )
).rows;
assert.deepEqual(
  movements.map((row) => ({ type: row.movement_type, qty: Number(row.quantity) })),
  [
    { type: 'opening_stock', qty: 100 },
    { type: 'adjustment', qty: 25 },
  ],
);

await asUser(mainMgr, async () => {
  await db.query(
    `select public.send_stock_transfer($1,'[{"product_id":"${chicken}","quantity_sent":125}]'::jsonb,null,$2)`,
    [branch1, 'repeat-opening-send-all-001'],
  );
  await db.query(
    `select public.initialize_main_branch_inventory('[{"product_id":"${chicken}","quantity":40},{"product_id":"${extra}","quantity":12}]'::jsonb, 'new product plus restock')`,
  );
});

assert.equal(await qty(main, chicken), 40, 'stock can be added again after Main is emptied');
assert.equal(await qty(main, extra), 12, 'a new product still gets a first opening');
assert.equal(
  (await db.query(
    `select movement_type from public.inventory_movements
     where branch_id='${main}' and product_id='${extra}'`,
  )).rows[0].movement_type,
  'opening_stock',
);

await asUser(owner, async () => {
  const result = (await db.query('select public.report_inventory_reconciliation() result')).rows[0].result;
  const reconciliation = typeof result === 'string' ? JSON.parse(result) : result;
  assert.ok(
    reconciliation.every((row) => Number(row.variance) === 0),
    'repeat opening stock keeps reconciliation at zero variance',
  );
});

await db.close();
console.log('repeat opening stock tests passed');
