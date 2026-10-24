// Step 4: POS availability and cart limits with shared ingredient stock.
// Database part: list_cashier_pos_inventory (sellable_quantity, stock_uses). Client part: posAvailability.ts and the
// real cartStore. Agreement part: the client's limits and confirm_sale (the final authority) accept the same carts.
// Egg is tracked in half-egg units (1 egg = 2 units). Products are created through the real RPC, so branch and master
// variant ids are genuinely different.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';

import {
  buildStockContext,
  cartUsage,
  findShortages,
  linesFor,
  maxAdditional,
  maxLineQuantity,
  parseStockUses,
  withCartLimits,
} from '../src/features/pos/posAvailability.ts';

const MIGRATION = '20261023130000_pos_shared_inventory_availability.sql';
const migrationSrc = readFileSync(`supabase/migrations/${MIGRATION}`, 'utf8');

// ---------------------------------------------------------------- 0. static: scope of the migration and the wiring
{
  const code = migrationSrc.replace(/--[^\n]*/g, '').replace(/comment on [\s\S]*?;\n/gi, '');
  assert.doesNotMatch(code, /confirm_sale/i, 'confirm_sale is not touched');
  assert.doesNotMatch(code, /\balter table\b|\bcreate table\b|\bcreate (unique )?index\b|\binsert into\b|\bupdate public\.|\bdelete from\b/i, 'no schema or data change');
  assert.equal((code.match(/drop function/gi) ?? []).length, 1, 'only list_cashier_pos_inventory is replaced');
  assert.match(code, /revoke all on function public\.pos_effective_stock_lines\(uuid, text\) from public, anon, authenticated;/);
  assert.match(code, /revoke all on function public\.pos_lines_sellable\(uuid, jsonb\) from public, anon, authenticated;/);
  assert.match(code, /lower\(pv\.name\) = lower\(p_variant_name\)/, 'branch variant is paired with its master variant by name, as confirm_sale does');
  assert.match(code, /grant execute on function public\.list_cashier_pos_inventory\(\) to authenticated/);

  const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
  const service = read('src/services/inventoryService.ts');
  assert.match(service, /row\.sellable_quantity != null/, 'POS quantity_on_hand = sellable quantity');
  assert.match(service, /stock_uses: parseStockUses\(row\.stock_uses\)/);
  const cart = read('src/stores/cartStore.ts');
  assert.match(cart, /maxAdditional\(context, state\.items, product\.id, variantId, drinkId\) < 1/);
  assert.match(cart, /maxLineQuantity\(context, state\.items, product\.id, variantId, drinkId\)/);
  // the original per-product limit stays as the fallback
  assert.match(cart, /Math\.min\(nextQuantity, Math\.max\(0, quantity_on_hand - otherQuantity\)\)/);
  assert.match(cart, /totalForProduct \+ 1 > quantity_on_hand/);
  const pos = read('app/(cashier)/cashier/pos.tsx');
  assert.match(pos, /setStockContext\(stockContext\)/);
  assert.match(pos, /withCartLimits\(inventory\.data \?\? \[\], stockContext, items\)/);
  assert.match(pos, /maxByLine=\{maxByLine\}/);
  assert.equal((read('src/features/pos/PosOrderPane.tsx').match(/maxByLine/g) ?? []).length >= 3, true);
  assert.equal((read('src/features/pos/PosViewOrderSheet.tsx').match(/maxByLine/g) ?? []).length >= 3, true);
  assert.match(read('app/(cashier)/cashier/payment.tsx'), /findShortages\(buildStockContext\(rows\)/);
  assert.match(read('src/features/pos/PosItemSheet.tsx'), /selectedVariant\?\.max_quantity != null/);
  // the list and the "out of stock" decision still follow the server's sellable quantity, not the cart
  assert.match(read('src/features/pos/posAvailability.ts'), /quantity_on_hand \(the server's sellable quantity\)/);
}

// ---------------------------------------------------------------- the real cartStore, loaded without the app shell
function loadTs(entry, stubs) {
  const cache = new Map();
  const nodeRequire = createRequire(path.resolve('package.json'));
  function load(file) {
    const abs = path.resolve(file);
    if (cache.has(abs)) return cache.get(abs).exports;
    const { outputText } = ts.transpileModule(readFileSync(abs, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      fileName: abs,
    });
    const module = { exports: {} };
    cache.set(abs, module);
    const localRequire = (id) => {
      if (id in stubs) return stubs[id];
      const resolveLocal = (base) => {
        for (const candidate of [`${base}.ts`, `${base}.tsx`, base]) {
          try {
            readFileSync(candidate);
            return load(candidate);
          } catch (e) {
            if (e.code !== 'ENOENT') throw e;
          }
        }
        throw new Error(`Unable to resolve ${id} from ${abs}`);
      };
      if (id.startsWith('@/')) return resolveLocal(path.resolve('src', id.slice(2)));
      if (id.startsWith('.')) return resolveLocal(path.resolve(path.dirname(abs), id));
      return nodeRequire(id);
    };
    vm.runInThisContext(`(function (module, exports, require) {${outputText}\n})`, { filename: abs })(module, module.exports, localRequire);
    return module.exports;
  }
  return load(entry);
}
const { useCartStore } = loadTs('src/stores/cartStore.ts', {
  './checkoutStore': { useCheckoutStore: { getState: () => ({ request: null }) } },
});

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

const id = (n) => `56000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const mainMgr = id(2);
const cashier = id(4);
const stranger = id(6);
const main = id(10);
const booth = id(11);
const egg = id(20);
const rice = id(21);
const soda = id(22);

await db.exec(`
  insert into auth.users values ('${mainMgr}','m@t'),('${cashier}','c@t'),('${stranger}','s@t');
  insert into public.branches(id,name,code,is_main_branch,is_active,receiving_mode) values
    ('${main}','Main','MAIN-P4',true,true,'counted'),('${booth}','Booth','BOOTH-P4',false,true,'cashier_confirm');
  insert into public.profiles(id,full_name,role,branch_id) values
    ('${mainMgr}','Main Manager','manager','${main}'),('${cashier}','Cashier One','cashier','${booth}'),('${stranger}','Other Manager','manager','${booth}');
  insert into public.products(id,name,sku,selling_price,is_active,inventory_mode,closing_stock_behavior) values
    ('${egg}','Egg','EGG-P4',10,true,'piece_stock','keep_at_branch'),
    ('${rice}','Rice','RICE-P4',15,true,'piece_stock','keep_at_branch'),
    ('${soda}','Soda','SODA-P4',30,true,'piece_stock','keep_at_branch');
  insert into public.branch_products(branch_id,product_id,selling_price,is_active) values
    ('${booth}','${egg}',10,true),('${booth}','${rice}',15,true),('${booth}','${soda}',30,true);
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
const createProduct = (name, sku, variants, stockUses) =>
  asUser(mainMgr, () =>
    db.query(
      `select * from public.create_complete_product(p_name := $1, p_sku := $2, p_description := null, p_variants := $3::jsonb, p_branches := $4::jsonb, p_selling_price := $5, p_stock_uses := $6::jsonb)`,
      [
        name,
        sku,
        J(variants.map(([n, price]) => ({ name: n, default_price: price }))),
        J([variants.length ? { branch_id: booth, variants: variants.map(([n, price]) => ({ name: n, selling_price: price })) } : { branch_id: booth, selling_price: '20.00' }]),
        variants.length ? null : '20.00',
        J(stockUses),
      ],
    ),
  ).then((r) => r.rows[0]);

const curry = await createProduct('Chicken Curry', 'CURRY-P4', [['Viand Only', '70.00'], ['With Rice', '85.00']], [
  { variant_name: 'Viand Only', ingredient_product_id: 'self', quantity: 1 },
  { variant_name: 'Viand Only', ingredient_product_id: egg, quantity: 1 }, // half an egg
  { variant_name: 'With Rice', ingredient_product_id: 'self', quantity: 1 },
  { variant_name: 'With Rice', ingredient_product_id: rice, quantity: 1 },
  { variant_name: 'With Rice', ingredient_product_id: egg, quantity: 1 },
]);
const extraEgg = await createProduct('Extra Egg', 'XEGG-P4', [], [{ ingredient_product_id: egg, quantity: 2 }]); // a whole egg, no stock of its own
const bbq = await createProduct('BBQ', 'BBQ-P4', [['1 Stick', '20.00'], ['3 Sticks', '55.00']], [
  { variant_name: '1 Stick', ingredient_product_id: 'self', quantity: 1 },
  { variant_name: '3 Sticks', ingredient_product_id: 'self', quantity: 3 },
]);
const plainMeal = await createProduct('Plain Meal', 'PLAIN-P4', [['Regular', '60.00'], ['Large', '80.00']], undefined); // no recipe at all

await db.exec(`
  set session_replication_role = replica; -- skip the "needs opening stock" activation guard for the fixtures only
  update public.products set is_active = true where id in ('${curry.id}','${extraEgg.id}','${bbq.id}','${plainMeal.id}');
  reset session_replication_role;
  insert into public.branch_inventory(branch_id,product_id,quantity_on_hand) values
    ('${booth}','${curry.id}',10),('${booth}','${rice}',6),('${booth}','${egg}',9),
    ('${booth}','${bbq.id}',10),('${booth}','${soda}',4),('${booth}','${plainMeal.id}',7);
`);

const listRows = () => asUser(cashier, () => db.query('select * from public.list_cashier_pos_inventory()')).then((r) => r.rows);
const byName = (rows, name) => rows.find((r) => r.product_name === name);
const masterId = async (product, name) => (await db.query(`select id from public.product_variants where product_id=$1 and name=$2`, [product, name])).rows[0].id;
const branchVariantId = async (product, name) => (await db.query(`select id from public.branch_product_variants where branch_id=$1 and product_id=$2 and name=$3`, [booth, product, name])).rows[0].id;
const numbers = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Number(v)]));

