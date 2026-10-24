// Drink Choice, Steps 1-2: the product_drink_choices table and saving it through create/update_complete_product.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const TABLE_MIGRATION = '20261024090000_product_drink_choices.sql';
const SAVE_MIGRATION = '20261024100000_save_product_drink_choices.sql';
const strip = (text) => text.replace(/--[^\n]*/g, '').replace(/comment on [\s\S]*?;\n/gi, '');

// ---------------------------------------------------------------- 0. static: additive and scoped
{
  const table = strip(readFileSync(`supabase/migrations/${TABLE_MIGRATION}`, 'utf8'));
  assert.doesNotMatch(table, /\bdrop\b|\bupdate public\.|\bdelete from\b|\binsert into\b|create (or replace )?function/i);
  assert.deepEqual([...table.matchAll(/alter table (public\.\w+)/gi)].map((m) => m[1]), ['public.product_drink_choices'], 'the only table altered is the new one (to enable row level security)');
  assert.equal((table.match(/create table/gi) ?? []).length, 1);
  assert.match(table, /revoke all on public\.product_drink_choices from public, anon, authenticated;\s*grant select on public\.product_drink_choices to authenticated;/);

  const save = strip(readFileSync(`supabase/migrations/${SAVE_MIGRATION}`, 'utf8'));
  assert.doesNotMatch(save, /confirm_sale|\balter table\b|\bcreate table\b|\bcreate (unique )?index\b/i);
  assert.equal((save.match(/drop function if exists/gi) ?? []).length, 2, 'only the two product RPCs are replaced');
  assert.match(save, /p_stock_uses jsonb default null,\s*p_drink_choices jsonb default null\s*\)/);
  assert.match(save, /revoke all on function public\.normalize_product_drink_choices\(jsonb\) from public, anon, authenticated;/);
  assert.match(save, /revoke all on function public\.apply_product_drink_choices\(uuid, jsonb\) from public, anon, authenticated;/);
  // validated first, applied after the options are final and in the same transaction
  assert.ok(save.indexOf('v_drink_choices := public.normalize_product_drink_choices(p_drink_choices);') < save.indexOf('insert into public.products('));
  assert.match(save, /perform public\.apply_product_drink_choices\(v_product\.id, v_drink_choices\);/);
  assert.match(save, /perform public\.apply_product_drink_choices\(p_product_id, v_drink_choices\);/);
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

const id = (n) => `59000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1);
const mainMgr = id(2);
const branchMgr = id(3);
const cashier = id(4);
const stranger = id(6);
const main = id(10);
const booth = id(11);
const coke = id(20);
const royal = id(21);
const sprite = id(22);
const rice = id(23);

await db.exec(`
  insert into auth.users values ('${owner}','o@t'),('${mainMgr}','m@t'),('${branchMgr}','b@t'),('${cashier}','c@t'),('${stranger}','s@t');
  insert into public.branches(id,name,code,is_main_branch,is_active,receiving_mode) values
    ('${main}','Main','MAIN-DC',true,true,'counted'),('${booth}','Booth','BOOTH-DC',false,true,'cashier_confirm');
  insert into public.profiles(id,full_name,role,branch_id) values
    ('${owner}','Owner','owner',null),('${mainMgr}','Main Manager','manager','${main}'),
    ('${branchMgr}','Booth Manager','manager','${booth}'),('${cashier}','Cashier','cashier','${booth}');
  insert into public.products(id,name,sku,selling_price,is_active,inventory_mode,closing_stock_behavior) values
    ('${coke}','Coke','COKE-DC',20,true,'piece_stock','keep_at_branch'),
    ('${royal}','Royal','ROYAL-DC',20,true,'piece_stock','keep_at_branch'),
    ('${sprite}','Sprite','SPRITE-DC',20,true,'piece_stock','keep_at_branch'),
    ('${rice}','Rice','RICE-DC',15,true,'piece_stock','keep_at_branch');
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
const variantBranches = (names) => [{ branch_id: booth, variants: names.map((name) => ({ name, selling_price: '60.00' })) }];

