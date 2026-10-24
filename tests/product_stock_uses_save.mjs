// Shared inventory, Step 3: create_complete_product / update_complete_product save Stock Used Per Order.
// Runs every migration in PGlite. (PGlite is a single connection: real multi-session locking is NOT proven here.)
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const MIGRATION = '20261023110000_save_product_stock_uses.sql';
const migrationSrc = readFileSync(`supabase/migrations/${MIGRATION}`, 'utf8');
const code = migrationSrc.replace(/--[^\n]*/g, '');

// ---------------------------------------------------------------- 0. static: additive, scoped, locking design
{
  assert.doesNotMatch(code, /confirm_sale/i, 'confirm_sale is not touched');
  assert.doesNotMatch(code, /\balter table\b|\bcreate (unique )?index\b|\bcreate table\b|\bdrop table\b|\bdrop column\b/i);
  assert.equal((code.match(/drop function if exists/gi) ?? []).length, 2, 'only the two product RPCs are replaced');
  assert.equal((code.match(/create function public\./gi) ?? []).length, 2);
  assert.match(code, /create or replace function public\.normalize_product_stock_uses/);
  assert.match(code, /create or replace function public\.apply_product_stock_uses/);
  // one optional trailing parameter; everything before it is the old signature
  assert.match(code, /p_closing_stock_behavior text default 'keep_at_branch',\s*p_stock_uses jsonb default null\s*\)/);
  assert.match(code, /p_closing_stock_behavior text default null,\s*p_stock_uses jsonb default null\s*\)/);
  // validation runs before any write; the write runs after variants are final
  assert.ok(code.indexOf('v_stock_uses := public.normalize_product_stock_uses(p_stock_uses);') < code.indexOf("insert into public.products("), 'create: validated first');
  assert.ok(code.indexOf('perform public.apply_product_stock_uses(p_product_id, v_stock_uses);') > code.indexOf('delete from public.product_variants where id = v_deleted_id;'), 'update: after variant deletes');
  assert.ok(code.indexOf('perform public.apply_product_stock_uses(p_product_id, v_stock_uses);') > code.indexOf('insert into public.product_variants('), 'update: after variant inserts');
  // serialisation: the product row is locked FOR UPDATE by the update RPC and again by the helper; ingredients are key-shared in id order
  assert.match(code, /select \* into v_product from public\.products where id = p_product_id for update;/);
  assert.match(code, /perform 1 from public\.products where id = p_product_id for update;/);
  assert.match(code, /order by p\.id\s+for key share;/);
  // internal helpers are not callable by API roles
  assert.match(code, /revoke all on function public\.normalize_product_stock_uses\(jsonb\) from public, anon, authenticated;/);
  assert.match(code, /revoke all on function public\.apply_product_stock_uses\(uuid, jsonb\) from public, anon, authenticated;/);
  // later migrations may redefine confirm_sale (the variant mapping fix does) but must not touch the product RPCs again unnoticed
  // (the one known follow-up is Drink Choice, which adds p_drink_choices and has its own tests)
  const KNOWN_FOLLOW_UPS = ['20261024100000_save_product_drink_choices.sql'];
  for (const later of readdirSync('supabase/migrations').filter((f) => f > MIGRATION && !KNOWN_FOLLOW_UPS.includes(f))) {
    const text = readFileSync(`supabase/migrations/${later}`, 'utf8').replace(/--[^\n]*/g, '');
    assert.doesNotMatch(text, /function public\.(create|update)_complete_product/i, `${later} redefines a product RPC`);
  }
}

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
for (const file of readdirSync('supabase/migrations').filter((n) => n.endsWith('.sql')).sort()) {
  await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8').replace(/create extension if not exists pgcrypto;/g, ''));
}

const id = (n) => `53000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1);
const mainMgr = id(2);
const branchMgr = id(3);
const cashier = id(4);
const main = id(10);
const booth = id(11);
const egg = id(20);
const rice = id(21);
const other = id(22);

await db.exec(`
  insert into auth.users values ('${owner}','o@t'),('${mainMgr}','m@t'),('${branchMgr}','b@t'),('${cashier}','c@t');
  insert into public.branches(id,name,code,is_main_branch,is_active,receiving_mode) values
    ('${main}','Main','MAIN-S3',true,true,'counted'),('${booth}','Booth','B1-S3',false,true,'cashier_confirm');
  insert into public.profiles(id,full_name,role,branch_id) values
    ('${owner}','Owner','owner',null),('${mainMgr}','Main Manager','manager','${main}'),
    ('${branchMgr}','Booth Manager','manager','${booth}'),('${cashier}','Cashier','cashier','${booth}');
  insert into public.products(id,name,sku,selling_price,is_active,inventory_mode,closing_stock_behavior) values
    ('${egg}','Egg','EGG-S3',10,true,'piece_stock','keep_at_branch'),
    ('${rice}','Rice','RICE-S3',15,true,'piece_stock','keep_at_branch'),
    ('${other}','Other Item','OTH-S3',5,true,'piece_stock','keep_at_branch');
