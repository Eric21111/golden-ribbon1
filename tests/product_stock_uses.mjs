// Shared inventory, Step 1: public.product_stock_uses (schema, constraints, access control).
// Runs every migration in PGlite. Verifies the table on its own and that existing behaviour is untouched.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migrationFile = 'supabase/migrations/20261023090000_product_stock_uses.sql';
const migration = readFileSync(migrationFile, 'utf8');

// ---------------------------------------------------------------- 0. the migration is additive only
{
  // executable SQL only: drop -- comments and COMMENT ON statements (documentation may mention confirm_sale)
  const code = migration.replace(/--[^\n]*/g, '').replace(/comment on [\s\S]*?;\n/gi, '');
  assert.doesNotMatch(code, /confirm_sale/i, 'confirm_sale is not touched');
  assert.doesNotMatch(code, /create (or replace )?function|drop function/i, 'no function is created or changed');
  assert.doesNotMatch(code, /\bdrop\s+(table|column|index|constraint|policy|trigger)\b/i, 'nothing is dropped');
  assert.doesNotMatch(code, /\balter table public\.(products|branch_inventory|inventory_movements|sales|sale_items|branch_products|branch_product_variants)\b/i);
  assert.doesNotMatch(code, /\b(update|delete from)\s+public\./i, 'no existing rows are changed');
  assert.doesNotMatch(code, /\binsert into\b/i, 'no data is added');
  // the only thing it does to an existing table is add a unique index that cannot reject existing rows
  assert.match(code, /create unique index if not exists product_variants_id_product_id_key\s+on public\.product_variants \(id, product_id\)/);
  // later migrations may build on the table (Step 2 wires it into confirm_sale) but must not alter its shape
  for (const later of readdirSync('supabase/migrations').filter((f) => f > '20261023090000_product_stock_uses.sql')) {
    const text = readFileSync(`supabase/migrations/${later}`, 'utf8').replace(/--[^\n]*/g, '');
    assert.doesNotMatch(text, /alter table public\.product_stock_uses|drop table public\.product_stock_uses|drop index[^;]*product_stock_uses/i, later);
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
for (const file of readdirSync('supabase/migrations').filter((name) => name.endsWith('.sql')).sort()) {
  await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8').replace(/create extension if not exists pgcrypto;/g, ''));
}

const id = (n) => `51000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1);
const mainManager = id(2);
const cashier = id(3);
const stranger = id(4); // signed in but has no profile
const main = id(10);
const branch1 = id(11);
const curry = id(20);
const tapa = id(21);
const egg = id(22);
const rice = id(23);
const bbq = id(24);
const iced = id(25);
const curryViand = id(30);
const curryRice = id(31);
const tapaOnly = id(32);

await db.exec(`
  insert into auth.users values ('${owner}','o@test'),('${mainManager}','m@test'),('${cashier}','c@test'),('${stranger}','s@test');
  insert into public.branches(id,name,code,is_main_branch,is_active) values
    ('${main}','Main','MAIN-SU',true,true),('${branch1}','Branch 1','B1-SU',false,true);
  insert into public.profiles(id,full_name,role,branch_id) values
    ('${owner}','Owner','owner',null),
    ('${mainManager}','Main Manager','manager','${main}'),
    ('${cashier}','Cashier','cashier','${branch1}');
  insert into public.products(id,name,sku,selling_price,is_active) values
    ('${curry}','Chicken Curry','CURRY-SU',70,true),
    ('${tapa}','Tapa','TAPA-SU',90,true),
    ('${egg}','Egg','EGG-SU',10,true),
    ('${rice}','Rice','RICE-SU',15,true),
    ('${bbq}','BBQ','BBQ-SU',20,true),
    ('${iced}','Iced Tea','ICED-SU',30,true);
  insert into public.product_variants(id,product_id,name,default_price) values
    ('${curryViand}','${curry}','Viand Only',70),
    ('${curryRice}','${curry}','With Rice',85),
    ('${tapaOnly}','${tapa}','Tapa Meal',90);
`);

const asUser = async (userId, work) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false);`);
  try {
    return await work();
  } finally {
    await db.exec('reset role');
  }
};
const asAnon = async (work) => {
  await db.exec(`set role anon; select set_config('request.jwt.claim.sub','',false);`);
  try {
    return await work();
  } finally {
    await db.exec('reset role');
  }
};
const rejects = async (sql, pattern, label) => {
  let error = null;
  try {
    await db.exec(sql);
  } catch (e) {
    error = e;
  }
  assert.ok(error, `${label}: should have been rejected`);
  assert.match(String(error.message), pattern, `${label}: wrong error: ${error.message}`);
};
const count = async (where = 'true') => Number((await db.query(`select count(*)::int n from public.product_stock_uses where ${where}`)).rows[0].n);
const addUse = (product, variant, ingredient, quantity) =>
  db.exec(`insert into public.product_stock_uses(product_id,variant_id,ingredient_product_id,quantity)
           values ('${product}',${variant ? `'${variant}'` : 'null'},'${ingredient}',${quantity})`);

