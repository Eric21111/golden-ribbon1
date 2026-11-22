/**
 * Phase 1 — Approach A safety foundations (local only).
 * Fractional recipe saving stays gated off; invalid lines must error, not drop.
 */
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { loadTs } from './_load_ts.mjs';

const half = loadTs('src/lib/halfStepQuantity.ts');
const mapping = loadTs('src/features/products/stockUseMapping.ts');
const { PRODUCT_STOCK_KEY } = loadTs('src/features/products/wizardGuards.ts');
const { portionsToUnits } = loadTs('src/lib/stockUnits.ts');

const {
  FRACTIONAL_STOCK_USES_ENABLED,
  isExactHalfStep,
  isValidHalfStepRecipeQuantity,
  isValidIntegerRecipeQuantity,
  isValidRecipeQuantity,
  isValidStockUsePayloadQuantity,
  assertValidStockUsePayloadQuantity,
  recipeQuantityModeForStockUnit,
  StockUseValidationError,
} = half;

const { buildStockUsePayload, FRACTIONAL_STOCK_USES_ENABLED: gateFromMapping } = mapping;

assert.equal(FRACTIONAL_STOCK_USES_ENABLED, false, 'Phase 1–3 keep fractional recipe saving disabled');
assert.equal(gateFromMapping, false);

// ---- exact half-step (no scale rounding)
assert.equal(isExactHalfStep(0.5), true);
assert.equal(isExactHalfStep(1), true);
assert.equal(isExactHalfStep(1.5), true);
assert.equal(isExactHalfStep(2.5), true);
assert.equal(isExactHalfStep(0), true); // step-shape ok; range checks reject
assert.equal(isExactHalfStep(0.3), false);
assert.equal(isExactHalfStep(0.49), false);
assert.equal(isExactHalfStep(0.51), false);
assert.equal(isExactHalfStep(-0.5), true); // step-shape; range rejects
assert.equal(isExactHalfStep(Number.NaN), false);
assert.equal(isExactHalfStep(Infinity), false);

assert.equal(isValidHalfStepRecipeQuantity(0.5), true);
assert.equal(isValidHalfStepRecipeQuantity(1), true);
assert.equal(isValidHalfStepRecipeQuantity(1.5), true);
assert.equal(isValidHalfStepRecipeQuantity(99), true);
assert.equal(isValidHalfStepRecipeQuantity(0), false);
assert.equal(isValidHalfStepRecipeQuantity(-0.5), false);
assert.equal(isValidHalfStepRecipeQuantity(0.3), false);
assert.equal(isValidHalfStepRecipeQuantity(0.49), false);
assert.equal(isValidHalfStepRecipeQuantity(100), false);
assert.equal(isValidHalfStepRecipeQuantity(99.5), false, 'max remains 99');

assert.equal(isValidIntegerRecipeQuantity(1), true);
assert.equal(isValidIntegerRecipeQuantity(99), true);
assert.equal(isValidIntegerRecipeQuantity(0.5), false);
assert.equal(isValidIntegerRecipeQuantity(0), false);
assert.equal(isValidIntegerRecipeQuantity(100), false);

// ---- piece/null vs portion modes
assert.equal(recipeQuantityModeForStockUnit(null, false), 'integer');
assert.equal(recipeQuantityModeForStockUnit('piece', false), 'integer');
assert.equal(recipeQuantityModeForStockUnit(null, true), 'half_step');
assert.equal(recipeQuantityModeForStockUnit('piece', true), 'half_step');
assert.equal(recipeQuantityModeForStockUnit('half_egg', true), 'integer', 'portion products stay integer units');
assert.equal(recipeQuantityModeForStockUnit('half_serving', true), 'integer');
assert.equal(recipeQuantityModeForStockUnit('quarter_serving', true), 'integer');

assert.equal(isValidRecipeQuantity(0.5, null, false), false, 'gate off: ordinary rejects half-step');
assert.equal(isValidRecipeQuantity(0.5, null, true), true, 'gate on: ordinary accepts half-step');
assert.equal(isValidRecipeQuantity(0.5, 'half_egg', true), false, 'portion never stores raw 0.5');
assert.equal(isValidRecipeQuantity(1, 'half_egg', true), true);
assert.equal(portionsToUnits(0.5, 'half_egg'), 1, 'portion UI still converts 0.5 → 1 unit');

// ---- payload gate (Phase 1 off)
assert.equal(isValidStockUsePayloadQuantity(1, false), true);
assert.equal(isValidStockUsePayloadQuantity(0.5, false), false);
assert.equal(isValidStockUsePayloadQuantity(0.5, true), true);
assert.throws(() => assertValidStockUsePayloadQuantity(0.5, false), (err) => err?.name === 'StockUseValidationError');
assert.throws(() => assertValidStockUsePayloadQuantity(0, false), /whole number/);
assert.throws(() => assertValidStockUsePayloadQuantity(100, false), /whole number/);

// ---- buildStockUsePayload: integers ok; invalid throws; duplicates rejected
assert.deepEqual(
  buildStockUsePayload({ [PRODUCT_STOCK_KEY]: [{ itemId: 'rice', quantity: 1 }, { itemId: 'egg', quantity: 2 }] }, []),
  [
    { ingredient_product_id: 'rice', quantity: 1 },
    { ingredient_product_id: 'egg', quantity: 2 },
  ],
);

assert.throws(
  () => buildStockUsePayload({ [PRODUCT_STOCK_KEY]: [{ itemId: 'egg', quantity: 1 }, { itemId: 'egg', quantity: 3 }] }, []),
  (err) => err?.name === 'StockUseValidationError' && /only once/i.test(String(err.message)),
  'duplicate ingredient is rejected',
);

for (const bad of [0, -0.5, 0.3, 0.49, 0.5, 1.5, 100]) {
  assert.throws(
    () => buildStockUsePayload({ [PRODUCT_STOCK_KEY]: [{ itemId: 'egg', quantity: bad }] }, []),
    (err) => err?.name === 'StockUseValidationError' && /Quantity must/.test(String(err.message)),
    `payload rejects ${bad} while gate is off`,
  );
}

// portion-compatible stored integer still saves under gate off
assert.deepEqual(
  buildStockUsePayload({ [PRODUCT_STOCK_KEY]: [{ itemId: 'egg', quantity: portionsToUnits(0.5, 'half_egg') }] }, []),
  [{ ingredient_product_id: 'egg', quantity: 1 }],
);

// quarantine: Egg cutover not in active migrations
const quarantined = [
  '20261122120000_egg_half_unit_cutover.sql',
  '20261122130000_egg_cutover_recon_era.sql',
];
assert.equal(
  readdirSync('supabase/migrations').filter((n) => quarantined.includes(n)).length,
  0,
);
for (const file of quarantined) {
  assert.ok(readdirSync('supabase/migrations_quarantine').includes(file), `${file} in quarantine`);
}

console.log(
  'half_step_stock_uses_phase1 passed: helpers, gate off, explicit validation errors, portion integer units, Egg cutover quarantined.',
);
