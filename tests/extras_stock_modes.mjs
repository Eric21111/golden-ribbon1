// Extras & Sides stock deduction: own stock (Fries), shared stock (Extra Rice -> Rice, Extra Egg -> Egg) and several stock
// items. What the wizard sends is built with the real client modules and saved with the real RPCs on PGlite (Postgres
// WASM, not a native PostgreSQL); sales go through confirm_sale, the final authority. Not a device / rendered test.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { loadTs } from './_load_ts.mjs';

const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const { stockModeOf, includesOwnStock, summarizeDeduction, summarizeVariantStock, effectiveLines, OWN_STOCK_LINES, THIS_PRODUCT_ID, ingredientOptionsFromProducts } = loadTs('src/features/products/recipePreviewData.ts');
const { buildStockUsePayload, stockUsesForSave, canonicalStockUses } = loadTs('src/features/products/stockUseMapping.ts');
const { PRODUCT_CATEGORIES, getCategoryConfig } = loadTs('src/features/products/productCategoryPreview.ts');
const { PRODUCT_STOCK_KEY } = loadTs('src/features/products/wizardGuards.ts');
const THIS = THIS_PRODUCT_ID;

// ---------------------------------------------------------------- 1. which categories offer the choice
{
  const flags = Object.fromEntries(PRODUCT_CATEGORIES.map((c) => [c.id, c.stockModeChoice]));
  assert.deepEqual(flags, { meals: false, snacks: false, drinks: false, extras: true, supplies: false }, 'only Extras & Sides get the choice');
  assert.equal(getCategoryConfig('unset').stockModeChoice, false, 'a product whose category is not set keeps the plain list');
  assert.equal(getCategoryConfig('extras').ingredientsLabel, 'STOCK DEDUCTION');
  // the other four categories behave exactly as before
  assert.equal(getCategoryConfig('meals').autoAddMainProduct, true);
  assert.equal(getCategoryConfig('snacks').allowOtherStock, false);
  assert.equal(getCategoryConfig('drinks').showIngredients, false);
  assert.equal(getCategoryConfig('supplies').showIngredients, false);
  assert.equal(getCategoryConfig('extras').allowOtherStock, true);
  assert.equal(getCategoryConfig('extras').autoAddMainProduct, false, 'a new side starts with no list = its own stock (the database default)');
  console.log('1. category flag: ok');
}

// ---------------------------------------------------------------- 2. mode and preview (pure)
{
  const items = ingredientOptionsFromProducts([{ id: 'rice', name: 'Rice' }, { id: 'egg', name: 'Egg' }]);
  assert.equal(stockModeOf([]), 'own', 'no list is own stock');
  assert.equal(stockModeOf(OWN_STOCK_LINES), 'own');
  assert.equal(stockModeOf([{ itemId: THIS, quantity: 2 }]), 'other', 'own x2 is a real list: shown as a list, not flattened to x1');
  assert.equal(stockModeOf([{ itemId: 'rice', quantity: 1 }]), 'other');
  assert.equal(stockModeOf([{ itemId: THIS, quantity: 1 }, { itemId: 'egg', quantity: 1 }]), 'other', 'own + others is a list, not "own"');
  assert.equal(includesOwnStock([{ itemId: THIS, quantity: 1 }, { itemId: 'egg', quantity: 1 }]), true);
  assert.equal(includesOwnStock([{ itemId: 'rice', quantity: 1 }]), false);

  assert.equal(summarizeDeduction([], 'Fries', items), 'Fries ×1', 'an empty list deducts the product itself, like the database');
  assert.equal(summarizeDeduction(OWN_STOCK_LINES, 'Fries', items), 'Fries ×1');
  assert.equal(summarizeDeduction([{ itemId: 'rice', quantity: 1 }], 'Extra Rice', items), 'Rice ×1');
  assert.equal(summarizeDeduction([{ itemId: 'rice', quantity: 1 }, { itemId: 'egg', quantity: 2 }], 'Egg Rice', items), 'Rice ×1, Egg ×2');
  assert.equal(summarizeDeduction([{ itemId: THIS, quantity: 1 }, { itemId: 'egg', quantity: 1 }], 'Fries', items), 'Fries ×1, Egg ×1');
  assert.equal(summarizeDeduction([{ itemId: THIS, quantity: 1 }], '', items), 'This product ×1');
  assert.equal(summarizeDeduction([{ itemId: 'gone', quantity: 1 }], 'X', items), '', 'an unknown item is left out, never invented');
  // the list an option really uses: its own, else the product-level one, else the product itself (shown as [])
  const rice1 = [{ itemId: 'rice', quantity: 1 }];
  const egg2 = [{ itemId: 'egg', quantity: 2 }];
  assert.deepEqual(effectiveLines([], []), []);
  assert.deepEqual(effectiveLines([], OWN_STOCK_LINES), [], 'a default product-level list is the same as none');
  assert.deepEqual(effectiveLines([], rice1), rice1, 'no list of its own: inherits the product-level list');
  assert.deepEqual(effectiveLines(egg2, rice1), egg2, 'its own list REPLACES the product-level one, never merged');
  assert.deepEqual(effectiveLines(OWN_STOCK_LINES, rice1), OWN_STOCK_LINES, 'an explicit own-stock line overrides the product-level list');

  // one-line summaries: "+ extras" only where the product itself x1 is in the list; otherwise spelled out
  assert.equal(summarizeVariantStock([], 'Fries', items), '');
  assert.equal(summarizeVariantStock([{ itemId: THIS, quantity: 1 }], 'Fries', items), '', 'own x1 alone: nothing extra to say');
  assert.equal(summarizeVariantStock([{ itemId: THIS, quantity: 1 }, { itemId: 'egg', quantity: 1 }], 'Curry', items), '+ Egg');
  assert.equal(summarizeVariantStock(rice1, 'Extra Rice', items), 'Uses Rice ×1', 'Extra Rice does not use its own stock: never "+ Rice"');
  assert.equal(summarizeVariantStock([{ itemId: THIS, quantity: 2 }], 'Fries', items), 'Uses Fries ×2', 'own x2 is not hidden');
  assert.equal(summarizeVariantStock([{ itemId: THIS, quantity: 2 }, { itemId: 'egg', quantity: 1 }], 'Fries', items), 'Uses Fries ×2, Egg ×1');
  console.log('2. mode + preview: ok');
}