const create = (name, sku, { variants = [['Viand Only', '70.00'], ['With Rice', '85.00']], drinkChoices, stockUses, who = mainMgr } = {}) =>
  asUser(who, () =>
    db.query(
      `select * from public.create_complete_product(p_name := $1, p_sku := $2, p_description := null, p_variants := $3::jsonb, p_branches := $4::jsonb, p_selling_price := $5, p_stock_uses := $6::jsonb, p_drink_choices := $7::jsonb)`,
      [name, sku, J(variants.map(([n, p]) => ({ name: n, default_price: p }))), J(variants.length ? variantBranches(variants.map(([n]) => n)) : [{ branch_id: booth, selling_price: '20.00' }]), variants.length ? null : '20.00', J(stockUses), J(drinkChoices)],
    ),
  ).then((r) => r.rows[0]);
const update = (productId, { name, sku, variants, deleted = [], drinkChoices, stockUses, who = mainMgr }) =>
  asUser(who, () =>
    db.query(
      `select * from public.update_complete_product(p_product_id := $1, p_name := $2, p_sku := $3, p_description := null, p_is_active := false, p_variants := $4::jsonb, p_deleted_variant_ids := $5::jsonb, p_branches := $6::jsonb, p_selling_price := null, p_stock_uses := $7::jsonb, p_drink_choices := $8::jsonb)`,
      [productId, name, sku, J(variants), J(deleted), J(variantBranches(variants.map((v) => v.name))), J(stockUses), J(drinkChoices)],
    ),
  ).then((r) => r.rows[0]);
const choices = async (productId) =>
  (await db.query(`select coalesce(pv.name,'?') v, p.name d from public.product_drink_choices c join public.product_variants pv on pv.id=c.variant_id join public.products p on p.id=c.drink_product_id where c.product_id=$1 order by 1,2`, [productId])).rows.map((r) => `${r.v}:${r.d}`);
const rawRows = async (productId) => (await db.query(`select id, variant_id, drink_product_id, created_at, updated_at from public.product_drink_choices where product_id=$1 order by id`, [productId])).rows;
const counts = async () => ({
  products: Number((await db.query('select count(*)::int n from public.products')).rows[0].n),
  variants: Number((await db.query('select count(*)::int n from public.product_variants')).rows[0].n),
  choices: Number((await db.query('select count(*)::int n from public.product_drink_choices')).rows[0].n),
});
const variantId = async (productId, name) => (await db.query(`select id from public.product_variants where product_id=$1 and name=$2`, [productId, name])).rows[0]?.id;

