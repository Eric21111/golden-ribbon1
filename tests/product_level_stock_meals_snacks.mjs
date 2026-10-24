// Stock Used Per Order for Meals and Snacks WITHOUT variants (product-level lists).
// The wizard's real mapping/config logic is driven against the real RPCs: create single-price Meals and Snacks with a
// product-level recipe, reopen them as Edit would, edit them, add / remove / switch variants, and check that sales
// deduct each ingredient exactly once. Egg and Rice are ingredients; ids are real (RPC-created).
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

import { loadTs } from './_load_ts.mjs';

const mapping = loadTs('src/features/products/stockUseMapping.ts');
const guards = loadTs('src/features/products/wizardGuards.ts');
const categories = loadTs('src/features/products/productCategoryPreview.ts');
const { buildStockUsePayload, savedStockUsesToRecipes, canonicalStockUses, stockUsesForSave, isDefaultProductLevel } = mapping;
const { PRODUCT_STOCK_KEY, shouldSeedProductStock } = guards;
const { getCategoryConfig } = categories;
const T = 'this-product';
const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

// ---------------------------------------------------------------- 0. configuration and pure rules
{
  for (const id of ['meals', 'snacks']) {
    const c = getCategoryConfig(id);
    assert.equal(c.productLevelStock, true, `${id}: product-level list while there are no variants`);
    assert.equal(c.autoAddMainProduct, true, `${id}: starts with This Product x1`);
    assert.equal(c.showIngredients, true);
  }
  // Extras, Drinks, Supplies and "Category not set" are unchanged
  assert.equal(getCategoryConfig('extras').productLevelStock, true);
  assert.equal(getCategoryConfig('extras').autoAddMainProduct, false);
  for (const id of ['drinks', 'supplies']) assert.equal(getCategoryConfig(id).productLevelStock, false, id);
  assert.equal(getCategoryConfig('unset').productLevelStock, true);
  assert.equal(getCategoryConfig('snacks').allowOtherStock, false, 'a snack is still just the snack');

  // the list starts with This Product x1 only for a never-configured product without variants
  assert.equal(shouldSeedProductStock({ variantCount: 0, autoAdd: true, current: undefined }), true);
  assert.equal(shouldSeedProductStock({ variantCount: 2, autoAdd: true, current: undefined }), false, 'never with variants');
  assert.equal(shouldSeedProductStock({ variantCount: 0, autoAdd: true, current: [] }), false, 'a list the user emptied stays empty');
  assert.equal(shouldSeedProductStock({ variantCount: 0, autoAdd: true, current: [{ itemId: 'x', quantity: 1 }] }), false, 'a saved list is never replaced');

  // the automatic default is the same as no recipe, so it is never saved
  assert.equal(isDefaultProductLevel([{ itemId: T, quantity: 1 }]), true);
  assert.equal(isDefaultProductLevel([{ itemId: T, quantity: 2 }]), false);
  assert.equal(isDefaultProductLevel([{ itemId: T, quantity: 1 }, { itemId: 'rice', quantity: 1 }]), false);
  assert.deepEqual(buildStockUsePayload({ [PRODUCT_STOCK_KEY]: [{ itemId: T, quantity: 1 }] }, []), [], 'default only: nothing to save');
  assert.deepEqual(buildStockUsePayload({ [PRODUCT_STOCK_KEY]: [{ itemId: T, quantity: 3 }] }, []), [{ ingredient_product_id: 'self', quantity: 3 }], 'a snack that uses 3 per order');
  assert.deepEqual(
    buildStockUsePayload({ [PRODUCT_STOCK_KEY]: [{ itemId: T, quantity: 1 }, { itemId: 'rice', quantity: 1 }] }, []),
    [{ ingredient_product_id: 'self', quantity: 1 }, { ingredient_product_id: 'rice', quantity: 1 }],
    'This Product + Rice is a real recipe',
  );

  // an unchanged default is not a change, and picking a category in Edit never makes a write
  const noRecipe = canonicalStockUses(buildStockUsePayload({}, []));
  assert.equal(stockUsesForSave(noRecipe, buildStockUsePayload({ [PRODUCT_STOCK_KEY]: [{ itemId: T, quantity: 1 }] }, [])), undefined);
  // a saved row that equals the default reads as the default and is left alone
  const savedDefault = savedStockUsesToRecipes([{ variant_id: null, ingredient_product_id: 'p-self', quantity: 1 }], 'p-self', []);
  assert.deepEqual(savedDefault, { [PRODUCT_STOCK_KEY]: [{ itemId: T, quantity: 1 }] });
  assert.equal(stockUsesForSave(canonicalStockUses(buildStockUsePayload(savedDefault, [])), buildStockUsePayload(savedDefault, [])), undefined);

  // variants added, removed and switched never lose the product-level list that is kept in state
  const rec = { [PRODUCT_STOCK_KEY]: [{ itemId: T, quantity: 1 }, { itemId: 'rice', quantity: 1 }] };
  const none = [];
  const withVariant = [{ key: 'k1', id: null, name: 'Large' }];
  const recWithVariant = { ...rec, k1: [{ itemId: T, quantity: 2 }] };
  const a = buildStockUsePayload(rec, none);
  const b = buildStockUsePayload(recWithVariant, withVariant);
  assert.equal(b.filter((x) => !x.variant_name).length, a.length, 'the product-level list is carried through when a variant is added');
  assert.deepEqual(buildStockUsePayload(rec, none), a, 'and is back exactly as it was when the variant is removed again');
  const switched = buildStockUsePayload({ ...rec, k2: [{ itemId: T, quantity: 1 }] }, [{ key: 'k2', id: null, name: 'Small' }]);
  assert.deepEqual(switched.filter((x) => !x.variant_name), a, 'switching to a different variant keeps it too');
  console.log('config and pure rules: ok');
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
const id = (n) => `58000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const mainMgr = id(2);
const cashier = id(4);
const main = id(10);
const booth = id(11);
const rice = id(21);

await db.exec(`
  insert into auth.users values ('${mainMgr}','m@t'),('${cashier}','c@t');
  insert into public.branches(id,name,code,is_main_branch,is_active,receiving_mode) values
    ('${main}','Main','MAIN-S6',true,true,'counted'),('${booth}','Booth','BOOTH-S6',false,true,'cashier_confirm');
  insert into public.profiles(id,full_name,role,branch_id) values
    ('${mainMgr}','Main Manager','manager','${main}'),('${cashier}','Cashier One','cashier','${booth}');
  insert into public.products(id,name,sku,selling_price,is_active,inventory_mode,closing_stock_behavior) values
    ('${rice}','Rice','RICE-S6',15,true,'piece_stock','keep_at_branch');
  insert into public.branch_products(branch_id,product_id,selling_price,is_active) values ('${booth}','${rice}',15,true);
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

async function createLikeWizard({ name, sku, variants = [], recipes = {}, price = '20.00' }) {
  const refs = variants.map((v, i) => ({ key: `t${i}`, id: null, name: v.name }));
  const stockUses = buildStockUsePayload(recipes, refs);
  const { rows } = await asUser(mainMgr, () =>
    db.query(
      `select * from public.create_complete_product(p_name := $1, p_sku := $2, p_description := null, p_variants := $3::jsonb, p_branches := $4::jsonb, p_selling_price := $5, p_stock_uses := $6::jsonb)`,
      [name, sku, J(variants.map((v) => ({ name: v.name, default_price: v.price }))), J([variants.length ? { branch_id: booth, variants: variants.map((v) => ({ name: v.name, selling_price: v.price })) } : { branch_id: booth, selling_price: price }]), variants.length ? null : price, J(stockUses)],
    ),
  );
  return { product: rows[0], sent: stockUses };
}
async function openEdit(productId) {
  const variants = (await db.query(`select id, name from public.product_variants where product_id=$1 order by sort_order`, [productId])).rows;
  const names = new Map((await db.query('select id, name from public.products')).rows.map((p) => [p.id, p.name]));
  const rows = (await db.query(`select variant_id, ingredient_product_id, quantity from public.product_stock_uses where product_id=$1`, [productId])).rows.map((r) => ({ ...r, quantity: Number(r.quantity) }));
  const refs = variants.map((v, i) => ({ key: `k${i}`, id: v.id, name: v.name }));
  const recipes = savedStockUsesToRecipes(rows, productId, refs, (pid) => names.get(pid) ?? pid);
  return { productId, refs, recipes, baseline: canonicalStockUses(buildStockUsePayload(recipes, refs)) };
}
// Once the fixtures are active, saving keeps them active (the activation guard is skipped for these fixtures only).
let keepActive = false;
async function saveEdit(state, { name, sku, price = '20.00', recipes = state.recipes, refs = state.refs, newVariants = [], deleted = [], prices = {} }) {
  const allRefs = [...refs, ...newVariants.map((v, i) => ({ key: `n${i}`, id: null, name: v.name }))];
  const stockUses = stockUsesForSave(state.baseline, buildStockUsePayload(recipes, allRefs));
  const variantPayload = allRefs.map((r) => ({ id: r.id, name: r.name, default_price: prices[r.name] ?? '30.00' }));
  if (keepActive) await db.exec('set session_replication_role = replica');
  try {
  await asUser(mainMgr, () =>
    db.query(
      `select * from public.update_complete_product(p_product_id := $1, p_name := $2, p_sku := $3, p_description := null, p_is_active := $9::boolean, p_variants := $4::jsonb, p_deleted_variant_ids := $5::jsonb, p_branches := $6::jsonb, p_selling_price := $7, p_stock_uses := $8::jsonb)`,
      [state.productId, name, sku, J(variantPayload), J(deleted), J([allRefs.length ? { branch_id: booth, variants: variantPayload.map((v) => ({ name: v.name, selling_price: v.default_price })) } : { branch_id: booth, selling_price: price }]), allRefs.length ? null : price, stockUses === undefined ? null : J(stockUses), keepActive],
    ),
  );
  } finally {
    if (keepActive) await db.exec('reset session_replication_role');
  }
  return stockUses;
}
const describe = async (productId) =>
  (await db.query(
    `select coalesce(pv.name,'(product)') v, case when u.ingredient_product_id = u.product_id then 'self' else p.name end i, u.quantity q
     from public.product_stock_uses u left join public.product_variants pv on pv.id=u.variant_id join public.products p on p.id=u.ingredient_product_id
     where u.product_id=$1 order by 1,2`, [productId])).rows.map((r) => `${r.v}:${r.i}x${r.q}`);
const rawRows = async (productId) => (await db.query(`select id, variant_id, ingredient_product_id, quantity, created_at, updated_at from public.product_stock_uses where product_id=$1 order by id`, [productId])).rows;

// ---------------------------------------------------------------- 1. create single-price Meals and Snacks
const pares = await createLikeWizard({ name: 'Pares', sku: 'PARES-S6', recipes: { [PRODUCT_STOCK_KEY]: [{ itemId: T, quantity: 1 }, { itemId: rice, quantity: 1 }] } });
const kikiam = await createLikeWizard({ name: 'Kikiam', sku: 'KIKIAM-S6', recipes: { [PRODUCT_STOCK_KEY]: [{ itemId: T, quantity: 3 }] } });
const plainMeal = await createLikeWizard({ name: 'Plain Meal', sku: 'PLAINM-S6', recipes: { [PRODUCT_STOCK_KEY]: [{ itemId: T, quantity: 1 }] } }); // left at the automatic default
{
  assert.deepEqual(await describe(pares.product.id), ['(product):Ricex1', '(product):selfx1'], 'Meal: This Product + Rice');
  assert.deepEqual(await describe(kikiam.product.id), ['(product):selfx3'], 'Snack: 3 per order');
  assert.deepEqual(plainMeal.sent, [], 'the untouched default is not sent');
  assert.deepEqual(await describe(plainMeal.product.id), [], 'and nothing is stored: it deducts one of itself, as every product without a recipe does');
  assert.equal((await db.query(`select count(*)::int n from public.product_variants where product_id=$1`, [pares.product.id])).rows[0].n, 0, 'no variants were created');
  console.log('create without variants: ok');
}

// ---------------------------------------------------------------- 2. reopen Edit, unrelated edits, selecting a category
const open = {};
{
  open.pares = await openEdit(pares.product.id);
  assert.deepEqual(open.pares.recipes, { [PRODUCT_STOCK_KEY]: [{ itemId: T, quantity: 1 }, { itemId: rice, quantity: 1 }] }, 'the product-level list loads: This Product first, then Rice');
  open.kikiam = await openEdit(kikiam.product.id);
  assert.deepEqual(open.kikiam.recipes, { [PRODUCT_STOCK_KEY]: [{ itemId: T, quantity: 3 }] });
  open.plain = await openEdit(plainMeal.product.id);
  assert.deepEqual(open.plain.recipes, {}, 'a product with no recipe opens with no list (the editor then shows the default This Product x1)');

  // renaming / repricing: no recipes are sent and the rows are untouched
  const before = await rawRows(pares.product.id);
  assert.equal(await saveEdit(open.pares, { name: 'Pares Special', sku: 'PARES-S6', price: '95.00' }), undefined);
  assert.deepEqual(await rawRows(pares.product.id), before, 'identical rows, timestamps included');
  // choosing Meals in Edit seeds the editor with This Product x1; saving must not write a recipe nobody chose
  const seeded = { ...open.plain.recipes, [PRODUCT_STOCK_KEY]: [{ itemId: T, quantity: 1 }] };
  assert.equal(await saveEdit(open.plain, { name: 'Plain Meal', sku: 'PLAINM-S6', recipes: seeded }), undefined);
  assert.deepEqual(await describe(plainMeal.product.id), []);
  console.log('reopen and unrelated edits: ok');
}

// ---------------------------------------------------------------- 3. intentional updates and removals
{
  // change the snack to 2 per order, add Rice to the plain meal, and remove Rice from Pares
  assert.deepEqual(await saveEdit(open.kikiam, { name: 'Kikiam', sku: 'KIKIAM-S6', recipes: { [PRODUCT_STOCK_KEY]: [{ itemId: T, quantity: 2 }] } }), [{ ingredient_product_id: 'self', quantity: 2 }]);
  assert.deepEqual(await describe(kikiam.product.id), ['(product):selfx2']);
  await saveEdit(open.plain, { name: 'Plain Meal', sku: 'PLAINM-S6', recipes: { [PRODUCT_STOCK_KEY]: [{ itemId: T, quantity: 1 }, { itemId: rice, quantity: 2 }] } });
  assert.deepEqual(await describe(plainMeal.product.id), ['(product):Ricex2', '(product):selfx1']);
  open.pares = await openEdit(pares.product.id);
  await saveEdit(open.pares, { name: 'Pares Special', sku: 'PARES-S6', price: '95.00', recipes: { [PRODUCT_STOCK_KEY]: [{ itemId: T, quantity: 1 }] } });
  assert.deepEqual(await describe(pares.product.id), [], 'back to This Product x1 only = the default, so no row is kept (same deduction as no recipe)');
  // put Pares's Rice back for the next sections
  open.pares = await openEdit(pares.product.id);
  await saveEdit(open.pares, { name: 'Pares Special', sku: 'PARES-S6', price: '95.00', recipes: { [PRODUCT_STOCK_KEY]: [{ itemId: T, quantity: 1 }, { itemId: rice, quantity: 1 }] } });
  assert.deepEqual(await describe(pares.product.id), ['(product):Ricex1', '(product):selfx1']);
  open.pares = await openEdit(pares.product.id);
  open.plain = await openEdit(plainMeal.product.id);
  console.log('updates and removals: ok');
}

// ---------------------------------------------------------------- 4. adding, removing and switching variants keeps the product-level list
{
  // (a) add a variant "Large" (own list: This Product x2 + Rice x2) while the product-level list stays in the wizard state
  const state = open.pares;
  await saveEdit(state, { name: 'Pares Special', sku: 'PARES-S6', newVariants: [{ name: 'Large' }], recipes: { ...state.recipes, n0: [{ itemId: T, quantity: 2 }, { itemId: rice, quantity: 2 }] }, prices: { Large: '120.00' } });
  assert.deepEqual(await describe(pares.product.id), ['(product):Ricex1', '(product):selfx1', 'Large:Ricex2', 'Large:selfx2'], 'both lists are stored: the variant has its own, the product keeps its default');
  open.pares = await openEdit(pares.product.id);
  assert.deepEqual(open.pares.recipes[PRODUCT_STOCK_KEY], [{ itemId: T, quantity: 1 }, { itemId: rice, quantity: 1 }], 'the product-level list loads next to the variant list');

  await db.exec(`
    set session_replication_role = replica; -- skip the "needs opening stock" activation guard for the fixtures only
    update public.products set is_active = true where id in ('${pares.product.id}','${kikiam.product.id}','${plainMeal.product.id}');
    reset session_replication_role;
    insert into public.branch_inventory(branch_id,product_id,quantity_on_hand) values
      ('${booth}','${pares.product.id}',20),('${booth}','${kikiam.product.id}',20),('${booth}','${plainMeal.product.id}',20),('${booth}','${rice}',40);
  `);
  keepActive = true;
  const shift = (await asUser(cashier, () => db.query('select public.start_cashier_shift() id'))).rows[0].id;
  let n = 0;
  const sell = (lines) => asUser(cashier, () => db.query(`select (public.confirm_sale($1,$2::jsonb,'100000',$3,'standard')).*`, [shift, J(lines.map(([product_id, variant_id, quantity]) => ({ product_id, variant_id, quantity }))), `s6-sale-${String(++n).padStart(12, '0')}`]));
  const stock = async () => Object.fromEntries((await db.query(`select p.name, bi.quantity_on_hand::numeric q from public.branch_inventory bi join public.products p on p.id=bi.product_id where bi.branch_id='${booth}'`)).rows.map((r) => [r.name, Number(r.q)]));
  const diff = (a, b) => Object.fromEntries(Object.keys(b).map((k) => [k, b[k] - a[k]]).filter(([, d]) => d !== 0));
  const branchVariant = async (product, name) => (await db.query(`select id from public.branch_product_variants where branch_id=$1 and product_id=$2 and name=$3`, [booth, product, name])).rows[0].id;
  let before = await stock();

  // a sale of the variant applies ONE rule: the variant's own list, never added to the product-level one
  await sell([[pares.product.id, await branchVariant(pares.product.id, 'Large'), 1]]);
  assert.deepEqual(diff(before, await stock()), { 'Pares Special': -2, Rice: -2 }, 'Large: its own list once (Pares x2 + Rice x2), not plus the product-level Pares x1 + Rice x1');

  // (b) add a variant and remove it again (it was never sold): the product-level list and Large's list are untouched
  const a1 = await openEdit(pares.product.id);
  await saveEdit(a1, { name: 'Pares Special', sku: 'PARES-S6', newVariants: [{ name: 'Temp' }], recipes: { ...a1.recipes, n0: [{ itemId: T, quantity: 1 }] }, prices: { Large: '120.00', Temp: '50.00' } });
  const a2 = await openEdit(pares.product.id);
  const temp = a2.refs.find((r) => r.name === 'Temp');
  assert.ok(temp, 'the variant was added');
  await saveEdit(a2, { name: 'Pares Special', sku: 'PARES-S6', deleted: [temp.id], refs: a2.refs.filter((r) => r.id !== temp.id), recipes: Object.fromEntries(Object.entries(a2.recipes).filter(([k]) => k !== temp.key)), prices: { Large: '120.00' } });
  assert.deepEqual(await describe(pares.product.id), ['(product):Ricex1', '(product):selfx1', 'Large:Ricex2', 'Large:selfx2'], "Temp went with its list; the product-level list and Large's are unchanged");

  // (c) switch: replace one variant by another in a single save
  const b1 = await openEdit(pares.product.id);
  await saveEdit(b1, { name: 'Pares Special', sku: 'PARES-S6', newVariants: [{ name: 'Small' }], recipes: { ...b1.recipes, n0: [{ itemId: T, quantity: 1 }] }, prices: { Large: '120.00', Small: '60.00' } });
  const b2 = await openEdit(pares.product.id);
  const small = b2.refs.find((r) => r.name === 'Small');
  await saveEdit(b2, {
    name: 'Pares Special', sku: 'PARES-S6', deleted: [small.id], refs: b2.refs.filter((r) => r.id !== small.id), newVariants: [{ name: 'Medium' }],
    recipes: { ...Object.fromEntries(Object.entries(b2.recipes).filter(([k]) => k !== small.key)), n0: [{ itemId: T, quantity: 1 }, { itemId: rice, quantity: 1 }] }, prices: { Large: '120.00', Medium: '80.00' },
  });
  assert.deepEqual(await describe(pares.product.id), ['(product):Ricex1', '(product):selfx1', 'Large:Ricex2', 'Large:selfx2', 'Medium:Ricex1', 'Medium:selfx1'], 'Small went with its list; Medium has its own; the product-level list is unchanged');

  // (d) an option WITHOUT its own list uses the product-level list once (one rule, no double count)
  const c1 = await openEdit(pares.product.id);
  const medium = c1.refs.find((r) => r.name === 'Medium');
  await saveEdit(c1, { name: 'Pares Special', sku: 'PARES-S6', recipes: { ...c1.recipes, [medium.key]: [] }, prices: { Large: '120.00', Medium: '80.00' } });
  before = await stock();
  await sell([[pares.product.id, await branchVariant(pares.product.id, 'Medium'), 2]]);
  assert.deepEqual(diff(before, await stock()), { 'Pares Special': -2, Rice: -2 }, 'an option with no list uses the product-level list once');

  // (e) a single-price meal: add a variant, remove it again, then sell it single-price from its product-level list
  const siomai = await createLikeWizard({ name: 'Siomai', sku: 'SIOMAI-S6', recipes: { [PRODUCT_STOCK_KEY]: [{ itemId: T, quantity: 1 }, { itemId: rice, quantity: 1 }] } });
  const e1 = await openEdit(siomai.product.id);
  await saveEdit(e1, { name: 'Siomai', sku: 'SIOMAI-S6', newVariants: [{ name: 'Box' }], recipes: { ...e1.recipes, n0: [{ itemId: T, quantity: 6 }] }, prices: { Box: '90.00' } });
  const e2 = await openEdit(siomai.product.id);
  const box = e2.refs.find((r) => r.name === 'Box');
  await saveEdit(e2, { name: 'Siomai', sku: 'SIOMAI-S6', deleted: [box.id], refs: [], recipes: Object.fromEntries(Object.entries(e2.recipes).filter(([k]) => k !== box.key)) });
  assert.deepEqual(await describe(siomai.product.id), ['(product):Ricex1', '(product):selfx1'], 'the product-level list survived adding and removing a variant');
  await db.exec(`set session_replication_role = replica; update public.products set is_active = true where id='${siomai.product.id}'; reset session_replication_role;
    insert into public.branch_inventory(branch_id,product_id,quantity_on_hand) values ('${booth}','${siomai.product.id}',20);`);
  before = await stock();
  await sell([[siomai.product.id, null, 2]]);
  assert.deepEqual(diff(before, await stock()), { Siomai: -2, Rice: -2 }, 'a single-price sale uses the product-level list once');

  // (f) the snack (2 per order) and the meal with a saved Rice x2 beside its own default
  before = await stock();
  await sell([[kikiam.product.id, null, 3], [plainMeal.product.id, null, 1]]);
  assert.deepEqual(diff(before, await stock()), { Kikiam: -6, 'Plain Meal': -1, Rice: -2 });
  console.log('variants added, removed and switched; no double deductions: ok');
}

// ---------------------------------------------------------------- 5. wiring (source)
{
  const editor = read('src/features/products/VariantListEditor.tsx');
  assert.match(editor, /const showProductStock = variants\.length === 0 && config\.productLevelStock && config\.showIngredients;/);
  assert.match(editor, /shouldSeedProductStock\(\{\s*variantCount: variants\.length,\s*autoAdd: config\.autoAddMainProduct,/);
  const map = read('src/features/products/stockUseMapping.ts');
  assert.match(map, /if \(!isDefaultProductLevel\(productLevel\)\) for \(const line of productLevel\) push\(\{\}, line\);/);
  // the Step 1 list is still only for the simple (Extras) flow; Meals and Snacks keep their Step 2 flow
  for (const f of ['CreateProductWizard.tsx', 'EditProductWizard.tsx']) {
    assert.match(read(`src/features/products/${f}`), /simpleFlow && getCategoryConfig\(category\)\.productLevelStock/);
  }
  const guardsSrc = read('src/features/products/wizardGuards.ts');
  assert.match(guardsSrc, /if \(state\.category !== state\.defaultCategory\) items\.push\('Product Category'\);/);
  console.log('wiring: ok');
}

console.log('product_level_stock_meals_snacks: ALL PASS');
