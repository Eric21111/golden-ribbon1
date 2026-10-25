// Step 5: Stock Used Per Order, frontend <-> database.
// The wizard's real mapping/recipe logic (stockUseMapping.ts, recipePreviewData.ts) is driven against the real
// create_complete_product / update_complete_product RPCs: create Curry, BBQ, Extra Egg and Extra Rice, reopen them as
// Edit would, edit with and without recipe changes, and check POS availability and deductions. Egg is tracked in
// half-egg units (1 egg = 2 units). Products are created through the RPC, so branch and master variant ids differ.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

import { loadTs } from './_load_ts.mjs';

const mapping = loadTs('src/features/products/stockUseMapping.ts');
const errors = loadTs('src/lib/errors.ts');
const data = loadTs('src/features/products/recipePreviewData.ts');
const guards = loadTs('src/features/products/wizardGuards.ts');
const availability = loadTs('src/features/pos/posAvailability.ts');
const { buildStockUsePayload, savedStockUsesToRecipes, canonicalStockUses, stockUsesForSave } = mapping;
const { ingredientOptionsFromProducts, suggestedIngredientIds, getQuickAddItems, getPickerOptions, filterPickerItems, summarizeExtras, unitLabel, THIS_PRODUCT_ID } = data;
const { PRODUCT_STOCK_KEY } = guards;
const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

