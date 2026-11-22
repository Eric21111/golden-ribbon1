/**
 * Phase 2 — native half-step recipe + sale/void deductions (PGlite local only).
 * FRACTIONAL_STOCK_USES_ENABLED stays false on the client; DB accepts half-step recipes.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { loadTs } from './_load_ts.mjs';

const half = loadTs('src/lib/halfStepQuantity.ts');
assert.equal(half.FRACTIONAL_STOCK_USES_ENABLED, false, 'client gate stays off in Phase 2');

assert.equal(
  readdirSync('supabase/migrations').filter((n) => n.includes('egg_half_unit') || n.includes('egg_cutover')).length,
  0,
  'Egg cutover stays quarantined',
);

const BOOT = `
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
`;

const db = new PGlite();
await db.exec(BOOT);
for (const file of readdirSync('supabase/migrations').filter((n) => n.endsWith('.sql')).sort()) {
  await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8').replace(/create extension if not exists pgcrypto;/g, ''));
}

const id = (n) => `a2000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1);
const manager = id(2);
const cashier = id(3);
const main = id(10);
const branch = id(11);
const rice = id(20);
const meal = id(21);
const portionEgg = id(22);
const portionMeal = id(23);

await db.exec(`
  insert into auth.users values ('${owner}','o@test'),('${manager}','m@test'),('${cashier}','c@test');
  insert into public.branches(id,name,code,is_main_branch,is_active) values
    ('${main}','Main','MAIN',true,true),('${branch}','SM1','SM1',false,true);
  insert into public.profiles(id,full_name,role,branch_id) values
    ('${owner}','Owner','owner','${main}'),
    ('${manager}','Manager','manager','${main}'),
    ('${cashier}','Cashier','cashier','${branch}');
  insert into public.products(id,name,sku,selling_price,is_active,inventory_mode,closing_stock_behavior,sell_in_pos,stock_unit_code)
  values
    ('${rice}','Rice','RICE-HS',15,true,'piece_stock','keep_at_branch',false,null),
    ('${meal}','Rice Meal','MEAL-HS',50,true,'piece_stock','record_as_unsold',true,null),
    ('${portionEgg}','Portion Egg','PEGG-HS',null,true,'piece_stock','keep_at_branch',false,'half_egg'),
    ('${portionMeal}','Portion Meal','PMEAL-HS',40,true,'piece_stock','record_as_unsold',true,null);
  insert into public.branch_products(branch_id,product_id,selling_price,is_active) values
    ('${branch}','${meal}',50,true),('${branch}','${portionMeal}',40,true);
`);

const asUser = async (userId, work) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false);`);
  try {
    return await work();
  } finally {
    await db.exec(`select set_config('request.jwt.claim.sub','',false); reset role;`);
  }
};

await asUser(manager, () =>
  db.query('select public.initialize_main_branch_inventory($1::jsonb,$2)', [
    JSON.stringify([
      { product_id: rice, quantity: '10' },
      { product_id: portionEgg, quantity: '10' },
    ]),
    'half-step opening',
  ]),
);

// Transfer rice + portion egg to selling branch (whole units — Phase 4 still owns fractional transfers)
const transferId = (
  await asUser(manager, () =>
    db.query('select public.send_stock_transfer($1,$2::jsonb,null,$3) id', [
      branch,
      JSON.stringify([
        { product_id: rice, quantity_sent: 10 },
        { product_id: portionEgg, quantity_sent: 10 },
      ]),
      'half-step-transfer-001',
    ]),
  )
).rows[0].id;
await asUser(cashier, () => db.query('select public.confirm_shipment_arrival($1,$2)', [transferId, 'half-step-arrival-001']));

const onHand = async (productId) =>
  Number(
    (
      await db.query(
        'select quantity_on_hand::float8 q from public.branch_inventory where branch_id=$1 and product_id=$2',
        [branch, productId],
      )
    ).rows[0].q,
  );

assert.equal(await onHand(rice), 10);

const riceIdBefore = (await db.query('select id::text, sku from public.products where id=$1', [rice])).rows[0];

const updateStockUses = (productId, name, sku, price, stockUses) =>
  asUser(manager, () =>
    db.query(
      `select * from public.update_complete_product(
        p_product_id := $1, p_name := $2, p_sku := $3, p_description := null, p_is_active := true,
        p_variants := '[]'::jsonb, p_deleted_variant_ids := '[]'::jsonb, p_branches := $4::jsonb,
        p_selling_price := $5, p_stock_uses := $6::jsonb
      )`,
      [
        productId,
        name,
        sku,
        JSON.stringify([{ branch_id: branch, selling_price: price }]),
        price,
        JSON.stringify(stockUses),
      ],
    ),
  );

// Phase 4A: fractional recipe RPC saves require the privileged server gate (default OFF).
await asUser(owner, () => db.query('select public.set_fractional_recipe_saving_enabled(true)'));

await updateStockUses(meal, 'Rice Meal', 'MEAL-HS', '50.00', [{ ingredient_product_id: rice, quantity: 0.5 }]);
assert.equal(
  Number((await db.query('select quantity::float8 q from public.product_stock_uses where product_id=$1', [meal])).rows[0].q),
  0.5,
);

// Reject invalid recipe quantities through the public save path
for (const bad of [0, -0.5, 0.3, 0.49, 100, 1.25]) {
  await assert.rejects(
    () => updateStockUses(meal, 'Rice Meal', 'MEAL-HS', '50.00', [{ ingredient_product_id: rice, quantity: bad }]),
    /half-step|Quantity must/i,
    `rejects ${bad}`,
  );
}

await asUser(owner, () => db.query('select public.set_fractional_recipe_saving_enabled(false)'));
// Direct table write still allowed for sale path when gate is off (constraint remains half-step).
await assert.rejects(
  () => updateStockUses(meal, 'Rice Meal', 'MEAL-HS', '50.00', [{ ingredient_product_id: rice, quantity: 1.5 }]),
  /whole number from 1 to 99/i,
  'gate OFF rejects fractional recipe RPC saves',
);
// Re-enable briefly for portion checks below that go through update_complete_product with integer qty only.
await asUser(owner, () => db.query('select public.set_fractional_recipe_saving_enabled(true)'));

// Portion-coded ingredient rejects fractional stored quantity
await assert.rejects(
  () =>
    updateStockUses(portionMeal, 'Portion Meal', 'PMEAL-HS', '40.00', [
      { ingredient_product_id: portionEgg, quantity: 0.5 },
    ]),
  /Portion-unit|whole stock-unit|half-step|Quantity must/i,
);
await updateStockUses(portionMeal, 'Portion Meal', 'PMEAL-HS', '40.00', [
  { ingredient_product_id: portionEgg, quantity: 1 },
]);
await asUser(owner, () => db.query('select public.set_fractional_recipe_saving_enabled(false)'));

const shift = (await asUser(cashier, () => db.query('select public.start_cashier_shift() id'))).rows[0].id;

const sell = (key, productId = meal, paid = 50) =>
  asUser(cashier, () =>
    db.query('select (public.confirm_sale($1,$2::jsonb,$3,$4,$5,$6)).id id', [
      shift,
      JSON.stringify([{ product_id: productId, quantity: 1 }]),
      paid,
      key,
      'standard',
      'cash',
    ]),
  );

const sale1 = (await sell('half-step-sale-00000001')).rows[0].id;
assert.equal(await onHand(rice), 9.5, '10 - 0.5 = 9.5');

await sell('half-step-sale-00000002');
assert.equal(await onHand(rice), 9, '9.5 - 0.5 = 9');

// Whole-number sale of portion meal still works (1 half-egg unit)
await sell('half-step-sale-00000003', portionMeal, 40);
assert.equal(await onHand(portionEgg), 9);

const itemId = (
  await db.query('select id::text from public.sale_items where sale_id=$1 and product_id=$2', [sale1, meal])
).rows[0].id;
await asUser(cashier, () =>
  db.query('select public.void_cashier_sale_item($1::uuid,1,1,$2,$3)', [itemId, 'Wrong quantity', '']),
);
assert.equal(await onHand(rice), 9.5, 'void restores 0.5');

// Idempotent retry
const again = (await sell('half-step-sale-00000002')).rows[0].id;
assert.ok(again);

// Another sale after void
await sell('half-step-sale-00000004');
assert.equal(await onHand(rice), 9);

// POS sellable with 0.5 remaining (set locally; not a transfer fractional path)
await db.exec(`update public.branch_inventory set quantity_on_hand = 0.5 where branch_id='${branch}' and product_id='${rice}'`);
assert.equal(await onHand(rice), 0.5);
await db.exec('reset role');
const sellable = Number(
  (
    await db.query('select public.pos_lines_sellable($1,$2::jsonb) n', [
      branch,
      JSON.stringify([{ ingredient_product_id: rice, quantity: 0.5 }]),
    ])
  ).rows[0].n,
);
assert.equal(sellable, 1, '0.5 on hand / 0.5 recipe = 1 sellable');
await sell('half-step-sale-00000005');
assert.equal(await onHand(rice), 0);
await assert.rejects(() => sell('half-step-sale-00000006'), /Insufficient stock/i);

const riceAfter = (await db.query('select id::text, sku from public.products where id=$1', [rice])).rows[0];
assert.deepEqual(riceAfter, riceIdBefore, 'product id/sku unchanged');

console.log(
  'piece_half_step_confirm_sale passed: 10→9.5→9, void→9.5, rejects bad qty, portion integers preserved, POS 0.5 sellable, gate off, no Egg cutover.',
);
await db.close();
