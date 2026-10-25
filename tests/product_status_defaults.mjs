// Product Status and Sell Separately defaults, manual overrides, and zero stock.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

import { applySetupDefaults, defaultsForProductSetup } from '../src/features/products/wizardGuards.ts';

assert.deepEqual(defaultsForProductSetup('supplies'), { enabled: true, sellSeparately: false });
assert.deepEqual(defaultsForProductSetup('meals'), { enabled: true, sellSeparately: true });
assert.deepEqual(defaultsForProductSetup('snacks'), { enabled: true, sellSeparately: true });
assert.deepEqual(defaultsForProductSetup('extras'), { enabled: true, sellSeparately: true });
assert.deepEqual(defaultsForProductSetup('drinks'), { enabled: true, sellSeparately: true });

const mealOnlyDrink = applySetupDefaults({
  category: 'drinks',
  enabled: true,
  sellSeparately: false,
  enabledOverridden: false,
  sellOverridden: true,
});
assert.deepEqual(mealOnlyDrink, { enabled: true, sellSeparately: false }, 'a manual No on a drink is kept');

const backToMeal = applySetupDefaults({
  category: 'meals',
  enabled: false,
  sellSeparately: false,
  enabledOverridden: true,
  sellOverridden: true,
});
assert.deepEqual(backToMeal, { enabled: false, sellSeparately: false }, 'manual overrides survive a setup change');

const supplyDefault = applySetupDefaults({
  category: 'supplies',
  enabled: true,
  sellSeparately: true,
  enabledOverridden: false,
  sellOverridden: false,
});
assert.deepEqual(supplyDefault, { enabled: true, sellSeparately: false });

const createSrc = readFileSync('src/features/products/CreateProductWizard.tsx', 'utf8');
const editSrc = readFileSync('src/features/products/EditProductWizard.tsx', 'utf8');
assert.match(createSrc, /applySetupDefaults\(/);
assert.doesNotMatch(editSrc, /applySetupDefaults\(/);
assert.doesNotMatch(createSrc, /name\.includes|sku\.includes/);
assert.match(editSrc, /useState\(product\.is_active\)/);
assert.match(editSrc, /useState\(product\.sell_in_pos !== false\)/);

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

const id = (n) => `71000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const manager = id(1);
const cashier = id(2);
const main = id(10);
const booth = id(11);

await db.exec(`
  insert into auth.users values ('${manager}','m@t'),('${cashier}','c@t');
  insert into public.branches(id,name,code,is_main_branch,is_active,receiving_mode) values
    ('${main}','Main','MAIN-ST',true,true,'counted'),
    ('${booth}','Booth','BOOTH-ST',false,true,'cashier_confirm');
  insert into public.profiles(id,full_name,role,branch_id) values
    ('${manager}','Main Manager','manager','${main}'),
    ('${cashier}','Cashier','cashier','${booth}');
`);

const asUser = async (userId, work) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false);`);
  try {
    return await work();
  } finally {
    await db.exec('reset role');
  }
};

const rice = await asUser(manager, () =>
  db.query(`select * from public.create_inventory_product('Rice','RICE-ST',null,'keep_at_branch')`),
).then((result) => result.rows[0]);
assert.equal(rice.is_active, false);
assert.equal(rice.selling_price, null);
assert.equal(rice.sell_in_pos, false);

const enabled = await asUser(manager, () =>
  db.query(`select * from public.set_product_status($1, true)`, [rice.id]),
).then((result) => result.rows[0]);
assert.equal(enabled.is_active, true, 'a supply can be enabled with zero stock');
assert.equal(enabled.selling_price, null);
assert.equal(enabled.sell_in_pos, false);

await asUser(manager, () =>
  db.query(`select public.initialize_main_branch_inventory($1::jsonb, 'opening')`, [
    JSON.stringify([{ product_id: rice.id, quantity: '5' }]),
  ]),
);
await asUser(manager, () => db.query(`select public.set_product_status($1, false)`, [rice.id]));
await asUser(manager, () =>
  db.query(`select public.initialize_main_branch_inventory($1::jsonb, 'more')`, [
    JSON.stringify([{ product_id: rice.id, quantity: '2' }]),
  ]),
);
const afterStock = (await db.query(
  `select is_active, selling_price::text price, sell_in_pos from public.products where id=$1`,
  [rice.id],
)).rows[0];
assert.equal(afterStock.is_active, false, 'opening stock does not turn a disabled product back on');
assert.equal(afterStock.price, null);
assert.equal(afterStock.sell_in_pos, false);
assert.equal(
  Number((await db.query(`select quantity_on_hand from public.branch_inventory where product_id=$1 and branch_id=$2`, [rice.id, main])).rows[0].quantity_on_hand),
  7,
);

const coke = await asUser(manager, () =>
  db.query(
    `select * from public.create_complete_product(p_name := 'Coke', p_sku := 'COKE-ST', p_description := null, p_variants := '[]'::jsonb, p_branches := $1::jsonb, p_selling_price := '25.00')`,
    [JSON.stringify([{ branch_id: booth, selling_price: '25.00' }])],
  ),
).then((result) => result.rows[0]);
assert.equal(coke.is_active, false);
assert.equal(Number(coke.selling_price), 25);
await asUser(manager, () => db.query(`select public.set_product_status($1, true)`, [coke.id]));
const cokeRow = (await db.query(`select is_active, selling_price::text price from public.products where id=$1`, [coke.id])).rows[0];
assert.equal(cokeRow.is_active, true);
assert.equal(cokeRow.price, '25.00');

await assert.rejects(
  () => asUser(cashier, () => db.query(`select public.set_product_status($1, false)`, [coke.id])),
  /unauthorized|main branch manager/i,
);

const shiftId = await asUser(cashier, () => db.query(`select public.start_cashier_shift() id`)).then((result) => result.rows[0].id);
await assert.rejects(
  () => asUser(cashier, () =>
    db.query(`select public.confirm_sale($1, $2::jsonb, 25, 'status-zero-stock-sale', 'standard')`, [
      shiftId,
      JSON.stringify([{ product_id: coke.id, quantity: 1 }]),
    ]),
  ),
  /insufficient stock/i,
);
const afterReject = (await db.query(`select is_active, selling_price::text price from public.products where id=$1`, [coke.id])).rows[0];
assert.equal(afterReject.is_active, true, 'a rejected sale does not change Product Status');
assert.equal(afterReject.price, '25.00');
assert.equal(Number((await db.query(`select count(*)::int n from public.sales`)).rows[0].n), 0);

console.log('product_status_defaults: PASS');
