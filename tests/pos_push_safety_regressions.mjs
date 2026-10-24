// Regression tests for two POS bugs found in the push-safety review (real PGlite database + the real client modules).
//
// 1. Checkout price refresh: several cart lines can be the same meal + option with different drinks. The price depends on
//    product + option only and get_cashier_line_prices answers once per DISTINCT pair, so the client must not expect one
//    row per cart line.
// 2. Required drinks all inactive: an option that includes a drink but has no usable one is reported by the server as
//    sellable 0 and left out of stock_uses.drinks. That is NOT "no drink required": confirm_sale refuses it ("Choose a
//    drink"), so the POS must not let it be selected or added.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { loadTs } from './_load_ts.mjs';

const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

// ---------------------------------------------------------------- database
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
const id = (n) => `73000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const mainMgr = id(2);
const cashier = id(4);
const main = id(10);
const booth = id(11);
const egg = id(20);
const rice = id(21);
const coke = id(22);
const royal = id(23);
await db.exec(`
  insert into auth.users values ('${mainMgr}','m@t'),('${cashier}','c@t');
  insert into public.branches(id,name,code,is_main_branch,is_active,receiving_mode) values
    ('${main}','Main','MAIN-PS',true,true,'counted'),('${booth}','Booth','BOOTH-PS',false,true,'cashier_confirm');
  insert into public.profiles(id,full_name,role,branch_id) values
    ('${mainMgr}','Main Manager','manager','${main}'),('${cashier}','Cashier','cashier','${booth}');
  insert into public.products(id,name,sku,selling_price,is_active,inventory_mode,closing_stock_behavior) values
    ('${egg}','Egg','EGG-PS',10,true,'piece_stock','keep_at_branch'),
    ('${rice}','Rice','RICE-PS',15,true,'piece_stock','keep_at_branch'),
    ('${coke}','Coke','COKE-PS',20,true,'piece_stock','keep_at_branch'),
    ('${royal}','Royal','ROYAL-PS',20,true,'piece_stock','keep_at_branch');
  insert into public.branch_products(branch_id,product_id,selling_price,is_active) values
    ('${booth}','${egg}',10,true),('${booth}','${rice}',15,true),('${booth}','${coke}',20,true),('${booth}','${royal}',20,true);
`);
const as = async (user, work) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${user}',false);`);
  try {
    return await work();
  } finally {
    await db.exec('reset role');
  }
};
const J = (v) => JSON.stringify(v);
const createCurry = (name, sku, drinks) =>
  as(mainMgr, () =>
    db.query(
      `select * from public.create_complete_product(p_name := $1, p_sku := $2, p_description := null, p_variants := $3::jsonb, p_branches := $4::jsonb, p_selling_price := null, p_stock_uses := $5::jsonb, p_drink_choices := $6::jsonb)`,
      [
        name,
        sku,
        J([{ name: 'Viand Only', default_price: '70.00' }, { name: 'With Rice', default_price: '85.00' }]),
        J([{ branch_id: booth, variants: [{ name: 'Viand Only', selling_price: '70.00' }, { name: 'With Rice', selling_price: '85.00' }] }]),
        J([
          { variant_name: 'Viand Only', ingredient_product_id: 'self', quantity: 1 },
          { variant_name: 'With Rice', ingredient_product_id: 'self', quantity: 1 },
          { variant_name: 'With Rice', ingredient_product_id: rice, quantity: 1 },
        ]),
        J(drinks),
      ],
    ),
  ).then((r) => r.rows[0]);
const curry = await createCurry('Chicken Curry', 'CURRY-PS', [{ variant_name: 'With Rice', drink_product_id: coke }, { variant_name: 'With Rice', drink_product_id: royal }]);
const adobo = await createCurry('Pork Adobo', 'ADOBO-PS', []); // same options, NO Drink Choice at all
await db.exec(`
  set session_replication_role = replica;
  update public.products set is_active = true where id in ('${curry.id}','${adobo.id}');
  reset session_replication_role;
  insert into public.branch_inventory(branch_id,product_id,quantity_on_hand) values
    ('${booth}','${curry.id}',20),('${booth}','${adobo.id}',20),('${booth}','${rice}',20),('${booth}','${coke}',6),('${booth}','${royal}',4);
`);
// reactivating a product is guarded (needs opening stock); fixtures skip that guard only
const reactivate = async (idList) => {
  await db.exec(`set session_replication_role = replica; update public.products set is_active = true where id in (${idList}); reset session_replication_role;`);
};
const shift = (await as(cashier, () => db.query('select public.start_cashier_shift() id'))).rows[0].id;
const bv = async (product, name) => (await db.query(`select id from public.branch_product_variants where branch_id=$1 and product_id=$2 and name=$3`, [booth, product, name])).rows[0].id;
const vRice = await bv(curry.id, 'With Rice');
const vOnly = await bv(curry.id, 'Viand Only');
const aRice = await bv(adobo.id, 'With Rice');

