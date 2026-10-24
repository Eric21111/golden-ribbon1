// confirm_sale: the POS sends the BRANCH variant id; recipes are stored against the MASTER variant id.
// Every scenario here uses genuinely different branch and master ids (products are created through the real RPC).
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const FIX = '20261023120000_confirm_sale_variant_mapping.sql';
const fixSrc = readFileSync(`supabase/migrations/${FIX}`, 'utf8');
const stepTwo = readFileSync('supabase/migrations/20261023100000_confirm_sale_shared_inventory.sql', 'utf8').replace(/\r\n/g, '\n');
const cutFn = (text) => {
  const i = text.indexOf('create or replace function public.confirm_sale(');
  return text.slice(i, text.indexOf('$$;\n', text.indexOf('  return v_sale;\nend;\n', i)) + 4);
};

// ---------------------------------------------------------------- 0. static: scoped to the variant mapping
{
  const code = fixSrc.replace(/--[^\n]*/g, '').replace(/comment on [\s\S]*?;\n/gi, '');
  assert.equal((code.match(/create or replace function/gi) ?? []).length, 1, 'only confirm_sale is replaced');
  assert.doesNotMatch(code, /\balter table\b|\bcreate (unique )?index\b|\bcreate table\b|\bdrop\b|create function/i);
  assert.match(code, /grant execute on function public\.confirm_sale\(uuid, jsonb, numeric, text, text\) to authenticated/);
  // same predicate the POS list uses to pair a branch variant with its master variant
  assert.match(code, /lower\(pv\.name\) = lower\(v_bvariant\.name\)/);
  assert.match(code, /pv\.product_id = v_bvariant\.product_id/);
  // the recipe lookup uses the master id, never the branch id
  assert.match(code, /vu\.variant_id = it\.master_variant_id/);
  assert.doesNotMatch(code, /vu\.variant_id = it\.variant_id/);
  // a validated branch variant (branch + product + active) and an ambiguity guard
  assert.match(code, /and branch_id = v_branch\s+and product_id = v_item\.product_id\s+and is_active\s+for share;/);
  assert.match(code, /cardinality\(v_masters\), 0\) > 1/);
  // everything else is the previous definition: the diff touches only the declarations and the expansion block
  const a = cutFn(stepTwo).split('\n');
  const b = cutFn(fixSrc).split('\n');
  const startA = a.findIndex((l) => l.includes('-- Shared inventory (product_stock_uses).'));
  const endA = a.findIndex((l, i) => i > startA && l === '  ) d;');
  const startB = b.findIndex((l) => l.includes('-- Shared inventory (product_stock_uses).'));
  const endB = b.findIndex((l, i) => i > startB && l === '  ) d;');
  const strip = (lines, s, e, decl) => lines.filter((_, i) => i < s || i > e).filter((l) => !decl.some((d) => l.includes(d)));
  const declB = ['v_mapped jsonb', 'v_bvariant public.branch_product_variants', 'v_masters uuid[]', 'v_master uuid;'];
  assert.deepEqual(strip(b, startB, endB, declB), strip(a, startA, endA, []), 'only the declarations and the expansion block differ from Step 2');
  // the stock check, the deduction and the movement writes are untouched
  for (const keep of ['jsonb_to_recordset(v_deductions)', "'sale', v_sale.id, v_user", 'Insufficient stock. % — Available: %, Requested: %', 'perform public.lock_branch_inventory_gate(v_branch);', 'p_idempotency_key']) {
    assert.ok(cutFn(fixSrc).includes(keep), keep);
  }
}

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