`);

const asUser = async (userId, work) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false);`);
  try {
    return await work();
  } finally {
    await db.exec('reset role');
  }
};
const J = (v) => (v === undefined ? null : JSON.stringify(v));
const noVariantBranches = [{ branch_id: booth, selling_price: '20.00' }];
const variantBranches = (names, price = '50.00') => [{ branch_id: booth, variants: names.map((name) => ({ name, selling_price: price })) }];

const create = (name, sku, { variants = [], branches, price = '20.00', stockUses, who = mainMgr } = {}) =>
  asUser(who, () =>
    db.query(
      `select * from public.create_complete_product(p_name := $1, p_sku := $2, p_description := null, p_variants := $3::jsonb, p_branches := $4::jsonb, p_selling_price := $5, p_stock_uses := $6::jsonb)`,
      [name, sku, J(variants), J(branches ?? (variants.length ? variantBranches(variants.map((v) => v.name)) : noVariantBranches)), variants.length ? null : price, J(stockUses)],
    ),
  ).then((r) => r.rows[0]);

const update = (productId, { name, sku, active = false, variants = [], deleted = [], branches, price = '20.00', stockUses, who = mainMgr } = {}) =>
  asUser(who, () =>
    db.query(
      `select * from public.update_complete_product(p_product_id := $1, p_name := $2, p_sku := $3, p_description := null, p_is_active := $4, p_variants := $5::jsonb, p_deleted_variant_ids := $6::jsonb, p_branches := $7::jsonb, p_selling_price := $8, p_stock_uses := $9::jsonb)`,
      [productId, name, sku, active, J(variants), J(deleted), J(branches ?? (variants.length ? variantBranches(variants.map((v) => v.name)) : noVariantBranches)), variants.length ? null : price, J(stockUses)],
    ),
  ).then((r) => r.rows[0]);

const uses = async (productId) =>
  (await db.query(
    `select coalesce(pv.name,'(product)') v, p.name i, u.quantity q
     from public.product_stock_uses u
     left join public.product_variants pv on pv.id = u.variant_id
     join public.products p on p.id = u.ingredient_product_id
     where u.product_id = $1 order by 1, 2`,
    [productId],
  )).rows.map((r) => `${r.v}:${r.i}x${r.q}`);
const rawUses = async (productId) =>
  (await db.query(`select id, variant_id, ingredient_product_id, quantity, created_at, updated_at from public.product_stock_uses where product_id=$1 order by id`, [productId])).rows;
const snapshot = async () => ({
  products: Number((await db.query('select count(*)::int n from public.products')).rows[0].n),
  variants: Number((await db.query('select count(*)::int n from public.product_variants')).rows[0].n),
  catalog: Number((await db.query('select count(*)::int n from public.branch_products')).rows[0].n),
  branchVariants: Number((await db.query('select count(*)::int n from public.branch_product_variants')).rows[0].n),
  stockUses: Number((await db.query('select count(*)::int n from public.product_stock_uses')).rows[0].n),
});
const variantId = async (productId, name) => (await db.query(`select id from public.product_variants where product_id=$1 and name=$2`, [productId, name])).rows[0]?.id;
const rejects = async (work, pattern, label) => {
  let error = null;
  try {
    await work();
  } catch (e) {
    error = e;
  }
  assert.ok(error, `${label}: should have been rejected`);
  assert.match(String(error.message), pattern, `${label}: wrong error: ${error.message}`);
};

