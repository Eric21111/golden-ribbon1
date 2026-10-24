// Drink Choice, POS side: the real cartStore + posAvailability + cart-line helpers against rows from the real
// list_cashier_pos_inventory, and checked against confirm_sale (the final authority). Not a rendered/device test.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { loadTs } from './_load_ts.mjs';

const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

// ---------------------------------------------------------------- 0. source pins for the screens
{
  const sheet = read('src/features/pos/PosItemSheet.tsx');
  assert.match(sheet, /Choose a drink/);
  assert.match(sheet, /const needsDrink = drinkOptions\.length > 0;/);
  assert.match(sheet, /canAdd = remaining > 0 && quantity > 0 && \(!needsDrink \|\| selectedDrink !== null\)/, 'a drink is required when the option includes one');
  assert.match(sheet, /onAdd\(selectedVariant, quantity, selectedDrink \?/);
  // legacy behaviour for options without a drink
  assert.match(sheet, /Math\.min\(Math\.max\(0, parsed\), remaining\)/);
  assert.match(sheet, /Maximum available quantity selected/);

  const payment = read('app/(cashier)/cashier/payment.tsx');
  assert.match(payment, /\.\.\.\(drink_product_id \? \{ drink_product_id \} : \{\}\)/, 'the key only exists when a drink was chosen');
  const pos = read('app/(cashier)/cashier/pos.tsx');
  assert.match(pos, /quantityByLine=\{quantitiesByDrinkLine\}/);
  assert.match(pos, /cartLineKey\(line\.product_id, line\.variant_id, line\.drink_product_id \?\? null\)/);
  for (const f of ['PosOrderPane', 'PosViewOrderSheet']) {
    const src = read(`src/features/pos/${f}.tsx`);
    assert.match(src, /item\.drink_product_id \?\? null/, `${f}: per-drink line callbacks`);
    assert.match(src, /cartLineLabel\(item\)/, `${f}: the drink is shown on the line`);
  }
  assert.match(read('src/features/pos/OrderSummary.tsx'), /cartLineLabel\(item\)/);
  assert.match(read('src/features/sales/SalesScreens.tsx'), /item\.drink_name/);
}

// ---------------------------------------------------------------- the real modules
const { useCartStore } = loadTs('src/stores/cartStore.ts', {
  './checkoutStore': { useCheckoutStore: { getState: () => ({ request: null }) } },
});
const { buildStockContext, parseStockUses, withCartLimits, findShortages, maxAdditional } = loadTs('src/features/pos/posAvailability.ts');
const { cartLineKey } = loadTs('src/lib/money.ts');
const { cartLineLabel } = loadTs('src/features/pos/cartLine.ts');

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
await db.exec(`
  insert into auth.users values ('${mainMgr}','m@t'),('${cashier}','c@t');
  insert into public.branches(id,name,code,is_main_branch,is_active,receiving_mode) values
    ('${main}','Main','MAIN-DP',true,true,'counted'),('${booth}','Booth','BOOTH-DP',false,true,'cashier_confirm');
  insert into public.profiles(id,full_name,role,branch_id) values
    ('${mainMgr}','Main Manager','manager','${main}'),('${cashier}','Cashier One','cashier','${booth}');
  insert into public.products(id,name,sku,selling_price,is_active,inventory_mode,closing_stock_behavior) values
    ('${egg}','Egg','EGG-DP',10,true,'piece_stock','keep_at_branch'),
    ('${rice}','Rice','RICE-DP',15,true,'piece_stock','keep_at_branch'),
    ('${coke}','Coke','COKE-DP',20,true,'piece_stock','keep_at_branch'),
    ('${royal}','Royal','ROYAL-DP',20,true,'piece_stock','keep_at_branch');
  insert into public.branch_products(branch_id,product_id,selling_price,is_active) values
    ('${booth}','${egg}',10,true),('${booth}','${rice}',15,true),('${booth}','${coke}',20,true),('${booth}','${royal}',20,true);
`);
const asUser = async (userId, work) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false);`);
  try {
    return await work();
  } finally {
    await db.exec('reset role');
  }
};
const J = (v) => (v === undefined ? null : JSON.stringify(v));
const curry = (
  await asUser(mainMgr, () =>
    db.query(
      `select * from public.create_complete_product(p_name := 'Chicken Curry', p_sku := 'CURRY-DP', p_description := null, p_variants := $1::jsonb, p_branches := $2::jsonb, p_selling_price := null, p_stock_uses := $3::jsonb, p_drink_choices := $4::jsonb)`,
      [
        J([{ name: 'Viand Only', default_price: '70.00' }, { name: 'With Rice', default_price: '85.00' }]),
        J([{ branch_id: booth, variants: [{ name: 'Viand Only', selling_price: '70.00' }, { name: 'With Rice', selling_price: '85.00' }] }]),
        J([
          { variant_name: 'Viand Only', ingredient_product_id: 'self', quantity: 1 },
          { variant_name: 'With Rice', ingredient_product_id: 'self', quantity: 1 },
          { variant_name: 'With Rice', ingredient_product_id: rice, quantity: 1 },
          { variant_name: 'With Rice', ingredient_product_id: egg, quantity: 1 },
        ]),
        J([{ variant_name: 'With Rice', drink_product_id: coke }, { variant_name: 'With Rice', drink_product_id: royal }]),
      ],
    ),
  )
).rows[0];
await db.exec(`
  set session_replication_role = replica;
  update public.products set is_active = true where id = '${curry.id}';
  reset session_replication_role;
  insert into public.branch_inventory(branch_id,product_id,quantity_on_hand) values
    ('${booth}','${curry.id}',20),('${booth}','${rice}',20),('${booth}','${egg}',20),('${booth}','${coke}',3),('${booth}','${royal}',1);
