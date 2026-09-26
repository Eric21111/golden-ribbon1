import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const wizard = readFileSync('src/features/products/CreateProductWizard.tsx', 'utf8');
assert.doesNotMatch(wizard, /Pricing is optional/);
// Variants step collects names only — no manual default/base price entry.
assert.doesNotMatch(wizard, /Default \/ base price/);
assert.doesNotMatch(wizard, /Default variant name/);
assert.match(wizard, /Same for All/);
assert.match(wizard, /Different per Branch/);

const products = readFileSync('app/(manager)/manager/products/index.tsx', 'utf8');
assert.match(products, /tryBeginSubmit/);
assert.match(products, /useCreateCompleteProduct/);
assert.match(products, /useProductSkus/);
assert.doesNotMatch(products, /Math\.min/);

const lockSrc = readFileSync('src/lib/submitLock.ts', 'utf8');
assert.match(lockSrc, /if \(lock\.current\) return false/);

function tryBeginSubmit(lock) {
  if (lock.current) return false;
  lock.current = true;
  return true;
}
function endSubmit(lock) {
  lock.current = false;
}
const lock = { current: false };
assert.equal(tryBeginSubmit(lock), true);
assert.equal(tryBeginSubmit(lock), false);
endSubmit(lock);
assert.equal(tryBeginSubmit(lock), true);

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