// mirrors inventoryService.listCashierPosInventory (pinned by the static checks above)
const toItem = (row) => ({
  product: { id: row.product_id, name: row.product_name, sku: row.product_sku, selling_price: Number(row.selling_price) },
  quantity_on_hand: row.sellable_quantity != null ? Number(row.sellable_quantity) : Number(row.quantity_on_hand ?? 0),
  stock_uses: parseStockUses(row.stock_uses),
  variants: (row.variants ?? []).map((v) => ({ ...v, selling_price: Number(v.selling_price), ...(v.sellable_quantity == null ? {} : { sellable_quantity: Number(v.sellable_quantity) }) })),
});

// ---------------------------------------------------------------- 1. the ids really are different
{
  for (const [product, name] of [[curry.id, 'Viand Only'], [curry.id, 'With Rice'], [bbq.id, '1 Stick'], [bbq.id, '3 Sticks']]) {
    assert.notEqual(await masterId(product, name), await branchVariantId(product, name), `${name}: branch id differs from master id`);
  }
}

// ---------------------------------------------------------------- 2. list_cashier_pos_inventory: sellable quantities and recipes
let rows;
{
  rows = await listRows();
  const curryRow = byName(rows, 'Chicken Curry');
  const vOnly = await branchVariantId(curry.id, 'Viand Only');
  const vRice = await branchVariantId(curry.id, 'With Rice');
  // Curry With Rice needs Curry, Rice and Egg: min(10 / 1, 6 / 1, 9 / 1) = 6.  Viand Only: min(10, 9) = 9.
  const variants = Object.fromEntries(curryRow.variants.map((v) => [v.name, Number(v.sellable_quantity)]));
  assert.deepEqual(variants, { 'Viand Only': 9, 'With Rice': 6 });
  assert.equal(Number(curryRow.sellable_quantity), 9, 'with variants: the most any single option can sell');
  assert.equal(Number(curryRow.quantity_on_hand), 10, 'quantity_on_hand is still the product\'s own stock');
  // recipes are keyed by the BRANCH variant id (what the POS sells), resolved through the master variant
  const uses = curryRow.stock_uses;
  assert.deepEqual(Object.keys(uses.variants).sort(), [vOnly, vRice].sort());
  assert.ok(!(await masterId(curry.id, 'With Rice') in uses.variants), 'master ids never appear');
  const lines = (arr) => arr.map((l) => `${l.ingredient_product_id === curry.id ? 'self' : l.ingredient_product_id === egg ? 'egg' : 'rice'}x${l.quantity}`).sort();
  assert.deepEqual(lines(uses.variants[vRice]), ['eggx1', 'ricex1', 'selfx1']);
  assert.deepEqual(lines(uses.variants[vOnly]), ['eggx1', 'selfx1']);
  assert.deepEqual(numbers(uses.ingredient_stock), { [curry.id]: 10, [rice]: 6, [egg]: 9 });
  assert.equal(uses.ingredient_names[egg], 'Egg');
  assert.equal(uses.ingredient_names[curry.id], 'Chicken Curry');

  // Extra Egg uses 2 half-egg units and has no stock of its own: 9 units -> 4 sellable
  const extra = byName(rows, 'Extra Egg');
  assert.equal(Number(extra.quantity_on_hand), 0, 'it has no inventory row');
  assert.equal(Number(extra.sellable_quantity), 4);
  assert.deepEqual(extra.variants, []);
  assert.deepEqual(extra.stock_uses.product, [{ ingredient_product_id: egg, quantity: 2 }]);

  // BBQ: 1 Stick uses 1, 3 Sticks uses 3 BBQ units of the same 10
  const bbqRow = byName(rows, 'BBQ');
  assert.deepEqual(Object.fromEntries(bbqRow.variants.map((v) => [v.name, Number(v.sellable_quantity)])), { '1 Stick': 10, '3 Sticks': 3 });
  assert.equal(Number(bbqRow.sellable_quantity), 10);

  // products without a recipe are exactly as before: sellable = their own stock, one line of themselves
  for (const [name, stock] of [['Soda', 4], ['Rice', 6], ['Egg', 9]]) {
    const r = byName(rows, name);
    assert.equal(Number(r.sellable_quantity), stock, name);
    assert.equal(Number(r.quantity_on_hand), stock, name);
    assert.deepEqual(r.stock_uses.product, [{ ingredient_product_id: r.product_id, quantity: 1 }], name);
    assert.deepEqual(numbers(r.stock_uses.ingredient_stock), { [r.product_id]: stock }, name);
  }
  const plain = byName(rows, 'Plain Meal');
  assert.equal(Number(plain.sellable_quantity), 7, 'variants without recipes share the product pool');
  assert.deepEqual(Object.fromEntries(plain.variants.map((v) => [v.name, Number(v.sellable_quantity)])), { Regular: 7, Large: 7 });
  assert.equal(rows.length, 7, 'same rows as before: one per active catalog product');
  // the row order and the existing columns are unchanged
  assert.deepEqual(rows.map((r) => r.product_name), [...rows.map((r) => r.product_name)].sort((a, b) => a.localeCompare(b)));
  for (const col of ['branch_id', 'branch_name', 'product_id', 'product_name', 'product_sku', 'selling_price', 'quantity_on_hand', 'updated_at', 'variants', 'inventory_mode']) assert.ok(col in rows[0], col);
  // variants keep id / name / selling_price (+ sellable_quantity) in the master order
  assert.deepEqual(curryRow.variants.map((v) => v.name), ['Viand Only', 'With Rice']);
  assert.deepEqual(Object.keys(curryRow.variants[0]).sort(), ['id', 'name', 'sellable_quantity', 'selling_price']);
  console.log('list_cashier_pos_inventory: ok');
}

