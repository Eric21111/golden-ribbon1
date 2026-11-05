// Migration 20261026100000_pos_require_active_branch_variant: a product with configured options is sold only through an
// ACTIVE branch option. The test builds the broken state with the OLD functions (all earlier migrations), records history
// the old logic produced (sales made through the base-price fallback), applies the new migration, and then checks that
// history is untouched, the products became unavailable, normal option sales and single-price sales still work, and stock
// moves exactly as before. Real RPCs on PGlite (Postgres WASM, not a native PostgreSQL). Not a device test.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const NEW = '20261026100000_pos_require_active_branch_variant.sql';
// later migrations (e.g. 20261027100000_edit_product_keeps_branch_availability, edit_product_atomic_availability.mjs) are out of scope here
const files = readdirSync('supabase/migrations').filter((n) => n.endsWith('.sql')).sort().filter((n) => n <= NEW);
assert.equal(files[files.length - 1], NEW, 'the new migration is the latest one');
const strip = (sql) => sql.replace(/create extension if not exists pgcrypto;/g, '');

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth; create table auth.users(id uuid primary key, email text);
  create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public, auth to authenticated; grant execute on function auth.uid() to authenticated;
`);
for (const f of files.filter((n) => n !== NEW)) await db.exec(strip(read(`supabase/migrations/${f}`)));

const id = (n) => `83000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const [mgr, c1, c2, main, sm1, sm2] = [id(2), id(4), id(5), id(10), id(11), id(12)];
const J = JSON.stringify;
const as = async (user, work) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${user}',false);`);
  try {
    return await work();
  } finally {
    await db.exec('reset role');
  }
};
await db.exec(`
  insert into auth.users values ('${mgr}','m@t'),('${c1}','c1@t'),('${c2}','c2@t');
  insert into public.branches(id,name,code,is_main_branch,is_active,receiving_mode) values
    ('${main}','Main','MAIN-VF',true,true,'counted'),('${sm1}','SM1','SM1-VF',false,true,'cashier_confirm'),('${sm2}','SM2','SM2-VF',false,true,'cashier_confirm');
  insert into public.profiles(id,full_name,role,branch_id) values
    ('${mgr}','Main Mgr','manager','${main}'),('${c1}','Cashier One','cashier','${sm1}'),('${c2}','Cashier Two','cashier','${sm2}');
`);
const create = (o) =>
  as(mgr, () =>
    db.query(
      `select * from public.create_complete_product(p_name:=$1,p_sku:=$2,p_description:=null,p_variants:=$3::jsonb,p_branches:=$4::jsonb,p_selling_price:=$5,p_stock_uses:=$6::jsonb,p_drink_choices:=$7::jsonb)`,
      [o.name, o.sku, J((o.variants ?? []).map(([n, p]) => ({ name: n, default_price: p }))), J(o.branches), o.price ?? null, o.stockUses ? J(o.stockUses) : null, o.drinks ? J(o.drinks) : null],
    ),
  ).then((r) => r.rows[0]);