// ---------------------------------------------------------------- 1. shape
{
  const cols = (await db.query(`
    select column_name, data_type, is_nullable from information_schema.columns
    where table_schema='public' and table_name='product_stock_uses' order by ordinal_position`)).rows;
  const byName = Object.fromEntries(cols.map((c) => [c.column_name, c]));
  assert.deepEqual(Object.keys(byName), ['id', 'product_id', 'variant_id', 'ingredient_product_id', 'quantity', 'created_at', 'updated_at']);
  assert.equal(byName.quantity.data_type, 'integer', 'whole numbers only');
  assert.equal(byName.quantity.is_nullable, 'NO');
  assert.equal(byName.variant_id.is_nullable, 'YES', 'variant is optional (products without variants)');
  for (const required of ['id', 'product_id', 'ingredient_product_id']) assert.equal(byName[required].is_nullable, 'NO');

  const idx = (await db.query(`select indexname from pg_indexes where schemaname='public' and tablename='product_stock_uses'`)).rows.map((r) => r.indexname);
  for (const name of ['product_stock_uses_pkey', 'product_stock_uses_product_level_key', 'product_stock_uses_variant_key', 'product_stock_uses_product_idx', 'product_stock_uses_ingredient_idx']) {
    assert.ok(idx.includes(name), `index ${name}`);
  }
  const rls = (await db.query(`select relrowsecurity from pg_class where oid = 'public.product_stock_uses'::regclass`)).rows[0];
  assert.equal(rls.relrowsecurity, true, 'row level security is on');
  console.log('shape: ok');
}

// ---------------------------------------------------------------- 2. rows that must be accepted
{
  await addUse(curry, curryViand, egg, 1); // Chicken Curry / Viand Only uses Egg x1 (a half-egg unit)
  await addUse(curry, curryRice, egg, 1);
  await addUse(curry, curryRice, rice, 1); // With Rice also uses Rice x1
  await addUse(tapa, tapaOnly, egg, 2); // Tapa uses a whole egg = 2 half-egg units
  await addUse(iced, null, egg, 2); // product without variants (product-level)
  await addUse(bbq, null, bbq, 3); // a product may use its own pool (BBQ x3)
  await addUse(egg, null, egg, 2); // "Extra Egg": the Egg product itself, 2 half-egg units
  assert.equal(await count(), 7);
  assert.equal(await count(`ingredient_product_id='${egg}'`), 5, 'five different configurations share one Egg ingredient');
  // the same ingredient may appear for different variants, and at product level next to variant lines
  await addUse(curry, null, egg, 1);
  assert.equal(await count(`product_id='${curry}'`), 4);
  await db.exec(`delete from public.product_stock_uses where product_id='${curry}' and variant_id is null`);
  console.log('accepted rows: ok');
}

// ---------------------------------------------------------------- 3. quantity must be a positive whole number
{
  for (const bad of [0, -1, 100, 1000]) {
    await rejects(
      `insert into public.product_stock_uses(product_id,variant_id,ingredient_product_id,quantity) values ('${tapa}','${tapaOnly}','${rice}',${bad})`,
      /check|violates/i,
      `quantity ${bad}`,
    );
  }
  await rejects(`insert into public.product_stock_uses(product_id,variant_id,ingredient_product_id,quantity) values ('${tapa}','${tapaOnly}','${rice}','1.5')`, /invalid input syntax for type integer/i, 'quantity 1.5 as text');
  await rejects(`insert into public.product_stock_uses(product_id,variant_id,ingredient_product_id,quantity) values ('${tapa}','${tapaOnly}','${rice}',null)`, /null value|not-null/i, 'null quantity');
  await rejects(`update public.product_stock_uses set quantity = 0 where product_id='${tapa}'`, /check|violates/i, 'update to 0');
  // the boundaries are accepted
  await addUse(tapa, tapaOnly, rice, 1);
  await db.exec(`update public.product_stock_uses set quantity = 99 where product_id='${tapa}' and ingredient_product_id='${rice}'`);
  await db.exec(`delete from public.product_stock_uses where product_id='${tapa}' and ingredient_product_id='${rice}'`);
  assert.equal(await count(), 7);
  console.log('quantity rules: ok');
}

