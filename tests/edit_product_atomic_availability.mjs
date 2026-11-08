// Migration 20261027100000_edit_product_keeps_branch_availability: update_complete_product keeps is_active on existing
// branch product / option rows when it saves a price (new rows are created ON). Real RPCs on PGlite (Postgres WASM, not a
// native PostgreSQL; true multi-session locking is NOT proven here, see the gated runner
// tests/edit_product_availability_concurrency_postgres.mjs).
//
// Three schemas are built from the real migration files:
//   OLD     everything except the new migration and the pending POS migration (what is deployed)
//   NEW     OLD + this migration                      (POS migration still pending)
//   NEWPOS  NEW + 20261026100000_pos_require_active_branch_variant (both applied)
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { loadTs } from './_load_ts.mjs';

const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const { branchesToSend } = loadTs('src/features/products/branchPricingEdit.ts');
const J = JSON.stringify;
const MIG = '20261027100000_edit_product_keeps_branch_availability.sql';
const POS = '20261026100000_pos_require_active_branch_variant.sql';
const LOCK = '20261028100000_update_complete_product_lock_order.sql';
const files = readdirSync('supabase/migrations').filter((n) => n.endsWith('.sql')).sort();
assert.deepEqual(files.slice(-2), [MIG, LOCK], 'the pending edit migrations sort last (after the pending POS migration)');
assert.ok(files.indexOf(POS) < files.indexOf(MIG));

const id = (n) => `86000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const [mgr, owner, c1, c2, main, sm1, sm2] = [id(2), id(3), id(4), id(5), id(10), id(11), id(12)];

async function boot(exclude) {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key, email text);
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public, auth to authenticated; grant execute on function auth.uid() to authenticated;
  `);
  for (const f of files.filter((n) => !exclude.includes(n))) await db.exec(read(`supabase/migrations/${f}`).replace(/create extension if not exists pgcrypto;/g, ''));
  return db;
}

