// What an INACTIVE master option (product_variants.is_active = false) means today, traced on the real backend, and that the
// pending migration 20261026100000 does not change it. The master option is a TEMPLATE: it is read in one place only, when a
// branch first receives the product through a transfer (only active masters are copied to the branch). The branch option
// (branch_product_variants.is_active) alone decides what that branch lists and sells. This test RECORDS that behaviour; it does
// not claim it is the only possible design. Real RPCs on PGlite (Postgres WASM, not a native PostgreSQL).
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const NEW = '20261026100000_pos_require_active_branch_variant.sql';
// later migrations (e.g. 20261027100000_edit_product_keeps_branch_availability, edit_product_atomic_availability.mjs) are out of scope here
const files = readdirSync('supabase/migrations').filter((n) => n.endsWith('.sql')).sort().filter((n) => n <= NEW);
const strip = (sql) => sql.replace(/create extension if not exists pgcrypto;/g, '');
const J = JSON.stringify;

/** Builds a database (with or without the pending migration), runs the scenario, and returns what it observed. */
async function run(withNewMigration) {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key, email text);
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public, auth to authenticated; grant execute on function auth.uid() to authenticated;
  `);
  for (const f of files.filter((n) => withNewMigration || n !== NEW)) await db.exec(strip(read(`supabase/migrations/${f}`)));
  const id = (n) => `84000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const [mgr, c1, main, sm1, sm2] = [id(2), id(4), id(10), id(11), id(12)];
  const as = async (user, work) => {
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${user}',false);`);
    try {
      return await work();
    } finally {
      await db.exec('reset role');
    }
  };
  await db.exec(`
    insert into auth.users values ('${mgr}','m@t'),('${c1}','c1@t');
    insert into public.branches(id,name,code,is_main_branch,is_active,receiving_mode) values
      ('${main}','Main','MAIN-MO',true,true,'counted'),('${sm1}','SM1','SM1-MO',false,true,'cashier_confirm'),('${sm2}','SM2','SM2-MO',false,true,'cashier_confirm');
    insert into public.profiles(id,full_name,role,branch_id) values ('${mgr}','Main Mgr','manager','${main}'),('${c1}','Cashier One','cashier','${sm1}');
  `);
  const create = (o) =>
    as(mgr, () =>
      db.query(
        `select * from public.create_complete_product(p_name:=$1,p_sku:=$2,p_description:=null,p_variants:=$3::jsonb,p_branches:=$4::jsonb,p_selling_price:=$5,p_stock_uses:=$6::jsonb)`,
        [o.name, o.sku, J((o.variants ?? []).map(([n, p]) => ({ name: n, default_price: p }))), J(o.branches), o.price ?? null, o.stockUses ? J(o.stockUses) : null],
      ),
    ).then((r) => r.rows[0]);
  const priced = (branches, variants) => branches.map((b) => (variants ? { branch_id: b, variants: variants.map(([n, p]) => ({ name: n, selling_price: p })) } : { branch_id: b, selling_price: '10.00' }));
  const rice = await create({ name: 'Rice', sku: 'RICE-MO', price: '10', branches: priced([sm1]) });
  const V = [['Plain', '20.00'], ['Fancy', '35.00']];
  const meal = await create({
    name: 'Retired Meal', sku: 'MEAL-MO', variants: V, branches: priced([sm1], V),
    stockUses: [{ variant_name: 'Plain', ingredient_product_id: 'self', quantity: 1 }, { variant_name: 'Fancy', ingredient_product_id: 'self', quantity: 1 }, { variant_name: 'Fancy', ingredient_product_id: rice.id, quantity: 1 }],
  });
  for (const p of [rice, meal]) await as(mgr, () => db.query('select public.set_product_status($1,true)', [p.id]));
  await as(mgr, () => db.query(`select public.initialize_main_branch_inventory($1::jsonb,'open')`, [J([rice, meal].map((p) => ({ product_id: p.id, quantity: 100 })))]));
  let n = 0;
  const key = (p) => `${p}-${String(++n).padStart(14, '0')}`;
  const send = async (branch, cashier) => {
    const t = (await as(mgr, () => db.query('select public.send_stock_transfer($1,$2::jsonb,null,$3) id', [branch, J([rice, meal].map((p) => ({ product_id: p.id, quantity_sent: 40, destination_price: 20 }))), key('mo-send')]))).rows[0].id;
    await as(cashier, () => db.query('select public.confirm_shipment_arrival($1,$2)', [t, key('mo-arrive')]));
  };
  await send(sm1, c1);
  const shift = (await as(c1, () => db.query('select public.start_cashier_shift() id'))).rows[0].id;
  const stock = async (b) => Object.fromEntries((await db.query(`select p.name, bi.quantity_on_hand::numeric q from public.branch_inventory bi join public.products p on p.id=bi.product_id where bi.branch_id=$1`, [b])).rows.map((r) => [r.name, Number(r.q)]));
  const delta = (a, b) => Object.fromEntries(Object.keys(b).map((k) => [k, b[k] - a[k]]).filter(([, v]) => v));
  const bv = async (b, name) => (await db.query('select id from public.branch_product_variants where branch_id=$1 and product_id=$2 and name=$3', [b, meal.id, name])).rows[0].id;

  // retire the Fancy MASTER option (directly: no screen does this). The branch option stays active.
  await db.exec(`update public.product_variants set is_active = false where product_id = '${meal.id}' and name = 'Fancy'`);
  const out = {};

  // 1. the menu and the sale path at the branch that already carries it
  const row = (await as(c1, () => db.query('select * from public.list_cashier_pos_inventory()'))).rows.find((r) => r.product_name === 'Retired Meal');
  out.menuOptions = row.variants.map((v) => [v.name, Number(v.selling_price)]).sort();
  const s0 = await stock(sm1);
  const fancyId = await bv(sm1, 'Fancy');
  const sale = (await as(c1, () => db.query('select (public.confirm_sale($1,$2::jsonb,$3,$4,$5)).*', [shift, J([{ product_id: meal.id, variant_id: fancyId, quantity: 2 }]), '1000', key('mo-sale'), 'standard']))).rows[0];
  out.fancySale = { total: Number(sale.total_amount), deducted: delta(s0, await stock(sm1)) };
  out.priceRow = (await as(c1, () => db.query('select * from public.get_cashier_line_prices($1::jsonb)', [J([{ product_id: meal.id, variant_id: fancyId }])]))).rows.map((r) => Number(r.selling_price));

  // 2. a branch that receives the product LATER only gets the active masters
  await as(mgr, () => db.query('select public.configure_branch_products($1,$2::jsonb)', [sm2, J([{ product_id: rice.id, selling_price: '10.00', is_active: true }])])).catch(() => {});
  const t = (await as(mgr, () => db.query('select public.send_stock_transfer($1,$2::jsonb,null,$3) id', [sm2, J([{ product_id: meal.id, quantity_sent: 10, destination_price: 20 }]), key('mo-send')]))).rows[0].id;
  await db.exec(`insert into auth.users values ('${id(5)}','c2@t'); insert into public.profiles(id,full_name,role,branch_id) values ('${id(5)}','Cashier Two','cashier','${sm2}')`);
  await as(id(5), () => db.query('select public.confirm_shipment_arrival($1,$2)', [t, key('mo-arrive')]));
  out.newBranchOptions = (await db.query('select name from public.branch_product_variants where branch_id=$1 and product_id=$2 order by name', [sm2, meal.id])).rows.map((r) => r.name);

  // 3. saving the product in the Edit wizard re-activates branch options (the master flag is not consulted and is left alone)
  await as(mgr, () => db.query('select public.configure_branch_product_variants($1,$2,$3::jsonb)', [sm1, meal.id, J([{ name: 'Plain', selling_price: '20.00', is_active: true }, { name: 'Fancy', selling_price: '35.00', is_active: false }])]));
  const masters = (await db.query('select id, name from public.product_variants where product_id=$1 order by name', [meal.id])).rows;
  const fancyBefore = (await db.query('select is_active from public.branch_product_variants where branch_id=$1 and product_id=$2 and name=$3', [sm1, meal.id, 'Fancy'])).rows[0].is_active;
  await as(mgr, () => db.query(
    `select * from public.update_complete_product(p_product_id:=$1,p_name:='Retired Meal',p_sku:='MEAL-MO',p_description:=null,p_is_active:=true,p_variants:=$2::jsonb,p_deleted_variant_ids:='[]'::jsonb,p_branches:=$3::jsonb,p_selling_price:=null)`,
    [meal.id, J(masters.map((m, i) => ({ id: m.id, name: m.name, default_price: i === 0 ? '35.00' : '20.00' }))), J(priced([sm1], [['Fancy', '35.00'], ['Plain', '20.00']]))],
  ));
  const fancyAfter = (await db.query('select is_active from public.branch_product_variants where branch_id=$1 and product_id=$2 and name=$3', [sm1, meal.id, 'Fancy'])).rows[0].is_active;
  out.wizardSave = { branchFancyBefore: fancyBefore, branchFancyAfter: fancyAfter, masterFancyStill: (await db.query(`select is_active from public.product_variants where product_id=$1 and name='Fancy'`, [meal.id])).rows[0].is_active };
  // the read-only audit (docs/pos-variant-fallback-audit.sql, query 7) finds exactly this: a retired master option still active at SM1
  const audit = read('docs/pos-variant-fallback-audit.sql').split(/\n(?=-- \d\) )/).slice(1).map((q) => q.replace(/^--.*$/gm, '').trim().replace(/;\s*$/, ''));
  out.audit7 = (await db.query(audit[6])).rows.map((r) => [r.branch, r.product, r.option_name, Number(r.branch_price), Number(r.units_sold_ever)]);
  return out;
}