`);
const shift = (await asUser(cashier, () => db.query('select public.start_cashier_shift() id'))).rows[0].id;
let keyN = 0;
const sell = (lines) =>
  asUser(cashier, () => db.query('select (public.confirm_sale($1,$2::jsonb,$3,$4,$5)).*', [shift, J(lines), '100000', `dp-sale-${String(++keyN).padStart(12, '0')}`, 'standard'])).then((r) => r.rows[0]);
const bv = async (name) => (await db.query(`select id from public.branch_product_variants where branch_id=$1 and product_id=$2 and name=$3`, [booth, curry.id, name])).rows[0].id;
const vRice = await bv('With Rice');
const vOnly = await bv('Viand Only');
const loadItems = async () =>
  (await asUser(cashier, () => db.query('select * from public.list_cashier_pos_inventory()'))).rows
    .filter((row) => row.product_name === 'Chicken Curry')
    .map((row) => ({
      product: { id: row.product_id, name: row.product_name, sku: row.product_sku, selling_price: Number(row.selling_price) },
      quantity_on_hand: Number(row.sellable_quantity),
      stock_uses: parseStockUses(row.stock_uses),
      variants: row.variants.map((v) => ({ ...v, selling_price: Number(v.selling_price) })),
    }));

let items = await loadItems();
let ctx = buildStockContext(items);
const store = useCartStore;
const reset = () => store.setState({ items: [], stockContext: ctx });
const base = () => items[0];
const optionOf = (list, name) => list[0].variants.find((v) => v.name === name);
const COKE = { id: coke, name: 'Coke' };
const ROYAL = { id: royal, name: 'Royal' };
const lines = () => store.getState().items;

// ---------------------------------------------------------------- 1. the sheet gets per-drink limits
{
  reset();
  const limited = withCartLimits(items, ctx, lines());
  const rice_ = optionOf(limited, 'With Rice');
  assert.deepEqual(rice_.drink_options.map((o) => [o.name, o.max_quantity]).sort(), [['Coke', 3], ['Royal', 1]]);
  assert.equal(rice_.max_quantity, 3, 'the option is as available as its best drink');
  assert.equal(optionOf(limited, 'Viand Only').drink_options, undefined, 'an option without a drink is unchanged');
  // meal ingredients still apply: with only 2 Rice left, Coke is limited to 2 too
  const tight = buildStockContext([{ ...base(), stock_uses: { ...base().stock_uses, ingredient_stock: { ...base().stock_uses.ingredient_stock, [rice]: 2 } } }]);
  assert.deepEqual(withCartLimits(items, tight, []).find(Boolean).variants.find((v) => v.name === 'With Rice').drink_options.map((o) => [o.name, o.max_quantity]).sort(), [['Coke', 2], ['Royal', 1]]);
  console.log('per-drink limits: ok');
}

// ---------------------------------------------------------------- 2. cart: one drink per meal, separate lines, never over any stock
{
  reset();
  const rice_ = optionOf(items, 'With Rice');
  // a drink is required: a line for a drink-option without one cannot be added
  store.getState().addProduct(base(), rice_);
  assert.equal(lines().length, 0, 'no drink chosen: the meal is not added');
  store.getState().addProduct(base(), rice_, { id: sprite0(), name: 'Nope' });
  assert.equal(lines().length, 0, 'a drink that is not offered is refused');
  function sprite0() { return id(99); }

  store.getState().setProductQuantity(base(), 2, rice_, COKE);
  store.getState().setProductQuantity(base(), 5, rice_, ROYAL); // only 1 Royal
  assert.deepEqual(lines().map((l) => [l.drink_name, l.quantity]), [['Coke', 2], ['Royal', 1]], 'the Royal line is capped by Royal stock');
  assert.equal(lines()[0].unit_price, 85, 'the price is the option price: a drink never changes it');
  assert.equal(lines()[0].subtotal, 170);
  // Coke has 1 left
  store.getState().addProduct(base(), rice_, COKE);
  store.getState().addProduct(base(), rice_, COKE);
  assert.equal(lines().find((l) => l.drink_product_id === coke).quantity, 3, 'capped at the Coke stock');
  // the same meal without a drink option in the cart: a plain line is independent
  store.getState().addProduct(base(), optionOf(items, 'Viand Only'));
  assert.equal(lines().length, 3);
  // decrease and remove act on the right line only
  store.getState().decreaseProduct(curry.id, vRice, coke);
  assert.equal(lines().find((l) => l.drink_product_id === coke).quantity, 2);
  store.getState().setProductQuantity(base(), 0, rice_, ROYAL);
  assert.deepEqual(lines().map((l) => l.drink_name ?? null), ['Coke', null]);
  assert.equal(cartLineKey(curry.id, vRice, coke) === cartLineKey(curry.id, vRice, royal), false);
  assert.equal(cartLineKey(curry.id, vRice), `${curry.id}:${vRice}`, 'a line without a drink keeps its key');
  assert.equal(cartLineLabel(lines()[0]), 'Chicken Curry (With Rice) · Coke');
  assert.equal(cartLineLabel(lines()[1]), 'Chicken Curry (Viand Only)');
  console.log('cart lines per drink: ok');
}

// ---------------------------------------------------------------- 3. client and server agree, and a drink is deducted once
{
  reset();
  const rice_ = optionOf(items, 'With Rice');
  store.getState().setProductQuantity(base(), 3, rice_, COKE);
  store.getState().setProductQuantity(base(), 1, rice_, ROYAL);
  const cart = lines();
  assert.deepEqual(findShortages(ctx, cart), [], 'the client accepts exactly the cart the stock allows');
  const request = cart.map(({ product_id, variant_id, quantity, drink_product_id }) => ({ product_id, variant_id, quantity, ...(drink_product_id ? { drink_product_id } : {}) }));
  const before = Object.fromEntries((await db.query(`select p.name, bi.quantity_on_hand::numeric q from public.branch_inventory bi join public.products p on p.id=bi.product_id where bi.branch_id='${booth}'`)).rows.map((r) => [r.name, Number(r.q)]));
  const sale = await sell(request);
  assert.equal(Number(sale.total_amount), 340, '4 meals x 85: drinks are included');
  const after = Object.fromEntries((await db.query(`select p.name, bi.quantity_on_hand::numeric q from public.branch_inventory bi join public.products p on p.id=bi.product_id where bi.branch_id='${booth}'`)).rows.map((r) => [r.name, Number(r.q)]));
  assert.equal(before.Coke - after.Coke, 3);
  assert.equal(before.Royal - after.Royal, 1);
  assert.equal(before.Rice - after.Rice, 4);
  assert.equal(before['Chicken Curry'] - after['Chicken Curry'], 4);
  const saleItems = (await db.query(`select drink_name, quantity from public.sale_items where sale_id=$1 order by drink_name`, [sale.id])).rows;
  assert.deepEqual(saleItems.map((r) => [r.drink_name, Number(r.quantity)]), [['Coke', 3], ['Royal', 1]]);

  // the stock is now gone: the refreshed list marks the option out, the cart refuses it, and the server agrees
  items = await loadItems();
  ctx = buildStockContext(items);
  assert.equal(Number(optionOf(items, 'With Rice').sellable_quantity), 0);
  assert.equal(maxAdditional(ctx, [], curry.id, vRice, coke), 0);
  reset();
  store.getState().addProduct(base(), optionOf(items, 'With Rice'), COKE);
  assert.equal(lines().length, 0, 'out of drink stock: the cart will not take it');
  await assert.rejects(() => sell([{ product_id: curry.id, variant_id: vRice, quantity: 1, drink_product_id: coke }]), /insufficient|not enough|stock/i, 'the server refuses it too');
  const unchanged = Number((await db.query(`select quantity_on_hand::numeric q from public.branch_inventory where branch_id='${booth}' and product_id='${coke}'`)).rows[0].q);
  assert.equal(unchanged, 0, 'a refused sale deducts nothing');
  console.log('client/server agree, deducted once: ok');
}

// ---------------------------------------------------------------- 4. products without a drink choice are unchanged
{
  reset();
  store.getState().setProductQuantity(base(), 4, optionOf(items, 'Viand Only'));
  assert.deepEqual(lines().map((l) => [l.variant_name, l.quantity, 'drink_product_id' in l]), [['Viand Only', 4, false]], 'no drink fields on a plain line');
  const sale = await sell([{ product_id: curry.id, variant_id: vOnly, quantity: 4 }]);
  assert.equal(Number(sale.total_amount), 280);
  console.log('plain options unchanged: ok');
}

console.log('drink_choice_pos: ALL PASS');
