// Branch Catalogs: the rows, prices and status badges must agree with what the backend really does. Rows are built with the
// real client module from the rows the Main Branch Manager can read, then compared with the cashier POS list at the same
// branch. Real RPCs and policies on PGlite (Postgres WASM, not a native PostgreSQL). Not a rendered / device test.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { loadTs } from './_load_ts.mjs';
import { textWidth } from './_font_metrics.mjs';

const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const { buildCatalogRows, formatPriceRange, catalogSummary, posLines, catalogEmptyState } = loadTs('src/features/products/branchCatalogRows.ts');

// ---------------------------------------------------------------- 1. pure: price text, summary, empty state
{
  assert.equal(formatPriceRange(20, 20), '₱20.00');
  assert.equal(formatPriceRange(70, 85), '₱70–₱85', 'whole pesos are shortened');
  assert.equal(formatPriceRange(20.5, 35), '₱20.50–₱35.00', 'with centavos both ends keep them');
  assert.equal(catalogEmptyState('SM1', false).title, 'Nothing listed at SM1');
  assert.doesNotMatch(JSON.stringify(catalogEmptyState('SM1', false)), /available/i, 'a listing is not availability');
  assert.match(catalogEmptyState('SM1', false).message, /price at this branch, or once stock of a priced product that is sold in POS is sent to it/);
  assert.doesNotMatch(JSON.stringify(catalogEmptyState('SM1', false)), /sellable/i);
  assert.deepEqual(catalogEmptyState('SM1', true), { title: 'No matches', message: 'Try another name or SKU.' });
  console.log('1. wording and price text: ok');
}

// ---------------------------------------------------------------- 2. the backend
const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth; create table auth.users(id uuid primary key, email text);
  create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public, auth to authenticated; grant execute on function auth.uid() to authenticated;
`);
for (const f of readdirSync('supabase/migrations').filter((n) => n.endsWith('.sql')).sort()) await db.exec(read(`supabase/migrations/${f}`).replace(/create extension if not exists pgcrypto;/g, ''));
const id = (n) => `80000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const [owner, mgr, cash1, cash2, main, sm1, sm2] = [id(1), id(2), id(4), id(5), id(10), id(11), id(12)];
const J = JSON.stringify;
const as = async (u, w) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${u}',false);`);
  try {
    return await w();
  } finally {
    await db.exec('reset role');
  }
};
await db.exec(`
  insert into auth.users values ('${owner}','o@t'),('${mgr}','m@t'),('${cash1}','c1@t'),('${cash2}','c2@t');
  insert into public.branches(id,name,code,is_main_branch,is_active,receiving_mode) values
    ('${main}','Main','MAIN-BC',true,true,'counted'),('${sm1}','SM1','SM1-BC',false,true,'cashier_confirm'),('${sm2}','SM2','SM2-BC',false,true,'cashier_confirm');
  insert into public.profiles(id,full_name,role,branch_id) values
    ('${owner}','Owner','owner',null),('${mgr}','Main Mgr','manager','${main}'),('${cash1}','C1','cashier','${sm1}'),('${cash2}','C2','cashier','${sm2}');
`);
const create = (name, sku, { price = '20.00', branches = [sm1], variants = [] } = {}) =>
  as(mgr, () =>
    db.query(
      `select * from public.create_complete_product(p_name := $1, p_sku := $2, p_description := null, p_variants := $3::jsonb, p_branches := $4::jsonb, p_selling_price := $5)`,
      [
        name,
        sku,
        J(variants.map(([n, p]) => ({ name: n, default_price: p }))),
        J(branches.map((b) => (variants.length ? { branch_id: b, variants: variants.map(([n, p]) => ({ name: n, selling_price: p })) } : { branch_id: b, selling_price: price }))),
        variants.length ? null : price,
      ],
    ),
  ).then((r) => r.rows[0]);
const enable = (p) => as(mgr, () => db.query('select public.set_product_status($1,true)', [p.id]));