const id = (n) => `55000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const mainMgr = id(2);
const cashier = id(4);
const cashier2 = id(5);
const main = id(10);
const booth = id(11);
const booth2 = id(12);
const egg = id(20);
const rice = id(21);
const garnish = id(22);

await db.exec(`
  insert into auth.users values ('${mainMgr}','m@t'),('${cashier}','c@t'),('${cashier2}','c2@t');
  insert into public.branches(id,name,code,is_main_branch,is_active,receiving_mode) values
    ('${main}','Main','MAIN-VM',true,true,'counted'),
    ('${booth}','Booth','BOOTH-VM',false,true,'cashier_confirm'),
    ('${booth2}','Booth Two','BOOTH2-VM',false,true,'cashier_confirm');
  insert into public.profiles(id,full_name,role,branch_id) values
    ('${mainMgr}','Main Manager','manager','${main}'),('${cashier}','Cashier One','cashier','${booth}'),('${cashier2}','Cashier Two','cashier','${booth2}');
  insert into public.products(id,name,sku,selling_price,is_active,inventory_mode,closing_stock_behavior) values
    ('${egg}','Egg','EGG-VM',10,true,'piece_stock','keep_at_branch'),
    ('${rice}','Rice','RICE-VM',15,true,'piece_stock','keep_at_branch'),
    ('${garnish}','Garnish','GARN-VM',2,true,'piece_stock','keep_at_branch');
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
const rejects = async (work, pattern, label) => {
  let error = null;
  try {
    await work();
  } catch (e) {
    error = e;
  }
  assert.ok(error, `${label}: should have been rejected`);
  assert.match(String(error.message), pattern, `${label}: wrong error: ${error.message}`);
};

// products are created through the real RPC, so branch and master variant ids are genuinely different
const createProduct = (name, sku, variants, stockUses, branchIds = [booth]) =>
  asUser(mainMgr, () =>
    db.query(
      `select * from public.create_complete_product(p_name := $1, p_sku := $2, p_description := null, p_variants := $3::jsonb, p_branches := $4::jsonb, p_selling_price := $5, p_stock_uses := $6::jsonb)`,
      [
        name,
        sku,
        J(variants.map(([n, price]) => ({ name: n, default_price: price }))),
        J(branchIds.map((b) => (variants.length ? { branch_id: b, variants: variants.map(([n, price]) => ({ name: n, selling_price: price })) } : { branch_id: b, selling_price: '20.00' }))),
        variants.length ? null : '20.00',
        J(stockUses),
      ],
    ),
  ).then((r) => r.rows[0]);

const curry = await createProduct(
  'Chicken Curry',
  'CURRY-VM',
  [['Viand Only', '70.00'], ['With Rice', '85.00'], ['Plain', '60.00']],
  [
    { variant_name: 'Viand Only', ingredient_product_id: 'self', quantity: 1 },
    { variant_name: 'Viand Only', ingredient_product_id: egg, quantity: 1 },
    { variant_name: 'With Rice', ingredient_product_id: 'self', quantity: 1 },
    { variant_name: 'With Rice', ingredient_product_id: rice, quantity: 1 },
    { variant_name: 'With Rice', ingredient_product_id: egg, quantity: 1 },
    // product-level default: used by any option that has no recipe of its own ("Plain")
    { ingredient_product_id: 'self', quantity: 1 },
    { ingredient_product_id: garnish, quantity: 2 },
  ],
);

await db.exec(`
  set session_replication_role = replica; -- skip the "needs opening stock" activation guard for the fixtures only
  update public.products set is_active = true where id = '${curry.id}';
  reset session_replication_role;
  insert into public.branch_inventory(branch_id,product_id,quantity_on_hand) values
    ('${booth}','${curry.id}',50),('${booth}','${rice}',50),('${booth}','${egg}',50),('${booth}','${garnish}',50);
`);

const masterId = async (name, product = curry.id) => (await db.query(`select id from public.product_variants where product_id=$1 and name=$2`, [product, name])).rows[0]?.id;
const branchId = async (name, branch = booth, product = curry.id) => (await db.query(`select id from public.branch_product_variants where branch_id=$1 and product_id=$2 and name=$3`, [branch, product, name])).rows[0]?.id;