// ---------------------------------------------------------------- 0. pure logic
{
  // real products replace the sample items; Egg is counted in half-egg units, everything else in pieces
  const options = ingredientOptionsFromProducts(
    [{ id: 'p-rice', name: 'Rice' }, { id: 'p-egg', name: 'Egg' }, { id: 'p-self', name: 'Chicken Curry' }, { id: 'p-bbq', name: 'BBQ' }],
    'p-self',
  );
  assert.deepEqual(options.map((o) => o.name), ['BBQ', 'Egg', 'Rice'], 'A to Z, the product being edited is left out');
  const egg = options.find((o) => o.name === 'Egg');
  assert.equal(unitLabel(egg.unit, 1), 'half-egg unit');
  assert.equal(unitLabel(egg.unit, 2), 'half-egg units');
  assert.equal(egg.hint, '½ egg');
  assert.equal(unitLabel(options.find((o) => o.name === 'Rice').unit, 2), 'pcs');
  const stockOnly = ingredientOptionsFromProducts([
    { id: 'p-rice', name: 'Rice', sellInPos: false },
    { id: 'p-silog', name: 'Silog', sellInPos: true },
  ]);
  assert.equal(stockOnly.find((item) => item.name === 'Rice').hint, 'Stock only');
  assert.equal(stockOnly.find((item) => item.name === 'Silog').hint, undefined);
  const labeled = ingredientOptionsFromProducts([
    { id: 'p-rice', name: 'Rice', sellInPos: false },
    { id: 'p-coke', name: 'Coke', sellInPos: true, category: 'drinks' },
    { id: 'p-beef', name: 'Beef Curry', sellInPos: true, category: 'meals' },
  ]);
  const suppliesFirst = filterPickerItems(labeled, 'supplies').map((item) => item.name);
  assert.deepEqual(suppliesFirst, ['Rice']);
  const allNames = filterPickerItems(labeled, 'all').map((item) => item.name);
  assert.deepEqual(allNames, ['Rice', 'Beef Curry', 'Coke'], 'inventory supplies stay ahead of other products');
  assert.deepEqual(filterPickerItems(labeled, 'drinks').map((item) => item.name), ['Coke']);
  const missing = errors.getProductErrorMessage({
    message: 'Could not find the function public.create_inventory_product',
    code: 'PGRST202',
  });
  assert.match(missing, /has not been applied/);
  assert.doesNotMatch(missing, /created|success/i);
  assert.ok(!options.some((o) => o.id.startsWith('sample-')), 'no sample ids');
  // "This Product" comes first and only the product's own name is hidden
  const picker = getPickerOptions('BBQ', options);
  assert.equal(picker[0].id, THIS_PRODUCT_ID);
  assert.ok(!picker.some((o) => o.id === 'p-bbq'), 'a product with the same name is covered by "This Product"');
  // chips suggest ingredients already used elsewhere in the same product
  assert.deepEqual(suggestedIngredientIds({ a: [{ itemId: THIS_PRODUCT_ID, quantity: 1 }, { itemId: 'p-egg', quantity: 1 }], b: [{ itemId: 'p-egg', quantity: 1 }, { itemId: 'p-rice', quantity: 1 }] }), ['p-egg', 'p-rice']);
  assert.deepEqual(getQuickAddItems([{ itemId: 'p-egg', quantity: 1 }], 'X', options, ['p-egg', 'p-rice']).map((o) => o.name), ['Rice'], 'already added items are not offered again');
  assert.deepEqual(getQuickAddItems([], 'X', options, []), [], 'nothing to suggest yet');
  assert.equal(summarizeExtras([{ itemId: THIS_PRODUCT_ID, quantity: 1 }, { itemId: 'p-egg', quantity: 2 }, { itemId: 'p-rice', quantity: 1 }], 'Chicken Curry', options), '+ Egg ×2, Rice');

  // payload: "This Product" -> "self", ids for existing options, names for new ones, product-level without a variant
  const refs = [{ key: 'k1', id: 'v-existing', name: 'Viand Only' }, { key: 'k2', id: null, name: ' New One ' }];
  const payload = buildStockUsePayload(
    { [PRODUCT_STOCK_KEY]: [{ itemId: 'p-rice', quantity: 1 }], k1: [{ itemId: THIS_PRODUCT_ID, quantity: 1 }, { itemId: 'p-egg', quantity: 2 }], k2: [{ itemId: THIS_PRODUCT_ID, quantity: 3 }], gone: [{ itemId: 'p-egg', quantity: 1 }] },
    refs,
  );
  assert.deepEqual(payload, [
    { ingredient_product_id: 'p-rice', quantity: 1 },
    { ingredient_product_id: 'self', quantity: 1, variant_id: 'v-existing' },
    { ingredient_product_id: 'p-egg', quantity: 2, variant_id: 'v-existing' },
    { ingredient_product_id: 'self', quantity: 3, variant_name: 'New One' },
  ], 'a list for an option that no longer exists is dropped');
  // invalid lines never reach the server
  assert.deepEqual(buildStockUsePayload({ k1: [{ itemId: 'p-egg', quantity: 0 }, { itemId: 'p-rice', quantity: 100 }, { itemId: 'p-x', quantity: 1.5 }, { itemId: 'p-egg', quantity: 1 }, { itemId: 'p-egg', quantity: 2 }] }, refs), [{ ingredient_product_id: 'p-egg', quantity: 1, variant_id: 'v-existing' }], 'invalid quantities and duplicates are dropped');

  // saved rows -> wizard state (and back)
  const rows = [
    { variant_id: null, ingredient_product_id: 'p-rice', quantity: 1 },
    { variant_id: 'v-existing', ingredient_product_id: 'p-egg', quantity: 2 },
    { variant_id: 'v-existing', ingredient_product_id: 'p-self', quantity: 1 },
    { variant_id: 'v-deleted', ingredient_product_id: 'p-egg', quantity: 9 },
  ];
  const recipes = savedStockUsesToRecipes(rows, 'p-self', [{ key: 'k1', id: 'v-existing', name: 'Viand Only' }]);
  assert.deepEqual(recipes, { [PRODUCT_STOCK_KEY]: [{ itemId: 'p-rice', quantity: 1 }], k1: [{ itemId: THIS_PRODUCT_ID, quantity: 1 }, { itemId: 'p-egg', quantity: 2 }] }, 'own id -> "This Product" first; rows of a missing option are ignored');
  // the order does not depend on the order the rows come back in
  const shuffled = savedStockUsesToRecipes([...rows].reverse(), 'p-self', [{ key: 'k1', id: 'v-existing', name: 'Viand Only' }], (id) => ({ 'p-egg': 'Egg', 'p-rice': 'Rice' })[id] ?? id);
  assert.deepEqual(shuffled.k1, recipes.k1, 'This Product first, then A to Z by name');

  // when to send recipes on an edit
  const base = canonicalStockUses(buildStockUsePayload(recipes, [{ key: 'k1', id: 'v-existing', name: 'Viand Only' }]));
  const same = buildStockUsePayload(recipes, [{ key: 'k1', id: 'v-existing', name: 'Renamed Viand' }]);
  assert.equal(stockUsesForSave(base, same), undefined, 'unchanged recipes (even with a renamed option) are not sent');
  const reordered = buildStockUsePayload({ ...recipes, k1: [recipes.k1[1], recipes.k1[0]] }, [{ key: 'k1', id: 'v-existing', name: 'Viand Only' }]);
  assert.equal(stockUsesForSave(base, reordered), undefined, 'order does not matter');
  const changed = buildStockUsePayload({ ...recipes, k1: [recipes.k1[0], { itemId: 'p-egg', quantity: 3 }] }, [{ key: 'k1', id: 'v-existing', name: 'Viand Only' }]);
  assert.deepEqual(stockUsesForSave(base, changed)?.length, 3, 'a changed quantity sends the complete set');
  assert.deepEqual(stockUsesForSave(base, []), [], 'removing everything sends an empty list (not "unchanged")');
  assert.notEqual(stockUsesForSave(base, []), undefined);
  console.log('pure logic: ok');
}