const fries = await create('Fries', 'FRIES-BC', { branches: [sm1, sm2] });
const curry = await create('Beef Curry', 'CURRY-BC', { variants: [['Viand Only', '70.00'], ['With Rice', '85.00']] });
const combo = await create('Combo', 'COMBO-BC', { variants: [['Small', '30.00'], ['Large', '50.50'], ['Jumbo', '60.00']] });
const cents = await create('Tea', 'TEA-BC', { price: '20.50' });
const disabled = await create('Disabled Soup', 'SOUP-BC');
const becomesStockOnly = await create('Becomes Stock Only', 'BSO-BC');
const rowOff = await create('Row Off', 'ROWOFF-BC');
const allOff = await create('All Off', 'ALLOFF-BC', { variants: [['One', '10.00'], ['Two', '12.00']] });
const noRows = await create('No Rows', 'NOROWS-BC', { variants: [['A', '15.00'], ['B', '18.00']] });
const stockOnlyNew = (await as(mgr, () => db.query(`select * from public.create_inventory_product('Rice','RICE-BC',null,'keep_at_branch')`))).rows[0];
for (const p of [fries, curry, combo, cents, becomesStockOnly, rowOff, allOff, noRows, stockOnlyNew]) await enable(p); // 'disabled' stays disabled
await as(mgr, () => db.query('select public.set_product_sell_in_pos($1,false)', [becomesStockOnly.id]));
await as(mgr, () => db.query('select public.configure_branch_products($1,$2::jsonb)', [sm1, J([{ product_id: rowOff.id, selling_price: '20.00', is_active: false }])]));
await as(mgr, () => db.query('select public.configure_branch_product_variants($1,$2,$3::jsonb)', [sm1, combo.id, J([{ name: 'Small', selling_price: '30.00', is_active: true }, { name: 'Large', selling_price: '50.50', is_active: false }, { name: 'Jumbo', selling_price: '60.00', is_active: true }])]));
await as(mgr, () => db.query('select public.configure_branch_product_variants($1,$2,$3::jsonb)', [sm1, allOff.id, J([{ name: 'One', selling_price: '10.00', is_active: false }, { name: 'Two', selling_price: '12.00', is_active: false }])]));
// SM2 carries No Rows WITHOUT any option rows (the product has master options, the branch has none)
await as(mgr, () => db.query('select public.configure_branch_products($1,$2::jsonb)', [sm2, J([{ product_id: noRows.id, selling_price: '15.00', is_active: true }])]));
// stock for Fries and All Off at SM1, so the POS has something to show
await as(mgr, () => db.query(`select public.initialize_main_branch_inventory($1::jsonb,'open')`, [J([{ product_id: fries.id, quantity: 50 }, { product_id: allOff.id, quantity: 50 }])]));
const transfer = (await as(mgr, () => db.query('select public.send_stock_transfer($1,$2::jsonb,null,$3) id', [sm1, J([{ product_id: fries.id, quantity_sent: 10, destination_price: 20 }, { product_id: allOff.id, quantity_sent: 10, destination_price: 10 }]), 'bc-send-00000000000001']))).rows[0].id;
await as(cash1, () => db.query('select public.confirm_shipment_arrival($1,$2)', [transfer, 'bc-arrive-0000000000001']));

// what the screen reads, as the Main Branch Manager
const readFor = async (branch) => ({
  products: (await as(mgr, () => db.query('select * from public.products'))).rows,
  entries: (await as(mgr, () => db.query('select * from public.branch_products where branch_id=$1', [branch]))).rows,
  variants: (await as(mgr, () => db.query('select * from public.branch_product_variants where branch_id=$1', [branch]))).rows,
  // what useProductIdsWithOptions reads: every product with any master option
  withOptions: (await as(mgr, () => db.query('select distinct product_id from public.product_variants'))).rows.map((r) => r.product_id),
});
const rowsFor = async (branch) => {
  const data = await readFor(branch);
  return buildCatalogRows(data.products, data.entries, data.variants, data.withOptions);
};
const posFor = async (cashier) => (await as(cashier, () => db.query('select * from public.list_cashier_pos_inventory()'))).rows;