// ---------------------------------------------------------------- 1. signatures and backward compatibility
{
  for (const [name, args] of [
    ['create_complete_product', 'p_name text, p_sku text, p_description text, p_variants jsonb, p_branches jsonb, p_selling_price text, p_inventory_mode text, p_closing_stock_behavior text, p_stock_uses jsonb, p_drink_choices jsonb'],
    ['update_complete_product', 'p_product_id uuid, p_name text, p_sku text, p_description text, p_is_active boolean, p_variants jsonb, p_deleted_variant_ids jsonb, p_branches jsonb, p_selling_price text, p_inventory_mode text, p_closing_stock_behavior text, p_stock_uses jsonb, p_drink_choices jsonb'],
  ]) {
    const rows = (await db.query(`select pg_get_function_identity_arguments(p.oid) a from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1`, [name])).rows;
    assert.equal(rows.length, 1, `${name}: exactly one callable signature`);
    assert.equal(rows[0].a, args);
  }
  const grants = (await db.query(`select routine_name, grantee from information_schema.routine_privileges where routine_schema='public' and routine_name in ('create_complete_product','update_complete_product') and privilege_type='EXECUTE' and grantee in ('anon','authenticated','PUBLIC') order by 1,2`)).rows.map((r) => `${r.routine_name}:${r.grantee}`);
  assert.deepEqual(grants, ['create_complete_product:authenticated', 'update_complete_product:authenticated']);

  // the exact calls existing code makes still work: positional, without the new argument
  const created = await asUser(mainMgr, () => db.query(`select * from public.create_complete_product('Legacy Plain','LEGACY-S3',null,'[]'::jsonb,$1::jsonb,'12.00')`, [J(noVariantBranches)])).then((r) => r.rows[0]);
  assert.equal(created.name, 'Legacy Plain');
  const updated = await asUser(mainMgr, () => db.query(`select * from public.update_complete_product($1,'Legacy Plain 2','LEGACY-S3',null,false,'[]'::jsonb,'[]'::jsonb,$2::jsonb,'13.00')`, [created.id, J(noVariantBranches)])).then((r) => r.rows[0]);
  assert.equal(updated.name, 'Legacy Plain 2');
  assert.equal(Number(updated.selling_price), 13);
  assert.deepEqual(await uses(created.id), [], 'no recipes appear on their own');
  console.log('signatures and backward compatibility: ok');
}

// ---------------------------------------------------------------- 2. create with recipes
let curry;
let bbq;
{
  // Chicken Curry: Viand Only (self x1, Egg x1), With Rice (self x1, Rice x1, Egg x1) and a product-level default
  curry = await create('Chicken Curry', 'CURRY-S3', {
    variants: [{ name: 'Viand Only', default_price: '70.00' }, { name: 'With Rice', default_price: '85.00' }],
    stockUses: [
      { variant_name: 'Viand Only', ingredient_product_id: 'self', quantity: 1 },
      { variant_name: 'Viand Only', ingredient_product_id: egg, quantity: 1 },
      { variant_name: 'with rice', ingredient_product_id: 'SELF', quantity: 1 }, // case-insensitive name and keyword
      { variant_name: ' With Rice ', ingredient_product_id: rice, quantity: '1' }, // trimmed name, quantity as text
      { variant_name: 'With Rice', ingredient_product_id: egg, quantity: 1 },
      { ingredient_product_id: other, quantity: 3 }, // product-level default
    ],
  });
  assert.deepEqual(await uses(curry.id), [
    '(product):Other Itemx3',
    'Viand Only:Chicken Curryx1',
    'Viand Only:Eggx1',
    'With Rice:Chicken Curryx1',
    'With Rice:Eggx1',
    'With Rice:Ricex1',
  ].sort());
  const vOnly = await variantId(curry.id, 'Viand Only');
  const rows = await rawUses(curry.id);
  assert.equal(rows.filter((r) => r.variant_id === vOnly).length, 2, 'lines are attached to the new variant ids');
  assert.equal(rows.find((r) => r.variant_id === null).quantity, 3);
  assert.equal(rows.filter((r) => r.ingredient_product_id === curry.id).length, 2, '"self" resolved to the new product id');

  // a product without variants: BBQ x3 uses itself
  bbq = await create('BBQ', 'BBQ-S3', { stockUses: [{ ingredient_product_id: 'self', quantity: 3 }] });
  assert.deepEqual(await uses(bbq.id), ['(product):BBQx3']);
  // creating without recipes (the legacy way) stores none
  const plain = await create('Soda S3', 'SODA-S3');
  assert.deepEqual(await uses(plain.id), []);
  // an empty list is also fine
  const empty = await create('Empty List', 'EMPTY-S3', { stockUses: [] });
  assert.deepEqual(await uses(empty.id), []);
  // the rest of the product is unchanged by the recipes
  assert.equal(curry.is_active, false);
  assert.equal(Number(curry.selling_price), 70);
  assert.equal(Number((await db.query(`select count(*)::int n from public.branch_product_variants where product_id=$1`, [curry.id])).rows[0].n), 2);
  console.log('create with recipes: ok');
}

