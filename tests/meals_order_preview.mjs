// Meals & Viands: the per-order Stock Deduction preview must say what a sale really deducts, including the drink.
// describeOrderDeduction is the real client function; the sales run through the real RPCs on PGlite (Postgres WASM,
// not a native PostgreSQL). Not a device / rendered test.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { loadTs } from './_load_ts.mjs';

const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const { describeOrderDeduction, summarizeDrinkLine, effectiveLines, ingredientOptionsFromProducts, THIS_PRODUCT_ID } = loadTs('src/features/products/recipePreviewData.ts');
const { PRODUCT_CATEGORIES, getCategoryConfig } = loadTs('src/features/products/productCategoryPreview.ts');
const THIS = THIS_PRODUCT_ID;

// ---------------------------------------------------------------- 1. the sentences (pure)
{
  const items = ingredientOptionsFromProducts([
    { id: 'rice', name: 'Rice', category: 'supplies' },
    { id: 'egg', name: 'Egg', category: 'supplies' },
    { id: 'coke', name: 'Coke', category: 'drinks', sellInPos: false },
    { id: 'royal', name: 'Royal', category: 'drinks' },
  ]);
  const base = { productName: 'Beef Curry', ingredients: items };
  const baseOnly = [{ itemId: THIS, quantity: 1 }];
  const withRice = [{ itemId: THIS, quantity: 1 }, { itemId: 'rice', quantity: 1 }];

  assert.deepEqual(describeOrderDeduction({ ...base, lines: baseOnly }), ['Each order uses Beef Curry ×1.']);
  assert.deepEqual(describeOrderDeduction({ ...base, lines: withRice }), ['Each order uses Beef Curry ×1, Rice ×1.']);
  assert.deepEqual(describeOrderDeduction({ ...base, lines: [] }), ['Each order uses Beef Curry ×1.'], 'no list = the product itself x1, as the database does');
  // the drink is conditional: only when the option includes one, and it is a CHOICE made at checkout
  assert.deepEqual(
    describeOrderDeduction({ ...base, lines: withRice, drink: { enabled: true, drinkIds: ['coke', 'royal'] } }),
    ['Each order uses Beef Curry ×1, Rice ×1.', 'Plus 1 drink, chosen at checkout: Coke, Royal.'],
  );
  assert.deepEqual(
    describeOrderDeduction({ ...base, lines: withRice, drink: { enabled: true, drinkIds: [] } }),
    ['Each order uses Beef Curry ×1, Rice ×1.', 'Plus 1 drink, chosen at checkout (none selected yet).'],
  );
  assert.deepEqual(describeOrderDeduction({ ...base, lines: withRice, drink: { enabled: false, drinkIds: ['coke'] } }), ['Each order uses Beef Curry ×1, Rice ×1.'], 'a drink that is switched off deducts nothing');
  assert.deepEqual(describeOrderDeduction({ ...base, lines: withRice, drink: null }), ['Each order uses Beef Curry ×1, Rice ×1.']);
  // an option with no list of its own inherits the product-level list, like the database
  assert.deepEqual(describeOrderDeduction({ ...base, lines: [], inheritedLines: withRice }), ['Each order uses Beef Curry ×1, Rice ×1.']);
  assert.deepEqual(describeOrderDeduction({ ...base, lines: baseOnly, inheritedLines: withRice }), ['Each order uses Beef Curry ×1.'], 'its own list replaces the inherited one');
  // quantities
  assert.deepEqual(describeOrderDeduction({ ...base, lines: [{ itemId: THIS, quantity: 1 }, { itemId: 'egg', quantity: 2 }] }), ['Each order uses Beef Curry ×1, Egg ×2.']);
  // disabled drinks: the database offers only enabled drinks, so the preview must not promise them
  const drinkItems = ingredientOptionsFromProducts([
    { id: 'rice', name: 'Rice' },
    { id: 'coke', name: 'Coke', category: 'drinks', sellInPos: false },
    { id: 'royal', name: 'Royal', category: 'drinks', isActive: false },
    { id: 'sprite', name: 'Sprite', category: 'drinks', isActive: false },
  ]);
  const dbase = { productName: 'Beef Curry', ingredients: drinkItems, lines: baseOnly };
  assert.equal(drinkItems.find((i) => i.id === 'royal').inactive, true);
  assert.equal(drinkItems.find((i) => i.id === 'coke').inactive, undefined, 'enabled (or unknown) is not marked');
  assert.match(drinkItems.find((i) => i.id === 'royal').hint, /Disabled/, 'the picker shows it');
  assert.deepEqual(
    describeOrderDeduction({ ...dbase, drink: { enabled: true, drinkIds: ['coke', 'royal'] } }),
    ['Each order uses Beef Curry ×1.', 'Plus 1 drink, chosen at checkout: Coke.', 'Not offered (disabled): Royal.'],
  );
  assert.deepEqual(
    describeOrderDeduction({ ...dbase, drink: { enabled: true, drinkIds: ['royal', 'sprite'] } }),
    ['Each order uses Beef Curry ×1.', "Plus 1 drink, but every selected drink is disabled, so this option can't be sold until one is enabled."],
  );
  assert.equal(summarizeDrinkLine({ enabled: true, drinkIds: ['coke'] }, drinkItems), 'Drink: Coke');
  assert.equal(summarizeDrinkLine({ enabled: true, drinkIds: ['coke', 'royal'] }, drinkItems), 'Drink: Coke (1 disabled)');
  assert.equal(summarizeDrinkLine({ enabled: true, drinkIds: ['royal', 'sprite'] }, drinkItems), 'Drink: all disabled');
  assert.equal(summarizeDrinkLine({ enabled: true, drinkIds: ['coke', 'rice'] }, drinkItems), 'Drink: 2 options');
  assert.equal(summarizeDrinkLine({ enabled: false, drinkIds: ['coke'] }, drinkItems), '');
  assert.equal(summarizeDrinkLine({ enabled: true, drinkIds: [] }, drinkItems), '');
  console.log('1. sentences: ok');
}