const priced = (branches, variants) => branches.map((b) => (variants ? { branch_id: b, variants: variants.map(([n, p]) => ({ name: n, selling_price: p })) } : { branch_id: b, selling_price: '40.00' }));
const rice = await create({ name: 'Rice', sku: 'RICE-VF', price: '10', branches: priced([sm1, sm2]) });
const coke = await create({ name: 'Coke', sku: 'COKE-VF', price: '25', branches: priced([sm1, sm2]) });
const V = [['Viand Only', '70.00'], ['With Rice', '85.00']];
const curry = await create({
  name: 'Beef Curry', sku: 'CURRY-VF', variants: V, branches: priced([sm1], V),
  stockUses: [{ variant_name: 'Viand Only', ingredient_product_id: 'self', quantity: 1 }, { variant_name: 'With Rice', ingredient_product_id: 'self', quantity: 1 }, { variant_name: 'With Rice', ingredient_product_id: rice.id, quantity: 1 }],
  drinks: [{ variant_name: 'With Rice', drink_product_id: coke.id }],
});
const W = [['Small', '30.00'], ['Large', '50.00']];
const combo = await create({ name: 'Combo', sku: 'COMBO-VF', variants: W, branches: priced([sm1], W) });
const single = await create({ name: 'Plain Fries', sku: 'FRIES-VF', price: '40', branches: priced([sm1, sm2]) });
// SM2 carries the meal with NO option rows (master options exist, the branch has none)
await as(mgr, () => db.query('select public.configure_branch_products($1,$2::jsonb)', [sm2, J([{ product_id: curry.id, selling_price: '70.00', is_active: true }])]));
const all = [rice, coke, curry, combo, single];
for (const p of all) await as(mgr, () => db.query('select public.set_product_status($1,true)', [p.id]));
await as(mgr, () => db.query(`select public.initialize_main_branch_inventory($1::jsonb,'open')`, [J(all.map((p) => ({ product_id: p.id, quantity: 200 })))]));
let n = 0;
const key = (p) => `${p}-${String(++n).padStart(14, '0')}`;
for (const [branch, cashier] of [[sm1, c1], [sm2, c2]]) {
  const t = (await as(mgr, () => db.query('select public.send_stock_transfer($1,$2::jsonb,null,$3) id', [branch, J(all.map((p) => ({ product_id: p.id, quantity_sent: 100, destination_price: 20 }))), key('vf-send')]))).rows[0].id;
  await as(cashier, () => db.query('select public.confirm_shipment_arrival($1,$2)', [t, key('vf-arrive')]));
}
const shift = {};
for (const [b, c] of [[sm1, c1], [sm2, c2]]) shift[b] = (await as(c, () => db.query('select public.start_cashier_shift() id'))).rows[0].id;
const stock = async (b) => Object.fromEntries((await db.query(`select p.name, bi.quantity_on_hand::numeric q from public.branch_inventory bi join public.products p on p.id=bi.product_id where bi.branch_id=$1`, [b])).rows.map((r) => [r.name, Number(r.q)]));
const delta = (a, b) => Object.fromEntries(Object.keys(b).map((k) => [k, b[k] - a[k]]).filter(([, v]) => v));
const bv = async (b, product, name) => (await db.query('select id from public.branch_product_variants where branch_id=$1 and product_id=$2 and name=$3', [b, product.id, name])).rows[0].id;
const setOptions = (b, product, list) => as(mgr, () => db.query('select public.configure_branch_product_variants($1,$2,$3::jsonb)', [b, product.id, J(list.map(([name, price, on]) => ({ name, selling_price: price, is_active: on })))]));
const saleOf = (cashier, b, lines, k = key('vf-sale')) => as(cashier, () => db.query('select (public.confirm_sale($1,$2::jsonb,$3,$4,$5)).*', [shift[b], J(lines), '1000', k, 'standard'])).then((r) => r.rows[0]);
const pos = async (cashier) => (await as(cashier, () => db.query('select product_name, variants, selling_price::numeric p, sellable_quantity::numeric q from public.list_cashier_pos_inventory()'))).rows;
const prices = (cashier, lines) => as(cashier, () => db.query('select * from public.get_cashier_line_prices($1::jsonb)', [J(lines)])).then((r) => r.rows);

// ---------------------------------------------------------------- 1. BEFORE: the bug, under the old functions, and its history
await setOptions(sm1, curry, [['Viand Only', '70.00', false], ['With Rice', '85.00', false]]);
const oldSm1 = await pos(c1);
assert.ok(oldSm1.some((r) => r.product_name === 'Beef Curry' && r.variants.length === 0), 'old: listed with no options');
const stock1Before = await stock(sm1);
const historySm1 = await saleOf(c1, sm1, [{ product_id: curry.id, variant_id: null, quantity: 2 }], 'history-sale-sm1-000000001');
assert.equal(Number(historySm1.total_amount), 140, 'old: sold at the base price');
assert.deepEqual(delta(stock1Before, await stock(sm1)), { 'Beef Curry': -2 }, 'old: no Rice, no drink');
const historySm2 = await saleOf(c2, sm2, [{ product_id: curry.id, variant_id: null, quantity: 1 }], 'history-sale-sm2-000000001');
assert.equal(Number(historySm2.total_amount), 70);

const TABLES = ['sales', 'sale_items', 'inventory_movements', 'branch_inventory', 'branch_products', 'branch_product_variants', 'product_variants', 'product_stock_uses', 'product_drink_choices', 'products'];
const snapshot = async () => {
  const out = {};
  for (const t of TABLES) out[t] = (await db.query(`select to_jsonb(x) j from public.${t} x order by 1`)).rows.map((r) => r.j);
  return JSON.stringify(out);
};
const before = await snapshot();

