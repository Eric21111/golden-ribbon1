import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const form = readFileSync('src/features/products/ProductForm.tsx', 'utf8');
assert.doesNotMatch(form, /Default\/base price|Pricing type|Single price/);
assert.match(form, /Selling branch price/);
assert.match(form, /canActivate/);
assert.match(form, /Variant price \(PHP\)/);
assert.match(form, /branchPriceDrafts/);
assert.match(form, /Switching branches keeps the price/);
assert.match(form, /catalogDrafts/);

const products = readFileSync('app/(manager)/manager/products/index.tsx', 'utf8');
assert.match(products, /Inactive until opening stock/);
assert.match(products, /canActivate=/);
assert.match(products, /createCompleteProduct|useCreateCompleteProduct/);
assert.match(products, /tryBeginSubmit/);
assert.match(products, /update_branch_product_variant_price|useUpdateBranchProductVariantPrice/);

const branches = readFileSync('src/features/branches/BranchForm.tsx', 'utf8');
assert.match(branches, /protectMainBranch \|\| isMainBranch \? null/);

const errors = readFileSync('src/lib/errors.ts', 'utf8');
assert.match(errors, /Each variant needs a name and a price/);
assert.match(errors, /Each selling branch needs a valid price/);

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
    readFileSync(`supabase/migrations/${file}`, 'utf8').replace(/create extension if not exists pgcrypto;/g, ''),
  );
}

const id = (n) => `29000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1);
const mainMgr = id(2);
const main = id(10);
const sm1 = id(11);
const sm2 = id(12);
const product = id(20);
const created = id(21);

await db.exec(`
  insert into auth.users values ('${owner}','o@test'),('${mainMgr}','m@test');
  insert into public.branches(id,name,code,is_main_branch) values
    ('${main}','Main','MAIN',true),('${sm1}','SM1','SM1',false),('${sm2}','SM2','SM2',false);
  insert into public.profiles(id,full_name,role,branch_id) values
    ('${owner}','Owner','owner',null),('${mainMgr}','Main Manager','manager','${main}');
`);

const asUser = async (userId, work) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false);`);
  try {
    return await work();
  } finally {
    await db.exec('reset role');
  }
};

await db.exec(
  `insert into public.products(id,name,sku,selling_price,is_active) values ('${product}','Chicken','CH',0,false)`,
);
await assert.rejects(
  db.exec(`update public.products set is_active=true where id='${product}'`),
  /opening stock/,
);
await asUser(mainMgr, async () => {
  await db.query(
    `select public.initialize_main_branch_inventory('[{"product_id":"${product}","quantity":12}]'::jsonb, 'open')`,
  );
});

assert.equal(
  (await db.query(`select is_active, selling_price from public.products where id='${product}'`)).rows[0].is_active,
  true,
);

await asUser(mainMgr, async () => {
  await db.exec(
    `insert into public.products(id,name,sku,selling_price,is_active)
     values ('${created}','Buffalo','BUF',70,false)`,
  );
  await db.query(`select public.configure_product_variants($1, $2::jsonb)`, [
    created,
    JSON.stringify([
      { name: 'With Rice', default_price: '80.00', is_active: true },
      { name: 'W/o Rice', default_price: '70.00', is_active: true },
    ]),
  ]);
  await db.query(`select public.configure_branch_products($1, $2::jsonb)`, [
    sm1,
    JSON.stringify([{ product_id: created, selling_price: '70.00', is_active: true }]),
  ]);
  await db.query(`select public.configure_branch_products($1, $2::jsonb)`, [
    sm2,
    JSON.stringify([{ product_id: created, selling_price: '88.00', is_active: true }]),
  ]);
  await db.query(`select public.configure_branch_product_variants($1, $2, $3::jsonb)`, [
    sm1,
    created,
    JSON.stringify([
      { name: 'With Rice', selling_price: '80.00', is_active: true },
      { name: 'W/o Rice', selling_price: '70.00', is_active: true },
    ]),
  ]);
  await db.query(`select public.configure_branch_product_variants($1, $2, $3::jsonb)`, [
    sm2,
    created,
    JSON.stringify([
      { name: 'With Rice', selling_price: '80.00', is_active: true },
      { name: 'W/o Rice', selling_price: '70.00', is_active: true },
    ]),
  ]);
});

const catalogs = (
  await db.query(
    `select branch_id, selling_price from public.branch_products where product_id=$1 order by branch_id`,
    [created],
  )
).rows;
assert.equal(catalogs.length, 2);
assert.equal(Number(catalogs.find((row) => row.branch_id === sm1).selling_price), 70);
assert.equal(Number(catalogs.find((row) => row.branch_id === sm2).selling_price), 88);

const variants = (
  await db.query(
    `select name, selling_price from public.branch_product_variants where product_id=$1 and branch_id=$2 order by name`,
    [created, sm1],
  )
).rows;
assert.equal(variants.length, 2);
assert.equal(variants[0].name, 'W/o Rice');
assert.equal(Number(variants[0].selling_price), 70);
assert.equal(variants[1].name, 'With Rice');
assert.equal(Number(variants[1].selling_price), 80);

assert.equal(
  (await db.query(`select is_active from public.products where id='${created}'`)).rows[0].is_active,
  false,
);

await db.close();
console.log('Product create tests passed: variant prices, both branch catalogs, active only after opening.');
