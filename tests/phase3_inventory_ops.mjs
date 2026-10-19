import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';

const mig = readFileSync('supabase/migrations/20261019140000_phase3_inventory_operations.sql', 'utf8');
const qaMig = readFileSync('supabase/migrations/20261019143000_phase3_inventory_qa.sql', 'utf8');
assert.match(mig, /record_branch_local_purchase/);
assert.match(mig, /is_non_returnable/);
assert.match(mig, /discrepancy_note/);
assert.match(mig, /reference_type = 'local_purchase'|local_purchase/);
assert.match(mig, /KG discrepancy/);
assert.match(mig, /Main-tracked only/);
assert.doesNotMatch(mig, /lower\(name\)\s+in\s*\(\s*'bbq'/i);
assert.doesNotMatch(mig, /like\s+'%drink%'/i);
assert.match(qaMig, /list_cashier_local_purchase_catalog/);
assert.match(qaMig, /never inferred from product name/i);
assert.match(readFileSync('src/services/inventoryService.ts', 'utf8'), /recordBranchLocalPurchase/);
assert.match(readFileSync('src/services/inventoryService.ts', 'utf8'), /listCashierLocalPurchaseCatalog/);
assert.match(readFileSync('src/features/reports/ShiftRemittanceDetailScreen.tsx', 'utf8'), /discrepancy_note/);
assert.match(readFileSync('src/features/pos/pricingPrograms.ts', 'utf8'), /STANDARD_MEAL_VARIANT_NAMES/);
assert.match(readFileSync('src/features/products/CreateProductWizard.tsx', 'utf8'), /NonReturnableField/);
assert.match(readFileSync('src/features/products/EditProductWizard.tsx', 'utf8'), /NonReturnableField/);
assert.match(readFileSync('app/(manager)/manager/products/index.tsx', 'utf8'), /setProductNonReturnable/);
assert.equal(existsSync('app/(cashier)/cashier/local-purchase.tsx'), true);
assert.match(readFileSync('app/(cashier)/cashier/dashboard.tsx', 'utf8'), /local-purchase/);
assert.match(readFileSync('app/(cashier)/_layout.tsx', 'utf8'), /local-purchase/);

const names = readdirSync('supabase/migrations').filter((n) => n.endsWith('.sql')).sort();
assert.ok(
  names.indexOf('20261019120000_phase2_pos_pricing_programs.sql')
    < names.indexOf('20261019140000_phase3_inventory_operations.sql'),
);
assert.ok(
  names.indexOf('20261019140000_phase3_inventory_operations.sql')
    < names.indexOf('20261019143000_phase3_inventory_qa.sql'),
);

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
  await db.exec(
    readFileSync(`supabase/migrations/${file}`, 'utf8').replace(/create extension if not exists pgcrypto;/g, ''),
  );
}

const id = (n) => `20101914-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1);
const mainMgr = id(2);
const cashier = id(3);
const outsider = id(4);
const main = id(10);
const branch = id(11);
const drink = id(20);
const meal = id(21);
const pares = id(22);
const bbq = id(23);

await db.exec(`
  insert into auth.users values
    ('${owner}','o@t'),('${mainMgr}','m@t'),('${cashier}','c@t'),('${outsider}','x@t');
  insert into public.branches(id,name,code,is_main_branch,is_active,receiving_mode) values
    ('${main}','Main','MAIN',true,true,'counted'),
    ('${branch}','Booth','B1',false,true,'cashier_confirm');
  insert into public.profiles(id,full_name,role,branch_id) values
    ('${owner}','Owner','owner',null),
    ('${mainMgr}','Main Mgr','manager','${main}'),
    ('${cashier}','Cashier','cashier','${branch}'),
    ('${outsider}','Other','cashier','${branch}');
  insert into public.products(id,name,sku,selling_price,is_active,inventory_mode,closing_stock_behavior,is_non_returnable) values
    ('${drink}','Bottled Drink','DRINK',20,true,'piece_stock','keep_at_branch',true),
    ('${meal}','Chicken Meal','MEAL',80,true,'piece_stock','record_as_unsold',false),
    ('${pares}','Pares','PARES',90,false,'piece_stock','record_as_unsold',false),
    ('${bbq}','BBQ','BBQ',50,true,'piece_stock','keep_at_branch',true);
  insert into public.branch_products(branch_id,product_id,selling_price,is_active) values
    ('${branch}','${drink}',20,true),('${branch}','${meal}',80,true),('${branch}','${bbq}',50,true);
  insert into public.branch_inventory(branch_id,product_id,quantity_on_hand) values
    ('${main}','${drink}',100),('${main}','${meal}',50),('${main}','${pares}',0),('${main}','${bbq}',40),
    ('${branch}','${drink}',5),('${branch}','${meal}',3),('${branch}','${bbq}',7);