// ---------------------------------------------------------------- 3. what the wizard sends for each mode
{
  const none = [];
  // own stock, new side: nothing is sent (the database already deducts the product itself x1)
  assert.deepEqual(buildStockUsePayload({}, none), []);
  assert.deepEqual(buildStockUsePayload({ [PRODUCT_STOCK_KEY]: OWN_STOCK_LINES }, none), [], 'tapping "Use this product\'s stock" writes no recipe');
  // shared stock: only the other item, never the product itself
  assert.deepEqual(buildStockUsePayload({ [PRODUCT_STOCK_KEY]: [{ itemId: 'rice-id', quantity: 1 }] }, none), [{ ingredient_product_id: 'rice-id', quantity: 1 }]);
  // several items
  assert.deepEqual(
    buildStockUsePayload({ [PRODUCT_STOCK_KEY]: [{ itemId: 'rice-id', quantity: 1 }, { itemId: 'egg-id', quantity: 2 }] }, none),
    [{ ingredient_product_id: 'rice-id', quantity: 1 }, { ingredient_product_id: 'egg-id', quantity: 2 }],
  );
  // own AND another item: both are sent, once each
  assert.deepEqual(
    buildStockUsePayload({ [PRODUCT_STOCK_KEY]: [{ itemId: THIS, quantity: 1 }, { itemId: 'egg-id', quantity: 1 }] }, none),
    [{ ingredient_product_id: 'self', quantity: 1 }, { ingredient_product_id: 'egg-id', quantity: 1 }],
  );
  // the same item twice can never be sent twice
  assert.equal(buildStockUsePayload({ [PRODUCT_STOCK_KEY]: [{ itemId: 'rice-id', quantity: 1 }, { itemId: 'rice-id', quantity: 3 }] }, none).length, 1);
  // a product-level list that is hidden because the product has options is still sent unchanged on every save (never lost)
  assert.deepEqual(
    buildStockUsePayload(
      { [PRODUCT_STOCK_KEY]: [{ itemId: 'rice-id', quantity: 1 }], 'v-large': [{ itemId: 'egg-id', quantity: 2 }] },
      [{ key: 'v-small', id: 'sv', name: 'Small' }, { key: 'v-large', id: 'lv', name: 'Large' }],
    ),
    [{ ingredient_product_id: 'rice-id', quantity: 1 }, { ingredient_product_id: 'egg-id', quantity: 2, variant_id: 'lv' }],
    'the product-level list is kept; the option without a list (Small) simply inherits it',
  );
  // switching shared -> own on Edit: the saved list must be CLEARED (an empty set replaces it), not left untouched
  const baseline = canonicalStockUses(buildStockUsePayload({ [PRODUCT_STOCK_KEY]: [{ itemId: 'rice-id', quantity: 1 }] }, none));
  assert.deepEqual(stockUsesForSave(baseline, buildStockUsePayload({ [PRODUCT_STOCK_KEY]: OWN_STOCK_LINES }, none)), [], 'own stock after shared = empty set = clear');
  assert.equal(stockUsesForSave(baseline, buildStockUsePayload({ [PRODUCT_STOCK_KEY]: [{ itemId: 'rice-id', quantity: 1 }] }, none)), undefined, 'unchanged = left alone');
  console.log('3. payloads per mode: ok');
}

