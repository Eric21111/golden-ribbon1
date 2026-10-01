import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';
import { PGlite } from '@electric-sql/pglite';

const part4aSrc = readFileSync(
  'supabase/migrations/20260928110000_shipment_inventory_mode_concurrency.sql',
  'utf8',
);
const errorsSrc = readFileSync('src/lib/errors.ts', 'utf8');

assert.doesNotMatch(part4aSrc, /update_complete_product/);
assert.doesNotMatch(part4aSrc, /set_product_inventory_mode/);
assert.match(part4aSrc, /create or replace function public\.confirm_shipment_arrival/);
assert.match(part4aSrc, /create or replace function public\.report_shipment_issue/);
assert.match(part4aSrc, /security definer/i);
assert.match(part4aSrc, /set search_path = ''/);
assert.match(
  part4aSrc,
  /Product inventory type changed while this shipment was in transit/,
);

const extractFn = (src, name) => {
  const start = src.indexOf(`create or replace function public.${name}`);
  assert.ok(start >= 0, `${name} missing`);
  const next = src.indexOf('create or replace function public.', start + 10);
  return next >= 0 ? src.slice(start, next) : src.slice(start);
};

for (const name of ['confirm_shipment_arrival', 'report_shipment_issue']) {
  const body = extractFn(part4aSrc, name);
  assert.match(body, /for update/);
  assert.match(
    body,
    /for v_product_id in\s+select distinct sti\.product_id[\s\S]*order by sti\.product_id[\s\S]*loop[\s\S]*perform 1[\s\S]*from public\.products p[\s\S]*for share;/i,
  );
  assert.doesNotMatch(body, /select distinct[\s\S]{0,80}for share/i);
  const lockAt = body.search(/perform 1[\s\S]*for share;/i);
  const mismatchAt = body.indexOf('inventory_mode is distinct from p.inventory_mode');
  const mutateAt = body.indexOf('insert into public.branch_inventory');
  assert.ok(lockAt >= 0 && mismatchAt > lockAt, `${name}: mismatch after product lock`);
  assert.ok(mutateAt > mismatchAt, `${name}: inventory mutate after mismatch`);
}

assert.match(errorsSrc, /inventory type changed while this shipment was in transit/);

const { outputText } = ts.transpileModule(errorsSrc, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: 'src/lib/errors.ts',
});
const module = { exports: {} };
vm.runInNewContext(outputText, { module, exports: module.exports, console }, { filename: 'src/lib/errors.ts' });
const { getInventoryErrorMessage } = module.exports;
assert.equal(
  getInventoryErrorMessage(new Error('Product inventory type changed while this shipment was in transit.')),
  'Product inventory type changed while this shipment was in transit.',
);

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
    readFileSync(`supabase/migrations/${file}`, 'utf8').replace(
      /create extension if not exists pgcrypto;/g,
      '',
    ),
  );
}

const hardening = (
  await db.query(`
    select p.proname,
           p.prosecdef,
           pg_get_function_identity_arguments(p.oid) as args,
           coalesce(array_to_string(p.proconfig, ','), '') as cfg
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('confirm_shipment_arrival', 'report_shipment_issue')
    order by p.proname
  `)
).rows;
assert.equal(hardening.length, 2);
for (const row of hardening) {
  assert.equal(row.prosecdef, true, `${row.proname} must stay SECURITY DEFINER`);
  assert.match(String(row.cfg), /search_path\s*=\s*(?:''|"")/, `${row.proname} search_path`);
}
assert.equal(
  hardening.find((row) => row.proname === 'confirm_shipment_arrival').args,
  'p_transfer_id uuid, p_idempotency_key text',
);
assert.equal(
  hardening.find((row) => row.proname === 'report_shipment_issue').args,
  'p_transfer_id uuid, p_items jsonb, p_notes text, p_idempotency_key text',
);