async function suite(label, db, { fixed, pos }) {
  const as = async (user, work) => {
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${user}',false);`);
    try {
      return await work();
    } finally {
      await db.exec('reset role');
    }
  };
  const fails = async (user, work) => {
    try {
      await as(user, work);
      return null;
    } catch (e) {
      return String(e.message);
    }
  };
  await db.exec(`
    insert into auth.users values ('${mgr}','m@t'),('${owner}','o@t'),('${c1}','c1@t'),('${c2}','c2@t');
    insert into public.branches(id,name,code,is_main_branch,is_active,receiving_mode) values
      ('${main}','Main','MAIN-AV',true,true,'counted'),('${sm1}','SM1','SM1-AV',false,true,'cashier_confirm'),('${sm2}','SM2','SM2-AV',false,true,'cashier_confirm');
    insert into public.profiles(id,full_name,role,branch_id) values ('${mgr}','Main Mgr','manager','${main}'),('${owner}','Owner','owner',null),('${c1}','C1','cashier','${sm1}'),('${c2}','C2','cashier','${sm2}');
  `);
  const create = (o) =>
    as(mgr, () =>
      db.query(
        `select * from public.create_complete_product(p_name:=$1,p_sku:=$2,p_description:=null,p_variants:=$3::jsonb,p_branches:=$4::jsonb,p_selling_price:=$5,p_stock_uses:=$6::jsonb)`,
        [o.name, o.sku, J((o.variants ?? []).map(([n, p]) => ({ name: n, default_price: p }))), J(o.branches), o.price ?? null, o.stockUses ? J(o.stockUses) : null],
      ),
    ).then((r) => r.rows[0]);
  const V = [['Small', '30.00'], ['Large', '50.00']];
  const opt = (b, small = '30.00', large = '50.00') => ({ branch_id: b, variants: [{ name: 'Small', selling_price: small }, { name: 'Large', selling_price: large }] });
  const rice = await create({ name: 'Rice', sku: 'RICE-AV', price: '10', branches: [{ branch_id: sm1, selling_price: '10' }, { branch_id: sm2, selling_price: '10' }] });
  const combo = await create({
    name: 'Combo', sku: 'COMBO-AV', variants: V, branches: [opt(sm1), opt(sm2)],
    stockUses: [{ variant_name: 'Small', ingredient_product_id: 'self', quantity: 1 }, { variant_name: 'Large', ingredient_product_id: 'self', quantity: 1 }, { variant_name: 'Large', ingredient_product_id: rice.id, quantity: 1 }],
  });
  const other = await create({ name: 'Other', sku: 'OTHER-AV', price: '25', branches: [{ branch_id: sm1, selling_price: '25' }, { branch_id: sm2, selling_price: '27' }] });
  for (const p of [rice, combo, other]) await as(mgr, () => db.query('select public.set_product_status($1,true)', [p.id]));
  await as(mgr, () => db.query(`select public.initialize_main_branch_inventory($1::jsonb,'open')`, [J([rice, combo, other].map((p) => ({ product_id: p.id, quantity: 200 })))]));
  let n = 0;
  const key = (p) => `${p}-${String(++n).padStart(14, '0')}`;
  for (const [b, c] of [[sm1, c1], [sm2, c2]]) {
    const t = (await as(mgr, () => db.query('select public.send_stock_transfer($1,$2::jsonb,null,$3) id', [b, J([rice, combo, other].map((p) => ({ product_id: p.id, quantity_sent: 100, destination_price: 20 }))), key('av-send')]))).rows[0].id;
    await as(c, () => db.query('select public.confirm_shipment_arrival($1,$2)', [t, key('av-arrive')]));
  }
  const shift = {};
  for (const [b, c] of [[sm1, c1], [sm2, c2]]) shift[b] = (await as(c, () => db.query('select public.start_cashier_shift() id'))).rows[0].id;
  const optId = async (b, name) => (await db.query('select id from public.branch_product_variants where branch_id=$1 and product_id=$2 and name=$3', [b, combo.id, name])).rows[0].id;
  const sell = (cashier, b, lines) =>
    as(cashier, () => db.query('select (public.confirm_sale($1,$2::jsonb,$3,$4,$5)).*', [shift[b], J(lines), '1000', key('av-sale'), 'standard'])).then((r) => ({ ok: true, row: r.rows[0] }), (e) => ({ ok: false, msg: String(e.message) }));
  const posOptions = async (cashier) => (await as(cashier, () => db.query('select product_name, variants from public.list_cashier_pos_inventory()'))).rows.find((r) => r.product_name === 'Combo')?.variants.map((v) => v.name ?? v.variant_name) ?? null;

  const source = async (productId) => ({
    sourceVariants: (await db.query('select id, name, default_price::numeric d from public.product_variants where product_id=$1 order by sort_order, name', [productId])).rows.map((r) => ({ id: r.id, name: r.name, default_price: Number(r.d) })),
    sourceBranchPrices: (await db.query('select branch_id, selling_price::numeric p, is_active from public.branch_products where product_id=$1', [productId])).rows.map((r) => ({ branch_id: r.branch_id, selling_price: Number(r.p), is_active: r.is_active })),
    sourceBranchVariantPrices: (await db.query('select branch_id, name, selling_price::numeric p, is_active from public.branch_product_variants where product_id=$1', [productId])).rows.map((r) => ({ branch_id: r.branch_id, name: r.name, selling_price: Number(r.p), is_active: r.is_active })),
  });
  const snap = async (productId) => J({
    p: (await db.query('select selling_price::numeric p, is_active, name, sku from public.products where id=$1', [productId])).rows,
    bp: (await db.query('select branch_id, selling_price::numeric p, is_active from public.branch_products where product_id=$1 order by 1', [productId])).rows,
    bpv: (await db.query('select branch_id, name, selling_price::numeric p, is_active from public.branch_product_variants where product_id=$1 order by 1,2', [productId])).rows,
    uses: (await db.query('select variant_id, ingredient_product_id, quantity::numeric q from public.product_stock_uses where product_id=$1 order by 1,2', [productId])).rows,
    master: (await db.query('select id, name, default_price::numeric d, is_active from public.product_variants where product_id=$1 order by 2', [productId])).rows,
  });
  const everything = async () => J([await snap(rice.id), await snap(combo.id), await snap(other.id)]);
  const history = async () => J({
    sales: (await db.query('select id, total_amount::numeric t from public.sales order by id')).rows,
    items: (await db.query('select id, product_id, variant_name, quantity, unit_price::numeric u from public.sale_items order by id')).rows,
    moves: (await db.query('select count(*)::int n from public.inventory_movements')).rows,
    stock: (await db.query('select branch_id, product_id, quantity_on_hand::numeric q from public.branch_inventory order by 1,2')).rows,
  });
  const opRow = async (b, name) => (await db.query('select selling_price::numeric p, is_active from public.branch_product_variants where branch_id=$1 and product_id=$2 and name=$3', [b, combo.id, name])).rows[0];
  const bpRow = async (b, p = combo) => (await db.query('select selling_price::numeric p, is_active from public.branch_products where branch_id=$1 and product_id=$2', [b, p.id])).rows[0];
  const off = (b, name) => as(mgr, () => db.query('select public.configure_branch_product_variants($1,$2,$3::jsonb)', [b, combo.id, J([{ name, selling_price: name === 'Large' ? 50 : 30, is_active: false }])]));
  const on = (b, name) => as(mgr, () => db.query('select public.configure_branch_product_variants($1,$2,$3::jsonb)', [b, combo.id, J([{ name, selling_price: name === 'Large' ? 50 : 30, is_active: true }])]));
  const save = (variants, branches, extra = {}) =>
    as(extra.user ?? mgr, () =>
      db.query(
        `select * from public.update_complete_product(p_product_id:=$1,p_name:=$2,p_sku:='COMBO-AV',p_description:=null,p_is_active:=true,p_variants:=$3::jsonb,p_deleted_variant_ids:=$4::jsonb,p_branches:=$5::jsonb,p_selling_price:=null,p_stock_uses:=$6::jsonb)`,
        [combo.id, extra.name ?? 'Combo', J(variants), J(extra.deleted ?? []), J(branches), extra.stockUses ? J(extra.stockUses) : null],
      ),
    );
  const masters = async () => (await source(combo.id)).sourceVariants;
  const asVariants = async (prices = { Small: '30', Large: '50' }, names = {}) => (await masters()).map((v) => ({ id: v.id, name: names[v.name] ?? v.name, default_price: prices[v.name] }));

  // a sale first, so there is history; then Large switched off at SM1 and the WHOLE product off at SM2 (no screen-made accident)
  const smallSm1 = await optId(sm1, 'Small');
  const firstSale = await sell(c1, sm1, [{ product_id: combo.id, variant_id: smallSm1, quantity: 2 }]);
  assert.ok(firstSale.ok, firstSale.msg);
  await off(sm1, 'Large');
  await as(mgr, () => db.query('select public.configure_branch_products($1,$2::jsonb)', [sm2, J([{ product_id: combo.id, selling_price: 30, is_active: false }])]));
  const start = await everything();
  const startHistory = await history();
  const reset = async () => {
    // back to the starting flags/prices for the next scenario (through the same public functions the screens use)
    await as(mgr, () => db.query('select public.configure_branch_product_variants($1,$2,$3::jsonb)', [sm1, combo.id, J([{ name: 'Small', selling_price: 30, is_active: true }, { name: 'Large', selling_price: 50, is_active: false }])]));
    await as(mgr, () => db.query('select public.configure_branch_products($1,$2::jsonb)', [sm1, J([{ product_id: combo.id, selling_price: 30, is_active: true }])]));
    await as(mgr, () => db.query('select public.configure_branch_product_variants($1,$2,$3::jsonb)', [sm2, combo.id, J([{ name: 'Small', selling_price: 30, is_active: true }, { name: 'Large', selling_price: 50, is_active: true }])]));
    await as(mgr, () => db.query('select public.configure_branch_products($1,$2::jsonb)', [sm2, J([{ product_id: combo.id, selling_price: 30, is_active: false }])]));
  };
  const steady = async (why) => assert.equal(await everything(), start, `${label}: back to the starting state (${why})`);

  // ------------------------------------------------ A. a price edit at a branch, ALL branches sent (the old app payload)
  await save(await asVariants(), [opt(sm1, '32'), opt(sm2, '33')]);
  assert.equal(Number((await opRow(sm1, 'Small')).p), 32, `${label}: price saved at SM1`);
  assert.equal(Number((await opRow(sm2, 'Small')).p), 33, `${label}: price saved at SM2`);
  assert.equal((await opRow(sm1, 'Large')).is_active, fixed ? false : true, `${label}: Large at SM1 ${fixed ? 'stays OFF' : 'is switched back ON (the bug)'}`);
  assert.equal((await bpRow(sm2)).is_active, fixed ? false : true, `${label}: the product at SM2 ${fixed ? 'stays OFF' : 'is switched back ON (the bug)'}`);
  assert.equal(Number((await opRow(sm1, 'Large')).p), 50, `${label}: the off option keeps its price`);

  // ------------------------------------------------ B. the exposure window the old app left (between the two requests)
  const during = await posOptions(c1);
  const largeNow = await sell(c1, sm1, [{ product_id: combo.id, variant_id: await optId(sm1, 'Large'), quantity: 1 }]);
  if (fixed) {
    assert.ok(!during.includes('Large'), `${label}: the off option is never listed to the cashier`);
    assert.equal(largeNow.ok, false, `${label}: and never sold: ${largeNow.msg}`);
  } else {
    assert.ok(during.includes('Large'), `${label}: old: between the two requests the off option IS listed`);
    assert.equal(largeNow.ok, true, `${label}: old: ...and sellable`);
  }
  if (!fixed) {
    await reset(); // the old flow leaves things on; put them back for the remaining checks
    return { start: null };
  }

  // ------------------------------------------------ C. an edit that changes nothing (all branches sent) changes nothing, other products untouched
  await reset();
  await steady('after reset');
  await save(await asVariants(), [opt(sm1), opt(sm2)]);
  await steady('untouched edit, all branches sent');
  assert.equal(await history(), (await history()), 'history readable');

  // ------------------------------------------------ D. a stale screen cannot undo an intentional switch
  const stale = { variants: await asVariants({ Small: '30', Large: '50' }) }; // the edit screen was opened here...
  await on(sm1, 'Large'); // ...a manager switched Large ON in Branch Catalogs meanwhile...
  await off(sm1, 'Small'); // ...and Small OFF
  await save(stale.variants, [opt(sm1, '31')]); // ...then the stale screen saved a price
  assert.deepEqual([(await opRow(sm1, 'Large')).is_active, (await opRow(sm1, 'Small')).is_active], [true, false], `${label}: the later intentional switches survive a stale save`);
  assert.equal(Number((await opRow(sm1, 'Small')).p), 31);
  await reset();
  await save(await asVariants({ Small: '30', Large: '50' }), [opt(sm1, '30')]);
  await steady('stale scenario undone');

  // ------------------------------------------------ E. new things are created ON; existing off things stay off
  // new option Regular at an existing product (Large is off at SM1; the product is off at SM2)
  const withRegular = [...(await asVariants()), { id: null, name: 'Regular', default_price: '20' }];
  const optsR = (b, extra = {}) => ({ branch_id: b, variants: [{ name: 'Small', selling_price: '30' }, { name: 'Large', selling_price: '50' }, { name: 'Regular', selling_price: '20', ...extra }] });
  await save(withRegular, [optsR(sm1), optsR(sm2)]);
  assert.deepEqual([(await opRow(sm1, 'Regular')).is_active, (await opRow(sm2, 'Regular')).is_active], [true, true], `${label}: a NEW option is created ON at every branch sent`);
  assert.equal((await opRow(sm1, 'Large')).is_active, false, `${label}: the existing off option stays off`);
  assert.equal((await bpRow(sm2)).is_active, false, `${label}: the existing off branch product stays off`);
  // delete it again (and only it)
  await save((await asVariants()).filter((v) => v.name !== 'Regular'), [], { deleted: [(await db.query(`select id from public.product_variants where product_id=$1 and name='Regular'`, [combo.id])).rows[0].id] });
  assert.equal((await db.query(`select count(*)::int n from public.branch_product_variants where product_id=$1 and name='Regular'`, [combo.id])).rows[0].n, 0);
  await steady('option added then deleted');
  // a branch that never carried the product (Other at a new branch): created ON
  await db.exec(`insert into public.branches(id,name,code,is_main_branch,is_active,receiving_mode) values ('${id(13)}','SM3','SM3-AV',false,true,'cashier_confirm')`);
  await as(mgr, () => db.query(`select * from public.update_complete_product(p_product_id:=$1,p_name:='Other',p_sku:='OTHER-AV',p_description:=null,p_is_active:=true,p_variants:='[]'::jsonb,p_deleted_variant_ids:='[]'::jsonb,p_branches:=$2::jsonb,p_selling_price:='25')`, [other.id, J([{ branch_id: id(13), selling_price: '26' }])]));
  assert.deepEqual([Number((await bpRow(id(13), other)).p), (await bpRow(id(13), other)).is_active], [26, true], `${label}: a branch added by Edit is created ON`);
  await db.exec(`delete from public.branch_products where branch_id='${id(13)}'`);
  await db.exec(`delete from public.branches where id='${id(13)}'`);
  await steady('new branch added then removed');

  // ------------------------------------------------ F. rename keeps the switch and the recipe
  await save(await asVariants({ Small: '30', Large: '50' }, { Large: 'Big' }), [{ branch_id: sm1, variants: [{ name: 'Small', selling_price: '30' }, { name: 'Big', selling_price: '50' }] }]);
  assert.equal((await opRow(sm1, 'Big')).is_active, false, `${label}: renamed and still off at SM1`);
  assert.equal((await opRow(sm2, 'Big')).is_active, true, `${label}: renamed at SM2 (not sent) too`);
  assert.equal((await db.query(`select count(*)::int n from public.product_stock_uses u join public.product_variants v on v.id=u.variant_id where v.name='Big'`)).rows[0].n, 2, `${label}: recipe followed the rename`);
  await save(await asVariants({ Small: '30', Big: '50' }, { Big: 'Large' }), [{ branch_id: sm1, variants: [{ name: 'Small', selling_price: '30' }, { name: 'Large', selling_price: '50' }] }]);
  await steady('renamed and back');

  // ------------------------------------------------ G. intentional switches still work, and so do product status and p_is_active
  await on(sm1, 'Large');
  assert.equal((await opRow(sm1, 'Large')).is_active, true, `${label}: configure_* can switch on`);
  await save(await asVariants(), [opt(sm1)]);
  assert.equal((await opRow(sm1, 'Large')).is_active, true, `${label}: and Edit leaves it on`);
  await as(mgr, () => db.query('select public.set_product_status($1,false)', [combo.id]));
  assert.equal((await db.query('select is_active from public.products where id=$1', [combo.id])).rows[0].is_active, false);
  await as(mgr, () => db.query('select public.set_product_status($1,true)', [combo.id]));
  await reset();
  await steady('switches toggled back');

  // ------------------------------------------------ H. failures are all-or-nothing, flags included
  const before = await everything();
  // the recipe is applied AFTER the branch rows are written, so this fails late
  const badRecipe = await fails(mgr, async () => db.query(
    `select * from public.update_complete_product(p_product_id:=$1,p_name:='Combo',p_sku:='COMBO-AV',p_description:=null,p_is_active:=true,p_variants:=$2::jsonb,p_deleted_variant_ids:='[]'::jsonb,p_branches:=$3::jsonb,p_selling_price:=null,p_stock_uses:=$4::jsonb)`,
    [combo.id, J(await asVariants({ Small: '35', Large: '55' })), J([opt(sm1, '35', '55')]), J([{ variant_name: 'Small', ingredient_product_id: id(999), quantity: 1 }])],
  ));
  assert.ok(badRecipe, `${label}: a bad recipe is refused`);
  assert.equal(await everything(), before, `${label}: ...and nothing changed: prices, flags and recipes are as they were`);
  const badPrice = await fails(mgr, async () => save(await asVariants(), [opt(sm1, '40'), { branch_id: sm2, variants: [{ name: 'Small', selling_price: 'abc' }, { name: 'Large', selling_price: '50' }] }]));
  assert.ok(badPrice, `${label}: a bad price at the second branch is refused`);
  assert.equal(await everything(), before, `${label}: ...the first branch's new price was rolled back too`);
  const badBranch = await fails(mgr, async () => save(await asVariants(), [opt(sm1, '41'), opt(main, '41')]));
  assert.ok(badBranch, `${label}: sending Main is refused`);
  assert.equal(await everything(), before, `${label}: ...and rolled back`);
  const cashier = await fails(c1, async () => save(await asVariants(), [opt(sm1, '42')], { user: c1 }));
  assert.match(cashier, /Unauthorized/, `${label}: a cashier cannot edit`);
  const ownerTry = await fails(owner, async () => save(await asVariants(), [opt(sm1, '42')], { user: owner }));
  assert.match(ownerTry, /Unauthorized/, `${label}: an owner cannot edit (Main manager only, as before)`);
  assert.equal(await everything(), before);

  // ------------------------------------------------ I. partial updates: unsent branches and products are not touched
  await save(await asVariants({ Small: '30', Large: '50' }), [opt(sm1, '36')]);
  assert.equal(Number((await opRow(sm2, 'Small')).p), 30, `${label}: SM2 not sent: price untouched`);
  assert.equal((await bpRow(sm2)).is_active, false, `${label}: SM2 not sent: still off`);
  assert.equal(await snap(rice.id), JSON.parse(start)[0], `${label}: another product untouched`);
  assert.equal(await snap(other.id), JSON.parse(start)[2], `${label}: another product untouched`);
  await save(await asVariants({ Small: '30', Large: '50' }), []); // an empty branch list is fine
  await reset();
  await save(await asVariants(), [opt(sm1)]);
  await steady('partial updates undone');

  // ------------------------------------------------ J. the current app (sends only the branches whose prices changed, no restore step)
  {
    const src = await source(combo.id);
    const variants = await asVariants({ Small: '34', Large: '50' });
    const send = branchesToSend({ pricing: [{ branchId: sm1, variants: [{ name: 'Small', selling_price: '34' }, { name: 'Large', selling_price: '50' }] }, { branchId: sm2, variants: [{ name: 'Small', selling_price: '30' }, { name: 'Large', selling_price: '50' }] }], variants, ...src });
    assert.deepEqual(send.map((d) => d.branchId), [sm1], `${label}: only the changed branch is sent`);
    await save(variants, send.map((d) => ({ branch_id: d.branchId, variants: d.variants })));
    assert.equal(Number((await opRow(sm1, 'Small')).p), 34, `${label}: the new price is saved`);
    assert.equal((await opRow(sm1, 'Large')).is_active, false, `${label}: Large stays off at SM1 with no second request`);
    assert.equal((await bpRow(sm2)).is_active, false, `${label}: the product stays off at SM2`);
  }

  // ------------------------------------------------ K. sales, recipes and history are untouched by all of the above
  const smallPrice = (await db.query(`select unit_price::numeric u from public.sale_items order by id limit 1`)).rows[0].u;
  assert.equal(Number(smallPrice), 30, `${label}: the first sale line keeps the price it was sold at`);
  assert.deepEqual(JSON.parse(await history()).sales, JSON.parse(startHistory).sales, `${label}: sales rows untouched`);
  assert.deepEqual(JSON.parse(await history()).items, JSON.parse(startHistory).items, `${label}: sale lines untouched`);
  const after = await sell(c1, sm1, [{ product_id: combo.id, variant_id: smallSm1, quantity: 1 }]);
  assert.ok(after.ok, `${label}: a sale of an on option still works after the edits: ${after.msg}`);
  const sold = await sell(c1, sm1, [{ product_id: combo.id, variant_id: await optId(sm1, 'Large'), quantity: 1 }]);
  assert.equal(sold.ok, false, `${label}: an off option cannot be sold after the edits`);
  assert.deepEqual((await posOptions(c1)).slice().sort(), ['Small'], `${label}: the cashier is offered only the on option`);
  return { start };
}

