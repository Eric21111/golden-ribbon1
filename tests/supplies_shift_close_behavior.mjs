// What a shift close does to an Inventory Supplies item (Rice, Egg) depending on its closing_stock_behavior.
// The Create wizard saves 'record_as_unsold' for every product whose "Keep Unsold Stock at Branch" switch is off, and the
// Products list shows that as "Unsold at close". This test RECORDS the database's actual behaviour so the business-rule
// question is decided on facts. It does not assert that the behaviour is desirable. Real RPCs on PGlite (Postgres WASM,
// not a native PostgreSQL).
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
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
const id = (n) => `78000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
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
    ('${main}','Main Kitchen','MAIN-SC',true,true,'counted'),('${booth}','Booth','BOOTH-SC',false,true,'cashier_confirm');
  insert into public.profiles(id,full_name,role,branch_id) values
    ('${mgr}','Main Manager','manager','${main}'),('${cashier}','Cashier','cashier','${booth}');
`);
// exactly what the wizard sends: closing = isNonReturnable ? keep_at_branch : record_as_unsold
const wizardCreate = ({ name, sku, nonReturnable }) =>
  as(mgr, () =>
    db.query(
      `select * from public.create_complete_product(p_name := $1, p_sku := $2, p_description := null, p_variants := '[]'::jsonb, p_branches := $3::jsonb, p_selling_price := '15.00', p_closing_stock_behavior := $4)`,
      [name, sku, J([{ branch_id: booth, selling_price: '15.00' }]), nonReturnable ? 'keep_at_branch' : 'record_as_unsold'],
    ),
  ).then(async (r) => {
    const product = r.rows[0];
    if (nonReturnable) await as(mgr, () => db.query('select public.set_product_non_returnable($1,true)', [product.id]));
    return product;
  });
const rice = await wizardCreate({ name: 'Rice', sku: 'RICE-SC', nonReturnable: false }); // a supply created with the wizard's defaults
const keptRice = await wizardCreate({ name: 'Kept Egg', sku: 'EGG-SC', nonReturnable: true }); // same, with the switch on

assert.deepEqual(
  (await db.query(`select name, closing_stock_behavior::text b, is_non_returnable n from public.products where id in ($1,$2) order by name`, [rice.id, keptRice.id])).rows,
  [{ name: 'Kept Egg', b: 'keep_at_branch', n: true }, { name: 'Rice', b: 'record_as_unsold', n: false }],
  'the wizard: switch off = "unsold at close", switch on = "keep at branch"',
);

await as(mgr, () => db.query(`select public.initialize_main_branch_inventory($1::jsonb,'open')`, [J([rice, keptRice].map((p) => ({ product_id: p.id, quantity: 100 })))]));
for (const p of [rice, keptRice]) await as(mgr, () => db.query('select public.set_product_status($1,true)', [p.id]));
let n = 0;
const key = (p) => `${p}-${String(++n).padStart(14, '0')}`;
const transfer = (await as(mgr, () => db.query('select public.send_stock_transfer($1,$2::jsonb,null,$3) id', [booth, J([rice, keptRice].map((p) => ({ product_id: p.id, quantity_sent: 40, destination_price: 15 }))), key('sc-send')]))).rows[0].id;
await as(cashier, () => db.query('select public.confirm_shipment_arrival($1,$2)', [transfer, key('sc-arrive')]));
const qty = async (p) => Number((await db.query('select quantity_on_hand q from public.branch_inventory where branch_id=$1 and product_id=$2', [booth, p.id])).rows[0].q);
assert.equal(await qty(rice), 40);

const shift = (await as(cashier, () => db.query('select public.start_cashier_shift() id'))).rows[0].id;
const preview = (await as(cashier, () => db.query('select public.begin_cashier_shift_close($1) preview', [shift]))).rows[0].preview;
const listed = preview.products.map((p) => p.product_id);
assert.ok(listed.includes(rice.id) && listed.includes(keptRice.id), 'supplies with stock at the branch are part of the close count');

const result = (await as(cashier, () => db.query('select public.finalize_cashier_shift_reconciliation($1,$2,$3::jsonb) result', [shift, '0', J([{ product_id: rice.id, actual_remaining: '40', waste_quantity: '0' }, { product_id: keptRice.id, actual_remaining: '40', waste_quantity: '0' }])]))).rows[0].result;
assert.equal(result.result, 'exact');

const recon = Object.fromEntries((await db.query(`select product_name_snapshot n, closing_stock_behavior::text b, unsold_quantity::numeric u, carried_quantity::numeric c from public.shift_product_reconciliations where shift_id=$1`, [shift])).rows.map((r) => [r.n, [r.b, Number(r.u), Number(r.c)]]));
assert.deepEqual(recon.Rice, ['record_as_unsold', 40, 0], 'Rice (switch off): all 40 recorded as UNSOLD at close');
assert.deepEqual(recon['Kept Egg'], ['keep_at_branch', 0, 40], 'Kept Egg (switch on): all 40 CARRIED to the next day');
assert.equal(await qty(rice), 0, 'the branch Rice balance is written off to 0 at close');
assert.equal(await qty(keptRice), 40, 'the kept supply still has its 40');
const moves = (await db.query(`select p.name, m.movement_type::text t, m.quantity::numeric q from public.inventory_movements m join public.products p on p.id=m.product_id where m.reference_type='shift_product_reconciliation' order by 1`)).rows.map((r) => [r.name, r.t, Number(r.q)]);
assert.deepEqual(moves, [['Rice', 'unsold', -40]], 'one "unsold" movement for Rice, none for the kept supply');
// and the supply used in a recipe is therefore gone for the next shift unless Main sends it again
console.log('supplies_shift_close_behavior: ALL PASS (current behaviour recorded)');