const before = await run(false);
const after = await run(true);

// ---- the behaviour, identical before and after the pending migration
assert.deepEqual(after, before, 'the pending migration changes none of this');

// 1. an inactive MASTER option with an ACTIVE branch option is still listed, priced and sold at the branch
assert.deepEqual(before.menuOptions, [['Fancy', 35], ['Plain', 20]], 'listed on the cashier menu');
assert.deepEqual(before.priceRow, [35], 'priced');
assert.deepEqual(before.fancySale, { total: 70, deducted: { 'Retired Meal': -2, Rice: -2 } }, 'sold, with its recipe (meal + Rice) deducted as usual');

assert.deepEqual(before.audit7, [['SM1', 'Retired Meal', 'Fancy', 35, 2]], 'audit query 7 reports the retired master option that is still sold at SM1');

// 2. only active masters are copied to a branch that receives the product later: the template does retire for NEW branches
assert.deepEqual(before.newBranchOptions, ['Plain'], 'a new branch does not get the retired option');

// 3. the Edit wizard turns branch options back on and never reads or changes the master flag
assert.deepEqual(before.wizardSave, { branchFancyBefore: false, branchFancyAfter: true, masterFancyStill: false });

// ---- where the master flag is (and is not) read: source-level confirmation
const migrations = files.map((f) => ({ f, text: read(`supabase/migrations/${f}`).replace(/--[^\n]*/g, '') }));
const readers = migrations.filter((m) => /\bpv\.is_active\b/.test(m.text) && m.f !== NEW).map((m) => m.f);
assert.ok(readers.length > 0 && readers.every((f) => /transfer|shipment|arrival|catalog|seed|kg_meal|inventory_only|carried|default_variants|cashier_report/i.test(f)), `the master flag is only read by the transfer / seeding paths: ${readers.join(', ')}`);
for (const f of ['20261024120000_confirm_sale_drink_choice.sql', '20261024160000_inventory_only_products.sql']) {
  const body = migrations.find((m) => m.f === f).text;
  const fn = f.startsWith('20261024120000') ? body.slice(body.indexOf('function public.confirm_sale')) : body.slice(body.indexOf('function public.list_cashier_pos_inventory'), body.indexOf('revoke all on function public.list_cashier_pos_inventory'));
  assert.doesNotMatch(fn, /\bpv\.is_active\b/, `${f}: the sale path / menu never consult the master flag`);
}
console.log('master_option_inactive_rules: ALL PASS');