// ---------------------------------------------------------------- 2. the database does exactly that
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
const id = (n) => `77000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
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
    ('${main}','Main Kitchen','MAIN-MP',true,true,'counted'),('${booth}','Booth','BOOTH-MP',false,true,'cashier_confirm');
  insert into public.profiles(id,full_name,role,branch_id) values
    ('${mgr}','Main Manager','manager','${main}'),('${cashier}','Cashier','cashier','${booth}');
`);
const create = ({ name, sku, price = '20.00', variants = [], stockUses, drinkChoices }) =>
  as(mgr, () =>
    db.query(
      `select * from public.create_complete_product(p_name := $1, p_sku := $2, p_description := null, p_variants := $3::jsonb, p_branches := $4::jsonb, p_selling_price := $5, p_stock_uses := $6::jsonb, p_drink_choices := $7::jsonb)`,
      [
        name,
        sku,
        J(variants.map(([n, p]) => ({ name: n, default_price: p }))),
        J([variants.length ? { branch_id: booth, variants: variants.map(([n, p]) => ({ name: n, selling_price: p })) } : { branch_id: booth, selling_price: price }]),
        variants.length ? null : price,
        stockUses === undefined ? null : J(stockUses),
        drinkChoices === undefined ? null : J(drinkChoices),
      ],
    ),
  ).then((r) => r.rows[0]);
const rice = await create({ name: 'Rice', sku: 'RICE-MP', price: '15.00' });
const coke = await create({ name: 'Coke', sku: 'COKE-MP', price: '25.00' });
const royal = await create({ name: 'Royal', sku: 'ROYAL-MP', price: '25.00' });
const curry = await create({
  name: 'Beef Curry',
  sku: 'CURRY-MP',
  variants: [['Viand Only', '70.00'], ['With Rice', '85.00']],
  stockUses: [
    { variant_name: 'Viand Only', ingredient_product_id: 'self', quantity: 1 },
    { variant_name: 'With Rice', ingredient_product_id: 'self', quantity: 1 },
    { variant_name: 'With Rice', ingredient_product_id: rice.id, quantity: 1 },
  ],
  drinkChoices: [{ variant_name: 'With Rice', drink_product_id: coke.id }, { variant_name: 'With Rice', drink_product_id: royal.id }],
});
await as(mgr, () => db.query(`select public.initialize_main_branch_inventory($1::jsonb,'open')`, [J([rice, coke, royal, curry].map((p) => ({ product_id: p.id, quantity: 100 })))]));
for (const p of [rice, coke, royal, curry]) await as(mgr, () => db.query('select public.set_product_status($1,true)', [p.id]));
// Coke is a meal-only drink (not sold on its own): it still fills the choice
await as(mgr, () => db.query('select public.set_product_sell_in_pos($1,false)', [coke.id]));
let n = 0;
const key = (p) => `${p}-${String(++n).padStart(14, '0')}`;
const transfer = (await as(mgr, () => db.query('select public.send_stock_transfer($1,$2::jsonb,null,$3) id', [booth, J([rice, coke, royal, curry].map((p) => ({ product_id: p.id, quantity_sent: 40, destination_price: 20 }))), key('mp-send')]))).rows[0].id;
await as(cashier, () => db.query('select public.confirm_shipment_arrival($1,$2)', [transfer, key('mp-arrive')]));
const shift = (await as(cashier, () => db.query('select public.start_cashier_shift() id'))).rows[0].id;
const stock = async () => Object.fromEntries((await db.query(`select p.name, bi.quantity_on_hand::numeric q from public.branch_inventory bi join public.products p on p.id=bi.product_id where bi.branch_id='${booth}'`)).rows.map((r) => [r.name, Number(r.q)]));
const sell = (lines) => as(cashier, () => db.query('select (public.confirm_sale($1,$2::jsonb,$3,$4,$5)).*', [shift, J(lines), '10000', key('mp-sale'), 'standard'])).then((r) => r.rows[0]);
const bv = Object.fromEntries((await db.query('select id, name from public.branch_product_variants where product_id=$1 and branch_id=$2', [curry.id, booth])).rows.map((r) => [r.name, r.id]));
const delta = (before, after) => Object.fromEntries(Object.keys(after).map((k) => [k, after[k] - before[k]]).filter(([, v]) => v));