// ---------------------------------------------------------------- 4. the database: each mode deducts exactly once
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
const id = (n) => `76000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const [mgr, cashier, main, booth] = [id(2), id(4), id(10), id(11)];
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
    ('${main}','Main Kitchen','MAIN-XM',true,true,'counted'),('${booth}','Booth','BOOTH-XM',false,true,'cashier_confirm');
  insert into public.profiles(id,full_name,role,branch_id) values
    ('${mgr}','Main Manager','manager','${main}'),('${cashier}','Cashier','cashier','${booth}');
`);
const create = ({ name, sku, price = '20.00', stockUses }) =>
  as(mgr, () =>
    db.query(
      `select * from public.create_complete_product(p_name := $1, p_sku := $2, p_description := null, p_variants := '[]'::jsonb, p_branches := $3::jsonb, p_selling_price := $4, p_stock_uses := $5::jsonb)`,
      [name, sku, J([{ branch_id: booth, selling_price: price }]), price, stockUses === undefined ? null : J(stockUses)],
    ),
  ).then((r) => r.rows[0]);
const update = (product, stockUses) =>
  as(mgr, () =>
    db.query(
      `select * from public.update_complete_product(p_product_id := $1, p_name := $2, p_sku := $3, p_description := null, p_is_active := true, p_variants := '[]'::jsonb, p_deleted_variant_ids := '[]'::jsonb, p_branches := $4::jsonb, p_selling_price := '20.00', p_stock_uses := $5::jsonb)`,
      [product.id, product.name, product.sku, J([{ branch_id: booth, selling_price: '20.00' }]), J(stockUses)],
    ),
  );

// what the wizard would send for each configuration (built with the real mapping above)
const wizard = (lines, ids = {}) => buildStockUsePayload({ [PRODUCT_STOCK_KEY]: lines.map((l) => ({ ...l, itemId: ids[l.itemId] ?? l.itemId })) }, []);

const rice = await create({ name: 'Rice', sku: 'RICE-XM', price: '15.00' });
const egg = await create({ name: 'Egg', sku: 'EGG-XM', price: '10.00' });
const ids = { rice: rice.id, egg: egg.id };
const fries = await create({ name: 'Fries', sku: 'FRIES-XM', stockUses: wizard([OWN_STOCK_LINES[0]]) }); // own stock
const extraRice = await create({ name: 'Extra Rice', sku: 'XRICE-XM', stockUses: wizard([{ itemId: 'rice', quantity: 1 }], ids) });
const extraEgg = await create({ name: 'Extra Egg', sku: 'XEGG-XM', stockUses: wizard([{ itemId: 'egg', quantity: 1 }], ids) });
const eggRice = await create({ name: 'Egg Rice', sku: 'EGGRICE-XM', stockUses: wizard([{ itemId: 'rice', quantity: 1 }, { itemId: 'egg', quantity: 2 }], ids) });
const friesEgg = await create({ name: 'Fries With Egg', sku: 'FRIESEGG-XM', stockUses: wizard([{ itemId: THIS, quantity: 1 }, { itemId: 'egg', quantity: 1 }], ids) });

// what is saved: own stock saves NO row; shared saves only the other item; own + other saves both
const saved = async (p) => (await db.query(`select ingredient_product_id = product_id as own, ingredient_product_id, quantity::numeric q from public.product_stock_uses where product_id=$1 order by 1,2`, [p.id])).rows.map((r) => [r.own, r.own ? 'self' : r.ingredient_product_id, Number(r.q)]);
assert.deepEqual(await saved(fries), [], 'own stock: no recipe rows (the database default deducts the product itself x1)');
assert.deepEqual(await saved(extraRice), [[false, rice.id, 1]], 'Extra Rice: Rice x1 only');
assert.deepEqual(await saved(extraEgg), [[false, egg.id, 1]], 'Extra Egg: Egg x1 only');
assert.deepEqual((await saved(eggRice)).sort(), [[false, egg.id, 2], [false, rice.id, 1]].sort(), 'several items, no own stock');
assert.deepEqual((await saved(friesEgg)).sort(), [[false, egg.id, 1], [true, 'self', 1]].sort(), 'own + shared: both, once each');