const shiftId = (await asUser(cashier, () => db.query('select public.start_cashier_shift() id'))).rows[0].id;
let keyN = 0;
const sell = (items, { key = `vm-sale-${String(++keyN).padStart(10, '0')}-key`, program = 'standard', paid = '100000' } = {}) =>
  asUser(cashier, () => db.query('select (public.confirm_sale($1,$2::jsonb,$3,$4,$5)).*', [shiftId, J(items), paid, key, program])).then((r) => r.rows[0]);
const stock = async () =>
  Object.fromEntries((await db.query(`select p.name, bi.quantity_on_hand::numeric q from public.branch_inventory bi join public.products p on p.id=bi.product_id where bi.branch_id='${booth}'`)).rows.map((r) => [r.name, Number(r.q)]));
const diff = (a, b) => Object.fromEntries(Object.keys(b).map((k) => [k, b[k] - a[k]]).filter(([, x]) => x !== 0));
const movements = async (saleId) => (await db.query(`select p.name, m.quantity::numeric q from public.inventory_movements m join public.products p on p.id=m.product_id where m.reference_id=$1 order by p.name`, [saleId])).rows;
const counts = async () => ({
  sales: Number((await db.query('select count(*)::int n from public.sales')).rows[0].n),
  items: Number((await db.query('select count(*)::int n from public.sale_items')).rows[0].n),
  moves: Number((await db.query(`select count(*)::int n from public.inventory_movements where movement_type='sale'`)).rows[0].n),
});

// ---------------------------------------------------------------- 1. the ids really are different
{
  for (const name of ['Viand Only', 'With Rice', 'Plain']) {
    const m = await masterId(name);
    const b = await branchId(name);
    assert.ok(m && b, name);
    assert.notEqual(m, b, `${name}: branch and master variant ids differ`);
  }
  // the recipe is stored against the master ids only
  const stored = (await db.query(`select distinct variant_id from public.product_stock_uses where product_id=$1 and variant_id is not null`, [curry.id])).rows.map((r) => r.variant_id);
  assert.deepEqual(stored.sort(), [await masterId('Viand Only'), await masterId('With Rice')].sort());
  assert.ok(!stored.includes(await branchId('With Rice')));
}

// ---------------------------------------------------------------- 2. the reported bug: Curry With Rice deducts Curry, Rice and Egg
{
  const before = await stock();
  const sale = await sell([{ product_id: curry.id, variant_id: await branchId('With Rice'), quantity: 1 }]);
  assert.deepEqual(diff(before, await stock()), { 'Chicken Curry': -1, Rice: -1, Egg: -1 });
  const rows = await movements(sale.id);
  assert.deepEqual(Object.fromEntries(rows.map((r) => [r.name, Number(r.q)])), { 'Chicken Curry': -1, Egg: -1, Rice: -1 });
  assert.equal(rows.length, 3, 'one movement per ingredient');
  assert.equal(Number(sale.total_amount), 85, 'price unchanged');
  console.log('curry with rice: ok');
}

// ---------------------------------------------------------------- 3. several options in one order, plus product-level fallback
{
  const before = await stock();
  const sale = await sell([
    { product_id: curry.id, variant_id: await branchId('With Rice'), quantity: 2 },
    { product_id: curry.id, variant_id: await branchId('Viand Only'), quantity: 1 },
    { product_id: curry.id, variant_id: await branchId('Plain'), quantity: 1 }, // no variant recipe -> product-level: Curry x1 + Garnish x2
  ]);
  assert.deepEqual(diff(before, await stock()), { 'Chicken Curry': -4, Rice: -2, Egg: -3, Garnish: -2 });
  const rows = await movements(sale.id);
  assert.equal(rows.length, 4, 'Curry and Egg each get ONE movement although several lines use them');
  assert.equal(Number(sale.total_amount), 2 * 85 + 70 + 60);
  console.log('mixed options and fallback: ok');
}