// ---------------------------------------------------------------- 3. mapping edge cases (same rules as confirm_sale)
{
  // case-insensitive name pairing, a branch-only option, and an ambiguous option
  const pares = await createProduct('Pares', 'PARES-P4', [['Regular', '90.00']], [
    { variant_name: 'Regular', ingredient_product_id: 'self', quantity: 1 },
    { variant_name: 'Regular', ingredient_product_id: rice, quantity: 2 },
    { ingredient_product_id: 'self', quantity: 1 }, // product-level default
    { ingredient_product_id: egg, quantity: 1 },
  ]);
  await db.exec(`
    set session_replication_role = replica; update public.products set is_active = true where id='${pares.id}'; reset session_replication_role;
    insert into public.branch_inventory(branch_id,product_id,quantity_on_hand) values ('${booth}','${pares.id}',8);
    update public.branch_product_variants set name='REGULAR' where branch_id='${booth}' and product_id='${pares.id}' and name='Regular';
    insert into public.branch_product_variants(branch_id,product_id,name,selling_price,is_active) values ('${booth}','${pares.id}','Booth Special',99,true);
    insert into public.product_variants(product_id,name,default_price,is_active,sort_order) values ('${pares.id}','Mega',120,true,10),('${pares.id}','MEGA',130,true,11);
    insert into public.branch_product_variants(branch_id,product_id,name,selling_price,is_active) values ('${booth}','${pares.id}','mega',125,true);
  `);
  const row = byName(await listRows(), 'Pares');
  const v = Object.fromEntries(row.variants.map((x) => [x.name, x]));
  const sellable = (name) => Number(v[name].sellable_quantity);
  assert.equal(sellable('REGULAR'), 3, "'REGULAR' (branch) pairs with 'Regular' (master): min(8, rice 6 / 2 = 3, egg none) -> 3");
  assert.equal(sellable('Booth Special'), 8, 'no master counterpart: the product-level lines (Pares x1 + Egg x1) apply, never Regular\'s recipe... limited by egg 9 and pares 8');
  assert.equal(sellable('mega'), 0, 'ambiguous (two master variants match): unsellable, exactly as confirm_sale refuses it');
  const uses = row.stock_uses;
  assert.equal(uses.variants[v.mega.id], null, 'ambiguous option has no recipe');
  assert.deepEqual(uses.variants[v['Booth Special'].id].map((l) => l.quantity).sort(), [1, 1], 'fell back to the product-level lines');
  // the client treats a null recipe as "cannot be sold"
  const ctx = buildStockContext([toItem(row)]);
  assert.equal(linesFor(ctx, pares.id, v.mega.id), null);
  assert.equal(maxAdditional(ctx, [], pares.id, v.mega.id), 0);
  console.log('mapping edge cases: ok');
}