const open = (items) => as(mgr, () => db.query(`select public.initialize_main_branch_inventory($1::jsonb,'open')`, [J(items.map(([product_id, quantity]) => ({ product_id, quantity })))]));
// Extra Rice / Extra Egg / Egg Rice have no stock of their own: nothing is opened or sent for them
await open([[rice.id, 100], [egg.id, 100], [fries.id, 50], [friesEgg.id, 50]]);
for (const p of [rice, egg, fries, extraRice, extraEgg, eggRice, friesEgg]) await as(mgr, () => db.query('select public.set_product_status($1,true)', [p.id]));
let n = 0;
const key = (p) => `${p}-${String(++n).padStart(14, '0')}`;
const transfer = (await as(mgr, () => db.query('select public.send_stock_transfer($1,$2::jsonb,null,$3) id', [booth, J([rice, egg, fries, friesEgg].map((p) => ({ product_id: p.id, quantity_sent: 40, destination_price: 20 }))), key('xm-send')]))).rows[0].id;
await as(cashier, () => db.query('select public.confirm_shipment_arrival($1,$2)', [transfer, key('xm-arrive')]));
const shift = (await as(cashier, () => db.query('select public.start_cashier_shift() id'))).rows[0].id;
const stock = async () => Object.fromEntries((await db.query(`select p.name, bi.quantity_on_hand::numeric q from public.branch_inventory bi join public.products p on p.id=bi.product_id where bi.branch_id='${booth}'`)).rows.map((r) => [r.name, Number(r.q)]));
const sell = (lines) => as(cashier, () => db.query('select (public.confirm_sale($1,$2::jsonb,$3,$4,$5)).*', [shift, J(lines), '1000', key('xm-sale'), 'standard'])).then((r) => r.rows[0]);
const posRows = async () => (await as(cashier, () => db.query('select * from public.list_cashier_pos_inventory()'))).rows;
const sellable = async (name) => Number((await posRows()).find((r) => r.product_name === name).sellable_quantity);

// availability follows the configuration
assert.equal(await sellable('Fries'), 40, 'own stock: its own 40');
assert.equal(await sellable('Extra Rice'), 40, 'shared: the Rice pool');
assert.equal(await sellable('Egg Rice'), 20, 'several items: the scarcest decides (Egg 40 / 2)');
assert.equal(await sellable('Fries With Egg'), 40, 'own + Egg: min(own 40, Egg 40)');

const before = await stock();
const sale = await sell([
  { product_id: fries.id, variant_id: null, quantity: 2 },
  { product_id: extraRice.id, variant_id: null, quantity: 3 },
  { product_id: extraEgg.id, variant_id: null, quantity: 2 },
  { product_id: eggRice.id, variant_id: null, quantity: 4 },
  { product_id: friesEgg.id, variant_id: null, quantity: 5 },
]);
assert.equal(Number(sale.total_amount), (2 + 3 + 2 + 4 + 5) * 20);
const after = await stock();
const delta = Object.fromEntries(Object.keys(after).map((k) => [k, after[k] - before[k]]).filter(([, v]) => v));
assert.deepEqual(
  delta,
  { Fries: -2 - 0, Rice: -(3 + 4), Egg: -(2 + 4 * 2 + 5), 'Fries With Egg': -5 },
  'Fries: own x2. Rice: Extra Rice 3 + Egg Rice 4. Egg: Extra Egg 2 + Egg Rice 4x2 + Fries With Egg 5. Fries With Egg: its own 5. Nothing else.',
);
for (const name of ['Extra Rice', 'Extra Egg', 'Egg Rice']) assert.ok(!(name in after), `${name} never gets a stock row`);
const moves = (await db.query(`select p.name, m.quantity::numeric q from public.inventory_movements m join public.products p on p.id=m.product_id where m.reference_id=$1 order by 1`, [sale.id])).rows.map((r) => [r.name, Number(r.q)]);
assert.deepEqual(moves, [['Egg', -15], ['Fries', -2], ['Fries With Egg', -5], ['Rice', -7]], 'one movement per stocked product, so no item is deducted twice for one sale line');