// ---------------------------------------------------------------- the real client modules
const supabaseStub = {
  supabase: {
    // runs the REAL get_cashier_line_prices as the cashier, in the shape supabase-js returns
    rpc: async (fn, args) => {
      try {
        const rows = await as(cashier, () => db.query(`select * from public.${fn}($1::jsonb)`, [J(args.p_lines)]));
        return { data: rows.rows, error: null };
      } catch (error) {
        return { data: null, error };
      }
    },
  },
};
const { getCashierLineSellingPrices } = loadTs('src/services/productService.ts', { '@/lib/supabase': supabaseStub });
const { applyLiveCartPrices, cartLineKey } = loadTs('src/lib/money.ts');
const { useCartStore } = loadTs('src/stores/cartStore.ts', { './checkoutStore': { useCheckoutStore: { getState: () => ({ request: null }) } } });
const { buildStockContext, parseStockUses, withCartLimits, maxAdditional } = loadTs('src/features/pos/posAvailability.ts');
const loadItems = async () =>
  (await as(cashier, () => db.query('select * from public.list_cashier_pos_inventory()'))).rows.map((row) => ({
    product: { id: row.product_id, name: row.product_name, sku: row.product_sku, selling_price: Number(row.selling_price) },
    quantity_on_hand: Number(row.sellable_quantity),
    stock_uses: parseStockUses(row.stock_uses),
    variants: row.variants.map((v) => ({ ...v, selling_price: Number(v.selling_price), sellable_quantity: Number(v.sellable_quantity) })),
  }));