// what the wizard holds for each option, and the preview it would show
const items = ingredientOptionsFromProducts([{ id: rice.id, name: 'Rice' }, { id: coke.id, name: 'Coke' }, { id: royal.id, name: 'Royal' }]);
const preview = (lines, drink) => describeOrderDeduction({ lines, productName: 'Beef Curry', ingredients: items, drink });
assert.deepEqual(preview([{ itemId: THIS, quantity: 1 }]), ['Each order uses Beef Curry ×1.']);
assert.deepEqual(preview([{ itemId: THIS, quantity: 1 }, { itemId: rice.id, quantity: 1 }], { enabled: true, drinkIds: [coke.id, royal.id] }), ['Each order uses Beef Curry ×1, Rice ×1.', 'Plus 1 drink, chosen at checkout: Coke, Royal.']);

// Viand Only x2: the meal only, no drink
let before = await stock();
await sell([{ product_id: curry.id, variant_id: bv['Viand Only'], quantity: 2 }]);
assert.deepEqual(delta(before, await stock()), { 'Beef Curry': -2 }, 'Viand Only: Beef Curry x1 per order and no drink (matches its preview)');
// With Rice x3 choosing Coke: meal + Rice + 1 Coke each; Royal untouched
before = await stock();
await sell([{ product_id: curry.id, variant_id: bv['With Rice'], drink_product_id: coke.id, quantity: 3 }]);
assert.deepEqual(delta(before, await stock()), { 'Beef Curry': -3, Rice: -3, Coke: -3 }, 'With Rice: Beef Curry x1 + Rice x1 + one chosen drink x1 per order (matches its preview)');
// the same option with the other drink: the choice decides which drink, never both
before = await stock();
await sell([{ product_id: curry.id, variant_id: bv['With Rice'], drink_product_id: royal.id, quantity: 2 }]);
assert.deepEqual(delta(before, await stock()), { 'Beef Curry': -2, Rice: -2, Royal: -2 }, 'only the chosen drink is deducted');
console.log('2. preview = database: ok');

// One sale, two lines: every quantity lands once, per product, and the drinks follow the choice made on each line
{
  const before = await stock();
  const sale = await sell([
    { product_id: curry.id, variant_id: bv['With Rice'], drink_product_id: coke.id, quantity: 1 },
    { product_id: curry.id, variant_id: bv['With Rice'], drink_product_id: royal.id, quantity: 2 },
    { product_id: curry.id, variant_id: bv['Viand Only'], quantity: 1 },
  ]);
  assert.deepEqual(delta(before, await stock()), { 'Beef Curry': -4, Rice: -3, Coke: -1, Royal: -2 }, 'meal 1+2+1, Rice 1+2, Coke 1, Royal 2');
  const moves = (await db.query(`select p.name, m.quantity::numeric q from public.inventory_movements m join public.products p on p.id=m.product_id where m.reference_id=$1 order by 1`, [sale.id])).rows.map((r) => [r.name, Number(r.q)]);
  assert.deepEqual(moves, [['Beef Curry', -4], ['Coke', -1], ['Rice', -3], ['Royal', -2]], 'one movement per product');
  console.log('2b. mixed sale: ok');
}