`);

const asUser = async (userId, work) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false);`);
  try {
    return await work();
  } finally {
    await db.exec('reset role');
  }
};

const qty = async (branchId, productId) =>
  Number(
    (
      await db.query(
        `select quantity_on_hand q from public.branch_inventory where branch_id=$1 and product_id=$2`,
        [branchId, productId],
      )
    ).rows[0].q,
  );

// Catalog lists only non-returnable PCS
const catalog = await asUser(cashier, () => db.query('select * from public.list_cashier_local_purchase_catalog()'));
assert.equal(catalog.rows.some((r) => r.product_id === drink), true);
assert.equal(catalog.rows.some((r) => r.product_id === bbq), true);
assert.equal(catalog.rows.some((r) => r.product_id === meal), false);

// Local purchase increases branch stock without touching Main
const purchaseRef = (
  await asUser(cashier, () =>
    db.query('select public.record_branch_local_purchase($1::jsonb,$2,$3) id', [
      JSON.stringify([{ product_id: drink, quantity: '4' }]),
      'Bought at SM',
      'phase3-local-purchase-0001',
    ]),
  )
).rows[0].id;
assert.ok(purchaseRef);
assert.equal(await qty(branch, drink), 9);
assert.equal(await qty(main, drink), 100);

// Idempotent duplicate key returns same ref / no double stock
const purchaseAgain = (
  await asUser(cashier, () =>
    db.query('select public.record_branch_local_purchase($1::jsonb,$2,$3) id', [
      JSON.stringify([{ product_id: drink, quantity: '4' }]),
      'Bought at SM',
      'phase3-local-purchase-0001',
    ]),
  )
).rows[0].id;
assert.equal(purchaseAgain, purchaseRef);
assert.equal(await qty(branch, drink), 9);

// Reject unmarked product
await asUser(cashier, () =>
  assert.rejects(
    () =>
      db.query('select public.record_branch_local_purchase($1::jsonb,$2,$3)', [
        JSON.stringify([{ product_id: meal, quantity: '1' }]),
        null,
        'phase3-local-purchase-meal01',
      ]),
    /non-returnable/i,
  ),
);

// Owner cannot local-purchase
await asUser(owner, () =>
  assert.rejects(
    () =>
      db.query('select public.record_branch_local_purchase($1::jsonb,$2,$3)', [
        JSON.stringify([{ product_id: drink, quantity: '1' }]),
        null,
        'phase3-local-purchase-owner1',
      ]),
    /Unauthorized|cashier or manager/i,
  ),
);

// Transfer still works for drinks (Main decreases, branch increases — no double)
const xfer = (
  await asUser(mainMgr, () =>
    db.query('select public.send_stock_transfer($1,$2::jsonb,$3,$4) id', [
      branch,
      JSON.stringify([{ product_id: drink, quantity_sent: '2' }]),
      null,
      'phase3-drink-transfer-00001',
    ]),
  )
).rows[0].id;
await asUser(cashier, () =>
  db.query('select public.confirm_shipment_arrival($1,$2)', [xfer, 'phase3-drink-arrive-000001']),
);
assert.equal(await qty(branch, drink), 11);
assert.equal(await qty(main, drink), 98);

