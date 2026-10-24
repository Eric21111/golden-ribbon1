// Shared inventory, Step 2: confirm_sale deducts through product_stock_uses.
// Runs every migration in PGlite. Egg is tracked in half-egg units (1 egg = 2 units).
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const NEW_MIGRATION = '20261023100000_confirm_sale_shared_inventory.sql';
const migrationSrc = readFileSync(`supabase/migrations/${NEW_MIGRATION}`, 'utf8');

// ---------------------------------------------------------------- 0. the migration is additive and scoped
{
  const code = migrationSrc.replace(/--[^\n]*/g, '').replace(/comment on [\s\S]*?;\n/gi, '');
  assert.equal((code.match(/create or replace function/gi) ?? []).length, 1, 'only confirm_sale is replaced');
  assert.match(code, /create or replace function public\.confirm_sale\(\s*p_shift_id uuid,\s*p_items jsonb,\s*p_amount_paid numeric,\s*p_idempotency_key text,\s*p_pricing_program text default 'standard'\s*\)\s*returns public\.sales/);
  assert.doesNotMatch(code, /drop function|\bdrop\s+(table|column|index|constraint|policy|trigger)\b|\balter table\b|\bcreate (unique )?index\b|\bcreate table\b|\binsert into public\.(products|branch_inventory|product_stock_uses|product_variants)\b/i);
  assert.match(code, /grant execute on function public\.confirm_sale\(uuid, jsonb, numeric, text, text\) to authenticated/);
  // no recursion: product_stock_uses is only read for the SOLD products' lines, never joined to itself
  assert.equal((code.match(/join public\.product_stock_uses/g) ?? []).length, 1);
  assert.doesNotMatch(code, /product_stock_uses[\s\S]{0,300}product_stock_uses u2/);
  // the old per-product deduction is gone; both loops now read the aggregated list
  assert.equal((code.match(/jsonb_to_recordset\(v_deductions\)/g) ?? []).length, 2, 'check and deduct share one list');
  // a later migration must not silently replace confirm_sale. The one known follow-up is the variant mapping fix, which
  // has its own regression test (confirm_sale_variant_mapping.mjs); anything else needs this test revisited.
  const KNOWN_FOLLOW_UPS = ['20261023120000_confirm_sale_variant_mapping.sql', '20261024120000_confirm_sale_drink_choice.sql'];
  for (const later of readdirSync('supabase/migrations').filter((f) => f > NEW_MIGRATION && !KNOWN_FOLLOW_UPS.includes(f))) {
    const text = readFileSync(`supabase/migrations/${later}`, 'utf8').replace(/--[^\n]*/g, '');
    assert.doesNotMatch(text, /function public\.confirm_sale/i, `${later} redefines confirm_sale`);
  }
}

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
async function boot(skip = []) {
  const db = new PGlite();
  await db.exec(BOOT);
  for (const file of readdirSync('supabase/migrations').filter((n) => n.endsWith('.sql')).sort()) {
    if (skip.includes(file)) continue;
    await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8').replace(/create extension if not exists pgcrypto;/g, ''));
  }
  return db;
}