const oldDb = await boot([MIG, POS, LOCK]);
await suite('OLD', oldDb, { fixed: false, pos: false });
console.log('OLD (deployed): the bug reproduced');

const newDb = await boot([POS, LOCK]);
await suite('NEW', newDb, { fixed: true, pos: false });
console.log('NEW (this migration, POS migration still pending): ok');

const bothDb = await boot([LOCK]);
await suite('NEW+POS', bothDb, { fixed: true, pos: true });
console.log('NEW+POS (both applied): ok');

const fullDb = await boot([]);
await suite('NEW+POS+LOCK', fullDb, { fixed: true, pos: true });
console.log('NEW+POS+LOCK (all three pending migrations applied): ok');

// ---------------------------------------------------------------- the migration file
{
  const sql = read(`supabase/migrations/${MIG}`);
  const body = sql.slice(sql.indexOf('create or replace function public.update_complete_product('), sql.indexOf('revoke all on function'));
  assert.doesNotMatch(sql, /\bdrop\s+(function|table|column|constraint|index|policy|trigger)\b/i, 'no drops');
  assert.doesNotMatch(sql, /\balter\s+table\b/i, 'no schema change');
  assert.doesNotMatch(sql.replace(body, ''), /\b(insert\s+into|update\s+public\.|delete\s+from)\b/i, 'no data change outside the function body');
  assert.equal((sql.match(/create or replace function/g) ?? []).length, 1, 'one function replaced');
  assert.equal((body.match(/is_active = true/g) ?? []).length, 0, 'the function no longer forces is_active = true');
  assert.equal((body.match(/on conflict \(branch_id, product_id(, name)?\) do update\n\s+set selling_price = excluded\.selling_price;/g) ?? []).length, 2, 'both upserts only update the price');
  const previous = read('supabase/migrations/20261024100000_save_product_drink_choices.sql');
  const oldBody = previous.slice(previous.indexOf('create function public.update_complete_product('), previous.indexOf('revoke all on function public.update_complete_product('));
  const normal = (s) => s.replace(/create (or replace )?function/, 'create function').replace(/\n\s*--[^\n]*/g, '').replace(/,\s*is_active = true;/g, ';').replace(/\s+/g, ' ');
  assert.equal(normal(body), normal(oldBody), 'apart from the two upserts and comments the function is identical to the deployed one');
  const sig = (await newDb.query(`select count(*)::int n from pg_proc where proname='update_complete_product' and pronamespace='public'::regnamespace`)).rows[0].n;
  assert.equal(sig, 1, 'one update_complete_product overload (no ambiguity for the app)');
  const acl = (await newDb.query(`select has_function_privilege('authenticated','public.update_complete_product(uuid,text,text,text,boolean,jsonb,jsonb,jsonb,text,text,text,jsonb,jsonb)','execute') a, has_function_privilege('anon','public.update_complete_product(uuid,text,text,text,boolean,jsonb,jsonb,jsonb,text,text,text,jsonb,jsonb)','execute') b`)).rows[0];
  assert.deepEqual([acl.a, acl.b], [true, false], 'grants: authenticated only');
  // independent of the pending POS migration
  const pos = read(`supabase/migrations/${POS}`);
  assert.doesNotMatch(pos, /update_complete_product/);
  assert.doesNotMatch(sql.replace(/^s*--.*$/gm, ''), /confirm_sale|list_cashier_pos_inventory|get_cashier_line_prices|pos_options_unavailable/, 'the code does not touch the sale functions');
  console.log('migration file: ok');
}