// ---------------------------------------------------------------- 1. table shape and constraints
let meal;
{
  const cols = (await db.query(`select column_name, is_nullable from information_schema.columns where table_schema='public' and table_name='product_drink_choices' order by ordinal_position`)).rows;
  assert.deepEqual(cols.map((c) => c.column_name), ['id', 'product_id', 'variant_id', 'drink_product_id', 'created_at', 'updated_at']);
  assert.ok(cols.every((c) => c.is_nullable === 'NO'), 'every reference is required: a drink choice always belongs to an option');
  assert.equal((await db.query(`select relrowsecurity from pg_class where oid='public.product_drink_choices'::regclass`)).rows[0].relrowsecurity, true);

  meal = await create('Chicken Curry', 'CURRY-DC', { drinkChoices: [{ variant_name: 'With Rice', drink_product_id: coke }, { variant_name: 'With Rice', drink_product_id: royal }] });
  const vRice = await variantId(meal.id, 'With Rice');
  const vOnly = await variantId(meal.id, 'Viand Only');
  // constraints (superuser inserts bypass the RPC, so the database itself must hold)
  const bad = (sql) => db.exec(sql);
  await rejects(() => bad(`insert into public.product_drink_choices(product_id,variant_id,drink_product_id) values ('${meal.id}','${vRice}','${coke}')`), /duplicate key/i, 'duplicate drink for an option');
  await rejects(() => bad(`insert into public.product_drink_choices(product_id,variant_id,drink_product_id) values ('${meal.id}','${vOnly}','${meal.id}')`), /not_self|check/i, 'a meal as its own drink');
  await rejects(() => bad(`insert into public.product_drink_choices(product_id,variant_id,drink_product_id) values ('${rice}','${vOnly}','${coke}')`), /foreign key/i, 'a variant of another product');
  await rejects(() => bad(`insert into public.product_drink_choices(product_id,variant_id,drink_product_id) values ('${meal.id}','${vOnly}','${id(999)}')`), /foreign key/i, 'an unknown drink');
  await rejects(() => bad(`insert into public.product_drink_choices(product_id,variant_id,drink_product_id) values ('${meal.id}',null,'${coke}')`), /null value|not-null/i, 'no option');
  // a drink that is offered cannot be deleted; deleting the option removes its drinks only
  await rejects(() => bad(`delete from public.products where id='${coke}'`), /foreign key|violates/i, 'delete an offered drink');
  // access: staff read, nobody writes, anon is denied
  for (const who of [owner, mainMgr, cashier]) {
    await asUser(who, async () => {
      assert.equal(Number((await db.query('select count(*)::int n from public.product_drink_choices')).rows[0].n), 2, 'staff can read');
      await assert.rejects(db.exec(`insert into public.product_drink_choices(product_id,variant_id,drink_product_id) values ('${meal.id}','${vOnly}','${sprite}')`), /permission denied/i);
      await assert.rejects(db.exec('delete from public.product_drink_choices'), /permission denied/i);
    });
  }
  assert.equal(await asUser(stranger, async () => Number((await db.query('select count(*)::int n from public.product_drink_choices')).rows[0].n)), 0, 'no role, no rows');
  console.log('table: ok');
}

// ---------------------------------------------------------------- 2. save through create; signature and compatibility
{
  assert.deepEqual(await choices(meal.id), ['With Rice:Coke', 'With Rice:Royal'], 'saved by option name when the product was created');
  assert.deepEqual(await choices((await create('Plain Pares', 'PARES-DC')).id), [], 'created without drink choices (the old way): none are stored');
  for (const [name, expected] of [
    ['create_complete_product', 'p_name text, p_sku text, p_description text, p_variants jsonb, p_branches jsonb, p_selling_price text, p_inventory_mode text, p_closing_stock_behavior text, p_stock_uses jsonb, p_drink_choices jsonb'],
    ['update_complete_product', 'p_product_id uuid, p_name text, p_sku text, p_description text, p_is_active boolean, p_variants jsonb, p_deleted_variant_ids jsonb, p_branches jsonb, p_selling_price text, p_inventory_mode text, p_closing_stock_behavior text, p_stock_uses jsonb, p_drink_choices jsonb'],
  ]) {
    const rows = (await db.query(`select pg_get_function_identity_arguments(p.oid) a from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1`, [name])).rows;
    assert.equal(rows.length, 1, `${name}: one callable signature`);
    assert.equal(rows[0].a, expected);
  }
  // the exact calls older code makes (fewer arguments) still work
  const legacy = await asUser(mainMgr, () => db.query(`select * from public.create_complete_product('Legacy One','LEGACY-DC',null,'[]'::jsonb,$1::jsonb,'12.00')`, [J([{ branch_id: booth, selling_price: '12.00' }])])).then((r) => r.rows[0]);
  assert.equal(legacy.name, 'Legacy One');
  assert.deepEqual(await choices(legacy.id), []);
  console.log('create and compatibility: ok');
}