const id = (n) => `52000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1);
const cashierId = id(3);
const main = id(10);
const branch = id(11);
// sold products and ingredients
const curry = id(20);
const rice = id(21);
const egg = id(22);
const tapa = id(23);
const bbq = id(24);
const extraEgg = id(25);
const soda = id(26);
const plain = id(27);
const pares = id(28);
// variants
const viand = id(30);
const withRice = id(31);
const plainRegular = id(32);
const plainLarge = id(33);
const paresRegular = id(34);
const paresLarge = id(35);

const PRODUCTS = [
  [curry, 'Chicken Curry', 'CURRY-SI', 70],
  [rice, 'Rice', 'RICE-SI', 15],
  [egg, 'Egg', 'EGG-SI', 10],
  [tapa, 'Tapa', 'TAPA-SI', 90],
  [bbq, 'BBQ', 'BBQ-SI', 20],
  [extraEgg, 'Extra Egg', 'XEGG-SI', 15],
  [soda, 'Soda', 'SODA-SI', 30],
  [plain, 'Plain Meal', 'PLAIN-SI', 60],
  [pares, 'Pares', 'PARES-SI', 100],
];
const VARIANTS = [
  [viand, curry, 'Viand Only', 70, 1],
  [withRice, curry, 'With Rice', 85, 2],
  [plainRegular, plain, 'Regular', 60, 1],
  [plainLarge, plain, 'Large', 80, 2],
  [paresRegular, pares, 'Regular', 100, 1],
  [paresLarge, pares, 'Large', 130, 2],
];
const STOCK = { [curry]: 20, [rice]: 20, [egg]: 20, [tapa]: 10, [bbq]: 30, [soda]: 10, [plain]: 10, [pares]: 10 }; // Extra Egg has no stock of its own

async function seed(db) {
  await db.exec(`
    insert into auth.users values ('${owner}','o@test'),('${cashierId}','c@test');
    insert into public.branches(id,name,code,is_main_branch,is_active,receiving_mode) values
      ('${main}','Main','MAIN',true,true,'counted'),('${branch}','Booth','B1',false,true,'cashier_confirm');
    insert into public.profiles(id,full_name,role,branch_id) values
      ('${owner}','Owner','owner',null),('${cashierId}','Cashier','cashier','${branch}');
    ${PRODUCTS.map(([pid, name, sku, price]) => `insert into public.products(id,name,sku,selling_price,is_active,inventory_mode,closing_stock_behavior) values ('${pid}','${name}','${sku}',${price},true,'piece_stock','keep_at_branch');`).join('\n')}
    ${PRODUCTS.map(([pid, , , price]) => `insert into public.branch_products(branch_id,product_id,selling_price,is_active) values ('${branch}','${pid}',${price},true);`).join('\n')}
    ${VARIANTS.map(([vid, pid, name, price, order]) => `insert into public.product_variants(id,product_id,name,default_price,is_active,sort_order) values ('${vid}','${pid}','${name}',${price},true,${order});
      insert into public.branch_product_variants(id,branch_id,product_id,name,selling_price,is_active) values ('${vid}','${branch}','${pid}','${name}',${price},true);`).join('\n')}
    ${Object.entries(STOCK).map(([pid, q]) => `insert into public.branch_inventory(branch_id,product_id,quantity_on_hand) values ('${branch}','${pid}',${q});`).join('\n')}
  `);
}

async function tools(db) {
  const asUser = async (userId, work) => {
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false);`);
    try {
      return await work();
    } finally {
      await db.exec('reset role');
    }
  };
  const shiftId = (await asUser(cashierId, () => db.query('select public.start_cashier_shift() id'))).rows[0].id;
  const sell = (items, key, { paid = '100000', program = 'standard' } = {}) =>
    asUser(cashierId, () =>
      db.query('select (public.confirm_sale($1,$2::jsonb,$3,$4,$5)).*', [shiftId, JSON.stringify(items), paid, key, program]),
    ).then((r) => r.rows[0]);
  const stock = async () =>
    Object.fromEntries(
      (await db.query(`select p.name, bi.quantity_on_hand::numeric q from public.branch_inventory bi join public.products p on p.id=bi.product_id where bi.branch_id='${branch}' order by p.name`)).rows.map((r) => [r.name, Number(r.q)]),
    );
  const movements = async (saleId) =>
    (await db.query(`select p.name, m.quantity::numeric q, m.movement_type, m.reference_type, m.reference_id, m.created_by, m.branch_id from public.inventory_movements m join public.products p on p.id=m.product_id where m.reference_id=$1 order by p.name`, [saleId])).rows;
  const counts = async () => ({
    sales: Number((await db.query('select count(*)::int n from public.sales')).rows[0].n),
    items: Number((await db.query('select count(*)::int n from public.sale_items')).rows[0].n),
    moves: Number((await db.query(`select count(*)::int n from public.inventory_movements where movement_type='sale'`)).rows[0].n),
  });
  const config = (rows) =>
    db.exec(rows.map(([product, variant, ingredient, quantity]) => `insert into public.product_stock_uses(product_id,variant_id,ingredient_product_id,quantity) values ('${product}',${variant ? `'${variant}'` : 'null'},'${ingredient}',${quantity});`).join('\n'));
  return { asUser, sell, stock, movements, counts, config };
}
const delta = (before, after) => Object.fromEntries(Object.keys(after).map((k) => [k, after[k] - before[k]]).filter(([, d]) => d !== 0));
const moves = (rows) => Object.fromEntries(rows.map((r) => [r.name, Number(r.q)]));