// The read-only audit script (docs/pos-variant-fallback-audit.sql) must find exactly this broken state, before the fix
{
  const queries = read('docs/pos-variant-fallback-audit.sql').split(/\n(?=-- \d\) )/).slice(1).map((q) => q.replace(/^--.*$/gm, '').trim().replace(/;\s*$/, ''));
  assert.equal(queries.length, 7);
  const rows = async (i) => (await db.query(queries[i])).rows;
  const headline = Object.fromEntries((await rows(0)).map((r) => [r.state, [Number(r.product_branch_pairs), Number(r.on_cashier_menu_today)]]));
  assert.deepEqual(headline, { 'all options off': [1, 1], 'no option rows': [1, 1] }, 'audit 1: SM1 (all off) and SM2 (no rows), both on the menu today');
  const detail = await rows(1);
  assert.deepEqual(detail.map((r) => [r.branch, r.product, r.on_cashier_menu_today, Number(r.base_price_used_today)]), [['SM1', 'Beef Curry', true, 70], ['SM2', 'Beef Curry', true, 70]]);
  const history = await rows(2);
  assert.deepEqual(history.map((r) => [r.branch, r.product, Number(r.units), Number(r.revenue)]).sort(), [['SM1', 'Beef Curry', 2, 140], ['SM2', 'Beef Curry', 1, 70]].sort(), 'audit 3: the two fallback sales');
  assert.deepEqual((await rows(5)).map((r) => [r.branch, Number(r.open_shifts)]), [['SM1', 1], ['SM2', 1]], 'audit 6: open shifts');
  assert.equal((await rows(4)).length, 0, 'audit 5: no anomalies in the fixture');
  assert.equal((await rows(6)).length, 0, 'audit 7: no retired master option is active at a branch in the fixture');
  console.log('2. read-only audit finds the broken state: ok');
}


// ---------------------------------------------------------------- 2. APPLY the new migration
await db.exec(strip(read(`supabase/migrations/${NEW}`)));

// ---------------------------------------------------------------- 3. history and configuration are untouched
assert.equal(await snapshot(), before, 'sales, sale_items, movements, balances, prices, options, recipes and drink choices are byte-for-byte unchanged');
{
  const replay = await saleOf(c1, sm1, [{ product_id: curry.id, variant_id: null, quantity: 2 }], 'history-sale-sm1-000000001');
  assert.equal(replay.id, historySm1.id, 'a retry of an earlier fallback sale (same idempotency key) still returns that sale');
  assert.equal(await snapshot(), before, 'and changes nothing');
}
console.log('3. history preserved: ok');

// ---------------------------------------------------------------- 4. all options off / no option rows: unavailable
{
  const sm1Pos = await pos(c1);
  assert.ok(!sm1Pos.some((r) => r.product_name === 'Beef Curry'), 'SM1 all options off: not on the cashier menu');
  assert.ok(!(await pos(c2)).some((r) => r.product_name === 'Beef Curry'), 'SM2 no option rows: not on the cashier menu');
  const attempts = [
    [c1, sm1, [{ product_id: curry.id, variant_id: null, quantity: 1 }]],
    [c1, sm1, [{ product_id: curry.id, variant_id: await bv(sm1, curry, 'With Rice'), drink_product_id: coke.id, quantity: 1 }]], // a (now inactive) option
    [c2, sm2, [{ product_id: curry.id, variant_id: null, quantity: 1 }]],
  ];
  for (const [cashier, b, lines] of attempts) {
    const s0 = await stock(b);
    await assert.rejects(saleOf(cashier, b, lines), /No option of "Beef Curry" is available at this branch\./, 'checkout is refused with a clear message');
    assert.deepEqual(await stock(b), s0, 'nothing is deducted');
  }
  assert.equal(Number((await db.query(`select count(*)::int n from public.sales where idempotency_key like 'vf-sale-%'`)).rows[0].n), 0, 'no sale row was written by a refused checkout');
  // the price lookup gives no row (the client reads that as "no longer available"): never the base price
  assert.deepEqual(await prices(c1, [{ product_id: curry.id, variant_id: null }]), []);
  assert.deepEqual(await prices(c2, [{ product_id: curry.id, variant_id: null }]), []);
  assert.deepEqual(await prices(c1, [{ product_id: curry.id, variant_id: await bv(sm1, curry, 'With Rice') }]), [], 'an inactive option has no price either');
  console.log('4. unavailable when options are off or missing: ok');
}