// ---------------------------------------------------------------- 4. access control and helper functions
{
  await asUser(stranger, async () => {
    await assert.rejects(db.query('select * from public.list_cashier_pos_inventory()'), /cashier access/i);
  });
  for (const who of [cashier, mainMgr]) {
    await asUser(who, async () => {
      await assert.rejects(db.query(`select public.pos_effective_stock_lines('${curry.id}', 'With Rice')`), /permission denied/i);
      await assert.rejects(db.query(`select public.pos_lines_sellable('${booth}', '[]'::jsonb)`), /permission denied/i);
    });
  }
  const grants = (await db.query(`select grantee from information_schema.routine_privileges where routine_schema='public' and routine_name='list_cashier_pos_inventory' and privilege_type='EXECUTE' and grantee in ('anon','authenticated','PUBLIC') order by grantee`)).rows.map((r) => r.grantee);
  assert.deepEqual(grants, ['authenticated']);
  console.log('access control: ok');
}

// ---------------------------------------------------------------- 5. client arithmetic on real rows
const items = (await listRows()).map(toItem);
const itemOf = (name) => items.find((i) => i.product.name === name);
const ctx = buildStockContext(items);
const vId = async (product, name) => branchVariantId(product, name);
const cartOf = (lines) => lines.map(([product_id, variant_id, quantity]) => ({ product_id, variant_id, quantity }));
{
  const vRice = await vId(curry.id, 'With Rice');
  const vOnly = await vId(curry.id, 'Viand Only');
  const v1 = await vId(bbq.id, '1 Stick');
  const v3 = await vId(bbq.id, '3 Sticks');

  // Curry With Rice requires Curry, Rice and Egg
  assert.equal(maxAdditional(ctx, [], curry.id, vRice), 6);
  assert.equal(maxAdditional(ctx, cartOf([[curry.id, vRice, 6]]), curry.id, vRice), 0, 'Rice (6) is the limit');
  assert.deepEqual([...cartUsage(ctx, cartOf([[curry.id, vRice, 2]]))].sort(), [[curry.id, 2], [egg, 2], [rice, 2]].sort());
  // Extra Egg uses 2 half-egg units
  assert.equal(maxAdditional(ctx, [], extraEgg.id, null), 4);
  assert.deepEqual([...cartUsage(ctx, cartOf([[extraEgg.id, null, 3]]))], [[egg, 6]]);
  // BBQ 3 Sticks uses 3 BBQ units
  assert.equal(maxAdditional(ctx, [], bbq.id, v3), 3);
  assert.equal(maxAdditional(ctx, [], bbq.id, v1), 10);
  assert.equal(maxAdditional(ctx, cartOf([[bbq.id, v3, 3]]), bbq.id, v1), 1, '3 x 3 = 9 of 10 sticks used');
  assert.equal(maxAdditional(ctx, cartOf([[bbq.id, v3, 3]]), bbq.id, v3), 0);

  // shared stock: Extra Egg, Curry Viand and Curry With Rice all draw on the same 9 Egg units
  const cart = cartOf([[extraEgg.id, null, 3]]); // 6 units
  assert.equal(maxAdditional(ctx, cart, curry.id, vOnly), 3, 'only 3 Egg units left');
  assert.equal(maxAdditional(ctx, cart, curry.id, vRice), 3);
  assert.equal(maxAdditional(ctx, cartOf([[extraEgg.id, null, 3], [curry.id, vOnly, 3]]), curry.id, vRice), 0, 'Egg is gone, so With Rice is blocked too');
  assert.equal(maxAdditional(ctx, cartOf([[extraEgg.id, null, 3], [curry.id, vOnly, 3]]), extraEgg.id, null), 0);
  // per-line caps leave the rest of the cart as it is
  assert.equal(maxLineQuantity(ctx, cartOf([[extraEgg.id, null, 3], [curry.id, vOnly, 1]]), extraEgg.id, null), 4, '9 - 1 = 8 units = 4 Extra Eggs');
  assert.equal(maxLineQuantity(ctx, cartOf([[extraEgg.id, null, 3], [curry.id, vOnly, 1]]), curry.id, vOnly), 3);

  // products without a recipe behave as before: limited by their own stock, variants sharing one pool
  assert.equal(maxAdditional(ctx, [], soda, null), 4);
  const regular = await vId(plainMeal.id, 'Regular');
  const large = await vId(plainMeal.id, 'Large');
  assert.equal(maxAdditional(ctx, cartOf([[plainMeal.id, regular, 5]]), plainMeal.id, large), 2);
  // selling Rice and Egg directly counts against the same stock as the meals that use them
  assert.equal(maxAdditional(ctx, cartOf([[curry.id, vRice, 4]]), rice, null), 2);
  assert.equal(maxAdditional(ctx, cartOf([[curry.id, vRice, 4], [extraEgg.id, null, 2]]), egg, null), 1, '9 - 4 - 4 = 1');

  // an unknown product falls back to the old per-product rule (handled by the cart store); the context just has no entry
  assert.equal(ctx.product.has(id(999)), false);

  // withCartLimits: per-line caps for the list and the sheet; listing/out-of-stock stays with the server value
  const limited = withCartLimits(items, ctx, cartOf([[extraEgg.id, null, 3]]));
  const lc = limited.find((i) => i.product.name === 'Chicken Curry');
  assert.equal(lc.quantity_on_hand, 9, 'unchanged: still the server sellable quantity');
  assert.deepEqual(Object.fromEntries(lc.variants.map((v) => [v.name, v.max_quantity])), { 'Viand Only': 3, 'With Rice': 3 });
  assert.equal(limited.find((i) => i.product.name === 'Extra Egg').max_quantity, 4, 'its own line may still reach 4 (this IS its quantity in the cart)');
  assert.equal(limited.find((i) => i.product.name === 'Soda').max_quantity, 4);

  // the final live check names the scarce ingredient
  const shortages = findShortages(ctx, cartOf([[extraEgg.id, null, 3], [curry.id, vOnly, 4]]));
  assert.deepEqual(shortages.map((s) => [s.name, s.needed, s.available]), [['Egg', 10, 9]]);
  assert.deepEqual(findShortages(ctx, cartOf([[soda, null, 5]])).map((s) => [s.name, s.needed, s.available]), [['Soda', 5, 4]], 'same wording as before for products without a recipe');
  assert.deepEqual(findShortages(ctx, cartOf([[soda, null, 4]])), []);
  console.log('client arithmetic: ok');
}