// ---------------------------------------------------------------- database
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

const id = (n) => `57000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const mainMgr = id(2);
const cashier = id(4);
const main = id(10);
const booth = id(11);
const egg = id(20);
const rice = id(21);

await db.exec(`
  insert into auth.users values ('${mainMgr}','m@t'),('${cashier}','c@t');
  insert into public.branches(id,name,code,is_main_branch,is_active,receiving_mode) values
    ('${main}','Main','MAIN-S5',true,true,'counted'),('${booth}','Booth','BOOTH-S5',false,true,'cashier_confirm');
  insert into public.profiles(id,full_name,role,branch_id) values
    ('${mainMgr}','Main Manager','manager','${main}'),('${cashier}','Cashier One','cashier','${booth}');
  insert into public.products(id,name,sku,selling_price,is_active,inventory_mode,closing_stock_behavior) values
    ('${egg}','Egg','EGG-S5',10,true,'piece_stock','keep_at_branch'),
    ('${rice}','Rice','RICE-S5',15,true,'piece_stock','keep_at_branch');
  insert into public.branch_products(branch_id,product_id,selling_price,is_active) values ('${booth}','${egg}',10,true),('${booth}','${rice}',15,true);
`);
const asUser = async (userId, work) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false);`);
  try {
    return await work();
  } finally {
    await db.exec('reset role');
  }
};
const J = (v) => JSON.stringify(v);

// ---- what the real screen does, step by step ----------------------------------------------------------------------
const allProducts = async () => (await db.query('select id, name from public.products order by name')).rows;

/** Create: the wizard state (variants with draft keys, recipes by key) -> RPC payload (same shape as submitCreate). */
async function createLikeWizard({ name, sku, variants = [], recipes = {}, price = '20.00' }) {
  const refs = variants.map((v, i) => ({ key: `t${i}`, id: null, name: v.name }));
  const stockUses = buildStockUsePayload(recipes, refs);
  const { rows } = await asUser(mainMgr, () =>
    db.query(
      `select * from public.create_complete_product(p_name := $1, p_sku := $2, p_description := null, p_variants := $3::jsonb, p_branches := $4::jsonb, p_selling_price := $5, p_stock_uses := $6::jsonb)`,
      [
        name,
        sku,
        J(variants.map((v) => ({ name: v.name, default_price: v.price }))),
        J([variants.length ? { branch_id: booth, variants: variants.map((v) => ({ name: v.name, selling_price: v.price })) } : { branch_id: booth, selling_price: price }]),
        variants.length ? null : price,
        J(stockUses),
      ],
    ),
  );
  return rows[0];
}

/** Opening Edit: load the saved rows exactly as listProductStockUses does, then rebuild the wizard's recipe state. */
async function openEdit(productId) {
  const variants = (await db.query(`select id, name from public.product_variants where product_id=$1 order by sort_order`, [productId])).rows;
  const rows = (await db.query(`select variant_id, ingredient_product_id, quantity from public.product_stock_uses where product_id=$1 order by created_at, id`, [productId])).rows.map((r) => ({ ...r, quantity: Number(r.quantity) }));
  const refs = variants.map((v, i) => ({ key: `k${i}`, id: v.id, name: v.name }));
  const names = new Map((await allProducts()).map((p) => [p.id, p.name]));
  const recipes = savedStockUsesToRecipes(rows, productId, refs, (pid) => names.get(pid) ?? pid);
  return { productId, refs, recipes, baseline: canonicalStockUses(buildStockUsePayload(recipes, refs)) };
}