// ---------------------------------------------------------------- 5. one option back on: only that option, at ITS price
{
  await setOptions(sm1, curry, [['Viand Only', '75.00', true], ['With Rice', '85.00', false]]);
  const row = (await pos(c1)).find((r) => r.product_name === 'Beef Curry');
  assert.ok(row, 'back on the menu');
  assert.deepEqual(row.variants.map((v) => [v.name, Number(v.selling_price)]), [['Viand Only', 75]], 'only the active option, at its price (not the 70 base)');
  const viand = await bv(sm1, curry, 'Viand Only');
  const s0 = await stock(sm1);
  const sale = await saleOf(c1, sm1, [{ product_id: curry.id, variant_id: viand, quantity: 2 }]);
  assert.equal(Number(sale.total_amount), 150);
  assert.deepEqual(delta(s0, await stock(sm1)), { 'Beef Curry': -2 }, 'Viand Only deducts the meal only (its recipe)');
  await assert.rejects(saleOf(c1, sm1, [{ product_id: curry.id, variant_id: null, quantity: 1 }]), /No option of|Select a meal option/, 'still no sale without an option');
  assert.deepEqual((await prices(c1, [{ product_id: curry.id, variant_id: viand }])).map((r) => Number(r.selling_price)), [75]);
  // the other option, with its recipe and drink choice, once it is on again
  await setOptions(sm1, curry, [['Viand Only', '75.00', true], ['With Rice', '85.00', true]]);
  const withRice = await bv(sm1, curry, 'With Rice');
  const s1 = await stock(sm1);
  const sale2 = await saleOf(c1, sm1, [{ product_id: curry.id, variant_id: withRice, drink_product_id: coke.id, quantity: 3 }]);
  assert.equal(Number(sale2.total_amount), 255);
  assert.deepEqual(delta(s1, await stock(sm1)), { 'Beef Curry': -3, Rice: -3, Coke: -3 }, 'With Rice: meal + Rice + the chosen drink, as before');
  console.log('5. option sales and deductions: ok');
}

// ---------------------------------------------------------------- 6. partly off, genuine single price, and other branches
{
  await setOptions(sm1, combo, [['Small', '30.00', true], ['Large', '50.00', false]]);
  const row = (await pos(c1)).find((r) => r.product_name === 'Combo');
  assert.deepEqual(row.variants.map((v) => v.name), ['Small'], 'a product with one option left stays available through it');
  const s0 = await stock(sm1);
  assert.equal(Number((await saleOf(c1, sm1, [{ product_id: combo.id, variant_id: await bv(sm1, combo, 'Small'), quantity: 1 }])).total_amount), 30);
  assert.deepEqual(delta(s0, await stock(sm1)), { Combo: -1 });
  await assert.rejects(saleOf(c1, sm1, [{ product_id: combo.id, variant_id: await bv(sm1, combo, 'Large'), quantity: 1 }]), /not available in this branch catalog/, 'the off option is still refused');

  // a product with NO master options is a genuine single-price product: unchanged everywhere
  assert.equal((await db.query('select count(*)::int n from public.product_variants where product_id=$1', [single.id])).rows[0].n, 0);
  for (const [cashier, b] of [[c1, sm1], [c2, sm2]]) {
    assert.ok((await pos(cashier)).some((r) => r.product_name === 'Plain Fries' && Number(r.p) === 40), `single-price product on the menu at ${b === sm1 ? 'SM1' : 'SM2'}`);
    assert.deepEqual((await prices(cashier, [{ product_id: single.id, variant_id: null }])).map((r) => Number(r.selling_price)), [40]);
    const s = await stock(b);
    assert.equal(Number((await saleOf(cashier, b, [{ product_id: single.id, variant_id: null, quantity: 2 }])).total_amount), 80);
    assert.deepEqual(delta(s, await stock(b)), { 'Plain Fries': -2 });
  }
  // an ingredient or drink sold on its own has no options either
  assert.equal(Number((await saleOf(c1, sm1, [{ product_id: coke.id, variant_id: null, quantity: 1 }])).total_amount), 40);
  console.log('6. partly off + single price: ok');
}

