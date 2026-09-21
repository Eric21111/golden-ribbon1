import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

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

for (const file of readdirSync('supabase/migrations').filter((file) => file.endsWith('.sql')).sort()) {
  await db.exec(
    readFileSync(`supabase/migrations/${file}`, 'utf8').replace(
      /create extension if not exists pgcrypto;/g,
      '',
    ),
  );
}

const id = (n) => `13000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1);
const mainManager = id(2);
const manager1 = id(3);
const manager2 = id(4);
const cashier1 = id(5);
const cashier2 = id(6);
const main = id(10);
const branch1 = id(11);
const branch2 = id(12);
const caldereta = id(20); // has variants: With Rice / Without Rice
const singlePriceProduct = id(21); // no variants, single-price
const newProduct = id(22); // introduced to Branch 2 purely via transfer

await db.exec(`
  insert into auth.users values
    ('${owner}','owner@test'),
    ('${mainManager}','main-manager@test'),
    ('${manager1}','manager-1@test'),
    ('${manager2}','manager-2@test'),
    ('${cashier1}','cashier-1@test'),
    ('${cashier2}','cashier-2@test');

  insert into public.branches(id,name,code,is_main_branch,is_active) values
    ('${main}','Main Branch','MAIN122',true,true),
    ('${branch1}','Branch 1','B1-122',false,true),
    ('${branch2}','Branch 2','B2-122',false,true);

  insert into public.profiles(id,full_name,role,branch_id) values
    ('${owner}','Owner','owner',null),
    ('${mainManager}','Main Manager','manager','${main}'),
    ('${manager1}','Manager 1','manager','${branch1}'),
    ('${manager2}','Manager 2','manager','${branch2}'),
    ('${cashier1}','Cashier 1','cashier','${branch1}'),
    ('${cashier2}','Cashier 2','cashier','${branch2}');

  insert into public.products(id,name,sku,selling_price,is_active) values
    ('${caldereta}','Chicken Caldereta','CALD122',75,true),
    ('${singlePriceProduct}','Fried Chicken','FRIED122',60,true),
    ('${newProduct}','Beef Tapa','TAPA122',95,true);