const db = await boot();
await seed(db);
const t = await tools(db);

// the recipes used below (Egg is in half-egg units)
await t.config([
  [curry, viand, curry, 1],
  [curry, viand, egg, 1], // Curry / Viand Only: Curry x1 + Egg x1 (half an egg)
  [curry, withRice, curry, 1],
  [curry, withRice, rice, 1],
  [curry, withRice, egg, 1], // Curry / With Rice: Curry x1 + Rice x1 + Egg x1
  [tapa, null, tapa, 1],
  [tapa, null, egg, 2], // Tapa: Tapa x1 + a whole egg (2 units)
  [bbq, null, bbq, 3], // BBQ: one order of BBQ uses 3 sticks
  [extraEgg, null, egg, 2], // Extra Egg: a whole egg, taken from the Egg pool (it has no stock of its own)
  [pares, null, pares, 1],
  [pares, null, rice, 1], // Pares default: Pares x1 + Rice x1 ...
  [pares, paresLarge, pares, 1],
  [pares, paresLarge, rice, 2], // ... but Large has its own lines: Pares x1 + Rice x2
]);

// ---------------------------------------------------------------- 1. Curry with Rice deducts Curry, Rice and Egg
{
  const before = await t.stock();
  const sale = await t.sell([{ product_id: curry, variant_id: withRice, quantity: 1 }], 'shared-curry-rice-000001');
  assert.equal(Number(sale.total_amount), 85, 'price is unchanged');
  assert.deepEqual(delta(before, await t.stock()), { 'Chicken Curry': -1, Rice: -1, Egg: -1 });
  const rows = await t.movements(sale.id);
  assert.deepEqual(moves(rows), { 'Chicken Curry': -1, Egg: -1, Rice: -1 });
  assert.equal(rows.length, 3, 'one movement per ingredient');
  for (const row of rows) {
    assert.equal(row.movement_type, 'sale');
    assert.equal(row.reference_type, 'sale');
    assert.equal(row.reference_id, sale.id);
    assert.equal(row.created_by, cashierId);
    assert.equal(row.branch_id, branch);
  }
  // the sale record itself is exactly what it always was: one row per sold line, with the sold product
  const items = (await db.query(`select product_id, variant_id, variant_name, quantity, unit_price::numeric u from public.sale_items where sale_id=$1`, [sale.id])).rows;
  assert.equal(items.length, 1);
  assert.equal(items[0].product_id, curry);
  assert.equal(items[0].variant_id, withRice);
  assert.equal(items[0].variant_name, 'With Rice');
  assert.equal(Number(items[0].u), 85);
  console.log('curry with rice: ok');
}

// ---------------------------------------------------------------- 2. variant-specific lines, quantity > 1
{
  const before = await t.stock();
  const sale = await t.sell([{ product_id: curry, variant_id: viand, quantity: 2 }], 'shared-curry-viand-000001');
  assert.deepEqual(delta(before, await t.stock()), { 'Chicken Curry': -2, Egg: -2 }, 'Viand Only has no Rice');
  assert.deepEqual(moves(await t.movements(sale.id)), { 'Chicken Curry': -2, Egg: -2 });
  console.log('variant lines: ok');
}

