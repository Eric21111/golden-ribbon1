// Regression test: the Edit Product wizard must pre-fill saved variant prices in Step 3.
// Bug: prices were seeded under the database variant id, but Step 3 reads them by the wizard's draft key,
// so every saved price showed blank. This checks the keying logic and the wizard source; it does not render.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { seedVariantPrices } from '../src/features/products/wizardGuards.ts';

const read = (path) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const wizardSrc = read('src/features/products/EditProductWizard.tsx');

// The wizard gives each existing variant a generated draft key that differs from its database id.
const drafts = [
  { key: 'k1', id: 'db-uuid-1', name: 'Viand Only' },
  { key: 'k2', id: 'db-uuid-2', name: 'With Rice' },
];
const saved = new Map([
  ['Viand Only', 80],
  ['With Rice', 95],
]);

// ---------------------------------------------------------------- 1. reproduces the original bug
{
  // The old seeding: keyed by database id. Step 3 reads by draft key -> blank.
  const oldSeed = Object.fromEntries(drafts.map((v) => [v.id, String(saved.get(v.name) ?? '')]));
  assert.equal(oldSeed[drafts[0].key] ?? '', '', 'old seeding leaves the price blank when read by key (the bug)');
  assert.equal(oldSeed[drafts[1].key] ?? '', '');
}

// ---------------------------------------------------------------- 2. the fix
{
  const seeded = seedVariantPrices(drafts, saved);
  assert.deepEqual(seeded, { k1: '80', k2: '95' }, 'saved prices are readable by draft key');
  assert.equal(seeded['db-uuid-1'], undefined, 'database ids are not used as keys');
}

// ---------------------------------------------------------------- 3. never invents or alters prices
{
  const partial = seedVariantPrices(drafts, new Map([['Viand Only', 80]]));
  assert.deepEqual(partial, { k1: '80', k2: '' }, 'a variant with no saved price stays blank, not 0');
  assert.deepEqual(seedVariantPrices(drafts, undefined), { k1: '', k2: '' }, 'no saved branch prices -> all blank');
  assert.deepEqual(seedVariantPrices([], saved), {}, 'no variants -> nothing seeded');
  assert.equal(seedVariantPrices(drafts, new Map([['Viand Only', 12.5]])).k1, '12.5', 'decimals are kept as-is');
  assert.equal(seedVariantPrices(drafts, new Map([['Viand Only', 0]])).k1, '0', 'a saved price of 0 is kept, not blanked');
  // matching is by variant name only; a renamed or new variant gets nothing
  const renamed = seedVariantPrices([{ key: 'k9', name: 'Large' }], saved);
  assert.deepEqual(renamed, { k9: '' });
}

// ---------------------------------------------------------------- 4. the wizard uses it, in both modes
{
  assert.match(wizardSrc, /seedVariantPrices\(variants, first\)/, 'Same for All seeding uses draft keys');
  assert.match(wizardSrc, /seedVariantPrices\(variants, prices\)/, 'Different per Branch seeding uses draft keys');
  assert.doesNotMatch(
    wizardSrc,
    /\[variant\.id,\s*String\(/,
    'prices must not be seeded under the database id again',
  );
  // seeding runs from the wizard's own draft list, so keys always match the rows Step 3 renders
  assert.match(wizardSrc, /useState<EditVariantDraft\[\]>\(\(\) =>\s*sourceVariants\.map\(\(variant\) => \(\{ key: nextKey\(\), id: variant\.id/);
  // every reader still looks prices up by draft key
  assert.match(wizardSrc, /uniformVariantPrices\[variant\.key\]/);
  assert.match(wizardSrc, /draft\.variantPrices\[variant\.key\]/);
  // submit still sends the database id for existing variants, so they update instead of being recreated
  assert.match(wizardSrc, /return \{ id: variant\.id, name: variant\.name\.trim\(\), default_price: price \}/);
}

console.log('edit_price_prefill: ALL PASS');