// ---------------------------------------------------------------- 3. which products are listed (unchanged rule)
const sm1Rows = await rowsFor(sm1);
const names = (rows) => rows.map((r) => r.product.name).sort();
assert.deepEqual(names(sm1Rows), ['All Off', 'Becomes Stock Only', 'Beef Curry', 'Combo', 'Disabled Soup', 'Fries', 'No Rows', 'Tea'], 'SM1: every product with a switched-on SM1 row, enabled or not');
assert.deepEqual(names(await rowsFor(sm2)), ['Fries', 'No Rows'], 'SM2: only what has an SM2 row');
assert.ok(!names(sm1Rows).includes('Row Off') && !names(sm1Rows).includes('Rice'), 'a switched-off row and a product with no row stay out');
console.log('3. listing rule: ok');

// ---------------------------------------------------------------- 4. status badges agree with the cashier POS
{
  const pos = await posFor(cash1);
  const inPos = new Set(pos.map((p) => p.product_name));
  for (const row of sm1Rows) {
    assert.equal(row.inPos, inPos.has(row.product.name), `${row.product.name}: inPos (${row.inPos}) must equal "the cashier POS lists it" (${inPos.has(row.product.name)})`);
  }
  const by = Object.fromEntries(sm1Rows.map((r) => [r.product.name, r]));
  assert.deepEqual(by['Disabled Soup'].badges.map((b) => b.label), ['Disabled']);
  assert.deepEqual(by['Becomes Stock Only'].badges.map((b) => b.label), ['Stock only']);
  assert.deepEqual(by.Fries.badges, [], 'a normal product carries no badge');
  assert.deepEqual(by.Combo.badges.map((b) => b.label), ['1 option off']);
  assert.equal(by.Fries.inPos && !by['Disabled Soup'].inPos && !by['Becomes Stock Only'].inPos, true);
  assert.equal(catalogSummary(sm1Rows, 'SM1'), '8 products listed at SM1 · 3 not in POS');
  assert.deepEqual(posLines(by['Disabled Soup'], 'SM1'), ['The product is disabled, so it is not in the cashier POS.']);
  assert.deepEqual(posLines(by['Becomes Stock Only'], 'SM1'), ['It is stock only, so it is not in the cashier POS.']);
  // "in POS" is menu visibility only, and the details say so
  assert.deepEqual(posLines(by.Fries, 'SM1'), ['In the cashier POS at SM1. That does not guarantee enough stock or recipe ingredients: the POS shows "Out of stock" when it runs short.']);
  assert.doesNotMatch(JSON.stringify(posLines(by.Fries, 'SM1')), /can sell/i, 'never promises a sale');
  // every option off: since migration 20261026100000 the backend does NOT list it and refuses checkout (no base-price fallback),
  // and the screen says the same: not in POS, no price pretended, and a reason in the details
  const allOffRow = by['All Off'];
  assert.deepEqual(allOffRow.badges.map((b) => b.label), ['All options off']);
  assert.equal(allOffRow.inPos, false);
  assert.equal(allOffRow.noActiveOption, true);
  assert.equal(allOffRow.priceText, 'No active option', 'the stored base price is not shown for a product that cannot be sold');
  assert.ok(allOffRow.lowPrice > by.Fries.lowPrice && allOffRow.lowPrice > by.Tea.lowPrice, 'sorts after every priced product');
  assert.deepEqual(posLines(allOffRow, 'SM1'), ['Every option is off at SM1, so it is not in the cashier POS and cannot be sold until one is turned on.']);
  assert.ok(!inPos.has('All Off'), 'backend: not on the cashier menu');
  const shift = (await as(cash1, () => db.query('select public.start_cashier_shift() id'))).rows[0].id;
  await assert.rejects(
    as(cash1, () => db.query('select (public.confirm_sale($1,$2::jsonb,$3,$4,$5)).*', [shift, J([{ product_id: allOff.id, variant_id: null, quantity: 1 }]), '1000', 'bc-sale-000000000000001', 'standard'])),
    /No option of "All Off" is available at this branch\./,
    'backend: checkout refused',
  );
  // partly off is still in POS, with the active range
  assert.equal(by.Combo.inPos, true);
  assert.equal(by.Combo.noActiveOption, false);

  // options configured but NONE set up at this branch (SM2): the same answer as the backend
  const sm2Rows = await rowsFor(sm2);
  const noRowsRow = sm2Rows.find((r) => r.product.name === 'No Rows');
  const sm2Pos = await posFor(cash2);
  assert.ok(!sm2Pos.some((r) => r.product_name === 'No Rows'), 'backend: not on the SM2 menu');
  assert.equal(noRowsRow.inPos, false);
  assert.deepEqual(noRowsRow.badges.map((b) => b.label), ['No options here']);
  assert.equal(noRowsRow.priceText, 'No active option');
  assert.deepEqual(posLines(noRowsRow, 'SM2'), ['It has options, but none are set up at SM2, so it is not in the cashier POS and cannot be sold until one is.']);
  for (const row of sm2Rows) assert.equal(row.inPos, sm2Pos.some((r) => r.product_name === row.product.name), `SM2 ${row.product.name}: inPos matches the POS`);
  // without the list of products that have options, that state cannot be told from a single-price product: this is why the
  // screen reads it
  const data2 = await readFor(sm2);
  assert.equal(buildCatalogRows(data2.products, data2.entries, data2.variants).find((r) => r.product.name === 'No Rows').inPos, true, 'without the master-options list it would wrongly look single-price');
  console.log('4. status badges = POS rules: ok');
}