// ---------------------------------------------------------------- 3. BBQ x3
{
  const before = await t.stock();
  const sale = await t.sell([{ product_id: bbq, quantity: 2 }], 'shared-bbq-x3-000000001');
  assert.deepEqual(delta(before, await t.stock()), { BBQ: -6 }, '2 orders of BBQ x3 = 6 sticks');
  const rows = await t.movements(sale.id);
  assert.deepEqual(moves(rows), { BBQ: -6 });
  assert.equal(rows.length, 1, 'a single movement even though it is the sold product itself');
  assert.equal(Number((await db.query(`select quantity from public.sale_items where sale_id=$1`, [sale.id])).rows[0].quantity), 2, 'sale_items still records 2 sold');
  console.log('bbq x3: ok');
}

// ---------------------------------------------------------------- 4. Extra Egg shares the Egg pool with meals, one Egg movement
{
  const before = await t.stock();
  const sale = await t.sell(
    [
      { product_id: extraEgg, quantity: 2 }, // 2 x 2 = 4
      { product_id: curry, variant_id: withRice, quantity: 1 }, // 1
      { product_id: tapa, quantity: 1 }, // 2
      { product_id: curry, variant_id: viand, quantity: 1 }, // 1
    ],
    'shared-egg-shared-000001',
  );
  assert.deepEqual(delta(before, await t.stock()), { Egg: -8, 'Chicken Curry': -2, Rice: -1, Tapa: -1 });
  const rows = await t.movements(sale.id);
  assert.equal(rows.filter((r) => r.name === 'Egg').length, 1, 'exactly one Egg movement for four lines');
  assert.deepEqual(moves(rows), { 'Chicken Curry': -2, Egg: -8, Rice: -1, Tapa: -1 });
  assert.equal(rows.length, 4);
  // Extra Egg has no stock of its own: no inventory row was created for it, and no movement for it
  assert.equal(Number((await db.query(`select count(*)::int n from public.branch_inventory where product_id='${extraEgg}'`)).rows[0].n), 0);
  assert.ok(!('Extra Egg' in moves(rows)));
  // four sold lines are recorded as sold
  assert.equal(Number((await db.query(`select count(*)::int n from public.sale_items where sale_id=$1`, [sale.id])).rows[0].n), 4);
  console.log('extra egg shares egg: ok');
}

// ---------------------------------------------------------------- 5. half-eggs: two Curry plates = one egg
{
  const before = await t.stock();
  await t.sell([{ product_id: curry, variant_id: viand, quantity: 2 }], 'shared-half-egg-0000001');
  assert.equal(delta(before, await t.stock()).Egg, -2, 'two half-egg units = one whole egg');
}

// ---------------------------------------------------------------- 6. variant lines win; otherwise product lines; never both
{
  const before = await t.stock();
  const sale = await t.sell(
    [
      { product_id: pares, variant_id: paresRegular, quantity: 1 }, // no variant lines -> product-level: Pares 1 + Rice 1
      { product_id: pares, variant_id: paresLarge, quantity: 1 }, // own lines: Pares 1 + Rice 2 (NOT also the product-level lines)
    ],
    'shared-fallback-0000001',
  );
  assert.deepEqual(delta(before, await t.stock()), { Pares: -2, Rice: -3 });
  assert.deepEqual(moves(await t.movements(sale.id)), { Pares: -2, Rice: -3 });
  console.log('variant vs product lines: ok');
}

// ---------------------------------------------------------------- 7. ingredients are not expanded recursively
{
  // give Egg (an ingredient) its own configuration; selling Curry must ignore it
  await t.config([[egg, null, rice, 5]]);
  const before = await t.stock();
  await t.sell([{ product_id: curry, variant_id: viand, quantity: 1 }], 'shared-no-recursion-001');
  assert.deepEqual(delta(before, await t.stock()), { 'Chicken Curry': -1, Egg: -1 }, "Egg's own lines (Rice x5) are not applied");
  await db.exec(`delete from public.product_stock_uses where product_id='${egg}'`);
  console.log('no recursion: ok');
}

