import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const wizard = readFileSync('src/features/products/EditProductWizard.tsx', 'utf8');
assert.match(wizard, /Same for All/);
assert.match(wizard, /Different per Branch/);
assert.match(wizard, /Save changes/);
assert.match(wizard, /deletedVariantIds/);

const products = readFileSync('app/(manager)/manager/products/index.tsx', 'utf8');
assert.match(products, /EditProductWizard/);
assert.match(products, /useUpdateCompleteProduct/);
assert.match(products, /canActivate=/);
assert.match(products, /Inactive until opening stock/);
assert.doesNotMatch(products, /ProductForm/);

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

const id = (n) => `32000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1);
const mainMgr = id(2);
const cashier = id(3);
const main = id(10);
const sm1 = id(11);
const sm2 = id(12);

await db.exec(`
  insert into auth.users values ('${owner}','o@test'),('${mainMgr}','m@test'),('${cashier}','c@test');
  insert into public.branches(id,name,code,is_main_branch) values
    ('${main}','Main','MAIN',true),('${sm1}','SM1','SM1',false),('${sm2}','SM2','SM2',false);
  insert into public.profiles(id,full_name,role,branch_id) values
    ('${owner}','Owner','owner',null),
    ('${mainMgr}','Main Manager','manager','${main}'),
    ('${cashier}','Cashier','cashier','${sm1}');
`);

const asUser = async (userId, work) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false);`);
  try {
    return await work();
  } finally {
    await db.exec('reset role');
  }
};

// --- Set up a variant product priced on both branches, via create_complete_product ---
const created = await asUser(mainMgr, async () => {
  const result = await db.query(
    `select * from public.create_complete_product($1,$2,$3,$4::jsonb,$5::jsonb,$6)`,
    [
      'Rice Meal',
      'RICE-U',
      'Original description',
      JSON.stringify([
        { name: 'With Rice', default_price: '150' },
        { name: 'Without Rice', default_price: '130' },
      ]),
      JSON.stringify([
        {
          branch_id: sm1,
          variants: [
            { name: 'With Rice', selling_price: '150' },
            { name: 'Without Rice', selling_price: '130' },
          ],
        },
        {
          branch_id: sm2,
          variants: [
            { name: 'With Rice', selling_price: '160' },
            { name: 'Without Rice', selling_price: '140' },
          ],
        },
      ]),
      null,
    ],
  );
  return result.rows[0];
});

const variantsBefore = (await db.query(
  `select id, name, sort_order from public.product_variants where product_id=$1 order by sort_order`,
  [created.id],
)).rows;
const withRiceId = variantsBefore.find((row) => row.name === 'With Rice').id;
const withoutRiceId = variantsBefore.find((row) => row.name === 'Without Rice').id;

// --- Non-authorized roles rejected ---
await asUser(cashier, async () => {
  await assert.rejects(
    () =>
      db.query(`select public.update_complete_product($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9)`, [
        created.id, 'Rice Meal', 'RICE-U', null, false,
        JSON.stringify([{ id: withRiceId, name: 'With Rice', default_price: '150' }]),
        JSON.stringify([]), JSON.stringify([]), null,
      ]),
    /Unauthorized/,
  );
});

// --- Rename product + rename "With Rice" -> "Rice Bowl" + add "Extra Rice" + delete "Without Rice" ---
// + reprice sm1 for the surviving variants, leave sm2 untouched this save.
await asUser(mainMgr, async () => {
  await db.query(`select public.update_complete_product($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9)`, [
    created.id,
    'Rice Meal Deluxe',
    'RICE-U',
    'Updated description',
    false,
    JSON.stringify([
      { id: withRiceId, name: 'Rice Bowl', default_price: '155' },
      { id: null, name: 'Extra Rice', default_price: '20' },
    ]),
    JSON.stringify([withoutRiceId]),
    JSON.stringify([
      {
        branch_id: sm1,
        variants: [
          { name: 'Rice Bowl', selling_price: '155' },
          { name: 'Extra Rice', selling_price: '20' },
        ],
      },
    ]),
    null,
  ]);
});

const productAfter = (await db.query(`select * from public.products where id=$1`, [created.id])).rows[0];
assert.equal(productAfter.name, 'Rice Meal Deluxe');
assert.equal(productAfter.description, 'Updated description');
assert.equal(Number(productAfter.selling_price), 155, 'selling_price follows the renamed sort_order 0 variant');

const variantsAfter = (await db.query(
  `select id, name, default_price, sort_order from public.product_variants where product_id=$1 order by sort_order`,
  [created.id],
)).rows;
assert.equal(variantsAfter.length, 2, 'the deleted variant is gone, the new one was inserted');
assert.equal(variantsAfter[0].id, withRiceId, 'the surviving variant keeps its id after rename');
assert.equal(variantsAfter[0].name, 'Rice Bowl');
assert.equal(Number(variantsAfter[0].default_price), 155);
assert.equal(variantsAfter[1].name, 'Extra Rice');
assert.ok(!variantsAfter.some((row) => row.id === withoutRiceId), 'the deleted variant row is really gone');