// ---------------------------------------------------------------- 3. create validation: nothing is saved
{
  const bad = [
    ['quantity 0', [{ ingredient_product_id: egg, quantity: 0 }], /Quantity must be a whole number from 1 to 99/],
    ['quantity 100', [{ ingredient_product_id: egg, quantity: 100 }], /Quantity must be a whole number/],
    ['quantity -1', [{ ingredient_product_id: egg, quantity: -1 }], /Quantity must be a whole number/],
    ['quantity 1.5', [{ ingredient_product_id: egg, quantity: 1.5 }], /Quantity must be a whole number/],
    ['quantity "1.0"', [{ ingredient_product_id: egg, quantity: '1.0' }], /Quantity must be a whole number/],
    ['quantity "abc"', [{ ingredient_product_id: egg, quantity: 'abc' }], /Quantity must be a whole number/],
    ['quantity missing', [{ ingredient_product_id: egg }], /Quantity must be a whole number/],
    ['quantity null', [{ ingredient_product_id: egg, quantity: null }], /Quantity must be a whole number/],
    ['ingredient missing', [{ quantity: 1 }], /needs an ingredient_product_id/],
    ['ingredient not a uuid', [{ ingredient_product_id: 'egg', quantity: 1 }], /product id or "self"/],
    ['unknown ingredient', [{ ingredient_product_id: id(999), quantity: 1 }], /ingredient product could not be found/],
    ['duplicate ingredient', [{ ingredient_product_id: egg, quantity: 1 }, { ingredient_product_id: egg, quantity: 2 }], /duplicate_stock_use/],
    ['self twice', [{ ingredient_product_id: 'self', quantity: 1 }, { ingredient_product_id: 'SELF', quantity: 1 }], /duplicate_stock_use/],
    ['variant id on a new product', [{ variant_id: id(777), ingredient_product_id: egg, quantity: 1 }], /does not belong to this product/],
    ['unknown variant name', [{ variant_name: 'Nope', ingredient_product_id: egg, quantity: 1 }], /variant name that this product does not have/],
    ['id and name together', [{ variant_id: id(777), variant_name: 'X', ingredient_product_id: egg, quantity: 1 }], /variant_id or variant_name, not both/],
    ['variant name too long', [{ variant_name: 'x'.repeat(61), ingredient_product_id: egg, quantity: 1 }], /1 to 60 characters/],
    ['line is not an object', [5], /must be an object/],
  ];
  for (const [label, stockUses, pattern] of bad) {
    const before = await snapshot();
    await rejects(() => create(`Bad ${label}`.slice(0, 40), `BAD-${Math.abs(label.length * 7919) % 99999}-${label.replace(/\W/g, '').slice(0, 12)}`.toUpperCase(), { stockUses }), pattern, label);
    assert.deepEqual(await snapshot(), before, `${label}: nothing was saved`);
  }
  // not an array
  for (const notArray of [{ ingredient_product_id: egg, quantity: 1 }, 'x', 5]) {
    const before = await snapshot();
    await rejects(() => create('Not Array', 'NOTARR-S3', { stockUses: notArray }), /must be a JSON array/, 'not an array');
    assert.deepEqual(await snapshot(), before);
  }
  // the same name/sku is still free afterwards (the failed attempts left no product behind)
  await create('Not Array', 'NOTARR-S3', { stockUses: [{ ingredient_product_id: egg, quantity: 1 }] });

  // a valid recipe cannot rescue an invalid product, and an invalid recipe cannot hide behind a valid product
  const before = await snapshot();
  await rejects(() => create('X', 'BAD-NAME-S3', { stockUses: [{ ingredient_product_id: egg, quantity: 1 }] }), /Product name must be 2 to 120 characters/, 'bad name');
  assert.deepEqual(await snapshot(), before);

  // variant reference on a product without variants
  await rejects(() => create('No Variants', 'NOVAR-S3', { stockUses: [{ variant_name: 'Solo', ingredient_product_id: egg, quantity: 1 }] }), /variant name that this product does not have/, 'name on a variantless product');
  assert.deepEqual(await snapshot(), before);

  // authorization
  for (const who of [owner, branchMgr, cashier]) {
    await rejects(() => create('Nope', 'NOPE-S3', { stockUses: [{ ingredient_product_id: egg, quantity: 1 }], who }), /Unauthorized/, 'who ' + who);
  }
  assert.deepEqual(await snapshot(), before);
  console.log('create validation: ok');
}