// ---------------------------------------------------------------- 4. no duplicate ingredient in one configuration
{
  await rejects(`insert into public.product_stock_uses(product_id,variant_id,ingredient_product_id,quantity) values ('${curry}','${curryRice}','${egg}',1)`, /duplicate key|unique/i, 'duplicate variant line');
  await rejects(`insert into public.product_stock_uses(product_id,variant_id,ingredient_product_id,quantity) values ('${iced}',null,'${egg}',1)`, /duplicate key|unique/i, 'duplicate product-level line (NULL variant)');
  await rejects(`insert into public.product_stock_uses(product_id,variant_id,ingredient_product_id,quantity) values ('${bbq}',null,'${bbq}',1)`, /duplicate key|unique/i, 'duplicate self line');
  // a duplicate cannot be created by editing a row either
  await addUse(tapa, tapaOnly, rice, 1);
  await rejects(`update public.product_stock_uses set ingredient_product_id='${egg}' where product_id='${tapa}' and ingredient_product_id='${rice}'`, /duplicate key|unique/i, 'update into a duplicate');
  await db.exec(`delete from public.product_stock_uses where product_id='${tapa}' and ingredient_product_id='${rice}'`);
  assert.equal(await count(), 7);
  console.log('duplicates: ok');
}

// ---------------------------------------------------------------- 5. references must be real
{
  const ghost = id(999);
  await rejects(`insert into public.product_stock_uses(product_id,variant_id,ingredient_product_id,quantity) values ('${ghost}',null,'${egg}',1)`, /foreign key/i, 'unknown product');
  await rejects(`insert into public.product_stock_uses(product_id,variant_id,ingredient_product_id,quantity) values ('${tapa}','${tapaOnly}','${ghost}',1)`, /foreign key/i, 'unknown ingredient');
  await rejects(`insert into public.product_stock_uses(product_id,variant_id,ingredient_product_id,quantity) values ('${tapa}','${ghost}','${rice}',1)`, /foreign key/i, 'unknown variant');
  // a variant of ANOTHER product is rejected, even though both ids exist
  await rejects(`insert into public.product_stock_uses(product_id,variant_id,ingredient_product_id,quantity) values ('${tapa}','${curryViand}','${rice}',1)`, /foreign key|product_stock_uses_variant_belongs_to_product_fkey/i, 'variant of a different product');
  // an existing line cannot be re-pointed at another product's variant
  await addUse(tapa, tapaOnly, rice, 1);
  await rejects(`update public.product_stock_uses set variant_id='${curryViand}' where product_id='${tapa}' and ingredient_product_id='${rice}'`, /foreign key/i, 're-pointing a line at another product\'s variant');
  await db.exec(`delete from public.product_stock_uses where product_id='${tapa}' and ingredient_product_id='${rice}'`);
  assert.equal(await count(), 7);
  console.log('references: ok');
}

// ---------------------------------------------------------------- 6. deleting things
{
  // an ingredient that is in use cannot be deleted (and so cannot silently disappear from recipes)
  await rejects(`delete from public.products where id='${rice}'`, /foreign key|violates/i, 'delete an ingredient in use');
  assert.equal(await count(`ingredient_product_id='${rice}'`), 1);

  // removing a variant removes only that variant's lines (update_complete_product deletes variants this way)
  await db.exec(`delete from public.product_variants where id='${curryRice}'`);
  assert.equal(await count(`variant_id='${curryRice}'`), 0, "the removed variant's lines are gone");
  assert.equal(await count(`variant_id='${curryViand}'`), 1, "the other variant's lines stay");
  assert.equal((await db.query(`select count(*)::int n from public.products where id in ('${egg}','${rice}')`)).rows[0].n, 2, 'ingredients are untouched');

  // deleting a sold product removes its own lines, never the ingredient or other products' lines
  await db.exec(`delete from public.product_stock_uses where ingredient_product_id='${rice}'`);
  await db.exec(`delete from public.products where id='${iced}'`);
  assert.equal(await count(`product_id='${iced}'`), 0);
  assert.equal(await count(`product_id='${tapa}'`), 1);
  assert.equal((await db.query(`select count(*)::int n from public.products where id='${egg}'`)).rows[0].n, 1);
  // put the fixtures back for the access-control section
  await db.exec(`insert into public.products(id,name,sku,selling_price,is_active) values ('${iced}','Iced Tea','ICED-SU',30,true)`);
  await db.exec(`insert into public.product_variants(id,product_id,name,default_price) values ('${curryRice}','${curry}','With Rice',85)`);
  await addUse(iced, null, egg, 2);
  await addUse(curry, curryRice, egg, 1);
  await addUse(curry, curryRice, rice, 1);
  console.log('deleting: ok');
}