/** Saving an Edit: recipes only when they changed (p_stock_uses null otherwise), like submitEdit. */
async function saveEdit(state, { name, sku, prices = {}, newVariants = [], deleted = [], recipes = state.recipes, refs = state.refs, price = '20.00', active = false }) {
  const allRefs = [...refs, ...newVariants.map((v, i) => ({ key: `n${i}`, id: null, name: v.name }))];
  const stockUses = stockUsesForSave(state.baseline, buildStockUsePayload(recipes, allRefs));
  const variantPayload = allRefs.map((r) => ({ id: r.id, name: r.name, default_price: prices[r.name] ?? '50.00' }));
  const hasVariants = allRefs.length > 0;
  await asUser(mainMgr, () =>
    db.query(
      `select * from public.update_complete_product(p_product_id := $1, p_name := $2, p_sku := $3, p_description := null, p_is_active := $9::boolean, p_variants := $4::jsonb, p_deleted_variant_ids := $5::jsonb, p_branches := $6::jsonb, p_selling_price := $7, p_stock_uses := $8::jsonb)`,
      [
        state.productId,
        name,
        sku,
        J(variantPayload),
        J(deleted),
        J([hasVariants ? { branch_id: booth, variants: variantPayload.map((v) => ({ name: v.name, selling_price: v.default_price })) } : { branch_id: booth, selling_price: price }]),
        hasVariants ? null : price,
        stockUses === undefined ? null : J(stockUses),
        active,
      ],
    ),
  );
  return stockUses;
}
const rawRows = async (productId) => (await db.query(`select id, variant_id, ingredient_product_id, quantity, created_at, updated_at from public.product_stock_uses where product_id=$1 order by id`, [productId])).rows;
const describe = async (productId) =>
  (await db.query(
    `select coalesce(pv.name,'(product)') v, case when u.ingredient_product_id = u.product_id then 'self' else p.name end i, u.quantity q
     from public.product_stock_uses u left join public.product_variants pv on pv.id=u.variant_id join public.products p on p.id=u.ingredient_product_id
     where u.product_id=$1 order by 1,2`, [productId])).rows.map((r) => `${r.v}:${r.i}x${r.q}`);

// ---------------------------------------------------------------- 1. create Curry, BBQ, Extra Egg, Extra Rice
const T = THIS_PRODUCT_ID;
const curry = await createLikeWizard({
  name: 'Chicken Curry', sku: 'CURRY-S5',
  variants: [{ name: 'Viand Only', price: '70.00' }, { name: 'With Rice', price: '85.00' }],
  recipes: { t0: [{ itemId: T, quantity: 1 }, { itemId: egg, quantity: 1 }], t1: [{ itemId: T, quantity: 1 }, { itemId: rice, quantity: 1 }, { itemId: egg, quantity: 1 }] },
});
const bbq = await createLikeWizard({
  name: 'BBQ', sku: 'BBQ-S5',
  variants: [{ name: '1 Stick', price: '20.00' }, { name: '3 Sticks', price: '55.00' }],
  recipes: { t0: [{ itemId: T, quantity: 1 }], t1: [{ itemId: T, quantity: 3 }] },
});
const extraEgg = await createLikeWizard({ name: 'Extra Egg', sku: 'XEGG-S5', recipes: { [PRODUCT_STOCK_KEY]: [{ itemId: egg, quantity: 2 }] } }); // a whole egg = 2 half-egg units
const extraRice = await createLikeWizard({ name: 'Extra Rice', sku: 'XRICE-S5', recipes: { [PRODUCT_STOCK_KEY]: [{ itemId: rice, quantity: 1 }] } });
{
  assert.deepEqual(await describe(curry.id), ['Viand Only:Eggx1', 'Viand Only:selfx1', 'With Rice:Eggx1', 'With Rice:Ricex1', 'With Rice:selfx1']);
  assert.deepEqual(await describe(bbq.id), ['1 Stick:selfx1', '3 Sticks:selfx3']);
  assert.deepEqual(await describe(extraEgg.id), ['(product):Eggx2']);
  assert.deepEqual(await describe(extraRice.id), ['(product):Ricex1']);
  // lines are attached to the variants the RPC just created (resolved by name), "self" to the new product's id
  const vRice = (await db.query(`select id from public.product_variants where product_id=$1 and name='With Rice'`, [curry.id])).rows[0].id;
  assert.equal((await db.query(`select count(*)::int n from public.product_stock_uses where variant_id=$1`, [vRice])).rows[0].n, 3);
  // a product created without any recipe stores none (the legacy way still works)
  const plain = await createLikeWizard({ name: 'Plain Soda', sku: 'SODA-S5' });
  assert.deepEqual(await describe(plain.id), []);
  console.log('create: ok');
}