// ---------------------------------------------------------------- 20261028100000_update_complete_product_lock_order
{
  const sql = read(`supabase/migrations/${LOCK}`);
  const body = sql.slice(sql.indexOf('create or replace function public.update_complete_product('), sql.indexOf('revoke all on function'));
  const prev = read(`supabase/migrations/${MIG}`);
  const prevBody = prev.slice(prev.indexOf('create or replace function public.update_complete_product('), prev.indexOf('revoke all on function'));
  assert.doesNotMatch(sql, /\bdrop\s+(function|table|column|constraint|index|policy|trigger)\b/i, 'no drops');
  assert.doesNotMatch(sql, /\balter\s+table\b/i, 'no schema change');
  assert.doesNotMatch(sql.replace(/create or replace function[\s\S]*?\n\$\$;/g, ''), /\b(insert\s+into|update\s+public\.|delete\s+from)\b/i, 'no data change outside the two function bodies');
  assert.equal((sql.match(/create or replace function/g) ?? []).length, 2, 'two functions replaced: update_complete_product and update_branch_product_variant_price');
  // the previous body plus exactly the two lock blocks: remove them and nothing else differs
  const stripComments = (s) => s.replace(/\n\s*--[^\n]*/g, '').replace(/\s+/g, ' ').trim();
  const lock1 = body.indexOf('  begin\n    if jsonb_typeof(p_branches)');
  const lock1End = body.indexOf('  end;\n', body.indexOf('exception when invalid_text_representation')) + '  end;\n'.length;
  const lock2 = body.indexOf('  perform 1\n  from public.branch_products\n  where product_id = p_product_id');
  const lock2End = body.indexOf('for no key update;\n', lock2) + 'for no key update;\n'.length;
  assert.ok(lock1 > 0 && lock1End > lock1 && lock2 > lock1End && lock2End > lock2, 'both lock blocks found');
  const without = body.slice(0, lock1) + body.slice(lock1End, lock2) + body.slice(lock2End);
  assert.equal(stripComments(without), stripComments(prevBody), 'apart from the two lock blocks the function is identical to the previous one');
  // statement order: selling branches (share) -> product (update) -> branch_products rows (no key update) -> any option row
  const at = (needle, from = 0) => {
    const i = body.indexOf(needle, from);
    assert.ok(i >= 0, `found: ${needle}`);
    return i;
  };
  const iBranches = at('for share;', at('from public.branches b\n      where b.id in ('));
  const iProduct = at('select * into v_product from public.products where id = p_product_id for update;');
  const iBp = at('for no key update;');
  const iOption = at('perform 1 from public.product_variants', 0) >= 0 ? body.indexOf('from public.product_variants\n        where id = (v_variant.value->>\'id\')::uuid') : -1;
  assert.ok(iBranches < iProduct && iProduct < iBp, 'order: branches, product, branch_products');
  assert.ok(iOption < 0 || iBp < iOption, 'branch_products rows are locked before the first option row');
  assert.ok(body.indexOf('order by b.id') > 0 && body.indexOf('order by branch_id') > 0, 'locks are taken in id order');
  // same single function, same grants
  const count = (await fullDb.query(`select count(*)::int n from pg_proc where proname='update_complete_product' and pronamespace='public'::regnamespace`)).rows[0].n;
  assert.equal(count, 1);
  // bad input is rejected with exactly the same messages as before the migration
  const probe = async (db) => {
    const pid = (await db.query(`select id from public.products where sku='COMBO-AV'`)).rows[0].id;
    const masters = (await db.query('select id, name, default_price::text d from public.product_variants where product_id=$1 order by sort_order', [pid])).rows;
    const variants = J(masters.map((m) => ({ id: m.id, name: m.name, default_price: m.d })));
    const out = [];
    const payloads = [
      '"x"', '{"a":1}', '[1,2]', '[{"branch_id":"not-a-uuid"}]', `[{"branch_id":"${id(777)}"}]`, `[{"branch_id":"${main}"}]`,
      '[{"branch_id":"' + '-'.repeat(36) + '"}]', `[{"branch_id":"${sm1}"},{"branch_id":"${sm1}"}]`, `[{"branch_id":"${sm1}"}]`, 'null', '[]',
    ];
    for (const payload of payloads) {
      await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${mgr}',false);`);
      try {
        await db.query(`select * from public.update_complete_product(p_product_id:=$1,p_name:='Combo',p_sku:='COMBO-AV',p_description:=null,p_is_active:=true,p_variants:=$2::jsonb,p_deleted_variant_ids:='[]'::jsonb,p_branches:=$3::jsonb,p_selling_price:=null)`, [pid, variants, payload]);
        out.push('ok');
      } catch (e) {
        out.push(String(e.message));
      } finally {
        await db.exec('reset role');
      }
    }
    return out;
  };
  const before = await probe(bothDb);
  const after = await probe(fullDb);
  assert.deepEqual(after, before, 'every bad payload gives exactly the same result with the lock-order migration');
  assert.ok(before.some((m) => /invalid input syntax|invalid_branch|JSON arrays/.test(m)), 'the payloads do exercise the validation');
  // ---- update_branch_product_variant_price: the original plus one lock block, same behaviour
  const orig = read('supabase/migrations/20260926150000_create_complete_product.sql');
  const origFn = orig.slice(orig.indexOf('create or replace function public.update_branch_product_variant_price('));
  const origBody = origFn.slice(0, origFn.indexOf('$$;') + 3);
  const newFn = sql.slice(sql.indexOf('create or replace function public.update_branch_product_variant_price('));
  const newBody = newFn.slice(0, newFn.indexOf('$$;') + 3);
  const blockStart = newBody.indexOf('  select v0.branch_id, v0.product_id');
  const blockEnd = newBody.indexOf('  end if;\n', blockStart) + '  end if;\n\n'.length;
  assert.ok(blockStart > 0 && blockEnd > blockStart, 'price RPC lock block found');
  const withoutBlock = newBody.slice(0, blockStart) + newBody.slice(blockEnd);
  const norm = (s) => s.replace(/\n\s*--[^\n]*/g, '').replace(/\s+/g, ' ').replace('v_sort_order integer; v_branch_id uuid; v_product_id uuid; begin', 'v_sort_order integer; begin').trim();
  assert.equal(norm(withoutBlock), norm(origBody), 'apart from the lock block (and its two variables) the price RPC is identical to the original');
  assert.ok(newBody.indexOf('for no key update;') > 0 && newBody.indexOf('for no key update;') < newBody.indexOf('into v_row'), 'branch + branch_products rows are locked before the option row');
  const priceProbe = async (db) => {
    const pid = (await db.query(`select id from public.products where sku='COMBO-AV'`)).rows[0].id;
    const row = async (b, name) => (await db.query('select id from public.branch_product_variants where branch_id=$1 and product_id=$2 and name=$3', [b, pid, name])).rows[0].id;
    const small = await row(sm1, 'Small');
    const large = await row(sm1, 'Large');
    const out = [];
    const run = async (user, optionId, price) => {
      await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${user}',false);`);
      try {
        const r = await db.query('select * from public.update_branch_product_variant_price($1,$2)', [optionId, price]);
        const after = (await db.query('select v.name, v.selling_price::numeric p, v.is_active, bp.selling_price::numeric bp from public.branch_product_variants v join public.branch_products bp on bp.branch_id=v.branch_id and bp.product_id=v.product_id where v.id=$1', [optionId])).rows[0];
        out.push(['ok', Number(r.rows[0].selling_price), after.name, Number(after.p), after.is_active, Number(after.bp)]);
      } catch (e) {
        out.push(['error', String(e.message)]);
      } finally {
        await db.exec('reset role');
      }
    };
    await run(mgr, small, '41.00'); // the default option: also moves the branch product price
    await run(mgr, large, '61.00'); // not the default option: the branch product price stays
    await run(mgr, id(901), '10.00'); // unknown option
    await run(mgr, small, 'abc'); // bad price
    await run(mgr, small, '-5'); // negative
    await run(c1, small, '12.00'); // cashier
    await run(owner, small, '12.00'); // owner
    return out;
  };
  const priceBefore = await priceProbe(bothDb);
  const priceAfter = await priceProbe(fullDb);
  assert.deepEqual(priceAfter, priceBefore, 'update_branch_product_variant_price behaves exactly as before');
  assert.equal(priceBefore[0][0], 'ok');
  assert.equal(priceBefore[0][5], 41, 'default option price moves the branch product price');
  assert.equal(priceBefore[1][5], 41, 'a non-default option does not');
  assert.ok(priceBefore.slice(2).every(([k]) => k === 'error'), 'the bad calls are refused');
  assert.match(priceBefore[5][1], /Unauthorized/);
  console.log('lock-order migration: ok');
}

console.log('edit_product_atomic_availability: ALL PASS');