// Non-returnable excluded from leftover return list / sweep
const returnable = await asUser(cashier, () => db.query('select * from public.list_return_inventory()'));
assert.equal(returnable.rows.some((r) => r.product_id === drink), false);
assert.equal(returnable.rows.some((r) => r.product_id === bbq), false);
assert.equal(returnable.rows.some((r) => r.product_id === meal), true);

const leftover = await asUser(cashier, () =>
  db.query('select public.return_leftover_stock($1,$2) id', ['phase3 leftover', 'phase3-leftover-key-00001']),
);
assert.ok(leftover.rows[0].id);
assert.equal(await qty(branch, drink), 11); // drink stays
assert.equal(await qty(branch, bbq), 7); // BBQ stays
assert.equal(await qty(branch, meal), 0); // meal returned

await asUser(cashier, () =>
  assert.rejects(
    () =>
      db.query('select public.create_stock_return($1::jsonb,$2,$3)', [
        JSON.stringify([{ product_id: drink, quantity_returned: '1' }]),
        null,
        'phase3-return-drink-blocked1',
      ]),
    /non-returnable/i,
  ),
);

// Explicit flag RPC
await asUser(mainMgr, () =>
  db.query('select public.set_product_non_returnable($1,$2)', [meal, true]),
);
const mealFlag = (
  await db.query(`select is_non_returnable f, closing_stock_behavior::text b from public.products where id=$1`, [
    meal,
  ])
).rows[0];
assert.equal(mealFlag.f, true);
assert.equal(mealFlag.b, 'keep_at_branch');
await asUser(mainMgr, () =>
  db.query('select public.set_product_non_returnable($1,$2)', [meal, false]),
);

// KG re-enable (Main) — no automatic PCS conversion of history
await asUser(mainMgr, () =>
  db.query('select public.set_product_inventory_mode($1,$2)', [pares, 'kg_meal']),
);
const paresMode = (
  await db.query(`select inventory_mode::text m from public.products where id=$1`, [pares])
).rows[0].m;
assert.equal(paresMode, 'kg_meal');

await asUser(mainMgr, () =>
  db.query('select public.initialize_main_branch_inventory($1::jsonb,$2)', [
    JSON.stringify([{ product_id: pares, quantity: '12.500' }]),
    'KG opening',
  ]),
);
assert.equal(await qty(main, pares), 12.5);

// KG transfer leaves Main, stays unmeasured at booth (no double sellable stock)
const kgXfer = (
  await asUser(mainMgr, () =>
    db.query('select public.send_stock_transfer($1,$2::jsonb,$3,$4) id', [
      branch,
      JSON.stringify([{ product_id: pares, quantity_sent: '2.250' }]),
      null,
      'phase3-kg-transfer-00000001',
    ]),
  )
).rows[0].id;
await asUser(cashier, () =>
  db.query('select public.confirm_shipment_arrival($1,$2)', [kgXfer, 'phase3-kg-arrive-000000001']),
);
assert.equal(await qty(main, pares), 10.25);
const branchPares = (
  await db.query(
    `select coalesce(quantity_on_hand,0) q from public.branch_inventory where branch_id=$1 and product_id=$2`,
    [branch, pares],
  )
).rows[0];
assert.equal(Number(branchPares?.q ?? 0), 0);

// Local purchase / physical return reject KG with clear messaging
await asUser(cashier, () =>
  assert.rejects(
    () =>
      db.query('select public.record_branch_local_purchase($1::jsonb,$2,$3)', [
        JSON.stringify([{ product_id: pares, quantity: '1' }]),
        null,
        'phase3-local-purchase-kg0001',
      ]),
    /Main-tracked|KG|piece stock/i,
  ),
);
await asUser(cashier, () =>
  assert.rejects(
    () =>
      db.query('select public.create_stock_return($1::jsonb,$2,$3)', [
        JSON.stringify([{ product_id: pares, quantity_returned: '1' }]),
        null,
        'phase3-return-kg-blocked0001',
      ]),
    /Main-tracked|KG/i,
  ),
);

console.log('phase3_inventory_ops: ok');