// ---------------------------------------------------------------- 2. reopening Edit shows what was saved
const opened = {};
{
  for (const [key, product] of [['curry', curry], ['bbq', bbq], ['extraEgg', extraEgg], ['extraRice', extraRice]]) opened[key] = await openEdit(product.id);
  // the wizard state equals what was entered, with ids replaced by the real ones and "self" shown as "This Product"
  const c = opened.curry;
  assert.deepEqual(c.recipes[c.refs[0].key], [{ itemId: T, quantity: 1 }, { itemId: egg, quantity: 1 }], 'Viand Only: This Product x1 + Egg x1');
  assert.deepEqual(c.recipes[c.refs[1].key], [{ itemId: T, quantity: 1 }, { itemId: egg, quantity: 1 }, { itemId: rice, quantity: 1 }], 'With Rice: This Product first, then Egg and Rice A to Z');
  assert.equal(c.recipes[PRODUCT_STOCK_KEY], undefined, 'no product-level list on a product with option lists');
  const b = opened.bbq;
  assert.deepEqual(b.recipes[b.refs[1].key], [{ itemId: T, quantity: 3 }], '3 Sticks: This Product x3');
  assert.deepEqual(opened.extraEgg.recipes, { [PRODUCT_STOCK_KEY]: [{ itemId: egg, quantity: 2 }] }, 'Extra Egg: Egg x2');
  assert.deepEqual(opened.extraRice.recipes, { [PRODUCT_STOCK_KEY]: [{ itemId: rice, quantity: 1 }] }, 'Extra Rice: Rice x1');
  // the picker would resolve every saved line to a real, named product
  const options = ingredientOptionsFromProducts(await allProducts(), curry.id);
  assert.equal(options.find((o) => o.id === egg).name, 'Egg');
  assert.ok(!options.some((o) => o.id === curry.id), 'the product being edited is not offered as an ingredient');
  assert.equal(summarizeExtras(c.recipes[c.refs[1].key], 'Chicken Curry', options), '+ Egg, Rice');
  console.log('reopen edit: ok');
}

// ---------------------------------------------------------------- 3. unrelated edits keep every recipe
{
  const before = {};
  for (const p of [curry, bbq, extraEgg, extraRice]) before[p.id] = await rawRows(p.id);
  // rename the product and change the price, recipes untouched
  const sentExtraEgg = await saveEdit(opened.extraEgg, { name: 'Extra Egg (Whole)', sku: 'XEGG-S5', price: '25.00' });
  assert.equal(sentExtraEgg, undefined, 'nothing about the recipes changed, so none are sent');
  assert.deepEqual(await rawRows(extraEgg.id), before[extraEgg.id], 'identical rows, timestamps included');
  // rename an option IN PLACE and change prices: the option keeps its list (it is the same variant)
  const c = opened.curry;
  const sentCurry = await saveEdit(c, { name: 'Chicken Curry', sku: 'CURRY-S5', refs: c.refs.map((r) => (r.name === 'Viand Only' ? { ...r, name: 'Viand' } : r)), prices: { Viand: '72.00', 'With Rice': '88.00' } });
  assert.equal(sentCurry, undefined);
  assert.deepEqual((await rawRows(curry.id)).map((r) => [r.id, r.quantity]), before[curry.id].map((r) => [r.id, r.quantity]), 'same rows');
  assert.deepEqual(await describe(curry.id), ['Viand:Eggx1', 'Viand:selfx1', 'With Rice:Eggx1', 'With Rice:Ricex1', 'With Rice:selfx1'], 'the renamed option kept its list');
  // adding an option without a recipe also leaves the others alone
  const bState = opened.bbq;
  const sentBbq = await saveEdit(bState, { name: 'BBQ', sku: 'BBQ-S5', newVariants: [{ name: '5 Sticks' }], prices: { '1 Stick': '20.00', '3 Sticks': '55.00', '5 Sticks': '90.00' } });
  assert.equal(sentBbq, undefined, 'a new option with no list changes nothing about the recipes');
  assert.deepEqual(await describe(bbq.id), ['1 Stick:selfx1', '3 Sticks:selfx3']);
  // ... and a fresh load of the same product still equals what was there before
  opened.curry = await openEdit(curry.id);
  opened.bbq = await openEdit(bbq.id);
  opened.extraEgg = await openEdit(extraEgg.id);
  console.log('unrelated edits keep recipes: ok');
}

