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

const id = (n) => `16000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const mainManager = id(2);
const main = id(10);
const branch1 = id(11);
const branch2 = id(12);
const newProduct = id(20); // never assigned to any branch — base price 60
const existingProduct = id(21); // already carried by branch1 at a custom price

await db.exec(`
  insert into auth.users values ('${mainManager}','main-manager@test');
  insert into public.branches(id,name,code,is_main_branch,is_active) values
    ('${main}','Main Branch','MAIN124',true,true),
    ('${branch1}','Branch 1','B1-124',false,true),
    ('${branch2}','Branch 2','B2-124',false,true);
  insert into public.profiles(id,full_name,role,branch_id) values
    ('${mainManager}','Main Manager','manager','${main}');
  insert into public.products(id,name,sku,selling_price,is_active) values
    ('${newProduct}','New Product','NEW124',60,true),
    ('${existingProduct}','Existing Product','EXIST124',80,true);
  insert into public.branch_products(branch_id,product_id,selling_price,is_active) values
    ('${branch1}','${existingProduct}',150,true);
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

await asUser(mainManager, async () => {
  await db.query(
    `select public.initialize_main_branch_inventory('[{"product_id":"${newProduct}","quantity":100},{"product_id":"${existingProduct}","quantity":100}]'::jsonb, 'm12.4 opening stock')`,
  );

  // -- 3. No price input required to send a transfer. --
  const newProductTransfer = (
    await db.query(
      `select public.send_stock_transfer($1,'[{"product_id":"${newProduct}","quantity_sent":10}]'::jsonb,null,$2) id`,
      [branch1, 'm124-newproduct-send-key01'],
    )
  ).rows[0].id;
  assert.ok(newProductTransfer, 'sending a never-carried product succeeds with quantity only, no price field');

  // -- 1. New branch product gets the product's default/base price automatically. --
  const newCatalogRow = (
    await db.query('select selling_price,is_active from public.branch_products where branch_id=$1 and product_id=$2', [branch1, newProduct])
  ).rows[0];
  assert.equal(newCatalogRow.is_active, true, 'transfer auto-creates the destination branch catalog entry');
  assert.equal(Number(newCatalogRow.selling_price), 60, 'new branch product defaults to the product base selling_price (60)');

  // -- 2. Existing branch product keeps its existing branch price. --
  const existingProductTransfer = (
    await db.query(
      `select public.send_stock_transfer($1,'[{"product_id":"${existingProduct}","quantity_sent":5}]'::jsonb,null,$2) id`,
      [branch1, 'm124-existingproduct-send-key01'],
    )
  ).rows[0].id;
  assert.ok(existingProductTransfer);
  const existingCatalogRow = (
    await db.query('select selling_price from public.branch_products where branch_id=$1 and product_id=$2', [branch1, existingProduct])
  ).rows[0];
  assert.equal(
    Number(existingCatalogRow.selling_price),
    150,
    'a product already carried by the branch keeps its existing branch price, unaffected by the product base price (80)',
  );

  // Sending the never-carried product to a second, different branch also
  // defaults to the base price there — confirms it is not copied from
  // branch1's now-custom-priced catalog entry.
  const secondBranchTransfer = (
    await db.query(
      `select public.send_stock_transfer($1,'[{"product_id":"${newProduct}","quantity_sent":4}]'::jsonb,null,$2) id`,
      [branch2, 'm124-newproduct-send-key02'],
    )
  ).rows[0].id;
  assert.ok(secondBranchTransfer);
  const branch2CatalogRow = (
    await db.query('select selling_price from public.branch_products where branch_id=$1 and product_id=$2', [branch2, newProduct])
  ).rows[0];
  assert.equal(Number(branch2CatalogRow.selling_price), 60, 'each new branch defaults independently to the product base price');
});

await db.close();
console.log(
  'Milestone 12.4 tests passed: new branch products default to the base selling_price, existing branch prices are preserved, and no price input is required to send a transfer.',
);