// ---------------------------------------------------------------- 4. update: unrelated edits keep every recipe
{
  const beforeRows = await rawUses(curry.id);
  const vOnly = await variantId(curry.id, 'Viand Only');
  const vRice = await variantId(curry.id, 'With Rice');
  // rename the product, change prices, rename a variant IN PLACE (by id), change description: no p_stock_uses
  await update(curry.id, {
    name: 'Chicken Curry Deluxe',
    sku: 'CURRY-S3',
    variants: [{ id: vOnly, name: 'Viand', default_price: '72.00' }, { id: vRice, name: 'With Rice', default_price: '88.00' }],
    branches: variantBranches(['Viand', 'With Rice'], '60.00'),
  });
  const afterRows = await rawUses(curry.id);
  assert.deepEqual(afterRows, beforeRows, 'every line identical, including created_at and updated_at');
  assert.deepEqual(await uses(curry.id), [
    '(product):Other Itemx3',
    'Viand:Eggx1',
    'Viand:Chicken Curry Deluxex1',
    'With Rice:Chicken Curry Deluxex1',
    'With Rice:Eggx1',
    'With Rice:Ricex1',
  ].sort(), 'the renamed variant keeps its lines');
  // toggling active, editing closing behaviour and a JSON null recipe argument also leave recipes alone
  await update(curry.id, { name: 'Chicken Curry Deluxe', sku: 'CURRY-S3', active: false, variants: [{ id: vOnly, name: 'Viand', default_price: '72.00' }, { id: vRice, name: 'With Rice', default_price: '88.00' }], branches: variantBranches(['Viand', 'With Rice']), stockUses: undefined });
  assert.deepEqual(await rawUses(curry.id), beforeRows);
  // a variantless product keeps its recipe through a rename
  await update(bbq.id, { name: 'BBQ Stick', sku: 'BBQ-S3', price: '22.00' });
  assert.deepEqual(await uses(bbq.id), ['(product):BBQ Stickx3'], 'self line follows the product, now under its new name');
  console.log('unrelated edits preserve recipes: ok');
}