// Deletion cascaded to every branch's branch_product_variants, including sm2 (not resaved this time).
const branchVariantsAll = (await db.query(
  `select branch_id, name from public.branch_product_variants where product_id=$1`,
  [created.id],
)).rows;
assert.ok(!branchVariantsAll.some((row) => row.name === 'Without Rice'), 'deleted variant removed from every branch');
assert.ok(
  branchVariantsAll.some((row) => row.branch_id === sm1 && row.name === 'Rice Bowl'),
  'renamed variant carried its branch price forward under the new name',
);

const sm1Variants = branchVariantsAll.filter((row) => row.branch_id === sm1);
assert.equal(sm1Variants.length, 2, 'sm1 has exactly the two surviving/renamed variants');

const sm2Variants = (await db.query(
  `select name, selling_price from public.branch_product_variants where product_id=$1 and branch_id=$2 order by name`,
  [created.id, sm2],
)).rows;
assert.equal(sm2Variants.length, 1, 'sm2 was untouched this save aside from the rename cascade');
assert.equal(sm2Variants[0].name, 'Rice Bowl');
assert.equal(Number(sm2Variants[0].selling_price), 160, 'sm2 price is unchanged since it was not resubmitted');

const sm1Base = (await db.query(
  `select selling_price from public.branch_products where product_id=$1 and branch_id=$2`,
  [created.id, sm1],
)).rows[0];
assert.equal(Number(sm1Base.selling_price), 155, 'branch_products base price follows the sort_order 0 variant');

// --- Incomplete branch pricing (missing a variant price for an included branch) is rejected ---
await asUser(mainMgr, async () => {
  await assert.rejects(
    () =>
      db.query(`select public.update_complete_product($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9)`, [
        created.id, 'Rice Meal Deluxe', 'RICE-U', null, false,
        JSON.stringify([
          { id: withRiceId, name: 'Rice Bowl', default_price: '155' },
          { id: variantsAfter[1].id, name: 'Extra Rice', default_price: '20' },
        ]),
        JSON.stringify([]),
        JSON.stringify([{ branch_id: sm1, variants: [{ name: 'Rice Bowl', selling_price: '155' }] }]),
        null,
      ]),
    /incomplete_branch_pricing/,
  );
});

// --- Activation still gated by opening stock (existing trigger fires regardless of call path) ---
await asUser(mainMgr, async () => {
  await assert.rejects(
    () =>
      db.query(`select public.update_complete_product($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9)`, [
        created.id, 'Rice Meal Deluxe', 'RICE-U', null, true,
        JSON.stringify([
          { id: withRiceId, name: 'Rice Bowl', default_price: '155' },
          { id: variantsAfter[1].id, name: 'Extra Rice', default_price: '20' },
        ]),
        JSON.stringify([]), JSON.stringify([]), null,
      ]),
    /opening stock/,
  );
});
assert.equal(
  (await db.query(`select is_active from public.products where id=$1`, [created.id])).rows[0].is_active,
  false,
  'a rolled-back activation attempt leaves is_active untouched (all-or-nothing)',
);

// --- Deleting every remaining variant drops the product back to single pricing ---
await asUser(mainMgr, async () => {
  await db.query(`select public.update_complete_product($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9)`, [
    created.id, 'Rice Meal Deluxe', 'RICE-U', null, false,
    JSON.stringify([]),
    JSON.stringify([withRiceId, variantsAfter[1].id]),
    JSON.stringify([{ branch_id: sm1, selling_price: '99' }]),
    '90',
  ]);
});
assert.equal(
  (await db.query(`select count(*)::int as n from public.product_variants where product_id=$1`, [created.id])).rows[0].n,
  0,
);
assert.equal(
  Number((await db.query(`select selling_price from public.products where id=$1`, [created.id])).rows[0].selling_price),
  90,
);
assert.equal(
  Number((await db.query(
    `select selling_price from public.branch_products where product_id=$1 and branch_id=$2`,
    [created.id, sm1],
  )).rows[0].selling_price),
  99,
);
assert.equal(
  (await db.query(`select count(*)::int as n from public.branch_product_variants where product_id=$1`, [created.id])).rows[0].n,
  0,
  'no branch_product_variants remain once the product has no variants',
);

// --- Renaming a product to a duplicate SKU/name is still rejected by the existing unique indexes ---
await db.exec(`
  insert into public.products(id,name,sku,selling_price,is_active) values ('${id(90)}','Other Item','OTHER',10,false);
`);
await asUser(mainMgr, async () => {
  await assert.rejects(
    () =>
      db.query(`select public.update_complete_product($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9)`, [
        created.id, 'Rice Meal Deluxe', 'OTHER', null, false, JSON.stringify([]), JSON.stringify([]), JSON.stringify([]), '90',
      ]),
    /products_sku_unique_ci|duplicate key/,
  );
});

await db.close();
console.log('update_complete_product_integrity: ok');
