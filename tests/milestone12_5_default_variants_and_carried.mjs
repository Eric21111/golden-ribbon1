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

const id = (n) => `17000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1);
const mainManager = id(2);
const manager1 = id(3);
const cashier2 = id(4);
const main = id(10);
const branch1 = id(11);
const branch2 = id(12);
const caldereta = id(20); // will get default variants
const single = id(21); // stays single-priced, pre-carried at branch1 with a custom price

await db.exec(`
  insert into auth.users values
    ('${owner}','owner@test'),
    ('${mainManager}','main-manager@test'),
    ('${manager1}','manager-1@test'),
    ('${cashier2}','cashier-2@test');

  insert into public.branches(id,name,code,is_main_branch,is_active) values
    ('${main}','Main Branch','MAIN125',true,true),
    ('${branch1}','Branch 1','B1-125',false,true),
    ('${branch2}','Branch 2','B2-125',false,true);

  insert into public.profiles(id,full_name,role,branch_id) values
    ('${owner}','Owner','owner',null),
    ('${mainManager}','Main Manager','manager','${main}'),
    ('${manager1}','Manager 1','manager','${branch1}'),
    ('${cashier2}','Cashier 2','cashier','${branch2}');

  insert into public.products(id,name,sku,selling_price,is_active) values
    ('${caldereta}','Buttered Chicken','CALD125',75,true),
    ('${single}','Iced Tea','ICED125',30,true);

  -- Pre-existing (already-carried) branch catalog entry that must be left
  -- alone by any later transfer.
  insert into public.branch_products(branch_id,product_id,selling_price,is_active) values
    ('${branch1}','${single}',45,true);
  insert into public.branch_product_variants(branch_id,product_id,name,selling_price,is_active) values
    ('${branch1}','${single}','Large',55,true);

  -- An inactive, never-had-stock branch product that must remain inactive.
  insert into public.products(id,name,sku,selling_price,is_active) values
    ('${id(22)}','Discontinued Item','DISC125',20,true);
  insert into public.branch_products(branch_id,product_id,selling_price,is_active) values
    ('${branch1}','${id(22)}',20,false);
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

const configureVariants = (productId, variants) =>
  db.query('select public.configure_product_variants($1,$2::jsonb)', [
    productId,
    JSON.stringify(variants),
  ]);

// ----------------------------------------------------------------------------
// Test 1: Main Manager creates a product with variants (default variants).
// ----------------------------------------------------------------------------

await asUser(mainManager, async () => {
  await configureVariants(caldereta, [
    { name: 'With Rice', default_price: 88, is_active: true },
    { name: 'Without Rice', default_price: 60, is_active: true },
  ]);
});

const defaultVariants = (
  await db.query('select name,default_price,is_active from public.product_variants where product_id=$1 order by name', [caldereta])
).rows;
assert.equal(defaultVariants.length, 2, 'default product variants are saved with the product');
assert.equal(Number(defaultVariants.find((v) => v.name === 'With Rice').default_price), 88);
assert.equal(Number(defaultVariants.find((v) => v.name === 'Without Rice').default_price), 60);

// Only the Main Branch Manager may create/edit default variants.
await asUser(manager1, async () => {
  await assert.rejects(
    configureVariants(caldereta, [{ name: 'Hack', default_price: 1, is_active: true }]),
    /Main Branch Manager/,
  );
});
await asUser(owner, async () => {
  await assert.rejects(
    configureVariants(caldereta, [{ name: 'Hack', default_price: 1, is_active: true }]),
    /Main Branch Manager/,
  );
});
// At least one active variant is required.
await asUser(mainManager, async () => {
  await assert.rejects(
    configureVariants(id(23), [{ name: 'Only Inactive', default_price: 1, is_active: false }]),
    /product does not exist|At least one variant must be active/i,
  );
});

await asUser(mainManager, async () => {
  await db.query(
    `select public.initialize_main_branch_inventory('[{"product_id":"${caldereta}","quantity":100},{"product_id":"${single}","quantity":50}]'::jsonb, 'm12.5 opening stock')`,
  );
});

// ----------------------------------------------------------------------------
// Test 2 + 3: first transfer auto-creates an active branch product and
// copies default variants; the new branch product is carried/ON by default.
// ----------------------------------------------------------------------------

let transferId;
await asUser(mainManager, async () => {
  assert.equal(
    Number((await db.query('select count(*) n from public.branch_products where branch_id=$1 and product_id=$2', [branch2, caldereta])).rows[0].n),
    0,
    'no pre-existing branch catalog row for Branch 2',
  );

  transferId = (
    await db.query(
      `select public.send_stock_transfer($1,'[{"product_id":"${caldereta}","quantity_sent":18}]'::jsonb,null,$2) id`,
      [branch2, 'm125-first-transfer-key001'],
    )
  ).rows[0].id;
});