// A disabled drink is NOT offered: a saved drink choice can still list it, so the wizard must not promise it
{
  await as(mgr, () => db.query('select public.set_product_status($1,false)', [royal.id]));
  const rows = (await as(cashier, () => db.query('select * from public.list_cashier_pos_inventory()'))).rows;
  const row = rows.find((r) => r.product_name === 'Beef Curry');
  const offered = (row.stock_uses.drinks[bv['With Rice']] ?? []).map((d) => (d === coke.id ? 'Coke' : d === royal.id ? 'Royal' : d));
  assert.deepEqual(offered, ['Coke'], 'the cashier is only offered the enabled drink');
  await assert.rejects(sell([{ product_id: curry.id, variant_id: bv['With Rice'], drink_product_id: royal.id, quantity: 1 }]), /inactive or unavailable/i, 'the disabled drink is refused at the register');
  // every selected drink disabled: the option cannot be sold at all (never offered with no drink)
  await as(mgr, () => db.query('select public.set_product_status($1,false)', [coke.id]));
  const none = (await as(cashier, () => db.query('select * from public.list_cashier_pos_inventory()'))).rows.find((r) => r.product_name === 'Beef Curry');
  assert.equal(Number(none.variants.find((v) => v.name === 'With Rice').sellable_quantity), 0, 'no enabled drink = With Rice is unavailable');
  assert.ok(Number(none.variants.find((v) => v.name === 'Viand Only').sellable_quantity) > 0, 'an option without a drink is unaffected');
  await as(mgr, () => db.query('select public.set_product_status($1,true)', [coke.id]));
  await as(mgr, () => db.query('select public.set_product_status($1,true)', [royal.id]));
  console.log('2c. disabled drinks: ok');
}

// ---------------------------------------------------------------- 3. only Meals gets the preview; wording and wiring
{
  assert.deepEqual(PRODUCT_CATEGORIES.map((c) => [c.id, c.ingredientsLabel]), [
    ['meals', 'STOCK DEDUCTION'], ['snacks', 'STOCK DEDUCTION · OPTIONAL'], ['drinks', ''], ['extras', 'STOCK DEDUCTION'], ['supplies', ''],
  ], 'one name for the section where a stock list exists; drinks and supplies have none');
  assert.equal(getCategoryConfig('unset').ingredientsLabel, 'STOCK DEDUCTION · OPTIONAL');
  // behaviour per category is untouched
  assert.equal(getCategoryConfig('meals').autoAddMainProduct, true);
  assert.equal(getCategoryConfig('meals').showDrinkChoice, true);
  assert.equal(getCategoryConfig('snacks').allowOtherStock, false);
  assert.equal(getCategoryConfig('extras').stockModeChoice, true);

  const editor = read('src/features/products/VariantListEditor.tsx');
  assert.match(editor, /config\.id === 'meals' && config\.showIngredients/, 'the order preview is Meals only');
  assert.match(editor, /drink: drinkVisible \? drinkChoice : null,/, 'a hidden drink choice never appears in the preview');
  assert.match(editor, /<DeductionPreview sentences=\{orderPreview\} \/>/);
  assert.match(editor, /summarizeDrinkLine\(drinkChoice, drinkOptions \?\? ingredients\)/, 'the collapsed card line counts only enabled drinks');
  assert.match(read('app/(manager)/manager/products/index.tsx'), /isActive: product\.is_active,/, 'the products screen tells the wizard which products are disabled');
  assert.match(editor, /describeOrderDeduction\(\{ lines: recipes\[PRODUCT_STOCK_KEY\] \?\? \[\], productName, ingredients \}\)/, 'a meal sold at one price shows it too (no drink: drinks belong to options)');

  const recipe = read('src/features/products/VariantRecipePreview.tsx');
  assert.match(recipe, /'Base product · Required'/, 'the locked meal item says what it is');
  assert.match(recipe, /locked\n\s*\? 'Base product · Required'/);
  assert.match(recipe, /accessibilityLabel=\{`\$\{shownName\} is the base product and is required`\}/);
  assert.match(recipe, /<Text style=\{styles\.chipText\}>Add Stock Item<\/Text>/);
  assert.doesNotMatch(recipe, /Browse all/, 'the chip is "Add Stock Item"');
  assert.match(recipe, /accessibilityLabel="Add Stock Item"/);
  assert.match(recipe, /<DeductionPreview/, 'Extras uses the same shared box');

  // Done closes one card; Next goes to Branch Pricing
  assert.match(editor, /<Text style=\{styles\.doneButtonText\}>Done editing<\/Text>/);
  assert.match(editor, /accessibilityHint="Closes this card\. Nothing is saved until the last step\."/);
  for (const f of ['CreateProductWizard', 'EditProductWizard']) {
    assert.match(read(`src/features/products/${f}.tsx`), /<ManagerActionButton label="Next: Pricing" onPress=\{goToStep3\} \/>/, f);
  }
  assert.doesNotMatch(editor, /Done with this/);
  console.log('3. labels + wiring: ok');
}

console.log('meals_order_preview: ALL PASS');