// ---------------------------------------------------------------- 6. the real cart store
{
  const vRice = await vId(curry.id, 'With Rice');
  const vOnly = await vId(curry.id, 'Viand Only');
  const v1 = await vId(bbq.id, '1 Stick');
  const v3 = await vId(bbq.id, '3 Sticks');
  const store = useCartStore;
  const reset = (withContext = true) => {
    store.setState({ items: [], stockContext: withContext ? ctx : null });
  };
  const qty = (product, variant) => store.getState().items.find((i) => i.product_id === product && i.variant_id === variant)?.quantity ?? 0;
  const row = (name) => itemOf(name);
  const variantOf = (name, vName) => itemOf(name).variants.find((v) => v.name === vName);

  // Extra Egg takes 2 units each: the cart stops at 4 even though the product's own stock is 0
  reset();
  for (let i = 0; i < 6; i++) store.getState().addProduct(row('Extra Egg'), null);
  assert.equal(qty(extraEgg.id, null), 4, 'Extra Egg is limited by Egg stock (9 / 2), not by its own (empty) inventory');

  // a mixed cart can never exceed the shared Egg stock
  reset();
  for (let i = 0; i < 3; i++) store.getState().addProduct(row('Extra Egg'), null); // 6 units
  for (let i = 0; i < 5; i++) store.getState().addProduct(row('Chicken Curry'), variantOf('Chicken Curry', 'Viand Only')); // 3 left
  for (let i = 0; i < 5; i++) store.getState().addProduct(row('Chicken Curry'), variantOf('Chicken Curry', 'With Rice')); // none left
  assert.equal(qty(extraEgg.id, null), 3);
  assert.equal(qty(curry.id, vOnly), 3);
  assert.equal(qty(curry.id, vRice), 0, 'With Rice is blocked once the shared Egg is used');
  assert.deepEqual(findShortages(ctx, store.getState().items), [], 'the cart never exceeds any ingredient');
  // typing a big number is capped to what is left, counting every other line
  store.getState().setProductQuantity(row('Extra Egg'), 99, null);
  assert.equal(qty(extraEgg.id, null), 3 + 0, 'no Egg left for more Extra Egg');
  store.getState().setProductQuantity(row('Chicken Curry'), 99, variantOf('Chicken Curry', 'Viand Only'));
  assert.equal(qty(curry.id, vOnly), 3);
  // freeing Egg frees room for the others
  store.getState().setProductQuantity(row('Extra Egg'), 1, null); // 2 units used by Extra Egg -> 9 - 2 - 3 = 4 left
  store.getState().setProductQuantity(row('Chicken Curry'), 99, variantOf('Chicken Curry', 'With Rice'));
  assert.equal(qty(curry.id, vRice), 4, 'With Rice may use the freed Egg: min(Egg 4, Rice 6, Curry 7)');
  assert.deepEqual(findShortages(ctx, store.getState().items), []);

  // BBQ 3 Sticks uses 3 BBQ units; 1 Stick uses 1
  reset();
  for (let i = 0; i < 5; i++) store.getState().addProduct(row('BBQ'), variantOf('BBQ', '3 Sticks'));
  assert.equal(qty(bbq.id, v3), 3, '3 x 3 = 9 of 10');
  store.getState().addProduct(row('BBQ'), variantOf('BBQ', '1 Stick'));
  store.getState().addProduct(row('BBQ'), variantOf('BBQ', '1 Stick'));
  assert.equal(qty(bbq.id, v1), 1, 'one stick left after 9 used');
  store.getState().setProductQuantity(row('BBQ'), 99, variantOf('BBQ', '1 Stick'));
  assert.equal(qty(bbq.id, v1), 1);

  // products without a recipe: the original behaviour (own stock, variants share one pool)
  reset();
  for (let i = 0; i < 6; i++) store.getState().addProduct(row('Soda'), null);
  assert.equal(qty(soda, null), 4);
  for (let i = 0; i < 5; i++) store.getState().addProduct(row('Plain Meal'), variantOf('Plain Meal', 'Regular'));
  store.getState().setProductQuantity(row('Plain Meal'), 99, variantOf('Plain Meal', 'Large'));
  assert.equal(qty(plainMeal.id, await vId(plainMeal.id, 'Regular')) + qty(plainMeal.id, await vId(plainMeal.id, 'Large')), 7, 'variants share the 7-unit pool');

  // with no context loaded the store behaves exactly as it always did
  reset(false);
  for (let i = 0; i < 6; i++) store.getState().addProduct({ product: row('Soda').product, quantity_on_hand: 4 }, null);
  assert.equal(qty(soda, null), 4);
  store.getState().setProductQuantity({ product: row('Soda').product, quantity_on_hand: 4 }, 99, null);
  assert.equal(qty(soda, null), 4);
  console.log('cart store: ok');
}