const id = (n) => `28110000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1);
const mainMgr = id(2);
const cashier = id(3);
const main = id(10);
const branch = id(11);
const pieceA = id(20);
const pieceB = id(21);
const kgMeal = id(22);
const pieceIssue = id(23);
const kgIssue = id(24);
const pieceWin = id(25);
const pieceBlock = id(26);

await db.exec(`
  insert into auth.users values
    ('${owner}','owner@test'),('${mainMgr}','main@test'),('${cashier}','cashier@test');
  insert into public.branches(id,name,code,is_main_branch,is_active) values
    ('${main}','Main','MAIN',true,true),('${branch}','Branch 1','B1',false,true);
  insert into public.profiles(id,full_name,role,branch_id) values
    ('${owner}','Owner','owner',null),
    ('${mainMgr}','Main Manager','manager','${main}'),
    ('${cashier}','Cashier','cashier','${branch}');
  insert into public.products(id,name,sku,selling_price,is_active) values
    ('${pieceA}','Piece Arrival','PA1',10,true),
    ('${pieceB}','Piece Issue','PI1',10,true),
    ('${kgMeal}','KG Arrival','KA1',80,true),
    ('${pieceIssue}','Piece Issue Match','PIM',10,true),
    ('${kgIssue}','KG Issue Match','KIM',80,true),
    ('${pieceWin}','Arrival Wins','AW1',10,true),
    ('${pieceBlock}','Pending Blocks','PB1',10,true);
`);

const asUser = async (userId, work) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false);`);
  try {
    return await work();
  } finally {
    await db.exec('reset role');
  }
};

const qty = async (branchId, productId) => {
  const row = (
    await db.query(
      'select quantity_on_hand from public.branch_inventory where branch_id=$1 and product_id=$2',
      [branchId, productId],
    )
  ).rows[0];
  return row ? Number(row.quantity_on_hand) : 0;
};

const transferStatus = async (transferId) =>
  (await db.query('select status::text as status from public.stock_transfers where id=$1', [transferId])).rows[0]
    .status;

const productMode = async (productId) =>
  (await db.query('select inventory_mode::text as mode from public.products where id=$1', [productId])).rows[0].mode;

const forceMode = async (productId, mode) => {
  await db.exec(`
    select set_config('golden.allow_inventory_mode_change', 'on', true);
    update public.products set inventory_mode = '${mode}'::public.inventory_mode where id = '${productId}';
  `);
};

const stockMain = async (productId, amount) => {
  await asUser(mainMgr, () =>
    db.query('select public.initialize_main_branch_inventory($1::jsonb, null)', [
      JSON.stringify([{ product_id: productId, quantity: String(amount) }]),
    ]),
  );
};

const send = async (productId, quantity, key) => {
  const sent = await asUser(mainMgr, () =>
    db.query('select public.send_stock_transfer($1,$2::jsonb,$3,$4) id', [
      branch,
      JSON.stringify([{ product_id: productId, quantity_sent: String(quantity) }]),
      null,
      key,
    ]),
  );
  return sent.rows[0].id;
};

const itemId = async (transferId) =>
  (await db.query('select id from public.stock_transfer_items where stock_transfer_id=$1', [transferId])).rows[0].id;

const mismatch = /Product inventory type changed while this shipment was in transit/;

await stockMain(pieceA, 4);
await stockMain(pieceB, 5);
await stockMain(pieceIssue, 20);
await stockMain(pieceWin, 20);
await stockMain(pieceBlock, 2);

const destBeforeA = await qty(branch, pieceA);
const transferA = await send(pieceA, 4, '4a-send-piece-a-0001');
await asUser(mainMgr, () =>
  assert.rejects(
    db.query('select public.set_product_inventory_mode($1,$2)', [pieceA, 'kg_meal']),
    /retired|piece stock|open transfers/i,
  ),
);
await forceMode(pieceA, 'kg_meal');
assert.equal(await productMode(pieceA), 'kg_meal');
await asUser(cashier, () =>
  assert.rejects(
    db.query('select public.confirm_shipment_arrival($1,$2)', [transferA, '4a-arrive-mismatch-a01']),
    mismatch,
  ),
);
assert.equal(await transferStatus(transferA), 'pending_receipt');
assert.equal(await qty(branch, pieceA), destBeforeA);
assert.equal(
  (
    await db.query(
      'select quantity_received from public.stock_transfer_items where stock_transfer_id=$1',
      [transferA],
    )
  ).rows[0].quantity_received,
  null,
);

const destBeforeB = await qty(branch, pieceB);
const transferB = await send(pieceB, 5, '4a-send-piece-b-0001');
const itemB = await itemId(transferB);
await forceMode(pieceB, 'kg_meal');
await asUser(cashier, () =>
  assert.rejects(
    db.query('select public.report_shipment_issue($1,$2::jsonb,$3,$4)', [
      transferB,
      JSON.stringify([{ stock_transfer_item_id: itemB, quantity_received: '3' }]),
      'short on arrival',
      '4a-issue-mismatch-b0001',
    ]),
    mismatch,
  ),
);
assert.equal(await transferStatus(transferB), 'pending_receipt');
assert.equal(await qty(branch, pieceB), destBeforeB);
assert.equal(
  Number(
    (await db.query('select count(*)::int as n from public.transfer_discrepancies where stock_transfer_id=$1', [transferB]))
      .rows[0].n,
  ),
  0,
);