// ---------------------------------------------------------------- 6b. master options that are all inactive cannot bypass option selection
// configure_product_variants refuses to retire the last active master option, so this state is not reachable through the app's
// own tools, but it can come from direct SQL or old data. "Has configured options" means ANY master row, so it never falls back.
{
  const R = [['Plain', '20.00'], ['Fancy', '35.00']];
  const retired = await create({ name: 'Retired Options', sku: 'RETIRED-VF', variants: R, branches: priced([sm1], R) });
  await as(mgr, () => db.query('select public.set_product_status($1,true)', [retired.id]));
  await as(mgr, () => db.query(`select public.initialize_main_branch_inventory($1::jsonb,'open')`, [J([{ product_id: retired.id, quantity: 50 }])]));
  const t = (await as(mgr, () => db.query('select public.send_stock_transfer($1,$2::jsonb,null,$3) id', [sm1, J([{ product_id: retired.id, quantity_sent: 20, destination_price: 20 }]), key('vf-send')]))).rows[0].id;
  await as(c1, () => db.query('select public.confirm_shipment_arrival($1,$2)', [t, key('vf-arrive')]));
  // every MASTER option inactive, every BRANCH option off
  await db.exec(`update public.product_variants set is_active = false where product_id = '${retired.id}'`);
  await setOptions(sm1, retired, [['Plain', '20.00', false], ['Fancy', '35.00', false]]);
  assert.ok(!(await pos(c1)).some((r) => r.product_name === 'Retired Options'), 'not on the menu');
  const s0 = await stock(sm1);
  await assert.rejects(saleOf(c1, sm1, [{ product_id: retired.id, variant_id: null, quantity: 1 }]), /No option of "Retired Options" is available at this branch\./, 'no bypass through the base price');
  assert.deepEqual(await prices(c1, [{ product_id: retired.id, variant_id: null }]), []);
  assert.deepEqual(await stock(sm1), s0);
  // master all inactive, but a branch option is on: an option is still REQUIRED, and that option sells normally
  await setOptions(sm1, retired, [['Plain', '20.00', true], ['Fancy', '35.00', false]]);
  assert.ok((await pos(c1)).some((r) => r.product_name === 'Retired Options'));
  await assert.rejects(saleOf(c1, sm1, [{ product_id: retired.id, variant_id: null, quantity: 1 }]), /Select a meal option/);
  assert.equal(Number((await saleOf(c1, sm1, [{ product_id: retired.id, variant_id: await bv(sm1, retired, 'Plain'), quantity: 1 }])).total_amount), 20);
  console.log('6b. all-inactive master options: ok');
}

// ---------------------------------------------------------------- 6c. out-of-stock and drink states are NOT "no option": the product stays listed
{
  // Beef Curry at SM1: Viand Only = the meal; With Rice = the meal + Rice + a drink (Coke). Both options are on.
  await setOptions(sm1, curry, [['Viand Only', '75.00', true], ['With Rice', '85.00', true]]);
  const variantStock = async () => {
    const row = (await pos(c1)).find((r) => r.product_name === 'Beef Curry');
    return row && { product: Number(row.q), options: Object.fromEntries(row.variants.map((v) => [v.name, Number(v.sellable_quantity)])) };
  };
  const setStock = (name, qty) => db.exec(`update public.branch_inventory set quantity_on_hand = ${qty} where branch_id = '${sm1}' and product_id = (select id from public.products where name = '${name}')`);
  const before = await variantStock();
  assert.ok(before.options['With Rice'] > 0 && before.options['Viand Only'] > 0);

  // Rice runs out: With Rice is out of stock, Viand Only is fine, and the product stays listed
  const riceHad = (await stock(sm1)).Rice;
  await setStock('Rice', 0);
  const noRice = await variantStock();
  assert.equal(noRice.options['With Rice'], 0, 'With Rice shows 0 available');
  assert.ok(noRice.options['Viand Only'] > 0 && noRice.product > 0, 'Viand Only and the product are still available');
  await assert.rejects(saleOf(c1, sm1, [{ product_id: curry.id, variant_id: await bv(sm1, curry, 'With Rice'), drink_product_id: coke.id, quantity: 1 }]), /Insufficient stock/, 'refused for stock, not for options');
  assert.equal(Number((await saleOf(c1, sm1, [{ product_id: curry.id, variant_id: await bv(sm1, curry, 'Viand Only'), quantity: 1 }])).total_amount), 75);
  await setStock('Rice', riceHad);

  // every drink of With Rice disabled: that option cannot be sold, the other still can, the product stays listed
  await as(mgr, () => db.query('select public.set_product_status($1,false)', [coke.id]));
  const noDrink = await variantStock();
  assert.equal(noDrink.options['With Rice'], 0, 'With Rice: no enabled drink, so 0 available');
  assert.ok(noDrink.options['Viand Only'] > 0);
  await assert.rejects(saleOf(c1, sm1, [{ product_id: curry.id, variant_id: await bv(sm1, curry, 'With Rice'), drink_product_id: coke.id, quantity: 1 }]), /inactive or unavailable/);
  await as(mgr, () => db.query('select public.set_product_status($1,true)', [coke.id]));

  // every option out of stock: still LISTED (the POS shows it as out of stock), checkout refused for stock, never "no option"
  const curryHad = (await stock(sm1))['Beef Curry'];
  await setStock('Beef Curry', 0);
  const none = await variantStock();
  assert.ok(none, 'still listed');
  assert.equal(none.product, 0);
  assert.deepEqual(Object.values(none.options), [0, 0]);
  await assert.rejects(saleOf(c1, sm1, [{ product_id: curry.id, variant_id: await bv(sm1, curry, 'Viand Only'), quantity: 1 }]), /Insufficient stock/);
  await setStock('Beef Curry', curryHad);
  console.log('6c. out-of-stock options and disabled drinks: ok');
}

