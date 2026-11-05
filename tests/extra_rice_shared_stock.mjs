// Rice (Inventory Supplies) holds the stock. Extra Rice (Extras & Sides, 20.00) is a selling product with NO stock of its own:
// its Stock Used Per Order is Rice x1. Meals "With Rice" use the same Rice pool. Real RPCs on PGlite + the real client modules.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { loadTs } from './_load_ts.mjs';

const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create table auth.users(id uuid primary key, email text);
  create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public, auth to authenticated;
  grant execute on function auth.uid() to authenticated;
`);
for (const f of readdirSync('supabase/migrations').filter((n) => n.endsWith('.sql')).sort()) {
  await db.exec(read(`supabase/migrations/${f}`).replace(/create extension if not exists pgcrypto;/g, ''));
}
const id = (n) => `75000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const mgr = id(2);
const cashier = id(4);
const main = id(10);
const booth = id(11);
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
  insert into auth.users values ('${mgr}','m@t'),('${cashier}','c@t');
  insert into public.branches(id,name,code,is_main_branch,is_active,receiving_mode) values
    ('${main}','Main Kitchen','MAIN-XR',true,true,'counted'),('${booth}','Booth','BOOTH-XR',false,true,'cashier_confirm');
  insert into public.profiles(id,full_name,role,branch_id) values
    ('${mgr}','Main Manager','manager','${main}'),('${cashier}','Cashier','cashier','${booth}');
