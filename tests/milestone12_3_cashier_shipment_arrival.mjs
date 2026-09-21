import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

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
  await db.exec(
    readFileSync(`supabase/migrations/${file}`, 'utf8').replace(
      /create extension if not exists pgcrypto;/g,
      '',
    ),
  );
}

const id = (n) => `15000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1);
const mainManager = id(2);
const manager1 = id(3); // manages counted-mode branch1
const cashier1 = id(4); // assigned to counted-mode branch1
const cashier2 = id(5); // assigned to cashier_confirm-mode branch2
const cashier3 = id(6); // assigned to cashier_confirm-mode branch3 (wrong-branch actor)
const main = id(10);
const branch1 = id(11); // counted (default)
const branch2 = id(12); // cashier_confirm
const branch3 = id(13); // cashier_confirm, but no transfers sent to it
const product = id(20);

await db.exec(`
  insert into auth.users values
    ('${owner}','owner@test'),
    ('${mainManager}','main-manager@test'),
    ('${manager1}','manager-1@test'),
    ('${cashier1}','cashier-1@test'),
    ('${cashier2}','cashier-2@test'),
    ('${cashier3}','cashier-3@test');

  insert into public.branches(id,name,code,is_main_branch,is_active) values
    ('${main}','Main Branch','MAIN123',true,true),
    ('${branch1}','Branch 1','B1-123',false,true),
    ('${branch2}','Branch 2','B2-123',false,true),
    ('${branch3}','Branch 3','B3-123',false,true);

  insert into public.profiles(id,full_name,role,branch_id) values
    ('${owner}','Owner','owner',null),
    ('${mainManager}','Main Manager','manager','${main}'),
    ('${manager1}','Manager 1','manager','${branch1}'),
    ('${cashier1}','Cashier 1','cashier','${branch1}'),
    ('${cashier2}','Cashier 2','cashier','${branch2}'),
    ('${cashier3}','Cashier 3','cashier','${branch3}');

  insert into public.products(id,name,sku,selling_price,is_active) values
    ('${product}','Shipment Product','SHIP123',50,true);
