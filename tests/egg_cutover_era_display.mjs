/**
 * Local unit + PGlite checks for Egg cutover era-aware report labeling.
 * No production access.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { loadTs } from './_load_ts.mjs';

const era = loadTs('src/lib/stockUnitEra.ts');
const recon = loadTs('src/features/reports/inventoryReconOverview.ts');
const corrections = loadTs('src/features/reports/stockCorrectionDisplay.ts');
const reportDisplay = loadTs('src/features/reports/reportDisplay.ts');

const cutoverAt = '2026-11-22T04:00:00.000Z';

assert.equal(era.stockUnitCodeAt('half_egg', '2026-11-21T12:00:00.000Z', cutoverAt), null);
assert.equal(era.stockUnitCodeAt('half_egg', '2026-11-22T05:00:00.000Z', cutoverAt), 'half_egg');
assert.equal(era.formatEraStockQuantity(5, 'half_egg', { era: 'pre_cutover' }), '5 eggs');
assert.equal(era.formatEraStockQuantity(10, 'half_egg', { era: 'post_cutover' }), '5 eggs');
assert.equal(era.formatEraStockQuantity(1, 'half_egg', { era: 'post_cutover' }), '0.5 eggs');
assert.equal(era.formatEraStockQuantity(5, 'half_egg', { era: 'unit_conversion' }), '5 half-egg units');
assert.equal(
  era.formatEraStockQuantity(5, 'half_egg', { occurredAt: '2026-11-21T12:00:00.000Z', cutoverAt }),
  '5 eggs',
  'pre-cutover must not use live half_egg labeling',
);
assert.equal(
  era.formatEraStockQuantity(10, 'half_egg', { occurredAt: '2026-11-22T05:00:00.000Z', cutoverAt }),
  '5 eggs',
);

// Fail-safe: unknown cutover must not silently convert stored units to physical eggs
assert.equal(
  era.formatEraStockQuantity(10, 'half_egg', {
    occurredAt: '2026-11-21T12:00:00.000Z',
    cutoverAt: null,
    cutoverKnown: false,
  }),
  '10 half-egg units',
);
assert.equal(
  era.formatEraStockQuantity(10, 'half_egg', {
    occurredAt: '2026-11-22T05:00:00.000Z',
    cutoverAt,
    cutoverKnown: false,
  }),
  '10 half-egg units',
);
assert.equal(
  reportDisplay.formatPcsQty(10, 'half_egg', {
    occurredAt: '2026-11-21T12:00:00.000Z',
    cutoverAt: null,
    cutoverKnown: false,
  }),
  '10 half-egg units',
);

assert.equal(
  era.discrepancyQuantityMeta({
    branchName: 'Main',
    stockUnitCode: 'half_egg',
    leftQty: 5,
    rightQty: 4,
    leftVerb: 'Sent',
    occurredAt: '2026-11-21T12:00:00.000Z',
    cutoverAt,
    cutoverKnown: true,
  }),
  'Main · Sent 5 eggs → Received 4 eggs',
);
assert.equal(
  era.discrepancyQuantityMeta({
    branchName: 'Main',
    stockUnitCode: 'half_egg',
    leftQty: 10,
    rightQty: 8,
    leftVerb: 'Returned',
    occurredAt: '2026-11-22T05:00:00.000Z',
    cutoverAt,
    cutoverKnown: true,
  }),
  'Main · Returned 5 eggs → Received 4 eggs',
);
assert.equal(
  era.discrepancyDiffBadgeLabel({
    difference: -2,
    discrepancyType: 'missing',
    stockUnitCode: 'half_egg',
    occurredAt: '2026-11-21T12:00:00.000Z',
    cutoverAt,
    cutoverKnown: true,
  }),
  '2 eggs missing',
);
assert.equal(
  era.discrepancyDiffBadgeLabel({
    difference: 2,
    discrepancyType: 'excess',
    stockUnitCode: 'half_egg',
    occurredAt: '2026-11-22T05:00:00.000Z',
    cutoverAt,
    cutoverKnown: false,
  }),
  '2 half-egg units excess',
);

assert.equal(
  corrections.correctionQuantityLine({ before: 5, after: 4 }, 'half_egg', {
    occurredAt: '2026-11-21T12:00:00.000Z',
    cutoverAt,
  }),
  '5 → 4 eggs',
);
assert.equal(
  corrections.correctionQuantityLine({ before: 10, after: 8 }, 'half_egg', {
    occurredAt: '2026-11-22T05:00:00.000Z',
    cutoverAt,
  }),
  '10 → 8 half-egg units',
);
assert.equal(
  corrections.correctionQuantityLine({ before: 10, after: 8 }, 'half_egg', {
    occurredAt: '2026-11-22T05:00:00.000Z',
    cutoverAt,
    cutoverKnown: false,
  }),
  '10 → 8 half-egg units',
);
assert.equal(
  reportDisplay.formatPcsQty(10, 'half_egg', { occurredAt: '2026-11-22T05:00:00.000Z', cutoverAt }),
  '5 eggs',
);
assert.equal(
  reportDisplay.formatPcsQty(5, 'half_egg', { occurredAt: '2026-11-21T12:00:00.000Z', cutoverAt }),
  '5 eggs',
);

const item = {
  product_id: 'egg',
  stock_unit_code: 'half_egg',
  stock_unit_cutover_at: cutoverAt,
  opening_stock: 5,
  opening_stock_pre: 5,
  opening_stock_post: 0,
  transfer_in: 0,
  transfer_in_pre: 0,
  transfer_in_post: 0,
  transfer_out: 4,
  transfer_out_pre: 0,
  transfer_out_post: 4,
  sale: 2,
  sale_pre: 0,
  sale_post: 2,
  return_out: 0,
  return_out_pre: 0,
  return_out_post: 0,
  return_in: 0,
  return_in_pre: 0,
  return_in_post: 0,
  adjustment: 0,
  adjustment_pre: 0,
  adjustment_post: 0,
  unit_conversion: 5,
  calculated_stock: 10,
  current_stock: 10,
  variance: 0,
};
const lines = recon.reconNonZeroMovementLines(item);
assert.deepEqual(
  lines.map((l) => [l.label, l.quantity, l.era]),
  [
    ['Opening stock (before unit change)', 5, 'pre_cutover'],
    ['Sent transfer (after unit change)', -4, 'post_cutover'],
    ['Sales (after unit change)', -2, 'post_cutover'],
    ['Unit conversion', 5, 'unit_conversion'],
  ],
);
assert.equal(recon.formatReconEraQuantity(5, item, 'pre_cutover'), '+5 eggs');
assert.equal(recon.formatReconEraQuantity(10, item, 'post_cutover'), '+5 eggs');
assert.equal(recon.formatReconEraQuantity(5, item, 'unit_conversion'), '+5 half-egg units');
assert.match(recon.formatReconEraQuantity(5, item, 'unit_conversion'), /half-egg/);
assert.doesNotMatch(recon.formatReconEraQuantity(5, item, 'unit_conversion'), /purchase|Added stock/i);

// Non-Egg products unchanged
assert.equal(era.formatEraStockQuantity(3, 'piece', { cutoverAt, occurredAt: cutoverAt }), '3 pcs');
assert.equal(era.formatEraStockQuantity(3, null, { cutoverAt, occurredAt: cutoverAt }), '3 pcs');

const BOOT = `
  create role anon; create role authenticated; create role service_role;
  create schema auth; create table auth.users(id uuid primary key, email text);
  create function auth.uid() returns uuid language sql as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema public, auth to authenticated;
  grant execute on function auth.uid() to authenticated;
`;

const id = (n) => `ea100000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1);
const manager = id(2);
const main = id(10);
const eggId = '9f0a71bf-3eaf-4edb-9a98-18177461f270';

const QUARANTINE = 'supabase/migrations_quarantine';
const EGG_MIGRATIONS = [
  '20261122120000_egg_half_unit_cutover.sql',
  '20261122130000_egg_cutover_recon_era.sql',
];
assert.equal(
  readdirSync('supabase/migrations').filter((n) => EGG_MIGRATIONS.includes(n)).length,
  0,
  'Egg cutover SQL must stay quarantined out of the active migration directory',
);

const db = new PGlite();
await db.exec(BOOT);
for (const file of readdirSync('supabase/migrations').filter((n) => n.endsWith('.sql')).sort()) {
  await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8').replace(/create extension if not exists pgcrypto;/g, ''));
}
for (const file of EGG_MIGRATIONS) {
  await db.exec(readFileSync(`${QUARANTINE}/${file}`, 'utf8').replace(/create extension if not exists pgcrypto;/g, ''));
}
await db.exec(`
  insert into auth.users values ('${owner}','o@test'),('${manager}','m@test');
  insert into public.branches(id,name,code,is_main_branch,is_active) values ('${main}','Main','MAIN',true,true);
  insert into public.profiles(id,full_name,role,branch_id) values
    ('${owner}','Owner','owner','${main}'),('${manager}','Manager','manager','${main}');
  insert into public.products(id,name,sku,selling_price,is_active,inventory_mode,closing_stock_behavior,sell_in_pos,stock_unit_code)
  values ('${eggId}','Egg','EGG',null,true,'piece_stock','keep_at_branch',false,null);
`);
await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${manager}',false);`);
await db.query('select public.initialize_main_branch_inventory($1::jsonb,$2)', [
  JSON.stringify([{ product_id: eggId, quantity: '5' }]),
  'era opening',
]);
await db.exec(`select set_config('request.jwt.claim.sub','',false); reset role;`);
await db.query('select public.apply_egg_half_unit_cutover()');

await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${owner}',false);`);
const report = (await db.query('select public.report_inventory_reconciliation($1) r', [main])).rows[0].r;
const egg = report.find((r) => r.product_id === eggId);
assert.ok(egg.stock_unit_cutover_at);
assert.equal(Number(egg.opening_stock_pre), 5);
assert.equal(Number(egg.opening_stock_post), 0);
assert.equal(Number(egg.unit_conversion), 5);
assert.equal(Number(egg.adjustment), 0, 'ordinary adjustments exclude unit_conversion');
assert.equal(Number(egg.current_stock), 10);
assert.equal(Number(egg.calculated_stock), 10);
assert.equal(Number(egg.variance), 0);
await db.exec('reset role');
await db.close();

// Compatibility notes encoded as assertions on migration source
const guardSrc = readFileSync(`${QUARANTINE}/20261122120000_egg_half_unit_cutover.sql`, 'utf8');
assert.match(guardSrc, /reference_type in \('sale', 'unit_conversion'\)/);
assert.match(guardSrc, /x-gr-half-egg/);
assert.match(readFileSync('src/lib/supabase.ts', 'utf8'), /x-gr-half-egg/);
// Remaining outdated-build risks (documented, not fully closable server-side):
// - sale path remains ungated so recipe deducts work; old POS may still sell products that use Egg
// - old builds without era formatters still mislabel historical/live Egg quantities in reports
// - old builds can still *view* Egg on-hand with wrong unit meaning (writes of Egg stock are blocked)
assert.match(guardSrc, /may mis-display Egg on-hand/);
assert.match(guardSrc, /blocked from opening\/transfer\/correction\/waste/);

// Screens must load cutover via egg_half_unit_cutover_at and pass cutoverKnown
for (const file of [
  'src/features/reports/DiscrepancyReportsScreens.tsx',
  'src/features/reports/DiscrepancyDetailScreen.tsx',
  'src/features/reports/WasteHistoryScreen.tsx',
  'src/features/reports/StockCorrectionsScreen.tsx',
  'src/features/reports/ShiftRemittanceDetailScreen.tsx',
]) {
  const screen = readFileSync(file, 'utf8');
  assert.match(screen, /getEggHalfUnitCutoverAt/);
  assert.match(screen, /cutoverKnown/);
  assert.match(screen, /cutoverQuery\.isSuccess/);
}

console.log(
  'Egg cutover era display passed: pre/post labels, discrepancy overview meta, cutoverKnown fail-safe, unit_conversion labeling, recon era buckets, non-Egg unchanged.',
);
