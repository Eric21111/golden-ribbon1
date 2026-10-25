/**
 * Drinks share one stock row across a meal's included choice and a paid extra line.
 * Sell in POS off hides the drink from the cashier menu and still allows it as the included choice.
 * Run: node tests/drink_inventory_integration.mjs
 */
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
for (const file of readdirSync('supabase/migrations').filter((name) => name.endsWith('.sql')).sort()) {
  await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8').replace(/create extension if not exists pgcrypto;/g, ''));
}

const id = (n) => `62000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const manager = id(1);
const cashier = id(2);
const main = id(10);
const booth = id(11);
await db.exec(`
  insert into auth.users values ('${manager}','m@t'),('${cashier}','c@t');
  insert into public.branches(id,name,code,is_main_branch,is_active,receiving_mode) values
    ('${main}','Main','MAIN-DK',true,true,'counted'),
    ('${booth}','Booth','BOOTH-DK',false,true,'cashier_confirm');
  insert into public.profiles(id,full_name,role,branch_id) values
    ('${manager}','Main Manager','manager','${main}'),
    ('${cashier}','Cashier','cashier','${booth}');
`);

const asUser = async (userId, work) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false);`);
  try { return await work(); } finally { await db.exec('reset role'); }
};
const J = (value) => JSON.stringify(value);
const money = (value) => Number(value).toFixed(2);
const rejects = async (work, pattern) => { await assert.rejects(work, pattern); };
const json = (value) => (typeof value === 'string' ? JSON.parse(value) : value);

const rice = await asUser(manager, () =>
  db.query(`select * from public.create_inventory_product('Rice','RICE-DK',null,'keep_at_branch')`),
).then((result) => result.rows[0]);
const sprite = await asUser(manager, () =>
  db.query(`select * from public.create_inventory_product('Sprite','SPRITE-DK',null,'keep_at_branch')`),
).then((result) => result.rows[0]);
const coke = await asUser(manager, () =>
  db.query(
    `select * from public.create_complete_product(p_name := 'Coke', p_sku := 'COKE-DK', p_description := null, p_variants := '[]'::jsonb, p_branches := $1::jsonb, p_selling_price := '25.00')`,
    [J([{ branch_id: booth, selling_price: '25.00' }])],
  ),
).then((result) => result.rows[0]);
const royal = await asUser(manager, () =>
  db.query(
    `select * from public.create_complete_product(p_name := 'Royal', p_sku := 'ROYAL-DK', p_description := null, p_variants := '[]'::jsonb, p_branches := $1::jsonb, p_selling_price := '30.00')`,
    [J([{ branch_id: booth, selling_price: '30.00' }])],
  ),
).then((result) => result.rows[0]);
const meal = await asUser(manager, () =>
  db.query(
    `select * from public.create_complete_product(p_name := 'Combo', p_sku := 'COMBO-DK', p_description := null, p_variants := $1::jsonb, p_branches := $2::jsonb, p_selling_price := null, p_stock_uses := $3::jsonb, p_drink_choices := $4::jsonb)`,
    [
      J([{ name: 'With Drink', default_price: '90.00' }, { name: 'Viand Only', default_price: '80.00' }]),
      J([{ branch_id: booth, variants: [{ name: 'With Drink', selling_price: '90.00' }, { name: 'Viand Only', selling_price: '80.00' }] }]),
      J([
        { ingredient_product_id: rice.id, quantity: 1, variant_name: 'With Drink' },
        { ingredient_product_id: rice.id, quantity: 1, variant_name: 'Viand Only' },
      ]),
      J([
        { drink_product_id: coke.id, variant_name: 'With Drink' },
        { drink_product_id: sprite.id, variant_name: 'With Drink' },
        { drink_product_id: royal.id, variant_name: 'With Drink' },
      ]),
    ],
  ),
).then((result) => result.rows[0]);

await asUser(manager, () => db.query(`select public.initialize_main_branch_inventory($1::jsonb, 'opening')`, [
  J([
    { product_id: rice.id, quantity: '20' },
    { product_id: sprite.id, quantity: '8' },
    { product_id: coke.id, quantity: '10' },
    { product_id: meal.id, quantity: '1' },
  ]),
]));
assert.equal((await db.query(`select is_active from public.products where id=$1`, [sprite.id])).rows[0].is_active, false);
for (const productId of [rice.id, sprite.id, coke.id, meal.id]) {
  await asUser(manager, () => db.query(`select public.set_product_status($1, true)`, [productId]));
}
const transferId = await asUser(manager, () =>
  db.query(`select public.send_stock_transfer($1, $2::jsonb, 'drinks', 'drink-transfer-000001') id`, [
    booth,
    J([
      { product_id: rice.id, quantity_sent: '10' },
      { product_id: sprite.id, quantity_sent: '3' },
      { product_id: coke.id, quantity_sent: '6' },
    ]),
  ]),
).then((result) => result.rows[0].id);
await asUser(cashier, () => db.query(`select public.confirm_shipment_arrival($1, 'drink-arrival-000001')`, [transferId]));

const catalog = Number((await db.query(
  `select count(*)::int n from public.branch_products where product_id = any($1::uuid[])`,
  [[rice.id, sprite.id]],
)).rows[0].n);
assert.equal(catalog, 0, 'a POS-off drink and a stock-only component get no catalog price');

const shiftId = await asUser(cashier, () => db.query(`select public.start_cashier_shift() id`)).then((result) => result.rows[0].id);
const pos = await asUser(cashier, () => db.query(`select * from public.list_cashier_pos_inventory()`)).then((result) => result.rows);
assert.deepEqual(pos.map((row) => row.product_name), ['Coke', 'Combo']);
assert.equal(money(pos.find((row) => row.product_name === 'Coke').selling_price), '25.00');