// ---------------------------------------------------------------- 7. access control
{
  const total = await count();
  // staff with a role can read
  for (const [who, user] of [['owner', owner], ['main manager', mainManager], ['cashier', cashier]]) {
    const n = await asUser(user, async () => Number((await db.query('select count(*)::int n from public.product_stock_uses')).rows[0].n));
    assert.equal(n, total, `${who} can read every line`);
  }
  // a signed-in user with no profile / role sees nothing
  assert.equal(await asUser(stranger, async () => Number((await db.query('select count(*)::int n from public.product_stock_uses')).rows[0].n)), 0, 'no role = no rows');
  // anon has no access at all
  await asAnon(async () => {
    await assert.rejects(db.query('select * from public.product_stock_uses'), /permission denied/i);
  });
  // nobody can write through the API yet, whatever their role
  for (const [who, user] of [['owner', owner], ['main manager', mainManager], ['cashier', cashier]]) {
    await asUser(user, async () => {
      await assert.rejects(db.exec(`insert into public.product_stock_uses(product_id,variant_id,ingredient_product_id,quantity) values ('${bbq}',null,'${egg}',1)`), /permission denied/i, `${who} insert`);
      await assert.rejects(db.exec(`update public.product_stock_uses set quantity = 5`), /permission denied/i, `${who} update`);
      await assert.rejects(db.exec(`delete from public.product_stock_uses`), /permission denied/i, `${who} delete`);
    });
  }
  assert.equal(await count(), total, 'nothing changed');
  const grants = (await db.query(`
    select grantee, privilege_type from information_schema.role_table_grants
    where table_schema='public' and table_name='product_stock_uses' and grantee in ('anon','authenticated','public')
    order by grantee, privilege_type`)).rows.map((r) => `${r.grantee}:${r.privilege_type}`);
  assert.deepEqual(grants, ['authenticated:SELECT'], 'the only grant is SELECT for authenticated');
  console.log('access control: ok');
}

// ---------------------------------------------------------------- 8. updated_at is maintained
{
  const before = (await db.query(`select updated_at from public.product_stock_uses where product_id='${bbq}'`)).rows[0].updated_at;
  await db.exec(`select pg_sleep(0.01); update public.product_stock_uses set quantity = 4 where product_id='${bbq}'`);
  const after = (await db.query(`select updated_at from public.product_stock_uses where product_id='${bbq}'`)).rows[0].updated_at;
  assert.ok(new Date(after) > new Date(before), 'updated_at moves forward on edit');
}

// ---------------------------------------------------------------- 9. existing behaviour is unchanged
{
  // product_variants kept its columns, constraints and data; only the extra unique index exists
  const cols = (await db.query(`select column_name from information_schema.columns where table_schema='public' and table_name='product_variants' order by ordinal_position`)).rows.map((r) => r.column_name);
  assert.deepEqual(cols, ['id', 'product_id', 'name', 'default_price', 'is_active', 'sort_order', 'created_at', 'updated_at']);
  assert.equal((await db.query(`select count(*)::int n from public.product_variants where product_id='${curry}'`)).rows[0].n, 2);
  // variants can still be created and renamed exactly as before, with or without stock uses
  await db.exec(`insert into public.product_variants(product_id,name,default_price) values ('${curry}','Extra Large',100)`);
  await db.exec(`update public.product_variants set name='XL' where product_id='${curry}' and name='Extra Large'`);
  await assert.rejects(db.exec(`insert into public.product_variants(product_id,name,default_price) values ('${curry}','XL',1)`), /duplicate key|unique/i, 'the (product, name) rule still applies');
  // confirm_sale: still exactly one function. (Step 2 later teaches it to read the table; that is tested in
  // shared_inventory_confirm_sale.mjs.)
  const def = (await db.query(`select pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='confirm_sale'`)).rows;
  assert.equal(def.length, 1);
  // branch inventory and products are untouched by the new table
  const refs = (await db.query(`
    select conrelid::regclass::text t from pg_constraint
    where contype='f' and confrelid in ('public.product_stock_uses'::regclass)`)).rows;
  assert.equal(refs.length, 0, 'nothing else references the new table');
  console.log('existing behaviour: ok');
}

console.log('product_stock_uses: ALL PASS');