// ---------------------------------------------------------------- 5. switching modes on Edit
// shared -> own: the saved list is cleared and the product then draws on its OWN stock (it has none, so it cannot sell)
{
  const clear = stockUsesForSave(canonicalStockUses(buildStockUsePayload({ [PRODUCT_STOCK_KEY]: [{ itemId: ids.rice, quantity: 1 }] }, [])), buildStockUsePayload({ [PRODUCT_STOCK_KEY]: OWN_STOCK_LINES }, []));
  assert.deepEqual(clear, []);
  await update(extraRice, clear);
  assert.deepEqual(await saved(extraRice), [], 'the Rice line is gone');
  assert.equal(await sellable('Extra Rice'), 0, 'own stock of Extra Rice is 0: it is not sellable until it has stock, and Rice is no longer touched');
  // and back to shared: Rice again, still a single deduction
  await update(extraRice, wizard([{ itemId: 'rice', quantity: 1 }], ids));
  assert.deepEqual(await saved(extraRice), [[false, rice.id, 1]]);
  assert.equal(await sellable('Extra Rice'), (await stock()).Rice);
  console.log('5. switching modes: ok');
}

// ---------------------------------------------------------------- 5b. options + a saved product-level list (hidden in the wizard)
// A product-level list is only editable while the product has no options, but it stays saved. An option with no list of its own
// uses it; an option WITH a list uses only that list. The client's effectiveLines must agree with the database, option by option.
{
  const { effectiveLines: effective } = loadTs('src/features/products/recipePreviewData.ts');
  const combo = await as(mgr, () =>
    db.query(
      `select * from public.create_complete_product(p_name := 'Side Combo', p_sku := 'COMBO-XM', p_description := null, p_variants := $1::jsonb, p_branches := $2::jsonb, p_selling_price := null, p_stock_uses := $3::jsonb)`,
      [
        J([{ name: 'Small', default_price: '30.00' }, { name: 'Large', default_price: '50.00' }, { name: 'Solo', default_price: '25.00' }]),
        J([{ branch_id: booth, variants: [{ name: 'Small', selling_price: '30.00' }, { name: 'Large', selling_price: '50.00' }, { name: 'Solo', selling_price: '25.00' }] }]),
        J([
          { ingredient_product_id: rice.id, quantity: 1 }, // product-level list: no variant fields
          { variant_name: 'Large', ingredient_product_id: egg.id, quantity: 2 }, // Large has its own list
          { variant_name: 'Solo', ingredient_product_id: 'self', quantity: 1 }, // Solo explicitly uses its own stock
        ]),
      ],
    ),
  ).then((r) => r.rows[0]);
  await as(mgr, () => db.query('select public.set_product_status($1,true)', [combo.id]));
  const variantIds = Object.fromEntries((await db.query('select id, name from public.product_variants where product_id=$1', [combo.id])).rows.map((r) => [r.name, r.id]));
  const rows = await as(cashier, () => db.query('select * from public.list_cashier_pos_inventory()'));
  const row = rows.rows.find((r) => r.product_name === 'Side Combo');
  const bvIds = Object.fromEntries((await db.query('select id, name from public.branch_product_variants where product_id=$1 and branch_id=$2', [combo.id, booth])).rows.map((r) => [r.name, r.id]));
  const dbLines = (name) => (row.stock_uses.variants[bvIds[name]] ?? []).map((l) => [l.ingredient_product_id === combo.id ? 'self' : l.ingredient_product_id === rice.id ? 'rice' : 'egg', Number(l.quantity)]);

  // what the wizard holds for it (an edit loads the saved rows): the product-level list plus two option lists
  const recipes = {
    [PRODUCT_STOCK_KEY]: [{ itemId: 'rice', quantity: 1 }],
    Large: [{ itemId: 'egg', quantity: 2 }],
    Solo: [{ itemId: THIS, quantity: 1 }],
    Small: [],
  };
  const clientLines = (name) => effective(recipes[name], recipes[PRODUCT_STOCK_KEY]).map((l) => [l.itemId === THIS ? 'self' : l.itemId, l.quantity]);
  assert.deepEqual(dbLines('Small'), [['rice', 1]], 'database: Small has no list, so it uses the product-level list (Rice x1)');
  assert.deepEqual(clientLines('Small'), [['rice', 1]], 'client agrees');
  assert.deepEqual(dbLines('Large'), [['egg', 2]], 'database: Large uses ONLY its own list: no Rice, no merge');
  assert.deepEqual(clientLines('Large'), [['egg', 2]]);
  assert.deepEqual(dbLines('Solo'), [['self', 1]], 'database: an explicit own line overrides the product-level list');
  assert.deepEqual(clientLines('Solo'), [['self', 1]]);

  // and a real sale deducts exactly that
  const before = await stock();
  const bv = (name) => bvIds[name];
  const sold = await sell([
    { product_id: combo.id, variant_id: bv('Small'), quantity: 2 },
    { product_id: combo.id, variant_id: bv('Large'), quantity: 3 },
  ]);
  const after = await stock();
  assert.equal(after.Rice - before.Rice, -2, 'Small x2 = Rice 2 (inherited). Large x3 did not touch Rice');
  assert.equal(after.Egg - before.Egg, -6, 'Large x3 = Egg 6 (its own list)');
  assert.ok(!('Side Combo' in after), 'neither option touched Side Combo own stock');
  assert.equal(Number(sold.total_amount), 2 * 30 + 3 * 50);
  console.log('5b. options with a hidden product-level list: ok');
}