const id = (n) => `31000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1);
const mainMgr = id(2);
const main = id(10);
const sm1 = id(11);
const sm2 = id(12);

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

const created = await asUser(mainMgr, async () => {
  const result = await db.query(
    `select * from public.create_complete_product($1,$2,$3,$4::jsonb,$5::jsonb,$6)`,
    [
      'Rice Meal A',
      'RICE-A',
      '',
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

assert.equal(Number(created.selling_price), 150);
assert.equal(created.is_active, false);
assert.equal(created.sku, 'RICE-A');

const variantsA = (await db.query(
  `select name, default_price, sort_order from public.product_variants where product_id=$1 order by sort_order`,
  [created.id],
)).rows;
assert.equal(variantsA.length, 2);
assert.equal(variantsA[0].name, 'With Rice');
assert.equal(Number(variantsA[0].default_price), 150);
assert.equal(variantsA[0].sort_order, 0);
assert.equal(variantsA[1].name, 'Without Rice');
assert.equal(Number(variantsA[1].default_price), 130);

const sm1Base = (await db.query(
  `select selling_price from public.branch_products where product_id=$1 and branch_id=$2`,
  [created.id, sm1],
)).rows[0];
assert.equal(Number(sm1Base.selling_price), 150);

const sm1Vars = (await db.query(
  `select name, selling_price from public.branch_product_variants where product_id=$1 and branch_id=$2 order by name`,
  [created.id, sm1],
)).rows;
assert.equal(Number(sm1Vars.find((row) => row.name === 'With Rice').selling_price), 150);
assert.equal(Number(sm1Vars.find((row) => row.name === 'Without Rice').selling_price), 130);

const beforeC = (await db.query(`select count(*)::int as n from public.products`)).rows[0].n;
await asUser(mainMgr, async () => {
  await assert.rejects(
    () =>
      db.query(`select public.create_complete_product($1,$2,$3,$4::jsonb,$5::jsonb,$6)`, [
        'Rice Meal C',
        'RICE-C',
        '',
        JSON.stringify([
          { name: 'With Rice', default_price: '150' },
          { name: 'Without Rice', default_price: '130' },
        ]),
        JSON.stringify([
          {
            branch_id: sm1,
            variants: [{ name: 'With Rice', selling_price: '150' }],
          },
        ]),
        null,
      ]),
    /incomplete_branch_pricing/,
  );
});
assert.equal((await db.query(`select count(*)::int as n from public.products`)).rows[0].n, beforeC);

await asUser(mainMgr, async () => {
  await assert.rejects(
    () =>
      db.query(`select public.create_complete_product($1,$2,$3,$4::jsonb,$5::jsonb,$6)`, [
        'Rice Meal D',
        'RICE-D',
        '',
        JSON.stringify([{ name: 'With Rice', default_price: '' }]),
        JSON.stringify([]),
        null,
      ]),
    /invalid_product_price/,
  );
});
assert.equal((await db.query(`select count(*)::int as n from public.products where sku='RICE-D'`)).rows[0].n, 0);

const missingBranch = '31000000-0000-4000-8000-000000000099';
const beforeE = (await db.query(`select count(*)::int as n from public.products`)).rows[0].n;
await asUser(mainMgr, async () => {
  await assert.rejects(
    () =>
      db.query(`select public.create_complete_product($1,$2,$3,$4::jsonb,$5::jsonb,$6)`, [
        'Rice Meal E',
        'RICE-E',
        '',
        JSON.stringify([{ name: 'With Rice', default_price: '150' }]),
        JSON.stringify([{ branch_id: missingBranch, variants: [{ name: 'With Rice', selling_price: '150' }] }]),
        null,
      ]),
    /invalid_branch/,
  );
});
assert.equal((await db.query(`select count(*)::int as n from public.products`)).rows[0].n, beforeE);

await asUser(mainMgr, async () => {
  await assert.rejects(
    () =>
      db.query(`select public.create_complete_product($1,$2,$3,$4::jsonb,$5::jsonb,$6)`, [
        'Rice Meal F',
        'RICE-A',
        '',
        JSON.stringify([{ name: 'With Rice', default_price: '150' }]),
        JSON.stringify([]),
        null,
      ]),
    /products_sku_unique_ci|duplicate key/,
  );
});

const beforeH = (await db.query(`select count(*)::int as n from public.products`)).rows[0].n;
await asUser(mainMgr, async () => {
  await assert.rejects(
    () =>
      db.query(`select public.create_complete_product($1,$2,$3,$4::jsonb,$5::jsonb,$6)`, [
        'Rice Meal H',
        'RICE-H',
        '',
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
              { name: 'Large', selling_price: '180' },
            ],
          },
        ]),
        null,
      ]),
    /incomplete_branch_pricing/,
  );
});
assert.equal((await db.query(`select count(*)::int as n from public.products`)).rows[0].n, beforeH);

const defaultVariant = (await db.query(
  `select id, name, default_price from public.product_variants where product_id=$1 and sort_order=0`,
  [created.id],
)).rows[0];
const otherVariant = (await db.query(
  `select id, name from public.product_variants where product_id=$1 and sort_order=1`,
  [created.id],
)).rows[0];
const sm1DefaultBranch = (await db.query(
  `select id, name, selling_price from public.branch_product_variants
   where product_id=$1 and branch_id=$2 and name='With Rice'`,
  [created.id, sm1],
)).rows[0];
const sm2DefaultBranch = (await db.query(
  `select id, name from public.branch_product_variants
   where product_id=$1 and branch_id=$2 and name='With Rice'`,
  [created.id, sm2],
)).rows[0];

await asUser(mainMgr, async () => {
  await db.query(`select public.update_product_variant($1,$2,$3)`, [
    defaultVariant.id,
    'Rice Meal',
    '160',
  ]);
});

const renamed = (await db.query(`select id, name, default_price from public.product_variants where id=$1`, [
  defaultVariant.id,
])).rows[0];
assert.equal(renamed.id, defaultVariant.id);
assert.equal(renamed.name, 'Rice Meal');
assert.equal(Number(renamed.default_price), 160);
assert.equal(
  Number((await db.query(`select selling_price from public.products where id=$1`, [created.id])).rows[0].selling_price),
  160,
);
const sm1Renamed = (await db.query(
  `select id, name from public.branch_product_variants where id=$1`,
  [sm1DefaultBranch.id],
)).rows[0];
assert.equal(sm1Renamed.id, sm1DefaultBranch.id);
assert.equal(sm1Renamed.name, 'Rice Meal');
assert.equal(
  (await db.query(`select name from public.branch_product_variants where id=$1`, [sm2DefaultBranch.id])).rows[0].name,
  'Rice Meal',
);
assert.equal(
  (await db.query(`select name from public.product_variants where id=$1`, [otherVariant.id])).rows[0].name,
  'Without Rice',
);

await asUser(mainMgr, async () => {
  await db.query(`select public.update_branch_product_variant_price($1,$2)`, [sm1DefaultBranch.id, '165']);
});
assert.equal(
  Number(
    (await db.query(`select selling_price from public.branch_product_variants where id=$1`, [sm1DefaultBranch.id]))
      .rows[0].selling_price,
  ),
  165,
);
assert.equal(
  Number(
    (await db.query(`select selling_price from public.branch_products where product_id=$1 and branch_id=$2`, [
      created.id,
      sm1,
    ])).rows[0].selling_price,
  ),
  165,
);

const reversed = await asUser(mainMgr, async () => {
  const result = await db.query(
    `select * from public.create_complete_product($1,$2,$3,$4::jsonb,$5::jsonb,$6)`,
    [
      'Rice Meal K',
      'RICE-K',
      '',
      JSON.stringify([
        { name: 'With Rice', default_price: '150' },
        { name: 'Without Rice', default_price: '130' },
      ]),
      JSON.stringify([
        {
          branch_id: sm1,
          variants: [
            { name: 'Without Rice', selling_price: '135' },
            { name: 'With Rice', selling_price: '155' },
          ],
        },
      ]),
      null,
    ],
  );
  return result.rows[0];
});
assert.equal(Number(reversed.selling_price), 150);
assert.equal(
  Number(
    (await db.query(`select selling_price from public.branch_products where product_id=$1 and branch_id=$2`, [
      reversed.id,
      sm1,
    ])).rows[0].selling_price,
  ),
  155,
);
const reversedVars = (await db.query(
  `select name, selling_price from public.branch_product_variants where product_id=$1 and branch_id=$2`,
  [reversed.id, sm1],
)).rows;
assert.equal(Number(reversedVars.find((row) => row.name === 'With Rice').selling_price), 155);
assert.equal(Number(reversedVars.find((row) => row.name === 'Without Rice').selling_price), 135);

console.log('create_product_integrity: ok');