// ---------------------------------------------------------------- 4. intentional updates and removals
{
  // Extra Egg: Egg x2 -> Egg x4 (changed quantity), saved as the complete set
  const e = opened.extraEgg;
  const sent = await saveEdit(e, { name: 'Extra Egg (Whole)', sku: 'XEGG-S5', price: '25.00', recipes: { ...e.recipes, [PRODUCT_STOCK_KEY]: [{ itemId: egg, quantity: 4 }] } });
  assert.deepEqual(sent, [{ ingredient_product_id: egg, quantity: 4 }]);
  assert.deepEqual(await describe(extraEgg.id), ['(product):Eggx4']);
  opened.extraEgg = await openEdit(extraEgg.id);
  assert.deepEqual(opened.extraEgg.recipes[PRODUCT_STOCK_KEY], [{ itemId: egg, quantity: 4 }], 'reopening shows the new quantity');

  // Curry / With Rice: drop Rice, raise Egg to 2, and a brand-new option "Large" with its own list (by name)
  const c = opened.curry;
  const withRice = c.refs.find((r) => r.name === 'With Rice');
  const viand = c.refs.find((r) => r.name === 'Viand');
  const sentC = await saveEdit(c, {
    name: 'Chicken Curry', sku: 'CURRY-S5', newVariants: [{ name: 'Large' }], prices: { Viand: '72.00', 'With Rice': '88.00', Large: '110.00' },
    recipes: { ...c.recipes, [withRice.key]: [{ itemId: T, quantity: 1 }, { itemId: egg, quantity: 2 }], n0: [{ itemId: T, quantity: 2 }, { itemId: rice, quantity: 2 }] },
  });
  assert.equal(sentC.length, 6, 'the complete new set is sent: 2 lines each for Viand, With Rice and Large');
  assert.deepEqual(await describe(curry.id), ['Large:Ricex2', 'Large:selfx2', 'Viand:Eggx1', 'Viand:selfx1', 'With Rice:Eggx2', 'With Rice:selfx1']);
  opened.curry = await openEdit(curry.id);

  // Extra Rice: removing the whole list is an explicit [] (not "unchanged")
  const r = opened.extraRice;
  const sentR = await saveEdit(r, { name: 'Extra Rice', sku: 'XRICE-S5', recipes: { [PRODUCT_STOCK_KEY]: [] } });
  assert.deepEqual(sentR, []);
  assert.deepEqual(await describe(extraRice.id), [], 'the recipe is gone');
  opened.extraRice = await openEdit(extraRice.id);
  assert.deepEqual(opened.extraRice.recipes, {}, 'reopening shows an empty list');
  // removing an option removes its list and only its list
  const c2 = opened.curry;
  const large = c2.refs.find((r2) => r2.name === 'Large');
  await saveEdit(c2, { name: 'Chicken Curry', sku: 'CURRY-S5', deleted: [large.id], refs: c2.refs.filter((r2) => r2.id !== large.id), prices: { Viand: '72.00', 'With Rice': '88.00' }, recipes: Object.fromEntries(Object.entries(c2.recipes).filter(([k]) => k !== large.key)) });
  assert.deepEqual(await describe(curry.id), ['Viand:Eggx1', 'Viand:selfx1', 'With Rice:Eggx2', 'With Rice:selfx1']);
  opened.curry = await openEdit(curry.id);
  console.log('intentional updates and removals: ok');
}