// ---------------------------------------------------------------- 7. the client's limits and confirm_sale agree
{
  const vRice = await vId(curry.id, 'With Rice');
  const vOnly = await vId(curry.id, 'Viand Only');
  const v3 = await vId(bbq.id, '3 Sticks');
  const shiftId = (await asUser(cashier, () => db.query('select public.start_cashier_shift() id'))).rows[0].id;
  let keyN = 0;
  const sell = (lines) =>
    asUser(cashier, () => db.query(`select (public.confirm_sale($1,$2::jsonb,'100000',$3,'standard')).*`, [shiftId, J(lines.map(([product_id, variant_id, quantity]) => ({ product_id, variant_id, quantity }))), `p4-agree-${String(++keyN).padStart(10, '0')}-key`])).then((r) => r.rows[0]);
  const stock = async () => Object.fromEntries((await db.query(`select p.name, bi.quantity_on_hand::numeric q from public.branch_inventory bi join public.products p on p.id=bi.product_id where bi.branch_id='${booth}'`)).rows.map((r) => [r.name, Number(r.q)]));

  // build the largest mixed cart the client allows, using the real cart store
  const store = useCartStore;
  store.setState({ items: [], stockContext: ctx });
  const add = (name, vName, times) => {
    for (let i = 0; i < times; i++) store.getState().addProduct(itemOf(name), vName ? itemOf(name).variants.find((v) => v.name === vName) : null);
  };
  add('Extra Egg', null, 4); // 8 Egg units
  add('Chicken Curry', 'Viand Only', 3); // wants 3 more, only 1 fits
  add('Chicken Curry', 'With Rice', 3); // nothing fits
  add('BBQ', '3 Sticks', 4); // 3 fit
  add('BBQ', '1 Stick', 4); // 1 fits
  const cart = store.getState().items.map((i) => [i.product_id, i.variant_id, i.quantity]);
  assert.deepEqual(
    Object.fromEntries(store.getState().items.map((i) => [`${i.product_name}${i.variant_name ? ' / ' + i.variant_name : ''}`, i.quantity])),
    { 'Extra Egg': 4, 'Chicken Curry / Viand Only': 1, 'BBQ / 3 Sticks': 3, 'BBQ / 1 Stick': 1 },
  );

  // 1) confirm_sale accepts exactly that cart
  const before = await stock();
  const sale = await sell(cart);
  assert.ok(sale.id, 'the largest cart the client allows is accepted');
  const after = await stock();
  assert.deepEqual(
    Object.fromEntries(Object.keys(after).map((k) => [k, after[k] - before[k]]).filter(([, d]) => d !== 0)),
    { Egg: -9, 'Chicken Curry': -1, BBQ: -10 },
    'Egg 4 x 2 + 1 = 9, Curry 1, BBQ 3 x 3 + 1 = 10: the server deducts exactly what the client counted',
  );

  // 2) ... and rejects one more unit of a shared ingredient, for every kind of line
  await db.exec(`update public.branch_inventory set quantity_on_hand = 9 where branch_id='${booth}' and product_id='${egg}';
                 update public.branch_inventory set quantity_on_hand = 10 where branch_id='${booth}' and product_id in ('${curry.id}','${bbq.id}');
                 update public.branch_inventory set quantity_on_hand = 6 where branch_id='${booth}' and product_id='${rice}'`);
  const fresh = (await listRows()).map(toItem);
  const ctx2 = buildStockContext(fresh);
  const overs = [
    [[extraEgg.id, null, 4], [curry.id, vOnly, 2]], // Egg: 8 + 2 = 10 > 9
    [[extraEgg.id, null, 5]], // Egg: 10 > 9
    [[curry.id, vRice, 7]], // Rice 7 > 6
    [[bbq.id, v3, 4]], // BBQ 12 > 10
    [[extraEgg.id, null, 3], [curry.id, vOnly, 2], [curry.id, vRice, 2]], // Egg 6 + 2 + 2 = 10 > 9
  ];
  for (const lines of overs) {
    const asCart = lines.map(([product_id, variant_id, quantity]) => ({ product_id, variant_id, quantity }));
    assert.ok(findShortages(ctx2, asCart).length > 0, 'the client flags this cart');
    const c0 = Number((await db.query('select count(*)::int n from public.sales')).rows[0].n);
    await assert.rejects(sell(lines), /Insufficient stock/, 'confirm_sale refuses it');
    assert.equal(Number((await db.query('select count(*)::int n from public.sales')).rows[0].n), c0, 'nothing was written');
  }
  // the largest carts the client allows are all accepted (it never blocks something the server would take)
  for (const lines of [[[extraEgg.id, null, 4], [curry.id, vOnly, 1]], [[curry.id, vRice, 6]], [[bbq.id, v3, 3], [bbq.id, await vId(bbq.id, '1 Stick'), 1]], [[extraEgg.id, null, 2], [curry.id, vOnly, 2], [curry.id, vRice, 3]]]) {
    const asCart = lines.map(([product_id, variant_id, quantity]) => ({ product_id, variant_id, quantity }));
    assert.deepEqual(findShortages(ctx2, asCart), [], 'the client allows this cart');
    await sell(lines);
    await db.exec(`update public.branch_inventory set quantity_on_hand = 9 where branch_id='${booth}' and product_id='${egg}';
                   update public.branch_inventory set quantity_on_hand = 10 where branch_id='${booth}' and product_id in ('${curry.id}','${bbq.id}');
                   update public.branch_inventory set quantity_on_hand = 6 where branch_id='${booth}' and product_id='${rice}'`);
  }
  console.log('client limits agree with confirm_sale: ok');
}

console.log('pos_shared_inventory: ALL PASS');