// Revision 7A: active kg_meal create/send paths are retired (RPC gate).
await asUser(mainMgr, () =>
  assert.rejects(
    db.query('select public.set_product_inventory_mode($1,$2)', [kgMeal, 'kg_meal']),
    /retired|piece stock/i,
  ),
);

const destC = await qty(branch, pieceIssue);
const transferC = await send(pieceIssue, 6, '4a-send-piece-c-0001');
const arrivedC = await asUser(cashier, () =>
  db.query('select public.confirm_shipment_arrival($1,$2) status', [transferC, '4a-arrive-match-c00001']),
);
assert.equal(arrivedC.rows[0].status, 'received');
assert.equal(await qty(branch, pieceIssue), destC + 6);
assert.equal(
  Number(
    (
      await db.query(
        'select quantity_received from public.stock_transfer_items where stock_transfer_id=$1',
        [transferC],
      )
    ).rows[0].quantity_received,
  ),
  6,
);

const extraPiece = id(27);
await db.exec(`
  insert into public.products(id,name,sku,selling_price,is_active)
  values ('${extraPiece}','Piece Issue OK','PIO',10,true);
`);
await stockMain(extraPiece, 15);
const destIssueOk = await qty(branch, extraPiece);
const transferIssueOk = await send(extraPiece, 7, '4a-send-piece-issue-ok1');
const itemIssueOk = await itemId(transferIssueOk);
const issued = await asUser(cashier, () =>
  db.query('select public.report_shipment_issue($1,$2::jsonb,$3,$4) status', [
    transferIssueOk,
    JSON.stringify([{ stock_transfer_item_id: itemIssueOk, quantity_received: '5' }]),
    'two pieces short',
    '4a-issue-match-ok00001',
  ]),
);
assert.equal(issued.rows[0].status, 'received_with_discrepancy');
assert.equal(await qty(branch, extraPiece), destIssueOk + 5);

const destWin = await qty(branch, pieceWin);
const transferWin = await send(pieceWin, 8, '4a-send-arrival-win-01');
const timeoutMs = 8000;
const arrivalWins = (async () => {
  const held = db.transaction(async (tx) => {
    await tx.exec(
      `set role authenticated; select set_config('request.jwt.claim.sub','${cashier}',false);`,
    );
    const status = await tx.query('select public.confirm_shipment_arrival($1,$2) status', [
      transferWin,
      '4a-arrive-hold-open0001',
    ]);
    assert.equal(status.rows[0].status, 'received');
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
  const modeAfter = (async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    await asUser(mainMgr, () =>
      assert.rejects(
        db.query('select public.set_product_inventory_mode($1,$2)', [pieceWin, 'kg_meal']),
        /retired|piece stock|Clear every current balance/i,
      ),
    );
  })();
  await Promise.all([held, modeAfter]);
})();
await Promise.race([
  arrivalWins,
  new Promise((_, reject) =>
    setTimeout(() => reject(new Error('arrival-wins two-session test timed out')), timeoutMs),
  ),
]);
assert.equal(await productMode(pieceWin), 'piece_stock');
assert.equal(await qty(branch, pieceWin), destWin + 8);
assert.equal(await transferStatus(transferWin), 'received');

const pendingBlock = await send(pieceBlock, 2, '4a-send-pending-block01');
await asUser(mainMgr, () =>
  assert.rejects(
    db.query('select public.set_product_inventory_mode($1,$2)', [pieceBlock, 'kg_meal']),
    /retired|piece stock|open transfers/i,
  ),
);
assert.equal(await transferStatus(pendingBlock), 'pending_receipt');

// 7A lock gate is wired into confirm_shipment_arrival
const confirmDef = (
  await db.query(`
    select pg_get_functiondef(p.oid) as def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname='confirm_shipment_arrival'
  `)
).rows[0].def;
assert.match(confirmDef, /lock_branch_inventory_gate/);

console.log(
  'Part 4A/7A shipment concurrency tests passed: piece mismatch reject, matching receipt, arrival-wins, kg retired.',
);