// ---------------------------------------------------------------- 5. update: intentional changes
{
  const vOnly = await variantId(curry.id, 'Viand');
  const vRice = await variantId(curry.id, 'With Rice');
  const base = {
    name: 'Chicken Curry Deluxe',
    sku: 'CURRY-S3',
    variants: [{ id: vOnly, name: 'Viand', default_price: '72.00' }, { id: vRice, name: 'With Rice', default_price: '88.00' }],
    branches: variantBranches(['Viand', 'With Rice']),
  };
  const full = (extra = []) => [
    { variant_id: vOnly, ingredient_product_id: 'self', quantity: 1 },
    { variant_id: vOnly, ingredient_product_id: egg, quantity: 1 },
    { variant_id: vRice, ingredient_product_id: 'self', quantity: 1 },
    { variant_id: vRice, ingredient_product_id: rice, quantity: 1 },
    { variant_id: vRice, ingredient_product_id: egg, quantity: 1 },
    ...extra,
  ];

  // sending the same set changes nothing (unchanged lines keep their timestamps)
  const before = await rawUses(curry.id);
  await update(curry.id, { ...base, stockUses: full([{ ingredient_product_id: other, quantity: 3 }]) });
  assert.deepEqual(await rawUses(curry.id), before, 'identical payload = identical rows, timestamps included');

  // change a quantity, add a line, drop another
  await db.exec('select pg_sleep(0.01)');
  await update(curry.id, {
    ...base,
    stockUses: [
      { variant_id: vOnly, ingredient_product_id: 'self', quantity: 1 },
      { variant_id: vOnly, ingredient_product_id: egg, quantity: 2 }, // 1 -> 2
      { variant_id: vOnly, ingredient_product_id: rice, quantity: 1 }, // new
      { variant_id: vRice, ingredient_product_id: 'self', quantity: 1 },
      { variant_id: vRice, ingredient_product_id: rice, quantity: 1 },
      // With Rice / Egg and the product-level default are no longer listed -> removed
    ],
  });
  assert.deepEqual(await uses(curry.id), ['Viand:Chicken Curry Deluxex1', 'Viand:Eggx2', 'Viand:Ricex1', 'With Rice:Chicken Curry Deluxex1', 'With Rice:Ricex1'].sort());
  const afterChange = await rawUses(curry.id);
  const keptSame = afterChange.find((r) => r.variant_id === vRice && r.ingredient_product_id === rice);
  const wasSame = before.find((r) => r.variant_id === vRice && r.ingredient_product_id === rice);
  assert.deepEqual(keptSame, wasSame, 'an unchanged line is not rewritten');
  const changed = afterChange.find((r) => r.variant_id === vOnly && r.ingredient_product_id === egg);
  assert.ok(new Date(changed.updated_at) > new Date(before.find((r) => r.variant_id === vOnly && r.ingredient_product_id === egg).updated_at), 'a changed quantity moves updated_at');
  assert.equal(changed.id, before.find((r) => r.variant_id === vOnly && r.ingredient_product_id === egg).id, 'same row, updated in place');

  // a NEW variant created in the same save, referenced by name, next to an existing one referenced by id
  await update(curry.id, {
    ...base,
    variants: [...base.variants, { id: null, name: 'Large', default_price: '100.00' }],
    branches: variantBranches(['Viand', 'With Rice', 'Large']),
    stockUses: [
      { variant_id: vOnly, ingredient_product_id: 'self', quantity: 1 },
      { variant_name: 'LARGE', ingredient_product_id: 'self', quantity: 2 },
      { variant_name: 'Large', ingredient_product_id: egg, quantity: 2 },
      { variant_name: 'Large', ingredient_product_id: rice, quantity: 2 },
    ],
  });
  const large = await variantId(curry.id, 'Large');
  assert.ok(large, 'the new variant exists');
  assert.deepEqual(await uses(curry.id), ['Large:Chicken Curry Deluxex2', 'Large:Eggx2', 'Large:Ricex2', 'Viand:Chicken Curry Deluxex1'].sort(), 'everything else was removed because it was not listed');
  assert.ok((await rawUses(curry.id)).every((r) => r.variant_id === vOnly || r.variant_id === large));
  // restore a fuller set for the following checks
  await update(curry.id, { ...base, variants: [...base.variants, { id: large, name: 'Large', default_price: '100.00' }], branches: variantBranches(['Viand', 'With Rice', 'Large']), stockUses: [...full(), { variant_id: large, ingredient_product_id: egg, quantity: 2 }] });
  assert.equal((await uses(curry.id)).length, 6);

  // removing a variant removes its lines and only its lines
  await update(curry.id, { ...base, deleted: [large], variants: base.variants, branches: variantBranches(['Viand', 'With Rice']), stockUses: undefined });
  assert.equal((await uses(curry.id)).filter((l) => l.startsWith('Large')).length, 0, 'the deleted variant took its recipe with it');
  assert.equal((await uses(curry.id)).length, 5, 'other variants keep theirs');

  // [] clears everything; null / omitted does not
  await update(curry.id, { ...base, stockUses: undefined });
  assert.equal((await uses(curry.id)).length, 5);
  await update(curry.id, { ...base, stockUses: [] });
  assert.deepEqual(await uses(curry.id), [], 'an empty list removes every recipe');
  // and they can be added back afterwards
  await update(curry.id, { ...base, stockUses: full() });
  assert.equal((await uses(curry.id)).length, 5);

  // the whole replacement also covers a product-level recipe on a product that gained its first recipe
  await update(bbq.id, { name: 'BBQ Stick', sku: 'BBQ-S3', price: '22.00', stockUses: [{ ingredient_product_id: bbq.id, quantity: 4 }, { ingredient_product_id: rice, quantity: 1 }] });
  assert.deepEqual(await uses(bbq.id), ['(product):BBQ Stickx4', '(product):Ricex1']);
  assert.equal(Number((await db.query(`select count(*)::int n from public.product_stock_uses where product_id=$1`, [bbq.id])).rows[0].n), 2, '"self" and the product id are the same ingredient');
  await rejects(() => update(bbq.id, { name: 'BBQ Stick', sku: 'BBQ-S3', price: '22.00', stockUses: [{ ingredient_product_id: bbq.id, quantity: 4 }, { ingredient_product_id: 'self', quantity: 1 }] }), /duplicate_stock_use/, 'self + own id');
  assert.deepEqual(await uses(bbq.id), ['(product):BBQ Stickx4', '(product):Ricex1'], 'rejected update changed nothing');
  console.log('intentional updates, additions and removals: ok');
}

