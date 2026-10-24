// Drink Choice, Step 6.3: the wizard's real mapping logic against the real RPCs.
// Create a meal with eligible drinks, reopen it as Edit would, edit with and without drink changes, and check what the
// POS then offers. Products are created through the RPC, so branch and master variant ids are genuinely different.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

import { loadTs } from './_load_ts.mjs';

const mapping = loadTs('src/features/products/drinkChoiceMapping.ts');
const stockMapping = loadTs('src/features/products/stockUseMapping.ts');
const data = loadTs('src/features/products/recipePreviewData.ts');
const categories = loadTs('src/features/products/productCategoryPreview.ts');
const { buildDrinkChoicePayload, savedDrinkChoicesToState, canonicalDrinkChoices, drinkChoicesForSave } = mapping;
const { ingredientOptionsFromProducts, summarizeDrinkChoice } = data;
const { isDrinkChoiceVisible } = categories;
const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

// ---------------------------------------------------------------- 0. pure logic
{
  const refs = [{ key: 'k1', id: 'v-existing', name: 'With Rice' }, { key: 'k2', id: null, name: ' New One ' }, { key: 'k3', id: 'v-plain', name: 'Viand Only' }];
  const payload = buildDrinkChoicePayload(
    { k1: { enabled: true, drinkIds: ['coke', 'royal', 'coke'] }, k2: { enabled: true, drinkIds: ['sprite'] }, k3: { enabled: false, drinkIds: ['coke'] }, gone: { enabled: true, drinkIds: ['coke'] } },
    refs,
  );
  assert.deepEqual(payload, [
    { drink_product_id: 'coke', variant_id: 'v-existing' },
    { drink_product_id: 'royal', variant_id: 'v-existing' },
    { drink_product_id: 'sprite', variant_name: 'New One' },
  ], 'enabled options only; ids for existing options, names for new ones; duplicates and removed options dropped');
  assert.deepEqual(buildDrinkChoicePayload({ k1: { enabled: true, drinkIds: [] } }, refs), [], 'includes a drink but none chosen: nothing to save');

  const rows = [
    { variant_id: 'v-existing', drink_product_id: 'p-royal' },
    { variant_id: 'v-existing', drink_product_id: 'p-coke' },
    { variant_id: 'v-deleted', drink_product_id: 'p-coke' },
  ];
  const names = { 'p-coke': 'Coke', 'p-royal': 'Royal' };
  const state = savedDrinkChoicesToState(rows, refs, (id) => names[id] ?? id);
  assert.deepEqual(state, { k1: { enabled: true, drinkIds: ['p-coke', 'p-royal'] } }, 'A to Z by name; a missing option is ignored; "includes a drink" is on');
  assert.deepEqual(savedDrinkChoicesToState([...rows].reverse(), refs, (id) => names[id] ?? id), state, 'independent of the order the rows come back in');

  const base = canonicalDrinkChoices(buildDrinkChoicePayload(state, refs));
  assert.equal(drinkChoicesForSave(base, buildDrinkChoicePayload(state, refs.map((r) => (r.id === 'v-existing' ? { ...r, name: 'Renamed' } : r)))), undefined, 'a renamed option is not a change');
  assert.equal(drinkChoicesForSave(base, buildDrinkChoicePayload({ k1: { enabled: true, drinkIds: ['p-royal', 'p-coke'] } }, refs)), undefined, 'order is not a change');
  assert.equal(drinkChoicesForSave(base, buildDrinkChoicePayload({ k1: { enabled: true, drinkIds: ['p-coke'] } }, refs)).length, 1, 'a removed drink sends the complete new set');
  assert.deepEqual(drinkChoicesForSave(base, buildDrinkChoicePayload({ k1: { enabled: false, drinkIds: ['p-coke', 'p-royal'] } }, refs)), [], 'turning "Includes a drink" off removes them all (an explicit empty list)');

  // visibility: Meals show it; "Category not set" only for an option that already includes a drink; others hide it
  assert.equal(isDrinkChoiceVisible('meals', false), true);
  assert.equal(isDrinkChoiceVisible('snacks', false), false);
  assert.equal(isDrinkChoiceVisible('drinks', true), false);
  assert.equal(isDrinkChoiceVisible('unset', false), false);
  assert.equal(isDrinkChoiceVisible('unset', true), true, 'a saved drink choice is never invisible in Edit');

  const options = ingredientOptionsFromProducts([{ id: 'p-coke', name: 'Coke' }, { id: 'p-royal', name: 'Royal' }, { id: 'p-self', name: 'Chicken Curry' }], 'p-self');
  assert.equal(summarizeDrinkChoice({ enabled: true, drinkIds: ['p-royal', 'p-coke'] }, options), 'Royal, Coke');
  assert.equal(summarizeDrinkChoice({ enabled: false, drinkIds: ['p-coke'] }, options), '');
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
const id = (n) => `61000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
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
    ('${main}','Main','MAIN-DW',true,true,'counted'),('${booth}','Booth','BOOTH-DW',false,true,'cashier_confirm');
  insert into public.profiles(id,full_name,role,branch_id) values
    ('${mainMgr}','Main Manager','manager','${main}'),('${cashier}','Cashier One','cashier','${booth}');
  insert into public.products(id,name,sku,selling_price,is_active,inventory_mode,closing_stock_behavior) values
    ('${egg}','Egg','EGG-DW',10,true,'piece_stock','keep_at_branch'),('${rice}','Rice','RICE-DW',15,true,'piece_stock','keep_at_branch'),
    ('${coke}','Coke','COKE-DW',20,true,'piece_stock','keep_at_branch'),('${royal}','Royal','ROYAL-DW',20,true,'piece_stock','keep_at_branch'),
    ('${sprite}','Sprite','SPRITE-DW',20,true,'piece_stock','keep_at_branch');
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
const J = (v) => JSON.stringify(v);
const allProducts = async () => new Map((await db.query('select id, name from public.products')).rows.map((p) => [p.id, p.name]));

async function createLikeWizard({ name, sku, variants, drinks = {}, stock = [] }) {
  const refs = variants.map((v, i) => ({ key: `t${i}`, id: null, name: v.name }));
  const drinkChoices = buildDrinkChoicePayload(drinks, refs);
  const { rows } = await asUser(mainMgr, () =>
    db.query(
      `select * from public.create_complete_product(p_name := $1, p_sku := $2, p_description := null, p_variants := $3::jsonb, p_branches := $4::jsonb, p_selling_price := null, p_stock_uses := $5::jsonb, p_drink_choices := $6::jsonb)`,
      [name, sku, J(variants.map((v) => ({ name: v.name, default_price: v.price }))), J([{ branch_id: booth, variants: variants.map((v) => ({ name: v.name, selling_price: v.price })) }]), J(stock), J(drinkChoices)],
    ),
  );
  return { product: rows[0], sent: drinkChoices };
}
async function openEdit(productId) {
  const variants = (await db.query(`select id, name from public.product_variants where product_id=$1 order by sort_order`, [productId])).rows;
  const names = await allProducts();
  const rows = (await db.query(`select variant_id, drink_product_id from public.product_drink_choices where product_id=$1 order by created_at, id`, [productId])).rows;
  const refs = variants.map((v, i) => ({ key: `k${i}`, id: v.id, name: v.name }));
  const drinks = savedDrinkChoicesToState(rows, refs, (pid) => names.get(pid) ?? pid);
  return { productId, refs, drinks, baseline: canonicalDrinkChoices(buildDrinkChoicePayload(drinks, refs)) };
}
async function saveEdit(state, { name, sku, drinks = state.drinks, refs = state.refs, newVariants = [], deleted = [], prices = {} }) {
  const allRefs = [...refs, ...newVariants.map((v, i) => ({ key: `n${i}`, id: null, name: v.name }))];
  const drinkChoices = drinkChoicesForSave(state.baseline, buildDrinkChoicePayload(drinks, allRefs));
  const variantPayload = allRefs.map((r) => ({ id: r.id, name: r.name, default_price: prices[r.name] ?? '50.00' }));
  await db.exec('set session_replication_role = replica'); // keeps already-active fixtures active (activation guard skipped for fixtures only)
  try {
    await asUser(mainMgr, () =>
      db.query(
        `select * from public.update_complete_product(p_product_id := $1, p_name := $2, p_sku := $3, p_description := null, p_is_active := $4::boolean, p_variants := $5::jsonb, p_deleted_variant_ids := $6::jsonb, p_branches := $7::jsonb, p_selling_price := null, p_drink_choices := $8::jsonb)`,
        [state.productId, name, sku, activeNow, J(variantPayload), J(deleted), J([{ branch_id: booth, variants: variantPayload.map((v) => ({ name: v.name, selling_price: v.default_price })) }]), drinkChoices === undefined ? null : J(drinkChoices)],
      ),
    );
  } finally {
    await db.exec('reset session_replication_role');
  }
  return drinkChoices;
}
let activeNow = false;
const describe = async (productId) =>
  (await db.query(`select pv.name v, p.name d from public.product_drink_choices c join public.product_variants pv on pv.id=c.variant_id join public.products p on p.id=c.drink_product_id where c.product_id=$1 order by 1,2`, [productId])).rows.map((r) => `${r.v}:${r.d}`);
const rawRows = async (productId) => (await db.query(`select id, variant_id, drink_product_id, created_at, updated_at from public.product_drink_choices where product_id=$1 order by id`, [productId])).rows;

// ---------------------------------------------------------------- 1. create a meal with eligible drinks
const curry = await createLikeWizard({
  name: 'Chicken Curry', sku: 'CURRY-DW',
  variants: [{ name: 'Viand Only', price: '70.00' }, { name: 'With Rice', price: '85.00' }],
  drinks: { t1: { enabled: true, drinkIds: [coke, royal] } },
  stock: [{ variant_name: 'With Rice', ingredient_product_id: 'self', quantity: 1 }, { variant_name: 'With Rice', ingredient_product_id: rice, quantity: 1 }],
});
{
  assert.deepEqual(curry.sent, [{ drink_product_id: coke, variant_name: 'With Rice' }, { drink_product_id: royal, variant_name: 'With Rice' }]);
  assert.deepEqual(await describe(curry.product.id), ['With Rice:Coke', 'With Rice:Royal']);
  assert.deepEqual(await describe((await createLikeWizard({ name: 'No Drink Meal', sku: 'NODRINK-DW', variants: [{ name: 'Regular', price: '60.00' }] })).product.id), [], 'a meal without drink choices stores none');
  console.log('create: ok');
}

// ---------------------------------------------------------------- 2. reopen Edit shows the saved drinks
let open;
{
  open = await openEdit(curry.product.id);
  const withRice = open.refs.find((r) => r.name === 'With Rice');
  const viand = open.refs.find((r) => r.name === 'Viand Only');
  assert.deepEqual(open.drinks[withRice.key], { enabled: true, drinkIds: [coke, royal] }, 'With Rice includes a drink: Coke, Royal (A to Z)');
  assert.equal(open.drinks[viand.key], undefined, 'Viand Only does not');
  const names = await allProducts();
  const options = ingredientOptionsFromProducts([...names].map(([pid, nm]) => ({ id: pid, name: nm })), curry.product.id);
  assert.equal(summarizeDrinkChoice(open.drinks[withRice.key], options), 'Coke, Royal');
  console.log('reopen edit: ok');
}

// ---------------------------------------------------------------- 3. unrelated edits keep the drinks
{
  const before = await rawRows(curry.product.id);
  const sent = await saveEdit(open, { name: 'Chicken Curry Deluxe', sku: 'CURRY-DW', refs: open.refs.map((r) => (r.name === 'With Rice' ? { ...r, name: 'With Rice!' } : r)), prices: { 'Viand Only': '72.00', 'With Rice!': '88.00' } });
  assert.equal(sent, undefined, 'renaming the product and an option sends no drink choices');
  assert.deepEqual(await rawRows(curry.product.id), before, 'identical rows, timestamps included');
  open = await openEdit(curry.product.id);
  assert.equal(open.refs.find((r) => r.name === 'With Rice!') !== undefined, true);
  console.log('unrelated edits keep drinks: ok');
}

// ---------------------------------------------------------------- 4. intentional updates and removals
{
  const wr = open.refs.find((r) => r.name === 'With Rice!');
  const vo = open.refs.find((r) => r.name === 'Viand Only');
  // add Sprite, remove Royal, and give Viand Only a drink too
  const sent = await saveEdit(open, { name: 'Chicken Curry Deluxe', sku: 'CURRY-DW', prices: { 'Viand Only': '72.00', 'With Rice!': '88.00' }, drinks: { [wr.key]: { enabled: true, drinkIds: [coke, sprite] }, [vo.key]: { enabled: true, drinkIds: [royal] } } });
  assert.equal(sent.length, 3, 'the complete new set');
  assert.deepEqual(await describe(curry.product.id), ['Viand Only:Royal', 'With Rice!:Coke', 'With Rice!:Sprite']);
  open = await openEdit(curry.product.id);
  assert.deepEqual(open.drinks[open.refs.find((r) => r.name === 'Viand Only').key], { enabled: true, drinkIds: [royal] });

  // a new option "Large" with its own drinks, by name, next to the existing ones
  await saveEdit(open, { name: 'Chicken Curry Deluxe', sku: 'CURRY-DW', newVariants: [{ name: 'Large' }], prices: { 'Viand Only': '72.00', 'With Rice!': '88.00', Large: '110.00' }, drinks: { ...open.drinks, n0: { enabled: true, drinkIds: [coke, royal] } } });
  assert.deepEqual(await describe(curry.product.id), ['Large:Coke', 'Large:Royal', 'Viand Only:Royal', 'With Rice!:Coke', 'With Rice!:Sprite']);
  open = await openEdit(curry.product.id);

  // turning "Includes a drink" off for one option removes only its drinks
  const large = open.refs.find((r) => r.name === 'Large');
  await saveEdit(open, { name: 'Chicken Curry Deluxe', sku: 'CURRY-DW', prices: { 'Viand Only': '72.00', 'With Rice!': '88.00', Large: '110.00' }, drinks: { ...open.drinks, [large.key]: { enabled: false, drinkIds: [coke, royal] } } });
  assert.deepEqual(await describe(curry.product.id), ['Viand Only:Royal', 'With Rice!:Coke', 'With Rice!:Sprite']);
  open = await openEdit(curry.product.id);

  // removing an option removes its drinks with it
  const largeNow = open.refs.find((r) => r.name === 'Large');
  await saveEdit(open, { name: 'Chicken Curry Deluxe', sku: 'CURRY-DW', deleted: [largeNow.id], refs: open.refs.filter((r) => r.id !== largeNow.id), prices: { 'Viand Only': '72.00', 'With Rice!': '88.00' } });
  assert.deepEqual(await describe(curry.product.id), ['Viand Only:Royal', 'With Rice!:Coke', 'With Rice!:Sprite']);
  open = await openEdit(curry.product.id);

  // every drink choice off: an explicit empty list
  const all = Object.fromEntries(Object.keys(open.drinks).map((k) => [k, { enabled: false, drinkIds: open.drinks[k].drinkIds }]));
  assert.deepEqual(await saveEdit(open, { name: 'Chicken Curry Deluxe', sku: 'CURRY-DW', prices: { 'Viand Only': '72.00', 'With Rice!': '88.00' }, drinks: all }), []);
  assert.deepEqual(await describe(curry.product.id), []);
  open = await openEdit(curry.product.id);
  assert.deepEqual(open.drinks, {}, 'reopening shows no drink choices');
  console.log('intentional updates and removals: ok');
}

// ---------------------------------------------------------------- 5. what the POS then offers follows the saved choices
{
  const wr = open.refs.find((r) => r.name === 'With Rice!');
  await saveEdit(open, { name: 'Chicken Curry Deluxe', sku: 'CURRY-DW', prices: { 'Viand Only': '72.00', 'With Rice!': '88.00' }, drinks: { [wr.key]: { enabled: true, drinkIds: [coke, royal] } } });
  await db.exec(`
    set session_replication_role = replica;
    update public.products set is_active = true where id='${curry.product.id}';
    reset session_replication_role;
    insert into public.branch_inventory(branch_id,product_id,quantity_on_hand) values
      ('${booth}','${curry.product.id}',10),('${booth}','${rice}',10),('${booth}','${coke}',4),('${booth}','${royal}',1);
  `);
  activeNow = true;
  const rows = (await asUser(cashier, () => db.query('select * from public.list_cashier_pos_inventory()'))).rows;
  const row = rows.find((r) => r.product_name === 'Chicken Curry Deluxe');
  const branchRice = (await db.query(`select id from public.branch_product_variants where branch_id=$1 and product_id=$2 and name='With Rice!'`, [booth, curry.product.id])).rows[0].id;
  assert.deepEqual(row.stock_uses.drinks, { [branchRice]: [coke, royal].sort() }, 'the saved drinks, keyed by the branch option the POS sells');
  assert.equal(Number(row.variants.find((v) => v.name === 'With Rice!').sellable_quantity), 5, 'meal ingredients 10, drinks 4 + 1 = 5');
  // edit the drinks: the POS follows right away
  const o2 = await openEdit(curry.product.id);
  const wr2 = o2.refs.find((r) => r.name === 'With Rice!');
  await saveEdit(o2, { name: 'Chicken Curry Deluxe', sku: 'CURRY-DW', prices: { 'Viand Only': '72.00', 'With Rice!': '88.00' }, drinks: { [wr2.key]: { enabled: true, drinkIds: [coke] } } });
  const row2 = (await asUser(cashier, () => db.query('select * from public.list_cashier_pos_inventory()'))).rows.find((r) => r.product_name === 'Chicken Curry Deluxe');
  assert.deepEqual(row2.stock_uses.drinks, { [branchRice]: [coke] });
  assert.equal(Number(row2.variants.find((v) => v.name === 'With Rice!').sellable_quantity), 4);
  console.log('pos follows the saved choices: ok');
}

// ---------------------------------------------------------------- 6. wiring (source)
{
  const service = read('src/services/productService.ts');
  assert.equal((service.match(/p_drink_choices: input\.drinkChoices \?\? null,/g) ?? []).length, 2, 'create and update both send it');
  assert.match(service, /\.from\('product_drink_choices'\)/);
  const screen = read('app/(manager)/manager/products/index.tsx');
  assert.equal((screen.match(/drinkChoices: values\.drinkChoices,/g) ?? []).length, 2);
  assert.match(screen, /useProductDrinkChoices\(editProduct\?\.id \?\? ''\)/);
  assert.match(screen, /editDrinkChoices\.error \|\| !editDrinkChoices\.data/, 'Edit never opens without the saved drink choices');
  assert.match(screen, /sourceDrinkChoices=\{/);
  const edit = read('src/features/products/EditProductWizard.tsx');
  assert.match(edit, /drinkChoicesForSave\(savedDrinkChoicesRef\.current \?\? '', buildDrinkChoicePayload\(drinkChoices, variants\)\)/);
  assert.match(read('src/features/products/CreateProductWizard.tsx'), /drinkChoices: buildDrinkChoicePayload\(/);
  for (const f of ['recipePreviewData.ts', 'VariantDrinkChoicePreview.tsx', 'VariantListEditor.tsx', 'CreateProductWizard.tsx', 'EditProductWizard.tsx']) {
    assert.doesNotMatch(read(`src/features/products/${f}`), /SAMPLE_DRINKS|sample-coke/, f);
  }
  console.log('wiring: ok');
}

console.log('drink_choice_wizard_db: ALL PASS');