// ---------------------------------------------------------------- 4. the sale record keeps the BRANCH variant
{
  const bv = await branchId('With Rice');
  const sale = await sell([{ product_id: curry.id, variant_id: bv, quantity: 1 }]);
  const item = (await db.query(`select variant_id, variant_name, quantity, unit_price::numeric u from public.sale_items where sale_id=$1`, [sale.id])).rows[0];
  assert.equal(item.variant_id, bv, 'sale_items still records the variant the POS sold');
  assert.equal(item.variant_name, 'With Rice');
  assert.equal(Number(item.u), 85);
  assert.deepEqual(sale.request_items, [{ product_id: curry.id, variant_id: bv, quantity: 1 }], 'the stored request is unchanged');
  // pricing programs still apply, and still deduct the recipe
  const before = await stock();
  const pwd = await sell([{ product_id: curry.id, variant_id: bv, quantity: 2 }], { program: 'pwd', paid: '200' });
  assert.equal(Number(pwd.total_amount), 127.5);
  assert.deepEqual(diff(before, await stock()), { 'Chicken Curry': -2, Rice: -2, Egg: -2 });
  console.log('sale record and pricing: ok');
}

// ---------------------------------------------------------------- 5. names match case-insensitively, exactly like the POS list
{
  await db.exec(`update public.branch_product_variants set name='WITH RICE' where branch_id='${booth}' and product_id='${curry.id}' and name='With Rice'`);
  const before = await stock();
  await sell([{ product_id: curry.id, variant_id: await branchId('WITH RICE'), quantity: 1 }]);
  assert.deepEqual(diff(before, await stock()), { 'Chicken Curry': -1, Rice: -1, Egg: -1 }, "'WITH RICE' (branch) pairs with 'With Rice' (master)");
  await db.exec(`update public.branch_product_variants set name='With Rice' where branch_id='${booth}' and product_id='${curry.id}' and name='WITH RICE'`);
  console.log('case-insensitive names: ok');
}

// ---------------------------------------------------------------- 6. an option with no master counterpart never borrows another recipe
{
  await db.exec(`insert into public.branch_product_variants(branch_id,product_id,name,selling_price,is_active) values ('${booth}','${curry.id}','Booth Special',99,true)`);
  const before = await stock();
  await sell([{ product_id: curry.id, variant_id: await branchId('Booth Special'), quantity: 1 }]);
  assert.deepEqual(diff(before, await stock()), { 'Chicken Curry': -1, Garnish: -2 }, "uses the product-level lines, not With Rice's or Viand's");
  await db.exec(`update public.branch_product_variants set is_active=false where branch_id='${booth}' and product_id='${curry.id}' and name='Booth Special'`);
  console.log('no master match falls back safely: ok');
}

// ---------------------------------------------------------------- 7. ambiguous names are refused, never guessed
{
  // master names are unique per product only case-sensitively, so 'Mega' and 'MEGA' can both exist
  await db.exec(`
    insert into public.product_variants(product_id,name,default_price,is_active,sort_order) values ('${curry.id}','Mega',120,true,10),('${curry.id}','MEGA',130,true,11);
    insert into public.product_stock_uses(product_id,variant_id,ingredient_product_id,quantity)
      select '${curry.id}', id, '${rice}', case when name='Mega' then 3 else 4 end from public.product_variants where product_id='${curry.id}' and name in ('Mega','MEGA');
    insert into public.branch_product_variants(branch_id,product_id,name,selling_price,is_active) values ('${booth}','${curry.id}','mega',125,true);
  `);
  const before = await stock();
  const c0 = await counts();
  await rejects(async () => sell([{ product_id: curry.id, variant_id: await branchId('mega'), quantity: 1 }]), /set up more than once for this product/, 'ambiguous');
  assert.deepEqual(await stock(), before, 'nothing was deducted');
  assert.deepEqual(await counts(), c0, 'no sale, item or movement was written');
  // an unambiguous name is fine again once the duplicate is gone
  await db.exec(`delete from public.product_variants where product_id='${curry.id}' and name='MEGA'`);
  await sell([{ product_id: curry.id, variant_id: await branchId('mega'), quantity: 1 }]);
  assert.deepEqual(diff(before, await stock()), { Rice: -3 }, "'mega' now pairs with 'Mega' only (a recipe without Curry itself, as configured)");
  await db.exec(`update public.branch_product_variants set is_active=false where branch_id='${booth}' and product_id='${curry.id}' and name='mega'; delete from public.product_variants where product_id='${curry.id}' and name='Mega';`);
  console.log('ambiguity refused: ok');
}