// ---------------------------------------------------------------- 3. validation: nothing is saved
{
  const before = await counts();
  const cases = [
    ['unknown drink', [{ variant_name: 'Viand Only', drink_product_id: id(999) }], /drink product could not be found/],
    ['the meal as its own drink', null, /cannot be its own drink/],
    ['duplicate drink', [{ variant_name: 'Viand Only', drink_product_id: coke }, { variant_name: 'viand only', drink_product_id: coke }], /duplicate_drink_choice/],
    ['no option given', [{ drink_product_id: coke }], /belongs to an option/],
    ['id and name together', [{ variant_id: id(5), variant_name: 'X', drink_product_id: coke }], /not both/],
    ['unknown option name', [{ variant_name: 'Nope', drink_product_id: coke }], /option that does not belong/],
    ['not a uuid', [{ variant_name: 'Viand Only', drink_product_id: 'coke' }], /needs a drink_product_id/],
    ['not an array', { variant_name: 'Viand Only', drink_product_id: coke }, /must be a JSON array/],
    ['not an object', [5], /must be an object/],
  ];
  for (const [label, drinkChoices, pattern] of cases) {
    const payload = label === 'the meal as its own drink'
      ? [{ variant_name: 'Viand Only', drink_product_id: '__SELF__' }]
      : drinkChoices;
    if (label === 'the meal as its own drink') {
      // needs a real product id for the meal: create it first without choices, then try to make it its own drink on edit
      const m = await create('Self Meal', 'SELFM-DC');
      const vs = (await db.query('select id, name from public.product_variants where product_id=$1 order by sort_order', [m.id])).rows;
      await rejects(() => update(m.id, { name: 'Self Meal', sku: 'SELFM-DC', variants: vs.map((v) => ({ id: v.id, name: v.name, default_price: '70.00' })), drinkChoices: [{ variant_name: 'Viand Only', drink_product_id: m.id }] }), pattern, label);
      continue;
    }
    const c0 = await counts();
    await rejects(() => create(`Bad ${label}`.slice(0, 40), `BAD-DC-${cases.findIndex((x) => x[0] === label)}`, { drinkChoices: payload }), pattern, label);
    assert.deepEqual(await counts(), c0, `${label}: the product, its options and its drink choices were all rolled back`);
  }
  assert.ok((await counts()).products > before.products - 1);
  // authorization
  for (const who of [owner, branchMgr, cashier]) {
    await rejects(() => create('Nope', 'NOPE-DC', { drinkChoices: [], who }), /Unauthorized/, 'who ' + who);
  }
  // helpers are not callable by API roles
  for (const who of [mainMgr, owner, cashier]) {
    await asUser(who, async () => {
      await assert.rejects(db.query(`select public.apply_product_drink_choices('${meal.id}', '[]'::jsonb)`), /permission denied/i);
      await assert.rejects(db.query(`select public.normalize_product_drink_choices('[]'::jsonb)`), /permission denied/i);
    });
  }
  console.log('validation: ok');
}