// ---------------------------------------------------------------- 8. pricing programs and totals are unchanged
{
  const before = await t.stock();
  const pwd = await t.sell([{ product_id: curry, variant_id: withRice, quantity: 2 }], 'shared-pwd-0000000001', { program: 'pwd', paid: '200' });
  assert.equal(Number(pwd.catalog_subtotal), 170);
  assert.equal(Number(pwd.total_amount), 127.5, '25% PWD discount as before');
  assert.equal(pwd.pricing_program, 'pwd');
  const emp = await t.sell([{ product_id: curry, variant_id: viand, quantity: 1 }], 'shared-employee-000001', { program: 'employee_meal', paid: '0' });
  assert.equal(Number(emp.total_amount), 0);
  assert.deepEqual(delta(before, await t.stock()), { 'Chicken Curry': -3, Rice: -2, Egg: -3 }, 'discounted and free meals still deduct their ingredients');
  console.log('pricing programs: ok');
}

// ---------------------------------------------------------------- 9. insufficient ingredient stock rolls back the whole sale
{
  await db.exec(`update public.branch_inventory set quantity_on_hand = 2 where branch_id='${branch}' and product_id='${egg}'`);
  const before = await t.stock();
  const c0 = await t.counts();
  // each line alone fits in 2 units of Egg, but together they need 1 + 2 = 3 -> the aggregate is what is checked
  await assert.rejects(
    t.sell(
      [
        { product_id: bbq, quantity: 1 },
        { product_id: curry, variant_id: viand, quantity: 1 },
        { product_id: extraEgg, quantity: 1 },
      ],
      'shared-insufficient-0001',
    ),
    /Insufficient stock\. Egg — Available: 2(\.0+)?, Requested: 3/,
  );
  assert.deepEqual(await t.stock(), before, 'nothing was deducted, not even the ingredients that were available');
  assert.deepEqual(await t.counts(), c0, 'no sale, sale item or movement was written');
  // the same key can be used again once stock exists (nothing was recorded under it)
  await db.exec(`update public.branch_inventory set quantity_on_hand = 20 where branch_id='${branch}' and product_id='${egg}'`);
  const ok = await t.sell(
    [
      { product_id: bbq, quantity: 1 },
      { product_id: curry, variant_id: viand, quantity: 1 },
      { product_id: extraEgg, quantity: 1 },
    ],
    'shared-insufficient-0001',
  );
  assert.equal(moves(await t.movements(ok.id)).Egg, -3);
  // an ingredient that has no inventory row at all counts as 0 and also rejects
  await db.exec(`delete from public.branch_inventory where branch_id='${branch}' and product_id='${rice}'`);
  const c1 = await t.counts();
  await assert.rejects(t.sell([{ product_id: curry, variant_id: withRice, quantity: 1 }], 'shared-no-rice-row-0001'), /Insufficient stock\. Rice — Available: 0, Requested: 1/);
  assert.deepEqual(await t.counts(), c1);
  await db.exec(`insert into public.branch_inventory(branch_id,product_id,quantity_on_hand) values ('${branch}','${rice}',20)`);
  console.log('insufficient stock rolls back: ok');
}