// ---------------------------------------------------------------- 6. update validation: atomic, nothing partially saved
{
  const vOnly = await variantId(curry.id, 'Viand');
  const vRice = await variantId(curry.id, 'With Rice');
  const base = {
    name: 'Chicken Curry Deluxe',
    sku: 'CURRY-S3',
    variants: [{ id: vOnly, name: 'Viand', default_price: '72.00' }, { id: vRice, name: 'With Rice', default_price: '88.00' }],
    branches: variantBranches(['Viand', 'With Rice']),
  };
  const state = async () => ({
    product: (await db.query(`select name, sku, selling_price::numeric p from public.products where id=$1`, [curry.id])).rows[0],
    variants: (await db.query(`select id, name, default_price::numeric d from public.product_variants where product_id=$1 order by name`, [curry.id])).rows,
    bpv: (await db.query(`select name, selling_price::numeric s from public.branch_product_variants where product_id=$1 order by name`, [curry.id])).rows,
    uses: await rawUses(curry.id),
  });
  const before = await state();
  const otherVariant = await variantId(bbq.id, 'x'); // none: bbq has no variants
  assert.equal(otherVariant, undefined);
  // a variant of ANOTHER product
  const foreignProduct = await create('Foreign Pares', 'FOREIGN-S3', { variants: [{ name: 'Regular', default_price: '90.00' }], stockUses: [{ variant_name: 'Regular', ingredient_product_id: 'self', quantity: 1 }] });
  const foreignVariant = await variantId(foreignProduct.id, 'Regular');
  const changed = { ...base, name: 'Should Not Stick', variants: [{ id: vOnly, name: 'Renamed', default_price: '1.00' }, { id: vRice, name: 'With Rice', default_price: '88.00' }], branches: variantBranches(['Renamed', 'With Rice'], '9.00') };

  const cases = [
    ['variant of another product', [{ variant_id: foreignVariant, ingredient_product_id: egg, quantity: 1 }], /does not belong to this product/],
    ['unknown variant id', [{ variant_id: id(888), ingredient_product_id: egg, quantity: 1 }], /does not belong to this product/],
    ['unknown variant name', [{ variant_name: 'Missing', ingredient_product_id: egg, quantity: 1 }], /variant name that this product does not have/],
    ['quantity 0', [{ variant_id: vOnly, ingredient_product_id: egg, quantity: 0 }], /whole number from 1 to 99/],
    ['quantity 100', [{ variant_id: vOnly, ingredient_product_id: egg, quantity: 100 }], /whole number/],
    ['unknown ingredient', [{ variant_id: vOnly, ingredient_product_id: id(999), quantity: 1 }], /ingredient product could not be found/],
    ['duplicate in one variant', [{ variant_id: vOnly, ingredient_product_id: egg, quantity: 1 }, { variant_id: vOnly, ingredient_product_id: egg, quantity: 2 }], /duplicate_stock_use/],
    ['id and name for the same variant', [{ variant_id: vOnly, ingredient_product_id: egg, quantity: 1 }, { variant_name: 'Renamed', ingredient_product_id: egg, quantity: 1 }], /duplicate_stock_use/],
  ];
  for (const [label, stockUses, pattern] of cases) {
    await rejects(() => update(curry.id, { ...changed, stockUses }), pattern, label);
    assert.deepEqual(await state(), before, `${label}: the product, variants, prices and recipes are all untouched`);
  }
  // a recipe that points at a variant the same save deletes
  await rejects(() => update(curry.id, { ...base, deleted: [vRice], variants: [base.variants[0]], branches: variantBranches(['Viand']), stockUses: [{ variant_id: vRice, ingredient_product_id: egg, quantity: 1 }] }), /does not belong to this product/, 'recipe for a deleted variant');
  assert.deepEqual(await state(), before, 'the variant it tried to delete is still there');

  // errors in the product part also leave the recipes alone
  await rejects(() => update(curry.id, { ...base, sku: '!!', stockUses: [] }), /SKU must be/, 'bad sku with []');
  assert.deepEqual(await state(), before, 'a failed save does not clear recipes');

  // authorization
  for (const who of [owner, branchMgr, cashier]) {
    await rejects(() => update(curry.id, { ...base, stockUses: [], who }), /Unauthorized/, 'who ' + who);
  }
  assert.deepEqual(await state(), before);
  // the helpers cannot be called directly by any API role
  for (const who of [mainMgr, owner, cashier]) {
    await asUser(who, async () => {
      await assert.rejects(db.query(`select public.apply_product_stock_uses('${curry.id}', '[]'::jsonb)`), /permission denied/i);
      await assert.rejects(db.query(`select public.normalize_product_stock_uses('[]'::jsonb)`), /permission denied/i);
    });
  }
  console.log('update validation and atomicity: ok');
}