// ---------------------------------------------------------------- 8. invalid variants are refused, whatever recipe they might match
{
  const other = await createProduct('Other Meal', 'OTHER-VM', [['With Rice', '50.00']], [{ variant_name: 'With Rice', ingredient_product_id: egg, quantity: 9 }], [booth, booth2]);
  await db.exec(`set session_replication_role = replica; update public.products set is_active = true where id='${other.id}'; reset session_replication_role;
    insert into public.branch_inventory(branch_id,product_id,quantity_on_hand) values ('${booth}','${other.id}',5);`);
  const otherBranchVariant = await branchId('With Rice', booth, other.id);
  const foreignBranchVariant = await branchId('With Rice', booth2, other.id);
  const goodBranchVariant = await branchId('With Rice');
  const before = await stock();
  const c0 = await counts();
  const cases = [
    ['a variant of another product', [{ product_id: curry.id, variant_id: otherBranchVariant, quantity: 1 }]],
    ['a variant of another branch', [{ product_id: other.id, variant_id: foreignBranchVariant, quantity: 1 }]],
    ['an unknown variant id', [{ product_id: curry.id, variant_id: id(999), quantity: 1 }]],
    ['the MASTER variant id instead of the branch id', [{ product_id: curry.id, variant_id: await masterId('With Rice'), quantity: 1 }]],
  ];
  for (const [label, items] of cases) {
    await rejects(() => sell(items), /not available in this branch catalog/, label);
    assert.deepEqual(await stock(), before, `${label}: nothing deducted`);
    assert.deepEqual(await counts(), c0, `${label}: nothing written`);
  }
  // an inactive branch variant
  await db.exec(`update public.branch_product_variants set is_active=false where id='${goodBranchVariant}'`);
  await rejects(() => sell([{ product_id: curry.id, variant_id: goodBranchVariant, quantity: 1 }]), /not available in this branch catalog/, 'inactive variant');
  assert.deepEqual(await stock(), before);
  await db.exec(`update public.branch_product_variants set is_active=true where id='${goodBranchVariant}'`);
  // a valid variant mixed with an invalid one rolls the whole sale back
  await rejects(() => sell([{ product_id: curry.id, variant_id: goodBranchVariant, quantity: 1 }, { product_id: curry.id, variant_id: id(998), quantity: 1 }]), /not available in this branch catalog/, 'mixed valid and invalid');
  assert.deepEqual(await stock(), before);
  assert.deepEqual(await counts(), c0);
  console.log('invalid variants refused: ok');
}

// ---------------------------------------------------------------- 9. atomicity, stock shortage and retries with variant recipes
{
  const bv = await branchId('With Rice');
  await db.exec(`update public.branch_inventory set quantity_on_hand = 1 where branch_id='${booth}' and product_id='${egg}'`);
  const before = await stock();
  const c0 = await counts();
  await rejects(() => sell([{ product_id: curry.id, variant_id: bv, quantity: 2 }]), /Insufficient stock\. Egg — Available: 1(\.0+)?, Requested: 2/, 'egg shortage');
  assert.deepEqual(await stock(), before, 'Curry and Rice were not deducted either');
  assert.deepEqual(await counts(), c0);
  await db.exec(`update public.branch_inventory set quantity_on_hand = 50 where branch_id='${booth}' and product_id='${egg}'`);

  // a retried sale does not deduct twice (same key), even reordered or split
  const items = [{ product_id: curry.id, variant_id: bv, quantity: 2 }];
  const first = await sell(items, { key: 'vm-retry-0000000000001' });
  const afterFirst = await stock();
  const c1 = await counts();
  const again = await sell(items, { key: 'vm-retry-0000000000001' });
  assert.equal(again.id, first.id);
  const split = await sell([{ product_id: curry.id, variant_id: bv, quantity: 1 }, { product_id: curry.id, variant_id: bv, quantity: 1 }], { key: 'vm-retry-0000000000001' });
  assert.equal(split.id, first.id);
  assert.deepEqual(await stock(), afterFirst);
  assert.deepEqual(await counts(), c1);
  console.log('atomicity and retries: ok');
}