const withDrink = (await db.query(
  `select id::text from public.branch_product_variants where product_id = $1 and name = 'With Drink'`,
  [meal.id],
)).rows[0].id;
const viand = (await db.query(
  `select id::text from public.branch_product_variants where product_id = $1 and name = 'Viand Only'`,
  [meal.id],
)).rows[0].id;
const uses = json(pos.find((row) => row.product_name === 'Combo').stock_uses);
const offered = [...uses.drinks[withDrink]].map(String).sort();
assert.deepEqual(offered, [coke.id, sprite.id].sort(), 'inactive Royal is omitted; POS-off Sprite stays a choice');
assert.equal(uses.drinks[viand], undefined, 'an option with no Drink Choice does not require one');

const stock = async (productId) => Number((await db.query(
  `select quantity_on_hand from public.branch_inventory where branch_id = $1 and product_id = $2`,
  [booth, productId],
)).rows[0].quantity_on_hand);
const sell = (items, key) => asUser(cashier, () =>
  db.query(`select (public.confirm_sale($1, $2::jsonb, 1000, $3, 'standard')).*`, [shiftId, J(items), key]),
).then((result) => result.rows[0]);

const included = await sell(
  [{ product_id: meal.id, variant_id: withDrink, quantity: 1, drink_product_id: sprite.id }],
  'included-sprite-0001',
);
assert.equal(money(included.total_amount), '90.00', 'the included drink adds nothing, including no upgrade charge');
assert.equal(await stock(sprite.id), 2);
assert.equal(await stock(rice.id), 9);
assert.equal(await stock(coke.id), 6);

const mixed = await sell([
  { product_id: meal.id, variant_id: withDrink, quantity: 2, drink_product_id: coke.id },
  { product_id: coke.id, quantity: 1 },
], 'mixed-coke-00000001');
assert.equal(money(mixed.total_amount), '205.00', 'two meals at 90 plus one paid Coke at its selling price');
assert.equal(await stock(coke.id), 3, 'included drinks and the paid drink share one stock row');
const cokeMove = (await db.query(
  `select count(*)::int n, sum(quantity)::int qty from public.inventory_movements where reference_id = $1 and product_id = $2 and movement_type = 'sale'`,
  [mixed.id, coke.id],
)).rows[0];
assert.equal(cokeMove.n, 1);
assert.equal(Number(cokeMove.qty), -3);

const doubled = await sell([
  { product_id: meal.id, variant_id: withDrink, quantity: 1, drink_product_id: coke.id },
  { product_id: meal.id, variant_id: withDrink, quantity: 1, drink_product_id: coke.id },
], 'duplicate-lines-0001');
assert.equal(money(doubled.total_amount), '180.00');
assert.equal(await stock(coke.id), 1);
const doubledMove = (await db.query(
  `select count(*)::int n, sum(quantity)::int qty from public.inventory_movements where reference_id = $1 and product_id = $2 and movement_type = 'sale'`,
  [doubled.id, coke.id],
)).rows[0];
assert.equal(doubledMove.n, 1, 'repeated cart lines deduct the drink once for the sale');
assert.equal(Number(doubledMove.qty), -2);

const beforeFail = { coke: await stock(coke.id), sprite: await stock(sprite.id), rice: await stock(rice.id) };
await rejects(
  () => sell(
    [{ product_id: meal.id, variant_id: withDrink, quantity: 5, drink_product_id: sprite.id }],
    'sprite-short-000001',
  ),
  /insufficient stock/i,
);
assert.equal(await stock(coke.id), beforeFail.coke);
assert.equal(await stock(sprite.id), beforeFail.sprite);
assert.equal(await stock(rice.id), beforeFail.rice);

const plain = await sell([{ product_id: meal.id, variant_id: viand, quantity: 1 }], 'viand-no-drink-0001');
assert.equal(money(plain.total_amount), '80.00');
assert.equal(await stock(sprite.id), beforeFail.sprite);
assert.equal(await stock(coke.id), beforeFail.coke);

await rejects(
  () => sell([{ product_id: meal.id, variant_id: withDrink, quantity: 1 }], 'missing-drink-00001'),
  /choose a drink/i,
);
await rejects(
  () => sell([{ product_id: sprite.id, quantity: 1 }], 'sprite-alone-000001'),
  /not sold in POS|not available in this branch catalog/i,
);
await rejects(
  () => sell(
    [{ product_id: meal.id, variant_id: withDrink, quantity: 1, drink_product_id: royal.id }],
    'royal-inactive-0001',
  ),
  /inactive or unavailable/i,
);

const prices = (await db.query(
  `select sku, selling_price::text price, sell_in_pos from public.products where sku like '%-DK' order by sku`,
)).rows.map((row) => [row.sku, row.price, row.sell_in_pos]);
assert.deepEqual(prices, [
  ['COKE-DK', '25.00', true],
  ['COMBO-DK', '90.00', true],
  ['RICE-DK', null, false],
  ['ROYAL-DK', '30.00', true],
  ['SPRITE-DK', null, false],
]);
const variantPrices = (await db.query(
  `select name, default_price::text price from public.product_variants where product_id = $1 order by name`,
  [meal.id],
)).rows.map((row) => [row.name, row.price]);
assert.deepEqual(variantPrices, [
  ['Viand Only', '80.00'],
  ['With Drink', '90.00'],
]);

console.log('drink inventory integration: PASS');