`);
const create = ({ name, sku, variants = [], price = null, stockUses, branchPrice }) =>
  as(mgr, () =>
    db.query(
      `select * from public.create_complete_product(p_name := $1, p_sku := $2, p_description := null, p_variants := $3::jsonb, p_branches := $4::jsonb, p_selling_price := $5, p_stock_uses := $6::jsonb)`,
      [
        name,
        sku,
        J(variants.map(([n, p]) => ({ name: n, default_price: p }))),
        J([variants.length ? { branch_id: booth, variants: variants.map(([n, p]) => ({ name: n, selling_price: p })) } : { branch_id: booth, selling_price: branchPrice }]),
        price,
        stockUses === undefined ? null : J(stockUses),
      ],
    ),
  ).then((r) => r.rows[0]);
const enable = (product) => as(mgr, () => db.query('select public.set_product_status($1,true)', [product]));
const openMain = (items) => as(mgr, () => db.query(`select public.initialize_main_branch_inventory($1::jsonb,'open')`, [J(items.map(([product_id, quantity]) => ({ product_id, quantity })))]));
let keyN = 0;
const key = (p) => `${p}-${String(++keyN).padStart(14, '0')}`;
const sendAndReceive = async (items) => {
  const transfer = (await as(mgr, () => db.query('select public.send_stock_transfer($1,$2::jsonb,null,$3) id', [booth, J(items.map(([product_id, q]) => ({ product_id, quantity_sent: q, destination_price: 20 }))), key('xr-send')]))).rows[0].id;
  await as(cashier, () => db.query('select public.confirm_shipment_arrival($1,$2)', [transfer, key('xr-arrive')]));
};

// ---------------------------------------------------------------- setup through the real flows
const rice = await create({ name: 'Rice', sku: 'RICE-XR', price: '15.00', branchPrice: '15.00' }); // Inventory Supplies: just stock
const curry = await create({
  name: 'Chicken Curry',
  sku: 'CURRY-XR',
  variants: [['Viand Only', '70.00'], ['With Rice', '85.00']],
  stockUses: [
    { variant_name: 'Viand Only', ingredient_product_id: 'self', quantity: 1 },
    { variant_name: 'With Rice', ingredient_product_id: 'self', quantity: 1 },
    { variant_name: 'With Rice', ingredient_product_id: rice.id, quantity: 1 },
  ],
});
// Extra Rice: one fixed price, Stock Used Per Order = Rice x1 and nothing else (no "This Product")
const extra = await create({ name: 'Extra Rice', sku: 'XRICE-XR', price: '20.00', branchPrice: '20.00', stockUses: [{ ingredient_product_id: rice.id, quantity: 1 }] });
await openMain([[rice.id, 100], [curry.id, 50]]); // Extra Rice gets NO opening stock, no transfer: it has no stock of its own
for (const p of [rice, curry, extra]) await enable(p.id);
await sendAndReceive([[rice.id, 20], [curry.id, 30]]);
const shift = (await as(cashier, () => db.query('select public.start_cashier_shift() id'))).rows[0].id;
const bv = async (p, n) => (await db.query(`select id from public.branch_product_variants where branch_id=$1 and product_id=$2 and name=$3`, [booth, p, n])).rows[0].id;
const vRice = await bv(curry.id, 'With Rice');
const vOnly = await bv(curry.id, 'Viand Only');
const sell = (lines, k = key('xr-sale')) => as(cashier, () => db.query('select (public.confirm_sale($1,$2::jsonb,$3,$4,$5)).*', [shift, J(lines), '100000', k, 'standard'])).then((r) => r.rows[0]);
const stock = async () => Object.fromEntries((await db.query(`select p.name, bi.quantity_on_hand::numeric q from public.branch_inventory bi join public.products p on p.id=bi.product_id where bi.branch_id='${booth}'`)).rows.map((r) => [r.name, Number(r.q)]));
const rows = async () => (await as(cashier, () => db.query('select * from public.list_cashier_pos_inventory()'))).rows;
const byName = (list, name) => list.find((r) => r.product_name === name);

// ---------------------------------------------------------------- 1. what is saved
{
  const lines = (await db.query(`select ingredient_product_id, quantity::numeric q, variant_id from public.product_stock_uses where product_id=$1`, [extra.id])).rows;
  assert.deepEqual(lines.map((l) => [l.ingredient_product_id, Number(l.q), l.variant_id]), [[rice.id, 1, null]], 'Extra Rice uses Rice x1, product-level, and not itself');
  assert.equal((await db.query(`select count(*)::int n from public.product_stock_uses where product_id=$1 and ingredient_product_id=$1`, [extra.id])).rows[0].n, 0, 'no "This Product" line');
  const meal = (await db.query(`select ingredient_product_id = $2 as is_rice, quantity::numeric q from public.product_stock_uses where product_id=$1 and variant_id is not null and ingredient_product_id <> $1`, [curry.id, rice.id])).rows;
  assert.deepEqual(meal.map((l) => [l.is_rice, Number(l.q)]), [[true, 1]], 'With Rice uses Rice x1 from the same product');
  // Extra Rice has no stock rows anywhere
  assert.equal((await db.query(`select count(*)::int n from public.branch_inventory where product_id=$1`, [extra.id])).rows[0].n, 0);
  console.log('1. saved recipes: ok');
}

// ---------------------------------------------------------------- 2. POS availability comes from the Rice pool
{
  const list = await rows();
  const x = byName(list, 'Extra Rice');
  assert.equal(Number(x.sellable_quantity), 20, 'Extra Rice is sellable as far as Rice goes (20)');
  assert.deepEqual(x.stock_uses.product.map((l) => [l.ingredient_product_id, Number(l.quantity)]), [[rice.id, 1]]);
  assert.equal(Number(x.stock_uses.ingredient_stock[rice.id]), 20);
  assert.equal(Number(byName(list, 'Chicken Curry').variants.find((v) => v.name === 'With Rice').sellable_quantity), 20, 'the meal with rice draws on the same 20');
  assert.equal(Number(byName(list, 'Chicken Curry').variants.find((v) => v.name === 'Viand Only').sellable_quantity), 30, 'a meal without rice does not');
  console.log('2. availability from the Rice pool: ok');
}

// ---------------------------------------------------------------- 3. a mixed sale deducts Rice once, never Extra Rice
let sale1;
{
  const before = await stock();
  sale1 = await sell([
    { product_id: extra.id, variant_id: null, quantity: 3 },
    { product_id: curry.id, variant_id: vRice, quantity: 4 },
    { product_id: curry.id, variant_id: vOnly, quantity: 2 },
  ]);
  assert.equal(Number(sale1.total_amount), 3 * 20 + 4 * 85 + 2 * 70);
  const after = await stock();
  const d = Object.fromEntries(Object.keys(after).map((k) => [k, after[k] - before[k]]).filter(([, v]) => v));
  assert.deepEqual(d, { Rice: -7, 'Chicken Curry': -6 }, 'Rice: 3 (Extra Rice) + 4 (With Rice) = 7, once; the meal 6; nothing else');
  assert.ok(!('Extra Rice' in after), 'no Extra Rice stock row was ever created');
  const moves = (await db.query(`select p.name, m.quantity::numeric q from public.inventory_movements m join public.products p on p.id=m.product_id where m.reference_id=$1 order by 1`, [sale1.id])).rows;
  assert.deepEqual(moves.map((m) => [m.name, Number(m.q)]), [['Chicken Curry', -6], ['Rice', -7]], 'one movement per stocked product, none for Extra Rice');
  const items = (await db.query(`select p.name, si.quantity::numeric q, si.unit_price::numeric u from public.sale_items si join public.products p on p.id=si.product_id where si.sale_id=$1 order by 1`, [sale1.id])).rows;
  const sold = items.map((i) => `${i.name}:${Number(i.q)}@${Number(i.u)}`).sort();
  assert.deepEqual(sold, ['Chicken Curry:2@70', 'Chicken Curry:4@85', 'Extra Rice:3@20'], 'sales history still shows what was sold, at its own price');
  // replay with the same key: same sale, nothing deducted again
  const again = await sell([{ product_id: extra.id, variant_id: null, quantity: 3 }, { product_id: curry.id, variant_id: vRice, quantity: 4 }, { product_id: curry.id, variant_id: vOnly, quantity: 2 }], sale1.idempotency_key);
  assert.equal(again.id, sale1.id);
  assert.deepEqual(await stock(), after, 'a retry deducts nothing more');
  console.log('3. mixed sale, one Rice pool: ok');
}

// ---------------------------------------------------------------- 4. client cart limits and the server agree (13 Rice left)
{
  const { useCartStore } = loadTs('src/stores/cartStore.ts', { './checkoutStore': { useCheckoutStore: { getState: () => ({ request: null }) } } });
  const { buildStockContext, parseStockUses, withCartLimits, findShortages } = loadTs('src/features/pos/posAvailability.ts');
  const items = (await rows()).filter((r) => ['Extra Rice', 'Chicken Curry'].includes(r.product_name)).map((row) => ({
    product: { id: row.product_id, name: row.product_name, sku: row.product_sku, selling_price: Number(row.selling_price) },
    quantity_on_hand: Number(row.sellable_quantity),
    stock_uses: parseStockUses(row.stock_uses),
    variants: row.variants.map((v) => ({ ...v, selling_price: Number(v.selling_price), sellable_quantity: Number(v.sellable_quantity) })),
  }));
  const ctx = buildStockContext(items);
  const xItem = items.find((i) => i.product.name === 'Extra Rice');
  const cItem = items.find((i) => i.product.name === 'Chicken Curry');
  const withRice = cItem.variants.find((v) => v.name === 'With Rice');
  assert.equal(xItem.quantity_on_hand, 13);
  const store = useCartStore;
  store.setState({ items: [], stockContext: ctx });
  for (let i = 0; i < 20; i++) store.getState().addProduct(xItem, null);
  assert.equal(store.getState().items.find((l) => l.product_id === extra.id).quantity, 13, 'Extra Rice alone is capped by Rice (13), not by its own (missing) stock');
  store.getState().setProductQuantity(xItem, 10, null);
  for (let i = 0; i < 20; i++) store.getState().addProduct(cItem, withRice);
  assert.equal(store.getState().items.find((l) => l.variant_id === withRice.id).quantity, 3, 'With Rice gets only what Extra Rice left of the same Rice (13 - 10)');
  assert.deepEqual(findShortages(ctx, store.getState().items), []);
  const cart = store.getState().items.map(({ product_id, variant_id, quantity }) => ({ product_id, variant_id, quantity }));
  assert.equal(cart.reduce((n, l) => n + l.quantity, 0), 13);
  // the server refuses one more than the pool holds, writes nothing, then accepts exactly the cart the client allowed
  const before = await stock();
  await assert.rejects(() => sell([{ product_id: extra.id, variant_id: null, quantity: 10 }, { product_id: curry.id, variant_id: vRice, quantity: 4 }]), /insufficient|not enough|stock/i);
  assert.deepEqual(await stock(), before, 'a refused sale deducts nothing');
  await sell(cart);
  const after = await stock();
  assert.equal(after.Rice, 0, 'the shared Rice pool is exactly used up');
  // pool empty: both products become unsellable, together
  const list = await rows();
  assert.equal(Number(byName(list, 'Extra Rice').sellable_quantity), 0);
  assert.equal(Number(byName(list, 'Chicken Curry').variants.find((v) => v.name === 'With Rice').sellable_quantity), 0);
  await assert.rejects(() => sell([{ product_id: extra.id, variant_id: null, quantity: 1 }]), /insufficient|not enough|stock/i);
  console.log('4. shared limits, client = server: ok');
}

// ---------------------------------------------------------------- 5. Edit: fixing an Extra Rice that uses itself
{
  const legacy = await create({ name: 'Extra Rice Old', sku: 'XRICE-OLD', price: '20.00', branchPrice: '20.00' }); // nothing saved = "This Product"
  await enable(legacy.id);
  // without a recipe it uses its OWN stock, which it does not have: fails safe (unsellable), it never touches Rice
  await db.exec(`update public.branch_inventory set quantity_on_hand = 5 where branch_id='${booth}' and product_id='${rice.id}'`);
  assert.equal(Number(byName(await rows(), 'Extra Rice Old').sellable_quantity), 0);
  await assert.rejects(() => sell([{ product_id: legacy.id, variant_id: null, quantity: 1 }]), /insufficient|not enough|stock/i);
  // "This Product x1" saved explicitly is replaced by the complete new list: Rice x1 only
  const edit = (stockUses) => as(mgr, () => db.query(
    `select * from public.update_complete_product(p_product_id := $1, p_name := 'Extra Rice Old', p_sku := 'XRICE-OLD', p_description := null, p_is_active := true, p_variants := '[]'::jsonb, p_deleted_variant_ids := '[]'::jsonb, p_branches := $2::jsonb, p_selling_price := '20.00', p_stock_uses := $3::jsonb)`,
    [legacy.id, J([{ branch_id: booth, selling_price: '20.00' }]), stockUses === undefined ? null : J(stockUses)],
  ));
  await edit([{ ingredient_product_id: 'self', quantity: 1 }]);
  await edit([{ ingredient_product_id: rice.id, quantity: 1 }]);
  const saved = (await db.query(`select ingredient_product_id = $2 as is_rice, ingredient_product_id = $1 as is_self from public.product_stock_uses where product_id=$1`, [legacy.id, rice.id])).rows;
  assert.deepEqual(saved, [{ is_rice: true, is_self: false }], 'the old "This Product" line is gone');
  await edit(undefined); // an unrelated edit leaves the recipe alone
  assert.equal((await db.query(`select count(*)::int n from public.product_stock_uses where product_id=$1`, [legacy.id])).rows[0].n, 1);
  const before = await stock();
  await sell([{ product_id: legacy.id, variant_id: null, quantity: 2 }]);
  const after = await stock();
  assert.deepEqual(Object.fromEntries(Object.keys(after).map((k) => [k, after[k] - before[k]]).filter(([, v]) => v)), { Rice: -2 });
  console.log('5. editing an Extra Rice: ok');
}

// ---------------------------------------------------------------- 6. what the wizard sends for Extra Rice
{
  const { buildStockUsePayload, isDefaultProductLevel } = loadTs('src/features/products/stockUseMapping.ts');
  const { PRODUCT_STOCK_KEY } = loadTs('src/features/products/wizardGuards.ts');
  const payload = buildStockUsePayload({ [PRODUCT_STOCK_KEY]: [{ itemId: 'RICE-ID', quantity: 1 }] }, []);
  assert.deepEqual(payload, [{ ingredient_product_id: 'RICE-ID', quantity: 1 }], 'Rice x1 at product level, no variant, no "self"');
  assert.deepEqual(buildStockUsePayload({ [PRODUCT_STOCK_KEY]: [] }, []), [], 'an empty list saves nothing (the product then uses itself)');
  assert.equal(isDefaultProductLevel([{ itemId: 'RICE-ID', quantity: 1 }]), false, 'a Rice line is a real choice, never mistaken for the default');
  // the stock picker: Rice (Inventory Supplies) is offered for Extra Rice, in the default list or under All
  const { ingredientOptionsFromProducts, filterPickerItems, getPickerOptions } = loadTs('src/features/products/recipePreviewData.ts');
  const options = ingredientOptionsFromProducts([{ id: 'RICE-ID', name: 'Rice', category: 'supplies', sellInPos: false }, { id: 'EGG-ID', name: 'Egg', category: null, sellInPos: true }]);
  const offered = (filter) => filterPickerItems(getPickerOptions('Extra Rice', options), filter).filter((o) => o.id !== 'this-product').map((o) => o.name);
  assert.ok(offered('supplies').includes('Rice'), 'default list');
  assert.ok(offered('all').includes('Rice') && offered('all').includes('Egg'));
  const legacyRice = ingredientOptionsFromProducts([{ id: 'RICE-ID', name: 'Rice', category: null, sellInPos: true }]);
  assert.ok(filterPickerItems(getPickerOptions('Extra Rice', legacyRice), 'all').some((o) => o.name === 'Rice'), 'a Rice with no saved category is still pickable under All');
  const cfg = loadTs('src/features/products/productCategoryPreview.ts');
  const extras = cfg.getCategoryConfig('extras');
  assert.equal(extras.productLevelStock, true);
  assert.equal(extras.autoAddMainProduct, false, 'Extras do not start with This Product');
  assert.equal(extras.allowOtherStock, true, 'and may use other stock such as Rice');
  const { getWizardFlow } = loadTs('src/features/products/wizardGuards.ts');
  assert.equal(getWizardFlow({ sellable: true, category: 'extras', variantCount: 0 }), 'simple');
  assert.match(read('src/features/products/CreateProductWizard.tsx'), /simpleFlow && getCategoryConfig\(category\)\.productLevelStock \?/, 'the Rice list is on Step 1 of the simple flow');
  assert.match(read('src/features/products/EditProductWizard.tsx'), /simpleFlow && getCategoryConfig\(category\)\.productLevelStock \?/);
  console.log('6. wizard payload: ok');
}

console.log('extra_rice_shared_stock: ALL PASS');
