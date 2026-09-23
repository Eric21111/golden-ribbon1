import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const form = readFileSync('src/features/products/ProductForm.tsx', 'utf8');
assert.doesNotMatch(form, /Default\/base price|Pricing type|Single price/);
assert.match(form, /Selling branch price/);
assert.match(form, /canActivate/);
assert.match(form, /Price lives on the selling-branch catalog/);

const branches = readFileSync('src/features/branches/BranchForm.tsx', 'utf8');
assert.match(branches, /protectMainBranch \|\| isMainBranch \? null/);

const products = readFileSync('app/(manager)/manager/products/index.tsx', 'utf8');
assert.match(products, /Inactive until opening stock/);
assert.match(products, /canActivate=/);

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
const product = id(20);

await db.exec(`
  insert into auth.users values ('${owner}','o@test'),('${mainMgr}','m@test');
  insert into public.branches(id,name,code,is_main_branch) values ('${main}','Main','MAIN',true);
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
assert.equal(
  Number(
    (await db.query(
      `select quantity_on_hand from public.branch_inventory where branch_id='${main}' and product_id='${product}'`,
    )).rows[0].quantity_on_hand,
  ),
  12,
);

await db.close();
console.log('Product active-after-opening tests passed: no base price/type, Main Active hidden, SQL gate works.');