// ---------------------------------------------------------------- 4. edit: unrelated edits preserve, intentional edits replace
{
  const vOnly = await variantId(meal.id, 'Viand Only');
  const vRice = await variantId(meal.id, 'With Rice');
  const variants = [{ id: vOnly, name: 'Viand Only', default_price: '70.00' }, { id: vRice, name: 'With Rice', default_price: '85.00' }];
  const before = await rawRows(meal.id);

  // rename the product, change prices, rename an option IN PLACE: no p_drink_choices -> nothing changes
  await update(meal.id, { name: 'Chicken Curry Deluxe', sku: 'CURRY-DC', variants: [{ ...variants[0], name: 'Viand', default_price: '72.00' }, variants[1]] });
  assert.deepEqual(await rawRows(meal.id), before, 'identical rows, timestamps included');
  assert.deepEqual(await choices(meal.id), ['With Rice:Coke', 'With Rice:Royal']);
  const renamed = [{ ...variants[0], name: 'Viand', default_price: '72.00' }, variants[1]];

  // sending the same set changes nothing
  await update(meal.id, { name: 'Chicken Curry Deluxe', sku: 'CURRY-DC', variants: renamed, drinkChoices: [{ variant_id: vRice, drink_product_id: coke }, { variant_id: vRice, drink_product_id: royal }] });
  assert.deepEqual(await rawRows(meal.id), before, 'identical payload = identical rows');

  // intentional: add Sprite to With Rice and give the renamed Viand option Coke (by id, then by name)
  await update(meal.id, { name: 'Chicken Curry Deluxe', sku: 'CURRY-DC', variants: renamed, drinkChoices: [
    { variant_id: vRice, drink_product_id: coke }, { variant_id: vRice, drink_product_id: royal }, { variant_id: vRice, drink_product_id: sprite }, { variant_name: 'Viand', drink_product_id: coke },
  ] });
  assert.deepEqual(await choices(meal.id), ['Viand:Coke', 'With Rice:Coke', 'With Rice:Royal', 'With Rice:Sprite']);
  const kept = (await rawRows(meal.id)).find((r) => r.variant_id === vRice && r.drink_product_id === coke);
  assert.deepEqual(kept, before.find((r) => r.variant_id === vRice && r.drink_product_id === coke), 'an unchanged choice is not rewritten');

  // remove one drink; a new option "Large" gets its drinks in the same save (by name)
  await update(meal.id, { name: 'Chicken Curry Deluxe', sku: 'CURRY-DC', variants: [...renamed, { id: null, name: 'Large', default_price: '100.00' }], drinkChoices: [
    { variant_id: vRice, drink_product_id: coke }, { variant_id: vRice, drink_product_id: sprite }, { variant_name: 'Large', drink_product_id: royal },
  ] });
  assert.deepEqual(await choices(meal.id), ['Large:Royal', 'With Rice:Coke', 'With Rice:Sprite']);

  // deleting an option removes its drinks and only its drinks
  const vLarge = await variantId(meal.id, 'Large');
  await update(meal.id, { name: 'Chicken Curry Deluxe', sku: 'CURRY-DC', variants: renamed, deleted: [vLarge] });
  assert.deepEqual(await choices(meal.id), ['With Rice:Coke', 'With Rice:Sprite']);

  // [] removes every drink choice; they can be added back
  await update(meal.id, { name: 'Chicken Curry Deluxe', sku: 'CURRY-DC', variants: renamed, drinkChoices: [] });
  assert.deepEqual(await choices(meal.id), []);
  await update(meal.id, { name: 'Chicken Curry Deluxe', sku: 'CURRY-DC', variants: renamed, drinkChoices: [{ variant_id: vRice, drink_product_id: coke }] });
  assert.deepEqual(await choices(meal.id), ['With Rice:Coke']);

  // a rejected edit changes nothing, not even the product name
  const snapshot = await rawRows(meal.id);
  await rejects(() => update(meal.id, { name: 'Should Not Stick', sku: 'CURRY-DC', variants: renamed, drinkChoices: [{ variant_id: vRice, drink_product_id: id(999) }] }), /drink product could not be found/, 'unknown drink on edit');
  assert.deepEqual(await rawRows(meal.id), snapshot);
  assert.equal((await db.query('select name from public.products where id=$1', [meal.id])).rows[0].name, 'Chicken Curry Deluxe');
  // the stock-used recipes saved alongside are independent of drink choices
  await update(meal.id, { name: 'Chicken Curry Deluxe', sku: 'CURRY-DC', variants: renamed, stockUses: [{ variant_id: vRice, ingredient_product_id: 'self', quantity: 1 }, { variant_id: vRice, ingredient_product_id: rice, quantity: 1 }] });
  assert.deepEqual(await choices(meal.id), ['With Rice:Coke'], 'saving recipes does not touch the drink choices');
  assert.equal((await db.query('select count(*)::int n from public.product_stock_uses where product_id=$1', [meal.id])).rows[0].n, 2);
  console.log('edit: ok');
}

console.log('product_drink_choices_save: ALL PASS');