// ---------------------------------------------------------------- 10. a retried sale does not deduct twice
{
  const items = [
    { product_id: curry, variant_id: withRice, quantity: 2 },
    { product_id: extraEgg, quantity: 1 },
  ];
  const first = await t.sell(items, 'shared-retry-000000001');
  const afterFirst = await t.stock();
  const c1 = await t.counts();
  const again = await t.sell(items, 'shared-retry-000000001');
  assert.equal(again.id, first.id, 'the same sale is returned');
  assert.equal(again.sale_number, first.sale_number);
  assert.deepEqual(await t.stock(), afterFirst, 'no second deduction');
  assert.deepEqual(await t.counts(), c1, 'no second sale, item or movement');
  // the same lines in a different order and split differently normalise to the same request
  const reordered = await t.sell([items[1], { product_id: curry, variant_id: withRice, quantity: 1 }, { product_id: curry, variant_id: withRice, quantity: 1 }], 'shared-retry-000000001');
  assert.equal(reordered.id, first.id);
  assert.deepEqual(await t.stock(), afterFirst);
  // a replay still succeeds even when the ingredients have since run out
  await db.exec(`update public.branch_inventory set quantity_on_hand = 0 where branch_id='${branch}' and product_id='${egg}'`);
  const late = await t.sell(items, 'shared-retry-000000001');
  assert.equal(late.id, first.id);
  // reusing the key for a different order is refused and deducts nothing
  const c2 = await t.counts();
  await assert.rejects(t.sell([{ product_id: bbq, quantity: 1 }], 'shared-retry-000000001'), /different order/i);
  assert.deepEqual(await t.counts(), c2);
  await db.exec(`update public.branch_inventory set quantity_on_hand = 20 where branch_id='${branch}' and product_id='${egg}'`);
  // exactly one movement per ingredient for the original sale
  const rows = await t.movements(first.id);
  assert.deepEqual(moves(rows), { 'Chicken Curry': -2, Egg: -4, Rice: -2 });
  console.log('retries: ok');
}

// ---------------------------------------------------------------- 11. products without recipes behave exactly as before
{
  const before = await t.stock();
  const sale = await t.sell(
    [
      { product_id: soda, quantity: 2 },
      { product_id: plain, variant_id: plainRegular, quantity: 1 },
      { product_id: plain, variant_id: plainLarge, quantity: 2 },
    ],
    'shared-legacy-00000001',
  );
  assert.deepEqual(delta(before, await t.stock()), { Soda: -2, 'Plain Meal': -3 }, 'one pool per product, variants share it');
  const rows = await t.movements(sale.id);
  assert.deepEqual(moves(rows), { 'Plain Meal': -3, Soda: -2 });
  assert.equal(rows.length, 2, 'variants of one product make a single movement');
  assert.equal(Number(sale.total_amount), 2 * 30 + 60 + 2 * 80);
  // the legacy shortage message is the same as before
  await db.exec(`update public.branch_inventory set quantity_on_hand = 1 where branch_id='${branch}' and product_id='${soda}'`);
  await assert.rejects(t.sell([{ product_id: soda, quantity: 2 }], 'shared-legacy-short-0001'), /Insufficient stock\. Soda — Available: 1(\.0+)?, Requested: 2/);
  console.log('legacy products: ok');
}

// ---------------------------------------------------------------- 12. validation that existed before still applies, and nothing is deducted
{
  const before = await t.stock();
  const c0 = await t.counts();
  // a variant that belongs to another product cannot pull that product's recipe
  await assert.rejects(t.sell([{ product_id: tapa, variant_id: withRice, quantity: 1 }], 'shared-wrong-variant-001'), /variant is not available|Invalid|not available/i);
  // a variant is still required when options exist
  await assert.rejects(t.sell([{ product_id: plain, quantity: 1 }], 'shared-no-variant-000001'), /meal option|variant/i);
  // inactive product / product missing from the branch catalog
  await db.exec(`update public.branch_products set is_active=false where branch_id='${branch}' and product_id='${extraEgg}'`);
  await assert.rejects(t.sell([{ product_id: extraEgg, quantity: 1 }], 'shared-inactive-000000001'), /not available in this branch catalog/);
  await db.exec(`update public.branch_products set is_active=true where branch_id='${branch}' and product_id='${extraEgg}'`);
  // a retired (inactive) product with a recipe is refused too (reactivation is a separate rule, so use its own product)
  const retired = id(40);
  await db.exec(`insert into public.products(id,name,sku,selling_price,is_active,inventory_mode,closing_stock_behavior) values ('${retired}','Retired Item','RET-SI',10,false,'piece_stock','keep_at_branch');
    insert into public.branch_products(branch_id,product_id,selling_price,is_active) values ('${branch}','${retired}',10,true);`);
  await t.config([[retired, null, egg, 1]]);
  await assert.rejects(t.sell([{ product_id: retired, quantity: 1 }], 'shared-inactive-000000002'), /inactive or unavailable/);
  // malformed cart and payment checks
  await assert.rejects(t.sell([], 'shared-empty-0000000001'), /1 to 200 products/);
  await assert.rejects(t.sell([{ product_id: bbq, quantity: 1 }], 'shared-underpaid-00000001', { paid: '5' }), /Insufficient payment/);
  assert.deepEqual(await t.stock(), before);
  assert.deepEqual(await t.counts(), c0);
  console.log('validation unchanged: ok');
}

