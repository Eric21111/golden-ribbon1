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

const id = (n) => `18000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const mainManager = id(2);
const main = id(10);
const branch2 = id(12);
const longsilog = id(20);

await db.exec(`
  insert into auth.users values ('${mainManager}','main-manager@test');
  insert into public.branches(id,name,code,is_main_branch,is_active) values
    ('${main}','Main Branch','MAIN126',true,true),
    ('${branch2}','Branch 2','B2-126',false,true);
  insert into public.profiles(id,full_name,role,branch_id) values
    ('${mainManager}','Main Manager','manager','${main}');
  insert into public.products(id,name,sku,selling_price,is_active) values
    ('${longsilog}','Longsilog','LONGSILOG126',80,true);
  insert into public.branch_products(branch_id,product_id,selling_price,is_active) values
    ('${branch2}','${longsilog}',80,true);
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

const productCount = async () => Number((await db.query('select count(*) n from public.products')).rows[0].n);
const skuCount = async () => Number((await db.query("select count(*) n from public.products where sku ilike 'LONGSILOG126%'")).rows[0].n);

const configurePrice = (branchId, price) =>
  db.query('select public.configure_branch_products($1,$2::jsonb)', [
    branchId,
    JSON.stringify([{ product_id: longsilog, selling_price: price, is_active: true }]),
  ]);

const configureVariants = (branchId, variants) =>
  db.query('select public.configure_branch_product_variants($1,$2,$3::jsonb)', [
    branchId,
    longsilog,
    JSON.stringify(variants),
  ]);

// ----------------------------------------------------------------------------
// Test 1 + 2: editing a Branch 2 price updates branch_products only —
// products row count is unchanged, and the branch price updates correctly.
// ----------------------------------------------------------------------------

const baselineProductCount = await productCount();

await asUser(mainManager, async () => {
  await configurePrice(branch2, 95);
});

assert.equal(await productCount(), baselineProductCount, 'editing a branch price does not change the products row count');
const priceAfterFirstEdit = (
  await db.query('select selling_price from public.branch_products where branch_id=$1 and product_id=$2', [branch2, longsilog])
).rows[0];
assert.equal(Number(priceAfterFirstEdit.selling_price), 95, 'branch_products price updates correctly');

// ----------------------------------------------------------------------------
// Test 3: repeated price edits never create another product/SKU.
// ----------------------------------------------------------------------------

await asUser(mainManager, async () => {
  await configurePrice(branch2, 99);
  await configurePrice(branch2, 88);
  await configurePrice(branch2, 101);
});

assert.equal(await productCount(), baselineProductCount, 'repeated branch price edits never create another product row');
assert.equal(await skuCount(), 1, 'repeated branch price edits never generate a new SKU for the same product');
const priceAfterRepeatedEdits = (
  await db.query('select selling_price from public.branch_products where branch_id=$1 and product_id=$2', [branch2, longsilog])
).rows[0];
assert.equal(Number(priceAfterRepeatedEdits.selling_price), 101, 'the latest branch price edit is the one saved');

// ----------------------------------------------------------------------------
// Test 4: variant price edit also does not create a product.
// ----------------------------------------------------------------------------

await asUser(mainManager, async () => {
  await configureVariants(branch2, [
    { name: 'With Rice', selling_price: 88, is_active: true },
    { name: 'Without Rice', selling_price: 60, is_active: true },
  ]);
});
assert.equal(await productCount(), baselineProductCount, 'creating branch variants does not create a product row');

await asUser(mainManager, async () => {
  // Repeated variant price edits, same shape as the reported bug flow.
  await configureVariants(branch2, [
    { name: 'With Rice', selling_price: 92, is_active: true },
    { name: 'Without Rice', selling_price: 65, is_active: true },
  ]);
});
assert.equal(await productCount(), baselineProductCount, 'editing branch variant prices does not create a product row');
const withRicePrice = (
  await db.query(
    'select selling_price from public.branch_product_variants where branch_id=$1 and product_id=$2 and name=$3',
    [branch2, longsilog, 'With Rice'],
  )
).rows[0];
assert.equal(Number(withRicePrice.selling_price), 92, 'branch_product_variants price updates correctly');

// Default (product-level) variant configuration is a separate, product-level
// operation (Main Branch Manager setting default variants) — also must never
// create a product row.
await asUser(mainManager, async () => {
  await db.query('select public.configure_product_variants($1,$2::jsonb)', [
    longsilog,
    JSON.stringify([{ name: 'With Rice', default_price: 88, is_active: true }]),
  ]);
});
assert.equal(await productCount(), baselineProductCount, 'configuring default product variants does not create a product row');

// ----------------------------------------------------------------------------
// Bonus regression: the new products_name_unique_ci guard rejects a second
// base product sharing an existing product's name — the actual mechanism
// that produced the observed "Longsilog" / "Longsilog-2" duplicate live.
// ----------------------------------------------------------------------------

await asUser(mainManager, async () => {
  await assert.rejects(
    db.exec(`insert into public.products(name,sku,selling_price) values ('Longsilog','LONGSILOG126-DUPE',80)`),
    /products_name_unique_ci|duplicate key/i,
    'a second base product with the same name (case/whitespace-insensitive) is rejected',
  );
  await assert.rejects(
    db.exec(`insert into public.products(name,sku,selling_price) values ('  longsilog  ','LONGSILOG126-DUPE2',80)`),
    /products_name_unique_ci|duplicate key/i,
    'the name check is case- and whitespace-insensitive',
  );
});
assert.equal(await productCount(), baselineProductCount, 'rejected duplicate-name inserts do not create a product row');

await db.close();
console.log(
  'Milestone 12.6 tests passed: branch price edits never create a product/SKU, repeated edits are safe, variant price edits (branch and default) never create a product, and duplicate product names are now rejected.',
);