`);

const asUser = async (userId, fn) => {
  await db.exec(
    `set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false);`,
  );
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
  }
};

// -- 1. Default receiving_mode is cashier_confirm for selling branches. --
const modes = (
  await db.query('select id, receiving_mode from public.branches where id in ($1,$2,$3)', [
    branch1, branch2, branch3,
  ])
).rows;
assert.ok(modes.every((row) => row.receiving_mode === 'cashier_confirm'), 'selling branches default to cashier_confirm');

// Setting counted mode is rejected.
await asUser(mainManager, async () => {
  await assert.rejects(
    db.query('select public.set_branch_receiving_mode($1,$2)', [branch1, 'counted']),
    /cashier confirmation/,
  );
});

// Only the Main Branch Manager may set receiving mode.
await asUser(manager1, async () => {
  await assert.rejects(
    db.query('select public.set_branch_receiving_mode($1,$2)', [branch1, 'cashier_confirm']),
    /Main Branch Manager/,
  );
});

await asUser(mainManager, async () => {
  await db.query(
    `select public.initialize_main_branch_inventory('[{"product_id":"${product}","quantity":200}]'::jsonb, 'm12.3 opening stock')`,
  );
});

// ----------------------------------------------------------------------------
// Test 1: manager counted receive is retired — cashier must confirm.
// ----------------------------------------------------------------------------

let counted;
await asUser(mainManager, async () => {
  counted = (
    await db.query(
      `select public.send_stock_transfer($1,'[{"product_id":"${product}","quantity_sent":40,"destination_price":50}]'::jsonb,null,$2) id`,
      [branch1, 'm123-counted-send-key001'],
    )
  ).rows[0].id;
});
assert.equal(
  Number((await db.query('select quantity_on_hand from public.branch_inventory where branch_id=$1 and product_id=$2', [branch1, product])).rows[0]?.quantity_on_hand ?? 0),
  0,
  'sending a transfer must not add destination stock',
);

await asUser(manager1, async () => {
  const items = (await db.query('select id,quantity_sent from public.stock_transfer_items where stock_transfer_id=$1', [counted])).rows;
  await assert.rejects(
    db.query('select public.receive_stock_transfer($1,$2::jsonb,null,$3) status', [
      counted,
      JSON.stringify(items.map((row) => ({ stock_transfer_item_id: row.id, quantity_received: 38 }))),
      'm123-counted-recv-key001',
    ]),
    /cashier confirmation/,
  );
});

await asUser(cashier1, async () => {
  const status = (
    await db.query('select public.confirm_shipment_arrival($1,$2) status', [counted, 'm123-branch1-arrival-key01'])
  ).rows[0].status;
  assert.equal(status, 'received');
});
assert.equal(
  Number((await db.query('select quantity_on_hand from public.branch_inventory where branch_id=$1 and product_id=$2', [branch1, product])).rows[0].quantity_on_hand),
  40,
  'cashier confirmation credits the full sent quantity',
);

// ----------------------------------------------------------------------------
// Test 2: cashier_confirm adds stock once.
// ----------------------------------------------------------------------------

let shipment;
await asUser(mainManager, async () => {
  shipment = (
    await db.query(
      `select public.send_stock_transfer($1,'[{"product_id":"${product}","quantity_sent":25,"destination_price":50}]'::jsonb,null,$2) id`,
      [branch2, 'm123-cashierconf-send-key01'],
    )
  ).rows[0].id;
});

await asUser(cashier2, async () => {
  const pending = (await db.query('select * from public.list_cashier_pending_transfers()')).rows;
  assert.equal(pending.length, 1, 'assigned cashier sees the pending incoming transfer');
  const [row] = pending;
  const items = typeof row.items === 'string' ? JSON.parse(row.items) : row.items;
  assert.equal(items.length, 1);
  assert.equal(Number(items[0].quantity_sent), 25, 'sent items/quantities are shown read-only');

  const status = (
    await db.query('select public.confirm_shipment_arrival($1,$2) status', [shipment, 'm123-arrival-key0000001'])
  ).rows[0].status;
  assert.equal(status, 'received');
});

assert.equal(
  Number((await db.query('select quantity_on_hand from public.branch_inventory where branch_id=$1 and product_id=$2', [branch2, product])).rows[0].quantity_on_hand),
  25,
  'cashier_confirm credits the full sent quantity to branch_inventory',
);
assert.equal(
  Number(
    (
      await db.query(
        `select quantity from public.inventory_movements where branch_id=$1 and product_id=$2 and movement_type='transfer_in' and reference_id=$3`,
        [branch2, product, shipment],
      )
    ).rows[0].quantity,
  ),
  25,
  'a single transfer_in movement is recorded for the confirmed shipment',
);
assert.equal(
  (await db.query('select difference from public.transfer_discrepancies where stock_transfer_id=$1', [shipment])).rows.length,
  0,
  'no discrepancy is ever recorded for cashier_confirm receipt',
);
{
  const row = (await db.query('select received_by, received_at, status from public.stock_transfers where id=$1', [shipment])).rows[0];
  assert.equal(row.status, 'received');
  assert.equal(row.received_by, cashier2, 'received_by is saved as the confirming cashier');
  assert.ok(row.received_at, 'received_at is saved');
}

// confirm_shipment_arrival must not double-add stock — calling again adds nothing.
await asUser(cashier2, async () => {
  // Same key: idempotent replay returns the cached status without re-applying stock.
  const status = (
    await db.query('select public.confirm_shipment_arrival($1,$2) status', [shipment, 'm123-arrival-key0000001'])
  ).rows[0].status;
  assert.equal(status, 'received');
});
assert.equal(
  Number((await db.query('select quantity_on_hand from public.branch_inventory where branch_id=$1 and product_id=$2', [branch2, product])).rows[0].quantity_on_hand),
  25,
  'stock is added exactly once even after a repeated confirmation call',
);

// ----------------------------------------------------------------------------
// Test 3: wrong-branch cashier is rejected.
// ----------------------------------------------------------------------------

let secondShipment;
await asUser(mainManager, async () => {
  secondShipment = (
    await db.query(
      `select public.send_stock_transfer($1,'[{"product_id":"${product}","quantity_sent":10}]'::jsonb,null,$2) id`,
      [branch2, 'm123-cashierconf-send-key02'],
    )
  ).rows[0].id;
});

await asUser(cashier3, async () => {
  // cashier3 is assigned to branch3, not branch2 — this transfer belongs to another branch.
  await assert.rejects(
    db.query('select public.confirm_shipment_arrival($1,$2)', [secondShipment, 'm123-wrongbranch-key001']),
    /belongs to another branch/,
  );
  const pending = (await db.query('select * from public.list_cashier_pending_transfers()')).rows;
  assert.equal(pending.length, 0, 'a cashier only sees pending transfers addressed to their own branch');
});
assert.equal(
  Number((await db.query('select quantity_on_hand from public.branch_inventory where branch_id=$1 and product_id=$2', [branch2, product])).rows[0].quantity_on_hand),
  25,
  'a rejected wrong-branch confirmation does not change destination stock',
);

// ----------------------------------------------------------------------------
// Test 4: duplicate confirmation is rejected (completed transfer, new key).
// ----------------------------------------------------------------------------

await asUser(cashier2, async () => {
  await db.query('select public.confirm_shipment_arrival($1,$2)', [secondShipment, 'm123-second-confirm-key1']);
  await assert.rejects(
    db.query('select public.confirm_shipment_arrival($1,$2)', [secondShipment, 'm123-second-confirm-key2']),
    /already been received|not pending receipt/,
  );
});
assert.equal(
  Number((await db.query('select quantity_on_hand from public.branch_inventory where branch_id=$1 and product_id=$2', [branch2, product])).rows[0].quantity_on_hand),
  35,
  'the completed transfer credited stock exactly once (25 + 10)',
);

// ----------------------------------------------------------------------------
// Test 5: reconciliation variance is zero.
// ----------------------------------------------------------------------------

await asUser(owner, async () => {
  const result = (await db.query('select public.report_inventory_reconciliation() result')).rows[0].result;
  const reconciliation = typeof result === 'string' ? JSON.parse(result) : result;
  assert.ok(
    reconciliation.every((row) => Number(row.variance) === 0),
    'counted and cashier_confirm receiving both keep reconciliation at zero variance',
  );
});

await db.close();
console.log(
  'Milestone 12.3 tests passed: counted mode unchanged, cashier_confirm single-credit arrival, wrong-branch rejection, duplicate-confirmation rejection, and reconciliation.',
);