const branch2Catalog = (
  await db.query('select selling_price,is_active from public.branch_products where branch_id=$1 and product_id=$2', [branch2, caldereta])
).rows[0];
assert.equal(branch2Catalog.is_active, true, 'first transfer auto-creates the branch product, carried/ON by default');
assert.equal(Number(branch2Catalog.selling_price), 75, 'auto-created branch product uses the product base price');

const branch2Variants = (
  await db.query('select name,selling_price,is_active from public.branch_product_variants where branch_id=$1 and product_id=$2 order by name', [
    branch2, caldereta,
  ])
).rows;
assert.equal(branch2Variants.length, 2, 'default variants are copied into branch_product_variants on first transfer');
assert.equal(branch2Variants.every((v) => v.is_active === true), true, 'copied variants default active');
assert.equal(Number(branch2Variants.find((v) => v.name === 'With Rice').selling_price), 88, 'copied price equals product_variants.default_price');
assert.equal(Number(branch2Variants.find((v) => v.name === 'Without Rice').selling_price), 60);

// ----------------------------------------------------------------------------
// Test 4: existing inactive branch product stays inactive (no bulk-enable).
// ----------------------------------------------------------------------------

const discontinuedRow = (
  await db.query('select is_active from public.branch_products where branch_id=$1 and product_id=$2', [branch1, id(22)])
).rows[0];
assert.equal(discontinuedRow.is_active, false, 'a pre-existing inactive branch product is not bulk-enabled by this migration');

// ----------------------------------------------------------------------------
// Test 5: existing branch variant prices are not overwritten on a later
// transfer of an already-carried product.
// ----------------------------------------------------------------------------

await asUser(mainManager, async () => {
  await db.query(
    `select public.send_stock_transfer($1,'[{"product_id":"${single}","quantity_sent":5}]'::jsonb,null,$2) id`,
    [branch1, 'm125-existing-transfer-key01'],
  );
});
const preservedCatalog = (
  await db.query('select selling_price from public.branch_products where branch_id=$1 and product_id=$2', [branch1, single])
).rows[0];
assert.equal(Number(preservedCatalog.selling_price), 45, 'an already-carried product keeps its existing branch price after a later transfer');
const preservedVariant = (
  await db.query('select selling_price,is_active from public.branch_product_variants where branch_id=$1 and product_id=$2 and name=$3', [
    branch1, single, 'Large',
  ])
).rows[0];
assert.equal(Number(preservedVariant.selling_price), 55, 'an existing branch variant price is not overwritten by a later transfer');
assert.equal(preservedVariant.is_active, true);

// ----------------------------------------------------------------------------
// Test 6: POS uses the copied variants once stock is received.
// ----------------------------------------------------------------------------

await asUser(cashier2, async () => {
  await db.query('select public.confirm_shipment_arrival($1,$2)', [
    transferId,
    'm125-receive-key000001',
  ]);
});

await asUser(cashier2, async () => {
  const shiftId = (await db.query('select public.start_cashier_shift() id')).rows[0].id;
  const pos = (await db.query('select * from public.list_cashier_pos_inventory()')).rows;
  const row = pos.find((r) => r.product_id === caldereta);
  assert.ok(row, 'the transferred product appears in Branch 2 POS after receipt');
  const variants = typeof row.variants === 'string' ? JSON.parse(row.variants) : row.variants;
  assert.equal(variants.length, 2, 'POS exposes the copied variants');
  const withRice = variants.find((v) => v.name === 'With Rice');
  assert.equal(Number(withRice.selling_price), 88);

  const sale = (
    await db.query(
      'select (public.confirm_sale($1,$2::jsonb,$3,$4)).*',
      [shiftId, JSON.stringify([{ product_id: caldereta, variant_id: withRice.id, quantity: 2 }]), '200.00', 'm125-pos-sale-key0001'],
    )
  ).rows[0];
  assert.equal(Number(sale.total_amount), 176, 'POS checkout uses the copied variant price (2 x 88)');
});

// Reconciliation stays consistent across everything above.
await asUser(owner, async () => {
  const result = (await db.query('select public.report_inventory_reconciliation() result')).rows[0].result;
  const reconciliation = typeof result === 'string' ? JSON.parse(result) : result;
  assert.ok(reconciliation.every((row) => Number(row.variance) === 0), 'reconciliation stays at zero variance');
});

await db.close();
console.log(
  'Milestone 12.5 tests passed: default product variants, transfer-copied variants, carried-by-default new branch products, preserved existing inactive/priced data, and POS using copied variants.',
);