// ---------------------------------------------------------------- 13. the function itself
{
  const fns = (await db.query(`select p.oid, pg_get_function_identity_arguments(p.oid) a, pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='confirm_sale'`)).rows;
  assert.equal(fns.length, 1, 'still a single confirm_sale (no overload was added)');
  assert.match(fns[0].a, /p_shift_id uuid, p_items jsonb, p_amount_paid numeric, p_idempotency_key text, p_pricing_program text/);
  assert.match(fns[0].d, /product_stock_uses/);
  const grants = (await db.query(`select grantee from information_schema.routine_privileges where routine_schema='public' and routine_name='confirm_sale' and privilege_type='EXECUTE' and grantee in ('anon','authenticated','PUBLIC') order by grantee`)).rows.map((r) => r.grantee);
  assert.deepEqual(grants, ['authenticated'], 'only signed-in users may execute it');
}

// ---------------------------------------------------------------- 14. differential: identical to the old function for products without recipes
{
  const old = await boot([NEW_MIGRATION]);
  await seed(old);
  const to = await tools(old);
  const fresh = await boot();
  await seed(fresh);
  const tn = await tools(fresh);
  // no product_stock_uses rows are configured in either database
  const scenario = [
    ([k]) => [[{ product_id: soda, quantity: 3 }], `diff-soda-${k}-0000000001`, {}],
    ([k]) => [[{ product_id: plain, variant_id: plainRegular, quantity: 2 }, { product_id: plain, variant_id: plainLarge, quantity: 1 }, { product_id: bbq, quantity: 4 }], `diff-mixed-${k}-000000001`, {}],
    ([k]) => [[{ product_id: curry, variant_id: viand, quantity: 2 }, { product_id: curry, variant_id: withRice, quantity: 1 }], `diff-curry-${k}-000000001`, { program: 'pwd', paid: '300' }],
    ([k]) => [[{ product_id: tapa, quantity: 2 }, { product_id: rice, quantity: 1 }], `diff-tapa-${k}-0000000001`, { program: 'employee_meal', paid: '0' }],
  ];
  const norm = async (tl, dbx, key) => {
    const out = [];
    for (const build of scenario) {
      const [items, k, opts] = build([key]);
      try {
        const sale = await tl.sell(items, k, opts);
        const lines = (await dbx.query(`select p.name, si.variant_name, si.quantity::int q, si.unit_price::numeric u, si.discount_amount::numeric d, si.subtotal::numeric s from public.sale_items si join public.products p on p.id=si.product_id where si.sale_id=$1 order by p.name, si.variant_name`, [sale.id])).rows;
        const mv = (await tl.movements(sale.id)).map((m) => [m.name, Number(m.q), m.movement_type, m.reference_type]);
        out.push({ total: Number(sale.total_amount), catalog: Number(sale.catalog_subtotal), program: sale.pricing_program, change: Number(sale.change_amount), lines, mv, stock: await tl.stock() });
      } catch (e) {
        out.push({ error: String(e.message) });
      }
    }
    return out;
  };
  const a = await norm(to, old, 'old');
  const b = await norm(tn, fresh, 'new');
  assert.ok(a.every((r) => !r.error), 'the old function accepted every scenario: ' + JSON.stringify(a.filter((r) => r.error)));
  assert.deepEqual(b, a, 'identical totals, lines, movements and stock');
  console.log('differential vs the previous function: ok');
}

console.log('shared_inventory_confirm_sale: ALL PASS');