// ---------------------------------------------------------------- 7. determinism: repeated and sequential saves never mix
{
  // two "concurrent" edits applied one after the other: the later one fully replaces the earlier (no mixed result)
  const target = await create('Race Target', 'RACE-S3', { stockUses: [{ ingredient_product_id: egg, quantity: 1 }] });
  await update(target.id, { name: 'Race Target', sku: 'RACE-S3', stockUses: [{ ingredient_product_id: egg, quantity: 2 }, { ingredient_product_id: rice, quantity: 1 }] }); // editor A
  await update(target.id, { name: 'Race Target', sku: 'RACE-S3', stockUses: [{ ingredient_product_id: rice, quantity: 5 }] }); // editor B
  assert.deepEqual(await uses(target.id), ['(product):Ricex5'], 'last write wins as a whole');
  // the same payload twice is a no-op the second time
  const first = await rawUses(target.id);
  await update(target.id, { name: 'Race Target', sku: 'RACE-S3', stockUses: [{ ingredient_product_id: rice, quantity: 5 }] });
  assert.deepEqual(await rawUses(target.id), first);
  // the unique indexes are the last line of defence even if a writer bypassed the helper
  await assert.rejects(db.exec(`insert into public.product_stock_uses(product_id,variant_id,ingredient_product_id,quantity) values ('${target.id}',null,'${rice}',1)`), /duplicate key/i);
  console.log('sequential editors: ok');
}

// ---------------------------------------------------------------- 8. end to end: recipes saved through the RPC drive confirm_sale
{
  // Products created through the RPC get REAL ids: the POS sells a variant by its branch_product_variants id, which
  // is a different uuid from the master product_variants id the recipe is stored against.
  const grill = await create('Grilled BBQ', 'GRILL-S3', { stockUses: [{ ingredient_product_id: 'self', quantity: 3 }, { ingredient_product_id: rice, quantity: 1 }] });
  const curryE2e = await create('Curry E2E', 'CURRYE2E-S3', {
    variants: [{ name: 'With Rice', default_price: '85.00' }],
    stockUses: [
      { variant_name: 'With Rice', ingredient_product_id: 'self', quantity: 1 },
      { variant_name: 'With Rice', ingredient_product_id: rice, quantity: 1 },
      { variant_name: 'With Rice', ingredient_product_id: egg, quantity: 1 },
    ],
  });
  await db.exec(`
    set session_replication_role = replica; -- skip the "needs opening stock" activation guard for the fixtures only
    update public.products set is_active = true where id in ('${grill.id}','${curryE2e.id}');
    reset session_replication_role;
    insert into public.branch_products(branch_id,product_id,selling_price,is_active) values ('${booth}','${egg}',10,true),('${booth}','${rice}',15,true);
    insert into public.branch_inventory(branch_id,product_id,quantity_on_hand) values
      ('${booth}','${grill.id}',30),('${booth}','${curryE2e.id}',10),('${booth}','${rice}',10),('${booth}','${egg}',10);
  `);
  const shift = (await asUser(cashier, () => db.query('select public.start_cashier_shift() id'))).rows[0].id;
  const stock = async () => Object.fromEntries((await db.query(`select p.name, bi.quantity_on_hand::numeric q from public.branch_inventory bi join public.products p on p.id=bi.product_id where bi.branch_id='${booth}'`)).rows.map((r) => [r.name, Number(r.q)]));
  const sell = (items, key) => asUser(cashier, () => db.query(`select (public.confirm_sale($1,$2::jsonb,'1000',$3,'standard')).*`, [shift, J(items), key])).then((r) => r.rows[0]);
  const diff = (a, b) => Object.fromEntries(Object.keys(b).map((k) => [k, b[k] - a[k]]).filter(([, x]) => x !== 0));

  // product-level recipe saved by create_complete_product: 2 orders of BBQ x3 + Rice x1 each
  const before = await stock();
  const sale = await sell([{ product_id: grill.id, quantity: 2 }], 'e2e-product-recipe-000001');
  assert.ok(sale.id);
  assert.deepEqual(diff(before, await stock()), { 'Grilled BBQ': -6, Rice: -2 }, 'a saved product-level recipe is what the sale deducts');

  // variant-level recipe: the POS sends the BRANCH variant id.
  const branchVariant = (await db.query(`select id from public.branch_product_variants where branch_id=$1 and product_id=$2 and name='With Rice'`, [booth, curryE2e.id])).rows[0].id;
  const masterVariant = await variantId(curryE2e.id, 'With Rice');
  assert.notEqual(branchVariant, masterVariant, 'real data: the branch variant and the master variant have different ids');
  const before2 = await stock();
  await sell([{ product_id: curryE2e.id, variant_id: branchVariant, quantity: 1 }], 'e2e-variant-recipe-000001');
  const got = diff(before2, await stock());
  const expected = { 'Curry E2E': -1, Rice: -1, Egg: -1 };
  // (confirm_sale maps the branch variant to the master variant: 20261023120000_confirm_sale_variant_mapping.sql)
  assert.deepEqual(got, expected, 'a variant recipe saved through the RPC is applied when the POS sends the branch variant id');
  console.log('end to end with confirm_sale: ok');
}

console.log('product_stock_uses_save: ALL PASS');