// ---------------------------------------------------------------- 10. a renamed option keeps working (the product edit renames both rows)
{
  const bvBefore = await branchId('With Rice');
  const mv = await masterId('With Rice');
  const viandMaster = await masterId('Viand Only');
  const plainMaster = await masterId('Plain');
  await asUser(mainMgr, () =>
    db.query(
      `select * from public.update_complete_product(p_product_id := $1, p_name := 'Chicken Curry', p_sku := 'CURRY-VM', p_description := null, p_is_active := true, p_variants := $2::jsonb, p_deleted_variant_ids := '[]'::jsonb, p_branches := $3::jsonb, p_selling_price := null)`,
      [
        curry.id,
        J([
          { id: viandMaster, name: 'Viand Only', default_price: '70.00' },
          { id: mv, name: 'With Garlic Rice', default_price: '85.00' },
          { id: plainMaster, name: 'Plain', default_price: '60.00' },
        ]),
        J([{ branch_id: booth, variants: [{ name: 'Viand Only', selling_price: '70.00' }, { name: 'With Garlic Rice', selling_price: '85.00' }, { name: 'Plain', selling_price: '60.00' }] }]),
      ],
    ),
  );
  assert.equal(await masterId('With Garlic Rice'), mv, 'the master variant kept its id');
  assert.equal(await branchId('With Garlic Rice'), bvBefore, 'the branch variant kept its id');
  const before = await stock();
  await sell([{ product_id: curry.id, variant_id: await branchId('With Garlic Rice'), quantity: 1 }]);
  assert.deepEqual(diff(before, await stock()), { 'Chicken Curry': -1, Rice: -1, Egg: -1 }, 'recipe still found after the rename');
  console.log('renamed option: ok');
}

// ---------------------------------------------------------------- 11. legacy: no recipes, equal ids (old seeds) and unconfigured products behave as before
{
  // products without any recipe still deduct one unit of themselves, variants share the pool
  const plain = await createProduct('Plain Meal', 'PLAIN-VM', [['Regular', '60.00'], ['Large', '80.00']], undefined);
  await db.exec(`set session_replication_role = replica; update public.products set is_active = true where id='${plain.id}'; reset session_replication_role;
    insert into public.branch_inventory(branch_id,product_id,quantity_on_hand) values ('${booth}','${plain.id}',20);`);
  const before = await stock();
  const sale = await sell([
    { product_id: plain.id, variant_id: await branchId('Regular', booth, plain.id), quantity: 2 },
    { product_id: plain.id, variant_id: await branchId('Large', booth, plain.id), quantity: 1 },
  ]);
  assert.deepEqual(diff(before, await stock()), { 'Plain Meal': -3 });
  assert.equal((await movements(sale.id)).length, 1);
  // a product-level-only recipe on a product that has options, sold through an option with no recipe of its own
  console.log('legacy behaviour: ok');
}

// ---------------------------------------------------------------- 12. the function is still a single, correctly granted confirm_sale
{
  const fns = (await db.query(`select pg_get_function_identity_arguments(p.oid) a, pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='confirm_sale'`)).rows;
  assert.equal(fns.length, 1);
  assert.match(fns[0].d, /master_variant_id/);
  const grants = (await db.query(`select grantee from information_schema.routine_privileges where routine_schema='public' and routine_name='confirm_sale' and privilege_type='EXECUTE' and grantee in ('anon','authenticated','PUBLIC') order by grantee`)).rows.map((r) => r.grantee);
  assert.deepEqual(grants, ['authenticated']);
}

console.log('confirm_sale_variant_mapping: ALL PASS');
