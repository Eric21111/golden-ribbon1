// Drink Choice, Steps 3-5: selling a meal with one eligible drink (sale_items columns, confirm_sale, POS availability).
// Products are created through the real RPC, so branch and master variant ids are genuinely different.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const SALE_ITEM = '20261024110000_sale_item_drink.sql';
const SALE = '20261024120000_confirm_sale_drink_choice.sql';
const POS = '20261024130000_pos_drink_availability.sql';
const read = (f) => readFileSync(`supabase/migrations/${f}`, 'utf8').replace(/\r\n/g, '\n');
const strip = (t) => t.replace(/--[^\n]*/g, '').replace(/comment on [\s\S]*?;\n/gi, '');

// ---------------------------------------------------------------- 0. static: scope of the migrations
{
  const items = strip(read(SALE_ITEM));
  assert.deepEqual([...items.matchAll(/alter table (public\.\w+)/gi)].map((m) => m[1]), ['public.sale_items']);
  assert.match(items, /add column if not exists drink_product_id uuid references public\.products\(id\),\s*add column if not exists drink_name text;/);
  assert.match(items, /create unique index if not exists sale_items_sale_product_variant_drink_idx/);
  assert.doesNotMatch(items, /\bupdate public\.|\bdelete from\b|\binsert into\b/i, 'no existing row is changed');

  const sale = strip(read(SALE));
  assert.equal((sale.match(/create or replace function/gi) ?? []).length, 1);
  assert.doesNotMatch(sale, /\balter table\b|\bcreate table\b|\bdrop\b/i);
  // the stored request of a sale without a drink is byte-identical: the drink key only exists when there is one
  assert.match(sale, /when drink_product_id is null then '\{\}'::jsonb/);
  // the drink joins the SAME aggregation: one extra line in the expansion, no second deduction loop
  assert.equal((sale.match(/jsonb_to_recordset\(v_deductions\)/g) ?? []).length, 2, 'check and deduct still share one list');
  assert.match(sale, /select r\.quantity, r\.drink_product_id\s+from resolved r\s+where r\.drink_product_id is not null/);

  const pos = strip(read(POS));
  assert.doesNotMatch(pos, /confirm_sale|\balter table\b|\bdrop\b|\binsert into\b/i);
  assert.match(pos, /revoke all on function public\.pos_variant_drink_ids\(uuid, text\) from public, anon, authenticated;/);
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

const id = (n) => `60000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const mainMgr = id(2);
const cashier = id(4);
const main = id(10);
const booth = id(11);
const egg = id(20);
const rice = id(21);
const coke = id(22);
const royal = id(23);
const sprite = id(24);

await db.exec(`
  insert into auth.users values ('${mainMgr}','m@t'),('${cashier}','c@t');
  insert into public.branches(id,name,code,is_main_branch,is_active,receiving_mode) values
    ('${main}','Main','MAIN-DS',true,true,'counted'),('${booth}','Booth','BOOTH-DS',false,true,'cashier_confirm');
  insert into public.profiles(id,full_name,role,branch_id) values
    ('${mainMgr}','Main Manager','manager','${main}'),('${cashier}','Cashier One','cashier','${booth}');
  insert into public.products(id,name,sku,selling_price,is_active,inventory_mode,closing_stock_behavior) values
    ('${egg}','Egg','EGG-DS',10,true,'piece_stock','keep_at_branch'),
    ('${rice}','Rice','RICE-DS',15,true,'piece_stock','keep_at_branch'),
    ('${coke}','Coke','COKE-DS',20,true,'piece_stock','keep_at_branch'),
    ('${royal}','Royal','ROYAL-DS',20,true,'piece_stock','keep_at_branch'),
    ('${sprite}','Sprite','SPRITE-DS',20,true,'piece_stock','keep_at_branch');
  insert into public.branch_products(branch_id,product_id,selling_price,is_active) values
    ('${booth}','${egg}',10,true),('${booth}','${rice}',15,true),('${booth}','${coke}',20,true),('${booth}','${royal}',20,true),('${booth}','${sprite}',20,true);
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

const createProduct = (name, sku, variants, { stockUses, drinkChoices } = {}) =>
  asUser(mainMgr, () =>
    db.query(
      `select * from public.create_complete_product(p_name := $1, p_sku := $2, p_description := null, p_variants := $3::jsonb, p_branches := $4::jsonb, p_selling_price := $5, p_stock_uses := $6::jsonb, p_drink_choices := $7::jsonb)`,
      [name, sku, J(variants.map(([n, p]) => ({ name: n, default_price: p }))), J([{ branch_id: booth, variants: variants.map(([n, p]) => ({ name: n, selling_price: p })) }]), null, J(stockUses), J(drinkChoices)],
    ),
  ).then((r) => r.rows[0]);
// Editing a product that is already active keeps it active (the activation guard is skipped for these fixtures only).
const editDrinks = async (product, variants, drinkChoices) => {
  await db.exec('set session_replication_role = replica');
  try {
    return await asUser(mainMgr, () =>
      db.query(
        `select * from public.update_complete_product(p_product_id := $1, p_name := $2, p_sku := $3, p_description := null, p_is_active := true, p_variants := $4::jsonb, p_deleted_variant_ids := '[]'::jsonb, p_branches := $5::jsonb, p_selling_price := null, p_drink_choices := $6::jsonb)`,
        [product.id, product.name, product.sku, J(variants), J([{ branch_id: booth, variants: variants.map((v) => ({ name: v.name, selling_price: v.default_price })) }]), J(drinkChoices)],
      ),
    );
  } finally {
    await db.exec('reset session_replication_role');
  }
};

// Curry: "Viand Only" (no drink) and "With Rice" (includes a drink: Coke or Royal). Rice and Egg are in the recipes.
const curry = await createProduct('Chicken Curry', 'CURRY-DS', [['Viand Only', '70.00'], ['With Rice', '85.00']], {
  stockUses: [
    { variant_name: 'Viand Only', ingredient_product_id: 'self', quantity: 1 },
    { variant_name: 'Viand Only', ingredient_product_id: egg, quantity: 1 },
    { variant_name: 'With Rice', ingredient_product_id: 'self', quantity: 1 },
    { variant_name: 'With Rice', ingredient_product_id: rice, quantity: 1 },
    { variant_name: 'With Rice', ingredient_product_id: egg, quantity: 1 },
  ],
  drinkChoices: [{ variant_name: 'With Rice', drink_product_id: coke }, { variant_name: 'With Rice', drink_product_id: royal }],
});
// a meal with no recipe and no drink choice at all (must behave exactly as before)
const plain = await createProduct('Plain Pares', 'PARES-DS', [['Regular', '60.00']]);

await db.exec(`
  set session_replication_role = replica; -- skip the "needs opening stock" activation guard for the fixtures only
  update public.products set is_active = true where id in ('${curry.id}','${plain.id}');
  reset session_replication_role;
  insert into public.branch_inventory(branch_id,product_id,quantity_on_hand) values
    ('${booth}','${curry.id}',20),('${booth}','${rice}',20),('${booth}','${egg}',20),
    ('${booth}','${coke}',6),('${booth}','${royal}',2),('${booth}','${sprite}',5),('${booth}','${plain.id}',10);
`);

// every section starts from the same stock so each one reads on its own
const resetStock = () => db.exec(`
  update public.branch_inventory set quantity_on_hand = 20 where branch_id='${booth}' and product_id in ('${curry.id}','${rice}','${egg}');
  update public.branch_inventory set quantity_on_hand = 6 where branch_id='${booth}' and product_id='${coke}';
  update public.branch_inventory set quantity_on_hand = 2 where branch_id='${booth}' and product_id='${royal}';
  update public.branch_inventory set quantity_on_hand = 5 where branch_id='${booth}' and product_id='${sprite}';
  update public.branch_inventory set quantity_on_hand = 10 where branch_id='${booth}' and product_id='${plain.id}';
`);

const shift = (await asUser(cashier, () => db.query('select public.start_cashier_shift() id'))).rows[0].id;
let keyN = 0;
const sell = (lines, { key = `ds-sale-${String(++keyN).padStart(12, '0')}`, program = 'standard', paid = '100000' } = {}) =>
  asUser(cashier, () =>
    db.query('select (public.confirm_sale($1,$2::jsonb,$3,$4,$5)).*', [shift, J(lines.map(([product_id, variant_id, quantity, drink_product_id]) => ({ product_id, variant_id, quantity, ...(drink_product_id ? { drink_product_id } : {}) }))), paid, key, program]),
  ).then((r) => r.rows[0]);
const stock = async () => Object.fromEntries((await db.query(`select p.name, bi.quantity_on_hand::numeric q from public.branch_inventory bi join public.products p on p.id=bi.product_id where bi.branch_id='${booth}'`)).rows.map((r) => [r.name, Number(r.q)]));
const diff = (a, b) => Object.fromEntries(Object.keys(b).map((k) => [k, b[k] - a[k]]).filter(([, d]) => d !== 0));
const moves = async (saleId) => (await db.query(`select p.name, m.quantity::numeric q from public.inventory_movements m join public.products p on p.id=m.product_id where m.reference_id=$1 order by p.name`, [saleId])).rows;
const counts = async () => ({
  sales: Number((await db.query('select count(*)::int n from public.sales')).rows[0].n),
  items: Number((await db.query('select count(*)::int n from public.sale_items')).rows[0].n),
  moves: Number((await db.query(`select count(*)::int n from public.inventory_movements where movement_type='sale'`)).rows[0].n),
});
const bv = async (product, name) => (await db.query(`select id from public.branch_product_variants where branch_id=$1 and product_id=$2 and name=$3`, [booth, product, name])).rows[0].id;
const mv = async (product, name) => (await db.query(`select id from public.product_variants where product_id=$1 and name=$2`, [product, name])).rows[0].id;
const vRice = await bv(curry.id, 'With Rice');
const vOnly = await bv(curry.id, 'Viand Only');
const listRows = () => asUser(cashier, () => db.query('select * from public.list_cashier_pos_inventory()')).then((r) => r.rows);
const rowOf = (rows, name) => rows.find((r) => r.product_name === name);

// ---------------------------------------------------------------- 1. the ids really differ; drink choices are keyed by the master option
{
  assert.notEqual(await mv(curry.id, 'With Rice'), vRice);
  assert.equal((await db.query('select count(*)::int n from public.product_drink_choices where product_id=$1', [curry.id])).rows[0].n, 2);
}

// ---------------------------------------------------------------- 2. availability in the POS list
{
  let rows = await listRows();
  let row = rowOf(rows, 'Chicken Curry');
  const sellable = Object.fromEntries(row.variants.map((v) => [v.name, Number(v.sellable_quantity)]));
  // With Rice: meal ingredients allow 20; Coke 6 + Royal 2 = 8 drinks -> 8. Viand Only has no drink: 20.
  assert.deepEqual(sellable, { 'Viand Only': 20, 'With Rice': 8 });
  assert.deepEqual(row.stock_uses.drinks, { [vRice]: [coke, royal].sort() }, 'eligible drinks, keyed by the BRANCH option the POS sells');
  assert.equal(row.stock_uses.drinks[vOnly], undefined, 'an option without a drink choice has no drinks entry');
  assert.equal(Number(row.stock_uses.ingredient_stock[coke]), 6, 'drink stock travels with the ingredient stock');
  assert.equal(row.stock_uses.ingredient_names[royal], 'Royal');
  assert.equal(Number(row.stock_uses.ingredient_stock[sprite] ?? 0), 0, 'a drink that is not offered is not listed');
  // products without Drink Choice are exactly as before
  const p = rowOf(rows, 'Plain Pares');
  assert.equal(Number(p.sellable_quantity), 10);
  assert.deepEqual(p.stock_uses.drinks, {});
  assert.equal(Number(rowOf(rows, 'Coke').sellable_quantity), 6);

  // an eligible drink running out lowers availability; all of them out makes the option unsellable
  await db.exec(`update public.branch_inventory set quantity_on_hand = 0 where branch_id='${booth}' and product_id='${royal}'`);
  row = rowOf(await listRows(), 'Chicken Curry');
  assert.equal(Number(row.variants.find((v) => v.name === 'With Rice').sellable_quantity), 6);
  await db.exec(`update public.branch_inventory set quantity_on_hand = 0 where branch_id='${booth}' and product_id='${coke}'`);
  row = rowOf(await listRows(), 'Chicken Curry');
  assert.equal(Number(row.variants.find((v) => v.name === 'With Rice').sellable_quantity), 0, 'no drink in stock: the meal with a drink cannot be sold');
  assert.equal(Number(row.variants.find((v) => v.name === 'Viand Only').sellable_quantity), 20, 'the option without a drink is unaffected');
  await db.exec(`update public.branch_inventory set quantity_on_hand = 6 where branch_id='${booth}' and product_id='${coke}'; update public.branch_inventory set quantity_on_hand = 2 where branch_id='${booth}' and product_id='${royal}'`);
  console.log('pos availability: ok');
}

// ---------------------------------------------------------------- 3. sale: the meal and the drink, once each
{
  await resetStock();
  const before = await stock();
  const sale = await sell([[curry.id, vRice, 2, coke]]);
  assert.equal(Number(sale.total_amount), 170, 'the meal price is unchanged: the drink is included');
  assert.deepEqual(diff(before, await stock()), { 'Chicken Curry': -2, Rice: -2, Egg: -2, Coke: -2 }, 'meal ingredients and the chosen drink, from their own stock');
  const m = await moves(sale.id);
  assert.deepEqual(Object.fromEntries(m.map((x) => [x.name, Number(x.q)])), { 'Chicken Curry': -2, Coke: -2, Egg: -2, Rice: -2 });
  assert.equal(m.length, 4, 'one movement per product');
  const item = (await db.query(`select variant_name, drink_product_id, drink_name, unit_price::numeric u, quantity from public.sale_items where sale_id=$1`, [sale.id])).rows[0];
  assert.equal(item.drink_product_id, coke);
  assert.equal(item.drink_name, 'Coke');
  assert.equal(item.variant_name, 'With Rice');
  assert.equal(Number(item.u), 85);
  assert.deepEqual(sale.request_items, [{ product_id: curry.id, variant_id: vRice, drink_product_id: coke, quantity: 2 }], 'the request records the drink');
  console.log('sale with a drink: ok');
}

// ---------------------------------------------------------------- 4. aggregation: several lines, shared drink stock, never twice
{
  await resetStock();
  const before = await stock();
  const sale = await sell([
    [curry.id, vRice, 1, coke],
    [curry.id, vRice, 1, royal], // the same meal with a different drink is its own line
    [coke, null, 1], // Coke sold on its own in the same order
    [curry.id, vOnly, 1], // an option without a drink: no drink
  ]);
  assert.deepEqual(diff(before, await stock()), { 'Chicken Curry': -3, Rice: -2, Egg: -3, Coke: -2, Royal: -1 }, 'Coke: 1 chosen + 1 sold directly = 2, deducted once');
  const m = await moves(sale.id);
  assert.equal(m.filter((x) => x.name === 'Coke').length, 1, 'a single Coke movement');
  assert.equal(Number(m.find((x) => x.name === 'Coke').q), -2);
  const lines = (await db.query(`select p.name, si.variant_name, si.drink_name, si.quantity from public.sale_items si join public.products p on p.id=si.product_id where si.sale_id=$1 order by p.name, si.variant_name, si.drink_name nulls first`, [sale.id])).rows;
  assert.equal(lines.length, 4, 'four sale lines: the two drink variants stay separate');
  assert.deepEqual(lines.filter((l) => l.variant_name === 'With Rice').map((l) => l.drink_name).sort(), ['Coke', 'Royal']);
  // the same line twice in one request merges into one line (drink included in the key)
  const before2 = await stock();
  const merged = await sell([[curry.id, vRice, 1, coke], [curry.id, vRice, 2, coke]]);
  assert.equal(Number((await db.query(`select quantity from public.sale_items where sale_id=$1`, [merged.id])).rows[0].quantity), 3);
  assert.equal(diff(before2, await stock()).Coke, -3);
  console.log('aggregation: ok');
}

// ---------------------------------------------------------------- 5. refused sales write nothing
{
  await resetStock();
  const before = await stock();
  const c0 = await counts();
  const refused = [
    ['no drink chosen', [[curry.id, vRice, 1]], /Choose a drink for With Rice/],
    ['a drink the option does not offer', [[curry.id, vRice, 1, sprite]], /That drink is not offered with With Rice/],
    ['a drink for an option without one', [[curry.id, vOnly, 1, coke]], /does not include a drink/],
    ['a drink for a product without options', [[plain.id, await bv(plain.id, 'Regular'), 1, coke]], /does not include a drink/],
    ['an unknown drink id', [[curry.id, vRice, 1, id(999)]], /not offered/],
  ];
  for (const [label, lines, pattern] of refused) {
    await rejects(() => sell(lines), pattern, label);
    assert.deepEqual(await stock(), before, `${label}: nothing deducted`);
    assert.deepEqual(await counts(), c0, `${label}: nothing written`);
  }
  // a malformed drink id
  await rejects(() => asUser(cashier, () => db.query(`select (public.confirm_sale($1,$2::jsonb,'1000','ds-bad-id-0000000001','standard')).*`, [shift, J([{ product_id: curry.id, variant_id: vRice, quantity: 1, drink_product_id: 'not-a-uuid' }])])), /Invalid product, variant, or quantity/, 'malformed drink id');
  // an inactive drink
  await db.exec(`set session_replication_role = replica; update public.products set is_active=false where id='${royal}'; reset session_replication_role;`);
  await rejects(() => sell([[curry.id, vRice, 1, royal]]), /inactive or unavailable/, 'inactive drink');
  assert.deepEqual(await stock(), before);
  await db.exec(`set session_replication_role = replica; update public.products set is_active=true where id='${royal}'; reset session_replication_role;`);
  console.log('refusals: ok');
}

// ---------------------------------------------------------------- 6. insufficient stock rolls the whole sale back
{
  await resetStock();
  const before = await stock();
  const c0 = await counts();
  // Royal has 2 left: asking for 3 fails, and neither the meal nor Coke is deducted
  await rejects(() => sell([[curry.id, vRice, 1, coke], [curry.id, vRice, 3, royal]]), /Insufficient stock\. Royal — Available: 2(\.0+)?, Requested: 3/, 'drink shortage');
  assert.deepEqual(await stock(), before);
  assert.deepEqual(await counts(), c0);
  // each line fits alone, but chosen + sold directly exceed the Coke on hand: the combined need is what is checked
  const coke0 = before.Coke;
  await rejects(() => sell([[curry.id, vRice, coke0 - 1, coke], [coke, null, 3]]), /Insufficient stock\. Coke/, 'shared drink stock');
  assert.deepEqual(await stock(), before);
  // the meal's own ingredients are still checked with the drink
  await db.exec(`update public.branch_inventory set quantity_on_hand = 1 where branch_id='${booth}' and product_id='${egg}'`);
  await rejects(() => sell([[curry.id, vRice, 2, coke]]), /Insufficient stock\. Egg — Available: 1(\.0+)?, Requested: 2/, 'meal ingredient shortage');
  assert.deepEqual(await stock(), { ...before, Egg: 1 }, 'the drink was not deducted either');
  await db.exec(`update public.branch_inventory set quantity_on_hand = ${before.Egg} where branch_id='${booth}' and product_id='${egg}'`);
  console.log('insufficient stock: ok');
}

// ---------------------------------------------------------------- 7. retries: idempotent, never a second deduction
{
  await resetStock();
  const lines = [[curry.id, vRice, 2, coke]];
  const first = await sell(lines, { key: 'ds-retry-000000000001' });
  const after = await stock();
  const c1 = await counts();
  const again = await sell(lines, { key: 'ds-retry-000000000001' });
  assert.equal(again.id, first.id);
  assert.deepEqual(await stock(), after);
  assert.deepEqual(await counts(), c1);
  // split differently: normalises to the same request
  const split = await sell([[curry.id, vRice, 1, coke], [curry.id, vRice, 1, coke]], { key: 'ds-retry-000000000001' });
  assert.equal(split.id, first.id);
  // a different drink under the same key is a different order
  await rejects(() => sell([[curry.id, vRice, 2, royal]], { key: 'ds-retry-000000000001' }), /different order/i, 'different drink, same key');
  // and a replay still succeeds after the drink has run out
  await db.exec(`update public.branch_inventory set quantity_on_hand = 0 where branch_id='${booth}' and product_id='${coke}'`);
  assert.equal((await sell(lines, { key: 'ds-retry-000000000001' })).id, first.id);
  await db.exec(`update public.branch_inventory set quantity_on_hand = 6 where branch_id='${booth}' and product_id='${coke}'`);
  console.log('retries: ok');
}

// ---------------------------------------------------------------- 8. pricing programs and existing products are unchanged
{
  await resetStock();
  const before = await stock();
  const pwd = await sell([[curry.id, vRice, 2, coke]], { program: 'pwd', paid: '200' });
  assert.equal(Number(pwd.catalog_subtotal), 170);
  assert.equal(Number(pwd.total_amount), 127.5, 'the 25% PWD discount applies to the meal as before');
  const free = await sell([[curry.id, vRice, 1, royal]], { program: 'employee_meal', paid: '0' });
  assert.equal(Number(free.total_amount), 0);
  assert.deepEqual(diff(before, await stock()), { 'Chicken Curry': -3, Rice: -3, Egg: -3, Coke: -2, Royal: -1 }, 'discounted and free meals still deduct their drink');
  // a meal without Drink Choice: same as ever
  const b2 = await stock();
  const s = await sell([[plain.id, await bv(plain.id, 'Regular'), 2], [curry.id, vOnly, 1]]);
  assert.deepEqual(diff(b2, await stock()), { 'Plain Pares': -2, 'Chicken Curry': -1, Egg: -1 });
  assert.equal((await db.query(`select count(*)::int n from public.sale_items where sale_id=$1 and drink_product_id is not null`, [s.id])).rows[0].n, 0);
  assert.equal(Number(s.total_amount), 2 * 60 + 70);
  console.log('pricing and unchanged products: ok');
}

// ---------------------------------------------------------------- 9. editing or removing eligible drinks changes what can be sold
{
  await resetStock();
  const variants = [{ id: await mv(curry.id, 'Viand Only'), name: 'Viand Only', default_price: '70.00' }, { id: await mv(curry.id, 'With Rice'), name: 'With Rice', default_price: '85.00' }];
  const masterRice = variants[1].id;
  // add Sprite, remove Royal
  await editDrinks(curry, variants, [{ variant_id: masterRice, drink_product_id: coke }, { variant_id: masterRice, drink_product_id: sprite }]);
  let before = await stock();
  await sell([[curry.id, vRice, 1, sprite]]);
  assert.equal(diff(before, await stock()).Sprite, -1, 'the newly added drink can be chosen');
  await rejects(() => sell([[curry.id, vRice, 1, royal]]), /not offered/, 'a removed drink can no longer be chosen');
  let row = rowOf(await listRows(), 'Chicken Curry');
  assert.deepEqual(row.stock_uses.drinks[vRice].sort(), [coke, sprite].sort());
  // removing every drink choice: the option sells like any meal again, and a drink is refused
  await editDrinks(curry, variants, []);
  before = await stock();
  await sell([[curry.id, vRice, 1]]);
  assert.deepEqual(diff(before, await stock()), { 'Chicken Curry': -1, Rice: -1, Egg: -1 }, 'no drink, no Coke deduction');
  await rejects(() => sell([[curry.id, vRice, 1, coke]]), /does not include a drink/, 'a drink is refused once none is configured');
  row = rowOf(await listRows(), 'Chicken Curry');
  assert.deepEqual(row.stock_uses.drinks, {});
  assert.equal(Number(row.variants.find((v) => v.name === 'With Rice').sellable_quantity), 18, 'back to the meal ingredients only (20 minus the two meals sold in this section)');
  // an unrelated edit (no p_drink_choices) leaves a configured set alone
  await editDrinks(curry, variants, [{ variant_id: masterRice, drink_product_id: coke }]);
  await db.exec('set session_replication_role = replica');
  await asUser(mainMgr, () => db.query(`select * from public.update_complete_product(p_product_id := $1, p_name := 'Chicken Curry', p_sku := 'CURRY-DS', p_description := null, p_is_active := true, p_variants := $2::jsonb, p_deleted_variant_ids := '[]'::jsonb, p_branches := $3::jsonb, p_selling_price := null)`, [curry.id, J(variants), J([{ branch_id: booth, variants: variants.map((v) => ({ name: v.name, selling_price: v.default_price })) }])]));
  await db.exec('reset session_replication_role');
  assert.equal((await db.query('select count(*)::int n from public.product_drink_choices where product_id=$1', [curry.id])).rows[0].n, 1);
  console.log('editing and removing drinks: ok');
}

console.log('drink_choice_sale: ALL PASS');