// ---------------------------------------------------------------- 7. the migration is additive and self-contained
{
  const mig = read(`supabase/migrations/${NEW}`);
  // top-level statements only (the bodies of the functions legitimately contain the inserts and updates they always had)
  const topLevel = mig.replace(/\$\$[\s\S]*?\$\$/g, '$$ $$').replace(/^--.*$/gm, '');
  assert.doesNotMatch(topLevel, /\b(insert into|update public\.|delete from|alter table|drop table|truncate)\b/i, 'no data statements: nothing is updated, deleted or backfilled');
  assert.doesNotMatch(topLevel, /drop function/i);
  const statements = topLevel.split(';').map((s) => s.trim().split(/\s+/).slice(0, 3).join(' ').toLowerCase()).filter(Boolean);
  assert.deepEqual([...new Set(statements)].sort(), ['begin', 'commit', 'comment on function', 'create or replace', 'grant execute on', 'revoke all on'].sort(), 'only function definitions, privileges and one comment');
  assert.match(mig, /grant execute on function public\.confirm_sale\(uuid, jsonb, numeric, text, text\) to authenticated;/);
  assert.match(mig, /revoke all on function public\.pos_options_unavailable\(uuid, uuid\) from public, anon, authenticated;/, 'the helpers are internal');
  // the signatures are unchanged (create or replace succeeded on top of the old ones)
  const sig = (await db.query(`select pg_get_function_result(p.oid) r from pg_proc p where p.proname = 'list_cashier_pos_inventory'`)).rows[0].r;
  assert.match(sig, /variants jsonb/);
  console.log('7. additive: ok');
}

// ---------------------------------------------------------------- 8. what the cashier reads when checkout is refused
{
  const { loadTs } = await import('./_load_ts.mjs');
  const { getCheckoutFailure, getInventoryErrorMessage } = loadTs('src/lib/errors.ts');
  // the REAL error the database raised in section 4 / 6b, in the shape supabase-js hands to the app
  let thrown;
  try {
    await saleOf(c2, sm2, [{ product_id: curry.id, variant_id: null, quantity: 1 }]); // SM2 still has no option rows for it
  } catch (error) {
    thrown = { code: error.code, message: error.message };
  }
  assert.equal(thrown.code, '22023');
  assert.match(thrown.message, /No option of "Beef Curry" is available at this branch\./);
  const failure = getCheckoutFailure(thrown);
  assert.equal(failure.message, 'An item in this order has no available option at this branch. Remove it from the order. Review the order and try again.');
  assert.equal(failure.preserveRequest, false, 'a definitive refusal: the request is not kept for a retry');
  assert.equal(getInventoryErrorMessage(thrown), 'An item in this order has no available option at this branch. Remove it from the order.');
  // neighbours are untouched
  assert.equal(getInventoryErrorMessage({ message: 'Select a meal option (variant) for Beef Curry.' }), 'Select a meal option before checkout.');
  assert.equal(getInventoryErrorMessage({ message: 'Choose a drink for With Rice.' }), 'Choose a drink for this meal option before checkout.');
  assert.equal(getInventoryErrorMessage({ message: 'Insufficient stock. Rice — Available: 0, Requested: 1' }), 'There is not enough stock to complete this operation.');
  console.log('8. checkout error text: ok');
}

console.log('pos_variant_fallback: ALL PASS');