// ---------------------------------------------------------------- 5. a rejected save changes nothing, and nothing is lost silently
{
  const before = await describe(extraEgg.id);
  const e = opened.extraEgg;
  // the wizard never builds an invalid payload; if one is forced through the RPC anyway the whole save is refused
  await assert.rejects(
    asUser(mainMgr, () => db.query(`select * from public.update_complete_product(p_product_id := $1, p_name := 'Changed Name', p_sku := 'XEGG-S5', p_description := null, p_is_active := false, p_variants := '[]'::jsonb, p_deleted_variant_ids := '[]'::jsonb, p_branches := $2::jsonb, p_selling_price := '25.00', p_stock_uses := $3::jsonb)`, [extraEgg.id, J([{ branch_id: booth, selling_price: '25.00' }]), J([{ ingredient_product_id: egg, quantity: 0 }])])),
    /Quantity must be a whole number/,
  );
  assert.deepEqual(await describe(extraEgg.id), before);
  assert.equal((await db.query(`select name from public.products where id=$1`, [extraEgg.id])).rows[0].name, 'Extra Egg (Whole)', 'the product was not renamed either');
  // opening Edit twice yields the same state (loading is read-only)
  assert.deepEqual((await openEdit(extraEgg.id)).recipes, e.recipes);
  console.log('safety: ok');
}

// ---------------------------------------------------------------- 6. saved recipes drive POS availability and deductions
{
  await db.exec(`
    set session_replication_role = replica; -- skip the "needs opening stock" activation guard for the fixtures only
    update public.products set is_active = true where id in ('${curry.id}','${bbq.id}','${extraEgg.id}','${extraRice.id}');
    reset session_replication_role;
    insert into public.branch_inventory(branch_id,product_id,quantity_on_hand) values
      ('${booth}','${curry.id}',10),('${booth}','${rice}',6),('${booth}','${egg}',9),('${booth}','${bbq.id}',10),('${booth}','${extraRice.id}',5);
  `);
  const listRows = () => asUser(cashier, () => db.query('select * from public.list_cashier_pos_inventory()')).then((r) => r.rows);
  const rowOf = (rows, name) => rows.find((r) => r.product_name === name);
  const variantsOf = (row) => Object.fromEntries(row.variants.map((v) => [v.name, Number(v.sellable_quantity)]));

  // saving an already-active product keeps it active (the activation guard is skipped for these fixtures only)
  const saveActive = async (state, options) => {
    await db.exec('set session_replication_role = replica');
    try {
      return await saveEdit(state, { ...options, active: true });
    } finally {
      await db.exec('reset session_replication_role');
    }
  };

  let rows = await listRows();
  // current recipes: Viand = Curry + Egg x1, With Rice = Curry + Egg x2 (Rice was removed above), Extra Egg = Egg x4, Extra Rice has no recipe now
  assert.deepEqual(variantsOf(rowOf(rows, 'Chicken Curry')), { Viand: 9, 'With Rice': 4 }, 'With Rice: min(Curry 10, Egg 9 / 2 = 4)');
  assert.equal(Number(rowOf(rows, 'Extra Egg (Whole)').sellable_quantity), 2, 'Extra Egg: Egg 9 / 4 = 2');
  assert.equal(Number(rowOf(rows, 'Extra Rice').sellable_quantity), 5, 'no recipe: its own stock, as before');
  assert.deepEqual(variantsOf(rowOf(rows, 'BBQ')), { '1 Stick': 10, '3 Sticks': 3, '5 Sticks': 10 }, 'the option added without a recipe uses 1 BBQ');

  // a recipe change in Edit changes availability right away
  const e = await openEdit(extraEgg.id);
  await saveActive(e, { name: 'Extra Egg (Whole)', sku: 'XEGG-S5', price: '25.00', recipes: { [PRODUCT_STOCK_KEY]: [{ itemId: egg, quantity: 2 }] } });
  rows = await listRows();
  assert.equal(Number(rowOf(rows, 'Extra Egg (Whole)').sellable_quantity), 4, 'Egg x2 -> 9 / 2 = 4');
  // putting a recipe back on Extra Rice moves its deduction from its own stock to Rice
  const r = await openEdit(extraRice.id);
  await saveActive(r, { name: 'Extra Rice', sku: 'XRICE-S5', recipes: { [PRODUCT_STOCK_KEY]: [{ itemId: rice, quantity: 1 }] } });
  rows = await listRows();
  assert.equal(Number(rowOf(rows, 'Extra Rice').sellable_quantity), 6, 'now limited by Rice (6), not its own 5');

  // the client's cart limits use the same data: build the context from the rows the POS would load
  const toItem = (row) => ({
    product: { id: row.product_id, name: row.product_name },
    quantity_on_hand: Number(row.sellable_quantity),
    stock_uses: availability.parseStockUses(row.stock_uses),
    variants: row.variants.map((v) => ({ ...v, sellable_quantity: Number(v.sellable_quantity) })),
  });
  const ctx = availability.buildStockContext(rows.map(toItem));
  const shift = (await asUser(cashier, () => db.query('select public.start_cashier_shift() id'))).rows[0].id;
  const bv = async (product, name) => (await db.query(`select id from public.branch_product_variants where branch_id=$1 and product_id=$2 and name=$3`, [booth, product, name])).rows[0].id;
  const sell = (lines, key) => asUser(cashier, () => db.query(`select (public.confirm_sale($1,$2::jsonb,'100000',$3,'standard')).*`, [shift, J(lines.map(([product_id, variant_id, quantity]) => ({ product_id, variant_id, quantity }))), key]));
  const stock = async () => Object.fromEntries((await db.query(`select p.name, bi.quantity_on_hand::numeric q from public.branch_inventory bi join public.products p on p.id=bi.product_id where bi.branch_id='${booth}'`)).rows.map((x) => [x.name, Number(x.q)]));
  const diff = (a, b) => Object.fromEntries(Object.keys(b).map((k) => [k, b[k] - a[k]]).filter(([, d]) => d !== 0));

  const vWithRice = await bv(curry.id, 'With Rice');
  const cart = [{ product_id: extraEgg.id, variant_id: null, quantity: 2 }, { product_id: curry.id, variant_id: vWithRice, quantity: 0 }];
  assert.equal(availability.maxAdditional(ctx, [{ product_id: extraEgg.id, variant_id: null, quantity: 2 }], curry.id, vWithRice), 2, 'Egg 9 - 4 = 5 -> With Rice (2 each) fits 2');
  const before = await stock();
  await sell([[extraEgg.id, null, 2], [curry.id, vWithRice, 2], [extraRice.id, null, 3]], 's5-sale-recipes-00000001');
  assert.deepEqual(diff(before, await stock()), { Egg: -8, 'Chicken Curry': -2, Rice: -3 }, 'Extra Egg 2 x 2 + With Rice 2 x 2 = 8 Egg; Extra Rice takes Rice, not its own stock');
  console.log('POS availability and deductions: ok');
}