// ================================================================ 1. checkout price refresh
{
  const cart = [
    { product_id: curry.id, variant_id: vRice, drink_product_id: coke, quantity: 2, unit_price: 85 },
    { product_id: curry.id, variant_id: vRice, drink_product_id: royal, quantity: 1, unit_price: 80 }, // stale price
    { product_id: curry.id, variant_id: vOnly, drink_product_id: null, quantity: 1, unit_price: 70 },
    { product_id: adobo.id, variant_id: aRice, drink_product_id: null, quantity: 1, unit_price: 85 },
  ];
  const lines = cart.map(({ product_id, variant_id }) => ({ product_id, variant_id }));

  // the cause, on the real function: 4 lines in, 3 distinct pairs out
  const raw = (await as(cashier, () => db.query('select * from public.get_cashier_line_prices($1::jsonb)', [J(lines)]))).rows;
  assert.equal(raw.length, 3, 'the server answers once per distinct product/option');
  assert.ok(lines.length > raw.length);

  // the fix: the refresh succeeds and prices every line, including both drink lines
  const prices = await getCashierLineSellingPrices(lines);
  assert.equal(prices[cartLineKey(curry.id, vRice)], 85);
  assert.equal(prices[cartLineKey(curry.id, vOnly)], 70);
  assert.equal(prices[cartLineKey(adobo.id, aRice)], 85);
  assert.equal(Object.keys(prices).length, 3);
  const repriced = applyLiveCartPrices(cart, prices);
  assert.deepEqual(repriced.items.map((l) => l.unit_price), [85, 85, 70, 85], 'both drink lines get the live option price; a drink never changes it');
  assert.equal(repriced.changed, true);

  // identical duplicate lines (same drink) are fine too
  assert.deepEqual(Object.keys(await getCashierLineSellingPrices([lines[0], lines[0], lines[0]])), [cartLineKey(curry.id, vRice)]);
  // cart without drinks behaves exactly as before
  assert.deepEqual(Object.keys(await getCashierLineSellingPrices([lines[2], lines[3]])).sort(), [cartLineKey(curry.id, vOnly), cartLineKey(adobo.id, aRice)].sort());
  assert.deepEqual(await getCashierLineSellingPrices([]), {});

  // still strict: an option that is not in this branch catalog fails the refresh (checkout stays blocked)
  await assert.rejects(() => getCashierLineSellingPrices([lines[0], { product_id: curry.id, variant_id: id(999) }]), /no longer available/);
  await db.exec(`update public.branch_product_variants set is_active = false where id = '${vOnly}'`);
  await assert.rejects(() => getCashierLineSellingPrices(lines), /no longer available/);
  await db.exec(`update public.branch_product_variants set is_active = true where id = '${vOnly}'`);

  // source pins: one price lookup per product + option, drink-less key kept
  const svc = read('src/services/productService.ts');
  assert.match(svc, /distinct\.set\(cartLineKey\(product_id, variant_id\)/);
  assert.match(svc, /\.length !== distinct\.size/);
  assert.match(read('src/lib/money.ts'), /prices\[cartLineKey\(item\.product_id, item\.variant_id\)\]/);
  console.log('1. price refresh with duplicate meal+option lines: ok');
}

// ================================================================ 2. required drinks all inactive
{
  const store = useCartStore;
  let items = await loadItems();
  let ctx = buildStockContext(items);
  const optionOf = (list, product, name) => list.find((i) => i.product.id === product).variants.find((v) => v.name === name);
  store.setState({ items: [], stockContext: ctx });

  // baseline: drinks usable -> sellable, offered, nothing blocked
  assert.equal(ctx.drinkBlocked.size, 0);
  assert.equal(optionOf(withCartLimits(items, ctx, []), curry.id, 'With Rice').unavailable, undefined);

  // every configured drink of "With Rice" becomes inactive
  await db.exec(`update public.products set is_active = false where id in ('${coke}','${royal}')`);
  items = await loadItems();
  ctx = buildStockContext(items);
  const rice_ = optionOf(items, curry.id, 'With Rice');
  assert.equal(rice_.sellable_quantity, 0, 'the server says: cannot be sold');
  assert.equal(items.find((i) => i.product.id === curry.id).stock_uses.drinks[vRice], undefined, 'and gives no drinks for it (the ambiguity the client must resolve)');
  assert.deepEqual([...ctx.drinkBlocked], [vRice], 'the client tells "drinks required but none usable" apart from "no drink required"');

  const limited = withCartLimits(items, ctx, []);
  assert.equal(optionOf(limited, curry.id, 'With Rice').unavailable, true, 'flagged so the sheet can disable it');
  assert.equal(optionOf(limited, curry.id, 'With Rice').max_quantity, 0);
  assert.equal(maxAdditional(ctx, [], curry.id, vRice, null), 0);
  assert.equal(maxAdditional(ctx, [], curry.id, vRice, coke), 0);
  // the cart refuses it on every path
  store.setState({ items: [], stockContext: ctx });
  const row = items.find((i) => i.product.id === curry.id);
  store.getState().addProduct(row, optionOf(items, curry.id, 'With Rice'));
  store.getState().setProductQuantity(row, 3, optionOf(items, curry.id, 'With Rice'));
  assert.equal(store.getState().items.length, 0, 'an unavailable option can not be added without a drink');
  // the server agrees: this is exactly what checkout would have refused
  await assert.rejects(
    () => as(cashier, () => db.query('select (public.confirm_sale($1,$2::jsonb,$3,$4,$5)).*', [shift, J([{ product_id: curry.id, variant_id: vRice, quantity: 1 }]), '1000', 'ps-sale-000000000001', 'standard'])),
    /Choose a drink/,
  );

  // the sibling option of the same meal, and a meal whose option has NO Drink Choice, are untouched
  assert.equal(optionOf(limited, curry.id, 'Viand Only').unavailable, undefined);
  assert.equal(optionOf(limited, adobo.id, 'With Rice').unavailable, undefined, 'no Drink Choice configured = no drink required');
  store.getState().addProduct(row, optionOf(items, curry.id, 'Viand Only'));
  store.getState().addProduct(items.find((i) => i.product.id === adobo.id), optionOf(items, adobo.id, 'With Rice'));
  assert.equal(store.getState().items.length, 2, 'options that need no drink still add normally');

  // out-of-stock ingredients are an ordinary shortage, not "drinks required": not flagged
  await reactivate(`'${coke}','${royal}'`);
  await db.exec(`update public.branch_inventory set quantity_on_hand = 0 where branch_id='${booth}' and product_id='${rice}'`);
  items = await loadItems();
  ctx = buildStockContext(items);
  assert.equal(ctx.drinkBlocked.size, 0);
  assert.equal(optionOf(items, curry.id, 'With Rice').sellable_quantity, 0);
  assert.equal(optionOf(withCartLimits(items, ctx, []), curry.id, 'With Rice').unavailable, undefined);
  await db.exec(`update public.branch_inventory set quantity_on_hand = 20 where branch_id='${booth}' and product_id='${rice}'`);

  // one drink active again: offered normally with only that drink
  await db.exec(`update public.products set is_active = false where id = '${royal}'`);
  items = await loadItems();
  ctx = buildStockContext(items);
  assert.equal(ctx.drinkBlocked.size, 0);
  const back = optionOf(withCartLimits(items, ctx, []), curry.id, 'With Rice');
  assert.deepEqual(back.drink_options.map((o) => o.name), ['Coke']);
  assert.equal(back.unavailable, undefined);
  await reactivate(`'${royal}'`);

  // item sheet source pins
  const sheet = read('src/features/pos/PosItemSheet.tsx');
  assert.match(sheet, /disabled=\{unavailable\}/);
  assert.match(sheet, /find\(\(variant\) => !variant\.unavailable\)/, 'opens on an option that can be sold');
  assert.match(read('src/features/pos/posAvailability.ts'), /if \(variantId && ctx\.drinkBlocked\.has\(variantId\)\) return 0;/);
  console.log('2. required drinks all inactive: ok');
}

console.log('pos_push_safety_regressions: ALL PASS');