// ---------------------------------------------------------------- 5. prices: single, range, options off
{
  const by = Object.fromEntries(sm1Rows.map((r) => [r.product.name, r]));
  assert.equal(by.Fries.priceText, '₱20.00');
  assert.equal(by.Tea.priceText, '₱20.50');
  assert.equal(by['Beef Curry'].priceText, '₱70–₱85', 'options with different prices show the range, not just the first price');
  assert.equal(by['Beef Curry'].options.length, 2);
  // an option that is off is not part of the range (Large 50.50 is off: 30 to 60 remain)
  assert.equal(by.Combo.priceText, '₱30–₱60');
  assert.deepEqual(by.Combo.options.map((o) => [o.name, o.active]), [['Jumbo', true], ['Large', false], ['Small', true]]);
  // the POS shows the same options and prices for what is sellable
  const pos = Object.fromEntries((await posFor(cash1)).map((p) => [p.product_name, p]));
  const posPrices = (name) => pos[name].variants.map((v) => Number(v.selling_price)).sort((a, b) => a - b);
  assert.deepEqual(posPrices('Beef Curry'), [70, 85], 'POS: the same two prices');
  assert.deepEqual(by['Beef Curry'].options.map((o) => o.price).sort((a, b) => a - b), [70, 85]);
  assert.deepEqual(posPrices('Combo'), [30, 60], 'POS: the off option is not offered');
  assert.deepEqual(by.Combo.options.filter((o) => o.active).map((o) => o.price).sort((a, b) => a - b), [30, 60]);
  // sorting key
  assert.equal(by['Beef Curry'].lowPrice, 70);
  // SM2 has its own price rows
  assert.equal((await rowsFor(sm2)).find((r) => r.product.name === 'Fries').priceText, '₱20.00');
  console.log('5. prices: ok');
}

// ---------------------------------------------------------------- 6. what this role cannot read: another branch's stock
// The screen is for the Main Branch Manager. The stock table's policy lets the owner, a branch's own manager and an on-shift
// cashier read a branch's balances, not the Main manager, so this screen cannot show or judge branch stock ("out of stock").
{
  const stockRows = async (user) => (await as(user, () => db.query('select product_id from public.branch_inventory where branch_id=$1', [sm1]))).rows.length;
  assert.ok((await stockRows(owner)) > 0, 'the owner can read SM1 stock');
  assert.equal(await stockRows(mgr), 0, 'the Main Branch Manager gets no rows for SM1 stock, so there is nothing truthful to show');
  // the other reads the screen needs ARE allowed
  assert.ok((await readFor(sm1)).variants.length > 0, 'option rows are readable');
  console.log('6. stock is not readable by this role (so it is not shown): ok');
}