`);

const asUser = async (userId, fn) => {
  await db.exec(
    `set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false);`,
  );
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
  }
};

const configureProducts = (branchId, items) =>
  db.query('select public.configure_branch_products($1,$2::jsonb)', [
    branchId,
    JSON.stringify(items),
  ]);

const configureVariants = (branchId, productId, variants) =>
  db.query('select public.configure_branch_product_variants($1,$2,$3::jsonb)', [
    branchId,
    productId,
    JSON.stringify(variants),
  ]);

const sendTransfer = (toBranchId, items, key) =>
  db.query('select public.send_stock_transfer($1,$2::jsonb,null,$3) id', [
    toBranchId,
    JSON.stringify(items),
    key,
  ]);

const receiveTransfer = async (transferId, _receivedByLine, key) => {
  // Selling branches use cashier confirmation only.
  return db.query('select public.confirm_shipment_arrival($1,$2) status', [transferId, key]);
};

// ----------------------------------------------------------------------------
// Setup: Main Branch opening stock, Branch 1 catalog + variants configured
// the traditional way (pre-existing catalog, as it would be before M12.2).
// ----------------------------------------------------------------------------

const shifts = {};

await asUser(mainManager, async () => {
  await db.query(
    `select public.initialize_main_branch_inventory(
      '[{"product_id":"${caldereta}","quantity":120},{"product_id":"${singlePriceProduct}","quantity":50},{"product_id":"${newProduct}","quantity":30}]'::jsonb,
      'm12.2 opening stock'
    )`,
  );
  await configureProducts(branch1, [
    { product_id: caldereta, selling_price: 75, is_active: true },
    { product_id: singlePriceProduct, selling_price: 60, is_active: true },
  ]);
  await configureVariants(branch1, caldereta, [
    { name: 'With Rice', selling_price: 88, is_active: true },
    { name: 'Without Rice', selling_price: 60, is_active: true },
  ]);

  shifts.setupTransferId = (
    await sendTransfer(
      branch1,
      [
        { product_id: caldereta, quantity_sent: 100 },
        { product_id: singlePriceProduct, quantity_sent: 50 },
      ],
      'm122-setup-branch1-send01',
    )
  ).rows[0].id;
});

await asUser(cashier1, async () => {
  await receiveTransfer(
    shifts.setupTransferId,
    { [caldereta]: 100, [singlePriceProduct]: 50 },
    'm122-setup-branch1-recv01',
  );
});

// ----------------------------------------------------------------------------
// A1. Only Main Branch Manager can configure variants; cross-role denials.
// ----------------------------------------------------------------------------

await asUser(owner, async () => {
  await assert.rejects(
    configureVariants(branch1, caldereta, [{ name: 'Hacked', selling_price: 1, is_active: true }]),
    /Main Branch Manager/,
  );
});
await asUser(manager1, async () => {
  await assert.rejects(
    configureVariants(branch1, caldereta, [{ name: 'Hacked', selling_price: 1, is_active: true }]),
    /Main Branch Manager/,
  );
  await assert.rejects(
    db.exec(`update public.branch_product_variants set selling_price=1 where branch_id='${branch1}'`),
    /permission denied/,
  );
});
await asUser(cashier1, async () => {
  const rows = (await db.query('select * from public.branch_product_variants')).rows;
  assert.equal(rows.length, 0, 'cashiers cannot read branch variant pricing directly (RLS-hidden)');
  await assert.rejects(
    db.exec(`update public.branch_product_variants set selling_price=1 where branch_id='${branch1}'`),
    /permission denied/,
  );
});

// ----------------------------------------------------------------------------
// A2. Single-price products still work exactly as before (no variant supplied).
// ----------------------------------------------------------------------------

await asUser(cashier1, async () => {
  shifts.branch1 = (await db.query('select public.start_cashier_shift() id')).rows[0].id;

  const pos = (await db.query('select * from public.list_cashier_pos_inventory()')).rows;
  const friedRow = pos.find((row) => row.product_id === singlePriceProduct);
  assert.ok(friedRow, 'single-price product is listed');
  const friedVariants = typeof friedRow.variants === 'string' ? JSON.parse(friedRow.variants) : friedRow.variants;
  assert.deepEqual(friedVariants, [], 'single-price product has no variants');

  const singleSale = (
    await db.query(
      'select (public.confirm_sale($1,$2::jsonb,$3,$4)).*',
      [shifts.branch1, JSON.stringify([{ product_id: singlePriceProduct, quantity: 2 }]), '200.00', 'm122-single-sale-key01'],
    )
  ).rows[0];
  assert.equal(Number(singleSale.total_amount), 120, 'single-price product totals unchanged: 2 x 60');
  shifts.singleSaleId = singleSale.id;
});

// ----------------------------------------------------------------------------
// A3. Variant totals/prices are correct; both variants deduct the same base
// stock (2 With Rice + 3 Without Rice against stock 100 -> 95).
// ----------------------------------------------------------------------------

await asUser(cashier1, async () => {
  const pos = (await db.query('select * from public.list_cashier_pos_inventory()')).rows;
  const calderetaRow = pos.find((row) => row.product_id === caldereta);
  const variants = typeof calderetaRow.variants === 'string' ? JSON.parse(calderetaRow.variants) : calderetaRow.variants;
  assert.equal(variants.length, 2, 'caldereta has two variants in the POS listing');
  const withRice = variants.find((v) => v.name === 'With Rice');
  const withoutRice = variants.find((v) => v.name === 'Without Rice');
  assert.equal(Number(withRice.selling_price), 88);
  assert.equal(Number(withoutRice.selling_price), 60);

  const beforeStock = Number(
    (await db.query(`select quantity_on_hand from public.branch_inventory where branch_id='${branch1}' and product_id='${caldereta}'`)).rows[0]
      .quantity_on_hand,
  );

  const variantSale = (
    await db.query(
      'select (public.confirm_sale($1,$2::jsonb,$3,$4)).*',
      [
        shifts.branch1,
        JSON.stringify([
          { product_id: caldereta, variant_id: withRice.id, quantity: 2 },
          { product_id: caldereta, variant_id: withoutRice.id, quantity: 3 },
        ]),
        '500.00',
        'm122-variant-sale-key01',
      ],
    )
  ).rows[0];
  assert.equal(Number(variantSale.total_amount), 2 * 88 + 3 * 60, 'variant totals: 2x88 + 3x60 = 356');
  shifts.variantSaleId = variantSale.id;

  const afterStock = Number(
    (await db.query(`select quantity_on_hand from public.branch_inventory where branch_id='${branch1}' and product_id='${caldereta}'`)).rows[0]
      .quantity_on_hand,
  );
  assert.equal(beforeStock - afterStock, 5, 'both variants deduct the same base product stock (2+3=5)');

  const saleItemRows = (
    await db.query('select variant_id,variant_name,unit_price,quantity from public.sale_items where sale_id=$1 order by unit_price desc', [
      variantSale.id,
    ])
  ).rows;
  assert.equal(saleItemRows.length, 2, 'two sale_items rows: one per variant');
  assert.equal(saleItemRows[0].variant_name, 'With Rice');
  assert.equal(Number(saleItemRows[0].unit_price), 88);
  assert.equal(saleItemRows[1].variant_name, 'Without Rice');
  assert.equal(Number(saleItemRows[1].unit_price), 60);
});

await asUser(owner, async () => {
  const movementCount = Number(
    (
      await db.query(
        `select count(*) n from public.inventory_movements where reference_type='sale' and reference_id=$1 and product_id=$2`,
        [shifts.variantSaleId, caldereta],
      )
    ).rows[0].n,
  );
  assert.equal(movementCount, 1, 'one aggregated inventory movement per product per sale, not one per variant');
});

// ----------------------------------------------------------------------------
// A4. Cross-branch variant is rejected (a Branch 1 variant id cannot be used
// against Branch 2, even if Branch 2 also carries the same base product).
// ----------------------------------------------------------------------------

await asUser(mainManager, async () => {
  await configureProducts(branch2, [{ product_id: caldereta, selling_price: 82, is_active: true }]);
  await configureVariants(branch2, caldereta, [
    { name: 'With Rice', selling_price: 92, is_active: true },
  ]);
  shifts.branch2CalderetaTransferId = (
    await sendTransfer(branch2, [{ product_id: caldereta, quantity_sent: 20 }], 'm122-b2-cald-send01')
  ).rows[0].id;
});

await asUser(cashier2, async () => {
  await receiveTransfer(shifts.branch2CalderetaTransferId, { [caldereta]: 20 }, 'm122-b2-cald-recv01');
});

await asUser(cashier1, async () => {
  const branch1Variants = (
    await db.query('select * from public.list_cashier_pos_inventory()')
  ).rows.find((row) => row.product_id === caldereta);
  const variants = typeof branch1Variants.variants === 'string' ? JSON.parse(branch1Variants.variants) : branch1Variants.variants;
  shifts.branch1WithRiceId = variants.find((v) => v.name === 'With Rice').id;
});

await asUser(cashier2, async () => {
  shifts.branch2 = (await db.query('select public.start_cashier_shift() id')).rows[0].id;
  await assert.rejects(
    db.query(
      'select public.confirm_sale($1,$2::jsonb,$3,$4)',
      [
        shifts.branch2,
        JSON.stringify([{ product_id: caldereta, variant_id: shifts.branch1WithRiceId, quantity: 1 }]),
        '100.00',
        'm122-cross-branch-variant01',
      ],
    ),
    /not available in this branch catalog/,
    'a Branch 1 variant id is rejected for a Branch 2 sale',
  );
});

// ----------------------------------------------------------------------------
// A5. Different branch variant prices work: Branch 2's "With Rice" is priced
// independently of Branch 1's.
// ----------------------------------------------------------------------------

await asUser(cashier2, async () => {
  const pos = (await db.query('select * from public.list_cashier_pos_inventory()')).rows;
  const calderetaRow = pos.find((row) => row.product_id === caldereta);
  const variants = typeof calderetaRow.variants === 'string' ? JSON.parse(calderetaRow.variants) : calderetaRow.variants;
  const withRiceBranch2 = variants.find((v) => v.name === 'With Rice');
  assert.equal(Number(withRiceBranch2.selling_price), 92, 'Branch 2 has its own independent variant price');

  const sale = (
    await db.query(
      'select (public.confirm_sale($1,$2::jsonb,$3,$4)).*',
      [shifts.branch2, JSON.stringify([{ product_id: caldereta, variant_id: withRiceBranch2.id, quantity: 1 }]), '100.00', 'm122-b2-variant-sale01'],
    )
  ).rows[0];
  assert.equal(Number(sale.total_amount), 92);
  shifts.branch2VariantSaleId = sale.id;
});

// ----------------------------------------------------------------------------
// A6. Historical prices stay unchanged after the variant is repriced.
// ----------------------------------------------------------------------------

await asUser(mainManager, async () => {
  await configureVariants(branch2, caldereta, [{ name: 'With Rice', selling_price: 150, is_active: true }]);
});

assert.equal(
  Number((await db.query('select unit_price from public.sale_items where sale_id=$1', [shifts.branch2VariantSaleId])).rows[0].unit_price),
  92,
  'a repriced variant does not change already-recorded historical sale prices',
);

// ----------------------------------------------------------------------------
// B1. Transfer auto-creates the destination catalog entry: Beef Tapa was
// never assigned to Branch 2 before. No price input is required — it
// defaults to the product's base selling_price (95).
// ----------------------------------------------------------------------------

await asUser(mainManager, async () => {
  assert.equal(
    Number((await db.query('select count(*) n from public.branch_products where branch_id=$1 and product_id=$2', [branch2, newProduct])).rows[0].n),
    0,
    'no pre-existing branch catalog row for the new product',
  );

  shifts.newProductTransferId = (
    await sendTransfer(branch2, [{ product_id: newProduct, quantity_sent: 18 }], 'm122-newprod-price01')
  ).rows[0].id;

  const catalogRow = (
    await db.query('select selling_price,is_active from public.branch_products where branch_id=$1 and product_id=$2', [branch2, newProduct])
  ).rows[0];
  assert.equal(catalogRow.is_active, true, 'transfer auto-creates and activates the destination catalog entry');
  assert.equal(Number(catalogRow.selling_price), 95, 'new branch product defaults to the product base selling_price');

  // Stock is not yet sellable: receipt has not happened.
  const preReceiptStock = (
    await db.query('select quantity_on_hand from public.branch_inventory where branch_id=$1 and product_id=$2', [branch2, newProduct])
  ).rows;
  assert.equal(preReceiptStock.length, 0, 'destination has no receivable inventory row until actual receipt');
});

await asUser(cashier2, async () => {
  await receiveTransfer(shifts.newProductTransferId, { [newProduct]: 18 }, 'm122-newprod-recv01');

  const postReceiptStock = Number(
    (await db.query('select quantity_on_hand from public.branch_inventory where branch_id=$1 and product_id=$2', [branch2, newProduct])).rows[0]
      .quantity_on_hand,
  );
  assert.equal(postReceiptStock, 18, 'stock becomes available only after actual receipt');
});

// ----------------------------------------------------------------------------
// B2. Received stock becomes available in Branch 2 POS at the auto-assigned
// base price (95), editable later via configure_branch_products.
// ----------------------------------------------------------------------------

await asUser(cashier2, async () => {
  const pos = (await db.query('select * from public.list_cashier_pos_inventory()')).rows;
  const tapaRow = pos.find((row) => row.product_id === newProduct);
  assert.ok(tapaRow, 'newly transferred-and-received product appears in destination POS');
  assert.equal(Number(tapaRow.quantity_on_hand), 18);
  assert.equal(Number(tapaRow.selling_price), 95, 'POS uses the auto-assigned base price');

  const sale = (
    await db.query(
      'select (public.confirm_sale($1,$2::jsonb,$3,$4)).*',
      [shifts.branch2, JSON.stringify([{ product_id: newProduct, quantity: 1 }]), '95.00', 'm122-newprod-sale01'],
    )
  ).rows[0];
  assert.equal(Number(sale.total_amount), 95);
});

await asUser(mainManager, async () => {
  // The Main Branch Manager can edit the auto-assigned price afterward via
  // the existing branch catalog/pricing flow.
  await configureProducts(branch2, [{ product_id: newProduct, selling_price: 105, is_active: true }]);
  const repriced = (
    await db.query('select selling_price from public.branch_products where branch_id=$1 and product_id=$2', [branch2, newProduct])
  ).rows[0];
  assert.equal(Number(repriced.selling_price), 105, 'branch price can be edited later in the catalog/pricing screen');
});

// ----------------------------------------------------------------------------
// B3. Security: selling manager / cashier cannot manage branch prices or
// variants, and cannot forge a branch or price via confirm_sale/transfer.
// ----------------------------------------------------------------------------

await asUser(manager1, async () => {
  await assert.rejects(
    sendTransfer(branch1, [{ product_id: newProduct, quantity_sent: 1 }], 'm122-selling-cannot-send01'),
    /Main Branch Manager/,
  );
  await assert.rejects(
    configureProducts(branch1, [{ product_id: newProduct, selling_price: 1, is_active: true }]),
    /Main Branch Manager/,
  );
});

await asUser(cashier1, async () => {
  // Client-forged low price is ignored: confirm_sale derives price from the
  // branch catalog server-side, never from client input.
  const forged = (
    await db.query(
      'select (public.confirm_sale($1,$2::jsonb,$3,$4)).*',
      [shifts.branch1, JSON.stringify([{ product_id: singlePriceProduct, quantity: 1, unit_price: 0.01 }]), '60.00', 'm122-forge-price01'],
    )
  ).rows[0];
  assert.equal(Number(forged.total_amount), 60, 'client-supplied unit_price is ignored server-side');
});

// ----------------------------------------------------------------------------
// B4. Reconciliation variance is zero across all this milestone's activity.
// ----------------------------------------------------------------------------

await asUser(owner, async () => {
  const result = (await db.query('select public.report_inventory_reconciliation() result')).rows[0].result;
  const reconciliation = typeof result === 'string' ? JSON.parse(result) : result;
  assert.ok(
    reconciliation.every((row) => Number(row.variance) === 0),
    'variant sales, single-price sales, and transfer-driven catalog creation keep reconciliation at zero variance',
  );
});

await db.close();
console.log(
  'Milestone 12.2 tests passed: single-price products, variant pricing/stock/security, transfer-driven branch catalog creation and reactivation, destination pricing, post-receipt POS availability, and reconciliation.',
);
