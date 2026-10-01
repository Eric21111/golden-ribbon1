import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

// Revision 7B: active KG UX removed; historical snapshot formatters remain.
const dashboard = readFileSync('app/(cashier)/cashier/dashboard.tsx', 'utf8');
assert.match(dashboard, /beginCashierShiftClose|useBeginCashierShiftClose|finalizeCashierShiftReconciliation|useFinalizeCashierShiftReconciliation/);
assert.match(dashboard, /Pending remittance|Complete Pending Remittance/);
assert.doesNotMatch(dashboard, /end_cashier_shift/);
assert.doesNotMatch(dashboard, /close_cashier_shift/);

const incoming = readFileSync('app/(cashier)/cashier/incoming.tsx', 'utf8');
assert.doesNotMatch(incoming, /isKgMeal\(/);
assert.match(incoming, /formatSnapshottedQuantity/);

const inventoryStatus = readFileSync('src/features/inventory/inventoryStatus.ts', 'utf8');
assert.doesNotMatch(inventoryStatus, /No KG low-stock threshold has been defined/);

const posInventory = readFileSync('src/features/pos/posInventory.ts', 'utf8');
assert.doesNotMatch(posInventory, /MAX_POS_MEAL_QUANTITY/);

const cartStore = readFileSync('src/stores/cartStore.ts', 'utf8');
assert.doesNotMatch(cartStore, /isKgMeal\(product\.inventory_mode\)/);

const reconScreen = readFileSync('src/features/reports/InventoryReconciliationScreen.tsx', 'utf8');
assert.match(reconScreen, /formatLiveStock/);
assert.doesNotMatch(reconScreen, /formatSnapshottedQuantity/);

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

const id = (n) => `18000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1);
const mainMgr = id(2);
const cashier = id(3);
const main = id(10);
const branch = id(11);
const buttered = id(20);
await db.exec(`
  insert into auth.users values
    ('${owner}','owner@test'),('${mainMgr}','main@test'),('${cashier}','cashier@test');
  insert into public.branches(id,name,code,is_main_branch) values
    ('${main}','Main','MAIN',true),('${branch}','Branch 1','B1',false);
  insert into public.profiles(id,full_name,role,branch_id) values
    ('${owner}','Owner','owner',null),
    ('${mainMgr}','Main Manager','manager','${main}'),
    ('${cashier}','Cashier','cashier','${branch}');
  insert into public.products(id,name,sku,selling_price,is_active) values
    ('${buttered}','Buttered Chicken','BCHK',80,true);
  insert into public.branch_products(branch_id,product_id,selling_price,is_active) values
    ('${branch}','${buttered}',80,true);
  insert into public.branch_inventory(branch_id,product_id,quantity_on_hand) values
    ('${main}','${buttered}',50),('${branch}','${buttered}',0);
`);

const asUser = async (userId, work) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false);`);
  try {
    return await work();
  } finally {
    await db.exec('reset role');
  }
};

// Revision 7A: active kg_meal ops are retired
await asUser(mainMgr, () =>
  assert.rejects(
    db.query('select public.set_product_inventory_mode($1,$2)', [buttered, 'kg_meal']),
    /retired|piece stock/i,
  ),
);

await asUser(mainMgr, () =>
  assert.rejects(
    db.query('select * from public.create_complete_product($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7)', [
      'New KG',
      'NEWKG',
      null,
      '[]',
      '[]',
      '10',
      'kg_meal',
    ]),
    /retired|piece stock/i,
  ),
);

// Cutover snapshot tables exist; PCS send/receive still works.
const tables = (
  await db.query(`
    select table_name from information_schema.tables
    where table_schema='public'
      and table_name in (
        'pcs_cutover_product_snapshots',
        'kg_meal_cutover_balance_snapshots',
        'shift_product_opening_stock',
        'shift_product_reconciliations'
      )
    order by table_name
  `)
).rows.map((r) => r.table_name);
assert.deepEqual(tables, [
  'kg_meal_cutover_balance_snapshots',
  'pcs_cutover_product_snapshots',
  'shift_product_opening_stock',
  'shift_product_reconciliations',
]);

const pcsTransfer = await asUser(mainMgr, () =>
  db.query('select public.send_stock_transfer($1,$2::jsonb,$3,$4) id', [
    branch,
    JSON.stringify([{ product_id: buttered, quantity_sent: '3' }]),
    null,
    'pcs-only-transfer-key1',
  ]),
);
await asUser(cashier, () =>
  db.query('select public.confirm_shipment_arrival($1,$2)', [pcsTransfer.rows[0].id, 'pcs-arrival-key-00001']),
);
const branchQty = (
  await db.query(
    'select quantity_on_hand from public.branch_inventory where branch_id=$1 and product_id=$2',
    [branch, buttered],
  )
).rows[0];
assert.equal(Number(branchQty.quantity_on_hand), 3);

const lineMode = (
  await db.query(
    'select inventory_mode::text as mode from public.stock_transfer_items where stock_transfer_id=$1',
    [pcsTransfer.rows[0].id],
  )
).rows[0].mode;
assert.equal(lineMode, 'piece_stock');

console.log('kg_meal tests updated for Revision 7A retirement + PCS continuity.');