// ---------------------------------------------------------------- 7. the screen
{
  const screen = read('app/(manager)/manager/catalog.tsx');
  const hook = read('src/hooks/useBranchProducts.ts');
  const service = read('src/services/branchProductService.ts');
  // unchanged: branch chips, search, sort, paging, access
  assert.match(screen, /<MainBranchGuard>/);
  assert.match(screen, /sellingBranches\.map\(\(branch\) => \(\{/);
  assert.match(screen, /useClientPagination\(visibleRows, `\$\{branchId\}\|\$\{search\}\|\$\{sort\}`, 10\)/);
  assert.match(screen, /case 'price-asc':\s+return a\.lowPrice - b\.lowPrice;/);
  assert.match(screen, /buildCatalogRows\(products\.data \?\? \[\], catalog\.data \?\? \[\], branchVariants\.data \?\? \[\], productIdsWithOptions\.data \?\? \[\]\)/, 'the listing rule lives in one tested function');
  assert.match(read('src/hooks/useProducts.ts'), /queryKey: \['product-variants', 'with-options'\]/, 'refreshed by the existing product-save invalidation');
  assert.match(read('src/services/productService.ts'), /from\('product_variants'\)\.select\('product_id'\)/);
  // wording
  assert.doesNotMatch(screen, /No available products|available here/);
  assert.match(screen, /catalogEmptyState\(branchName, Boolean\(search\.trim\(\)\)\)/);
  assert.match(screen, /Listed means priced at this branch\. "In POS" means it is on the cashier menu, which does not guarantee stock or recipe ingredients\./);
  assert.doesNotMatch(screen + read('src/features/products/branchCatalogRows.ts'), /sellable|can sell it|Sellab/i, 'no "sellable" wording is left');
  assert.match(screen, /label: 'Cashier menu', value: row\.inPos \? 'In POS' : 'Not in POS'/);
  assert.match(screen, /row\.inPos \? 'in POS' : 'not in POS'/, 'the spoken card says it');
  assert.match(screen, /Stock levels are not shown here\./);
  // cards: one tappable control with a spoken description, the real price, blockers as badges
  assert.match(screen, /accessibilityRole="button"\s+accessibilityLabel=\{spokenCard\(item, branchName\)\}\s+accessibilityHint="Opens branch details"/);
  assert.match(screen, /\{item\.priceText\}/);
  assert.match(screen, /<ManagerBadge key=\{badge\.key\} label=\{badge\.label\} tone=\{badge\.tone\} \/>/);
  // a read-only details sheet: no edit, no navigation to a management screen
  assert.match(screen, /Read only\. Change prices and product settings in Products\./);
  assert.doesNotMatch(screen, /router\.push|setEditProduct|configureBranch/, 'no management actions here');
  // the extra read is one bulk query, refreshed when a product is saved (that invalidates the whole prefix)
  assert.match(service, /export async function listBranchVariantsForBranch\(branchId: string\)/);
  assert.match(hook, /queryKey: \['branch-product-variants', branchId, 'all'\]/);
  assert.match(read('src/hooks/useProducts.ts'), /invalidateQueries\(\{ queryKey: \['branch-product-variants'\] \}\)/);
  console.log('7. screen wiring: ok');
}

// ---------------------------------------------------------------- 8. small screens: the widest price leaves room for the name
{
  const card = (w) => w - 2 * 20 - 2 * (14 + 1); // column padding, card padding + border
  const common = Math.max(...['₱70–₱85', '₱20.50–₱35.00'].map((t) => textWidth(t, 'Inter_700Bold', 15)));
  const extreme = textWidth('₱120.00–₱250.00', 'Inter_700Bold', 15);
  for (const w of [320, 360, 393, 411]) {
    const room = (price) => card(w) - 22 - 2 * 12 - price;
    assert.ok(room(common) >= 80,`at ${w}dp the name keeps ${room(common).toFixed(0)}dp beside a common price range`);
    // a three-digit range with centavos on both ends is the extreme: the name still gets about 70dp and wraps to two lines
    assert.ok(room(extreme) >= 65, `at ${w}dp the name keeps ${room(extreme).toFixed(0)}dp beside the widest range`);
  }
  const screen = read('app/(manager)/manager/catalog.tsx');
  assert.match(screen, /badges: { flexDirection: 'row', flexWrap: 'wrap'/, 'badges wrap onto the next line');
  assert.match(screen, /priceValue: {[^}]*flexShrink: 0/, 'the price is never squeezed');
  assert.match(screen, /name: { flex: 1,/, 'the name takes what is left and wraps (two lines)');
  console.log('8. widths: ok');
}

console.log('branch_catalog_ui: ALL PASS');
