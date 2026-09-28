import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const productsIndex = readFileSync('app/(manager)/manager/products/index.tsx', 'utf8');
const productService = readFileSync('src/services/productService.ts', 'utf8');
const hooks = readFileSync('src/hooks/useProducts.ts', 'utf8');
const wizard = readFileSync('src/features/products/EditProductWizard.tsx', 'utf8');
const shiftService = readFileSync('src/services/shiftService.ts', 'utf8');
const appSrc = [
  'src/services/productService.ts',
  'src/hooks/useProducts.ts',
  'app/(manager)/manager/products/index.tsx',
]
  .map((file) => readFileSync(file, 'utf8'))
  .join('\n');

assert.match(productsIndex, /inventoryMode:\s*values\.inventoryMode/);
assert.doesNotMatch(productsIndex, /setProductInventoryMode/);
const updateRpc = productService.slice(
  productService.indexOf("rpc('update_complete_product'"),
  productService.indexOf('export async function updateProductVariant'),
);
assert.match(updateRpc, /p_inventory_mode:\s*input\.inventoryMode,/);
assert.doesNotMatch(updateRpc, /p_inventory_mode:[^\n]*\?\?/);
assert.doesNotMatch(productService, /from\('products'\)[\s\S]{0,80}\.insert/);
assert.doesNotMatch(productService, /export async function createProduct\(/);
assert.doesNotMatch(productService, /export async function updateProduct\(/);
assert.doesNotMatch(productService, /export async function setProductInventoryMode\(/);
assert.doesNotMatch(hooks, /function useCreateProduct\(|function useUpdateProduct\(/);
assert.doesNotMatch(wizard, /saved separately/);
assert.match(wizard, /Every current balance, including Main Branch/);
assert.doesNotMatch(appSrc, /from\('products'\)[\s\S]{0,120}\.insert\(/);
assert.match(shiftService, /close_cashier_shift/);
assert.doesNotMatch(shiftService, /end_cashier_shift/);

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
for (const file of readdirSync('supabase/migrations').filter((name) => name.endsWith('.sql')).sort()) {
  await db.exec(
    readFileSync(`supabase/migrations/${file}`, 'utf8').replace(/create extension if not exists pgcrypto;/g, ''),
  );
}

const hardening = (
  await db.query(`
    select p.proname, p.prosecdef, pg_get_function_identity_arguments(p.oid) as args,
           coalesce(array_to_string(p.proconfig, ','), '') as cfg
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'update_complete_product'
  `)
).rows;
assert.equal(hardening.length, 1, 'exactly one update_complete_product signature');
assert.equal(hardening[0].prosecdef, true);
assert.match(String(hardening[0].cfg), /search_path\s*=\s*(?:''|"")/);
assert.match(String(hardening[0].args), /p_inventory_mode/);

const id = (n) => `28120000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1);
const mainMgr = id(2);
const cashier = id(3);
const main = id(10);
const branch = id(11);

await db.exec(`
  insert into auth.users values ('${owner}','o@test'),('${mainMgr}','m@test'),('${cashier}','c@test');
  insert into public.branches(id,name,code,is_main_branch,is_active) values
    ('${main}','Main','MAIN',true,true),('${branch}','Branch 1','B1',false,true);
  insert into public.profiles(id,full_name,role,branch_id) values
    ('${owner}','Owner','owner',null),
    ('${mainMgr}','Main Manager','manager','${main}'),
    ('${cashier}','Cashier','cashier','${branch}');
`);

const asUser = async (userId, work) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false);`);
  try {
    return await work();
  } finally {
    await db.exec('reset role');
  }
};

const createSimple = async (name, sku, price = '80', mode = 'piece_stock') => {
  const row = await asUser(mainMgr, () =>
    db.query('select * from public.create_complete_product($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7)', [
      name,
      sku,
      null,
      JSON.stringify([]),
      JSON.stringify([]),
      price,
      mode,
    ]),
  );
  return row.rows[0];
};

const snapshot = async (productId) =>
  (await db.query('select name, sku, selling_price, inventory_mode::text as mode, is_active from public.products where id=$1', [
    productId,
  ])).rows[0];

const edit10 = (productId, args) =>
  asUser(mainMgr, () =>
    db.query('select * from public.update_complete_product($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10)', [
      productId,
      args.name,
      args.sku,
      args.description ?? null,
      args.isActive ?? false,
      JSON.stringify(args.variants ?? []),
      JSON.stringify(args.deletedVariantIds ?? []),
      JSON.stringify(args.branches ?? []),
      args.sellingPrice ?? '80',
      args.mode,
    ]),
  );

const edit9 = (productId, args) =>
  asUser(mainMgr, () =>
    db.query('select * from public.update_complete_product($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9)', [
      productId,
      args.name,
      args.sku,
      args.description ?? null,
      args.isActive ?? false,
      JSON.stringify(args.variants ?? []),
      JSON.stringify(args.deletedVariantIds ?? []),
      JSON.stringify(args.branches ?? []),
      args.sellingPrice ?? '80',
    ]),
  );

const stockMain = (productId, qty) =>
  asUser(mainMgr, () =>
    db.query('select public.initialize_main_branch_inventory($1::jsonb, null)', [
      JSON.stringify([{ product_id: productId, quantity: String(qty) }]),
    ]),
  );

const productA = await createSimple('Atomic Alpha', 'ATOM-A', '80');
await stockMain(productA.id, 12);
await edit10(productA.id, {
  name: 'Atomic Alpha Classic',
  sku: 'ATOM-A',
  sellingPrice: '85',
  mode: 'piece_stock',
});
const afterA = await snapshot(productA.id);
assert.equal(afterA.name, 'Atomic Alpha Classic');
assert.equal(Number(afterA.selling_price), 85);
assert.equal(afterA.mode, 'piece_stock');

const productB = await createSimple('Atomic Bravo', 'ATOM-B', '70');
await edit10(productB.id, {
  name: 'Atomic Bravo Meal',
  sku: 'ATOM-B',
  sellingPrice: '75',
  mode: 'kg_meal',
});
const afterB = await snapshot(productB.id);
assert.equal(afterB.name, 'Atomic Bravo Meal');
assert.equal(Number(afterB.selling_price), 75);
assert.equal(afterB.mode, 'kg_meal');

const productC = await createSimple('Atomic Charlie', 'ATOM-C', '60');
const taken = await createSimple('Taken Name', 'ATOM-TAKEN', '50');
const beforeC = await snapshot(productC.id);
await asUser(mainMgr, () =>
  assert.rejects(
    () =>
      edit10(productC.id, {
        name: taken.name,
        sku: 'ATOM-C',
        sellingPrice: '60',
        mode: 'kg_meal',
      }),
    /already exists|unique/i,
  ),
);
const afterC = await snapshot(productC.id);
assert.deepEqual(afterC, beforeC);

const productD = await createSimple('Atomic Delta', 'ATOM-D', '40');
await stockMain(productD.id, 5);
const beforeD = await snapshot(productD.id);
await asUser(mainMgr, () =>
  assert.rejects(
    () =>
      edit10(productD.id, {
        name: 'Atomic Delta KG',
        sku: 'ATOM-D',
        sellingPrice: '41',
        mode: 'kg_meal',
      }),
    /Clear every current balance/,
  ),
);
assert.deepEqual(await snapshot(productD.id), beforeD);

const productE = await createSimple('Atomic Echo', 'ATOM-E', '30');
await stockMain(productE.id, 8);
const sentE = await asUser(mainMgr, () =>
  db.query('select public.send_stock_transfer($1,$2::jsonb,$3,$4) id', [
    branch,
    JSON.stringify([{ product_id: productE.id, quantity_sent: '8' }]),
    null,
    '4b-send-echo-00000001',
  ]),
);
await asUser(cashier, () =>
  db.query('select public.confirm_shipment_arrival($1,$2)', [sentE.rows[0].id, '4b-arrive-echo-000001']),
);
const beforeE = await snapshot(productE.id);
await asUser(mainMgr, () =>
  assert.rejects(
    () =>
      edit10(productE.id, {
        name: 'Atomic Echo KG',
        sku: 'ATOM-E',
        sellingPrice: '31',
        mode: 'kg_meal',
      }),
    /Clear every current balance/,
  ),
);
assert.deepEqual(await snapshot(productE.id), beforeE);

const productF = await createSimple('Atomic Foxtrot', 'ATOM-F', '20');
await stockMain(productF.id, 4);
await asUser(mainMgr, () =>
  db.query('select public.send_stock_transfer($1,$2::jsonb,$3,$4) id', [
    branch,
    JSON.stringify([{ product_id: productF.id, quantity_sent: '4' }]),
    null,
    '4b-send-fox-000000001',
  ]),
);
const beforeF = await snapshot(productF.id);
await asUser(mainMgr, () =>
  assert.rejects(
    () =>
      edit10(productF.id, {
        name: 'Atomic Foxtrot KG',
        sku: 'ATOM-F',
        sellingPrice: '21',
        mode: 'kg_meal',
      }),
    /open transfers/,
  ),
);
assert.deepEqual(await snapshot(productF.id), beforeF);

const productG = await createSimple('Atomic Golf', 'ATOM-G', '25');
await stockMain(productG.id, 6);
const sentG = await asUser(mainMgr, () =>
  db.query('select public.send_stock_transfer($1,$2::jsonb,$3,$4) id', [
    branch,
    JSON.stringify([{ product_id: productG.id, quantity_sent: '6' }]),
    null,
    '4b-send-golf-00000001',
  ]),
);
await asUser(cashier, () =>
  db.query('select public.confirm_shipment_arrival($1,$2)', [sentG.rows[0].id, '4b-arrive-golf-000001']),
);
await asUser(cashier, () =>
  db.query('select public.create_stock_return($1::jsonb,$2,$3)', [
    JSON.stringify([{ product_id: productG.id, quantity_returned: 6 }]),
    'leftover return',
    '4b-return-golf-0000001',
  ]),
);
const beforeG = await snapshot(productG.id);
await asUser(mainMgr, () =>
  assert.rejects(
    () =>
      edit10(productG.id, {
        name: 'Atomic Golf KG',
        sku: 'ATOM-G',
        sellingPrice: '26',
        mode: 'kg_meal',
      }),
    /open returns/,
  ),
);
assert.deepEqual(await snapshot(productG.id), beforeG);

const productH = await createSimple('Atomic Hotel', 'ATOM-H', '15');
const beforeH = await snapshot(productH.id);
await asUser(mainMgr, () =>
  assert.rejects(
    () =>
      edit10(productH.id, {
        name: 'Atomic Hotel',
        sku: 'ATOM-H',
        sellingPrice: '15',
        mode: 'kg_meal',
        variants: [
          { id: null, name: 'Regular', default_price: '15' },
          { id: null, name: 'regular', default_price: '16' },
        ],
      }),
    /variant name may appear only once/i,
  ),
);
assert.deepEqual(await snapshot(productH.id), beforeH);

const productI = await createSimple('Atomic India', 'ATOM-I', '18');
const beforeI = await snapshot(productI.id);
await asUser(mainMgr, () =>
  assert.rejects(
    () =>
      edit10(productI.id, {
        name: 'Atomic India',
        sku: 'ATOM-I',
        sellingPrice: 'not-a-price',
        mode: 'kg_meal',
      }),
    /invalid_product_price|selling price is required/i,
  ),
);
assert.deepEqual(await snapshot(productI.id), beforeI);

const productJ = await createSimple('Atomic Juliet', 'ATOM-J', '22');
await edit10(productJ.id, {
  name: 'Atomic Juliet',
  sku: 'ATOM-J',
  sellingPrice: '22',
  mode: 'kg_meal',
});
assert.equal((await snapshot(productJ.id)).mode, 'kg_meal');

await assert.rejects(
  db.exec(`update public.products set inventory_mode = 'piece_stock' where id = '${productJ.id}'`),
  /Inventory type can only be changed/,
);
assert.equal((await snapshot(productJ.id)).mode, 'kg_meal');

const createdKg = await createSimple('Atomic Kilo Create', 'ATOM-K', '90', 'kg_meal');
assert.equal(createdKg.inventory_mode, 'kg_meal');
assert.equal(createdKg.is_active, false);

const productP = await createSimple('Atomic Papa', 'ATOM-P', '33');
await stockMain(productP.id, 9);
await edit9(productP.id, {
  name: 'Atomic Papa Nine',
  sku: 'ATOM-P',
  sellingPrice: '34',
});
const afterP = await snapshot(productP.id);
assert.equal(afterP.name, 'Atomic Papa Nine');
assert.equal(Number(afterP.selling_price), 34);
assert.equal(afterP.mode, 'piece_stock');

console.log('Part 4B atomic product edit tests passed: A–R.');