// ---------------------------------------------------------------- 7. wiring (source)
{
  const service = read('src/services/productService.ts');
  assert.match(service, /p_stock_uses: input\.stockUses \?\? null,/);
  assert.equal((service.match(/p_stock_uses: input\.stockUses \?\? null,/g) ?? []).length, 2, 'create and update both send it');
  assert.match(service, /\.from\('product_stock_uses'\)/);
  const screen = read('app/(manager)/manager/products/index.tsx');
  assert.equal((screen.match(/stockUses: values\.stockUses,/g) ?? []).length, 2);
  assert.match(screen, /useProductStockUses\(editProduct\?\.id \?\? ''\)/);
  assert.match(screen, /editProduct && \(editStockUses\.error \|\| !editStockUses\.data \|\| editDrinkChoices\.error \|\| !editDrinkChoices\.data\)/, 'Edit never opens without the saved recipes and drink choices');
  assert.match(screen, /sourceStockUses=\{/);
  assert.equal((screen.match(/ingredientProducts=\{ingredientProducts\}/g) ?? []).length, 2);
  const edit = read('src/features/products/EditProductWizard.tsx');
  assert.match(edit, /stockUsesForSave\(savedStockUsesRef\.current \?\? '', buildStockUsePayload\(recipePreview, variants\)\)/);
  const create = read('src/features/products/CreateProductWizard.tsx');
  assert.match(create, /stockUses: buildStockUsePayload\(/);
  // no sample stock items remain anywhere in the wizard code
  for (const file of ['recipePreviewData.ts', 'VariantRecipePreview.tsx', 'InventoryItemPickerModal.tsx', 'VariantListEditor.tsx', 'CreateProductWizard.tsx', 'EditProductWizard.tsx']) {
    assert.doesNotMatch(read(`src/features/products/${file}`), /SAMPLE_INVENTORY_ITEMS|sample-rice|sample-egg/, file);
  }

  console.log('wiring: ok');
}

console.log('stock_used_frontend_db: ALL PASS');