// ---------------------------------------------------------------- 6. the UI is wired only where the backend supports it
{
  const component = read('src/features/products/VariantRecipePreview.tsx');
  assert.match(component, /stockModeChoice = false,/, 'off by default: every other category renders as before');
  assert.match(component, /accessibilityRole="radio"/);
  assert.match(component, /"Use this product's stock"/);
  assert.match(component, /'Use other stock items'/);
  assert.match(component, /stashedOtherLines/, 'switching to own and back keeps the items that were picked');
  assert.match(component, /onChange\(OWN_STOCK_LINES\)/);
  // an "other items" list can never be empty: tapping it opens the item sheet first, and closing the sheet changes nothing
  assert.match(component, /setStartingOther\(true\);\n\s*setPickerOpen\(true\);/);
  assert.match(component, /if \(startingOther\) onChange\(\[\{ itemId, quantity: 1 \}\]\);/, 'the first pick STARTS the list (does not pile onto this product)');
  assert.match(component, /onChange\(stockModeChoice && next\.length === 0 \? OWN_STOCK_LINES : next\);/, 'removing the last item goes back to own stock explicitly');
  assert.doesNotMatch(component, /Nothing selected yet/, 'no empty-other state exists to warn about');
  // switching to own stock says what is needed
  assert.match(component, /This product needs its own stock balance at the branch before it can sell\. The other items are no longer used\./);
  assert.match(component, /stockModeChoice && mode === 'own' && switchedToOwn/);
  // the preview reads the EFFECTIVE list (inherited product-level list included), the same one the database resolves
  assert.match(component, /summarizeDeduction\(effective, productName, ingredients\)/);
  assert.match(component, /const effective = effectiveLines\(lines, inheritedLines \?\? \[\]\);/);
  assert.match(read('src/features/products/VariantListEditor.tsx'), /inheritedLines=\{recipes\[PRODUCT_STOCK_KEY\] \?\? \[\]\}/, 'options see the product-level list they inherit');
  for (const [f, key] of [['CreateProductWizard', 'variant\\.id'], ['EditProductWizard', 'variant\\.key']]) {
    assert.match(read(`src/features/products/${f}.tsx`), new RegExp(`effectiveLines\\(recipePreview\\[${key}\\] \\?\\? \\[\\], recipePreview\\[PRODUCT_STOCK_KEY\\] \\?\\? \\[\\]\\)`), `${f}: pricing-step summary uses the effective list`);
  }
  for (const f of ['CreateProductWizard', 'EditProductWizard']) {
    assert.match(read(`src/features/products/${f}.tsx`), /stockModeChoice=\{getCategoryConfig\(category\)\.stockModeChoice\}/, f);
  }
  assert.equal((read('src/features/products/VariantListEditor.tsx').match(/stockModeChoice=\{config\.stockModeChoice\}/g) ?? []).length, 2, 'option lists and the product-level list');
  // the picker already refuses an item that is in the list, so one item can never be added twice
  assert.match(component, /if \(base\.some\(\(line\) => line\.itemId === itemId\)\) return;/);
  // no backend change: the migrations folder is untouched by this work
  console.log('6. wiring: ok');
}

console.log('extras_stock_modes: ALL PASS');
