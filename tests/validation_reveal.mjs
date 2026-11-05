// A refused Next / Create / Save brings the first thing to fix into view, and focuses it only when it is a text field.
// Pure logic is tested directly; the React/native glue (measureInWindow, scrollTo, focus) is checked as wiring only: there is no
// device here, so the actual scrolling and keyboard behaviour on Android is NOT exercised.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadTs } from './_load_ts.mjs';

const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const { revealScrollOffset } = loadTs('src/components/sheetScroll.ts');
const { firstPriceToFix, priceProblem } = loadTs('src/features/products/pricingReveal.ts');

// ---------------------------------------------------------------- 1. where to scroll
{
  // sheet scrolled 100 down: the content's top is 100 above the visible area's top (window y 300 -> contentY 200); 400 tall
  const base = { contentY: 200, offset: 100, viewportHeight: 400, elementHeight: 60 };
  // visible area is window y 300..700
  assert.equal(revealScrollOffset({ ...base, elementY: 350 }), null, 'fully visible: no scrolling at all');
  assert.equal(revealScrollOffset({ ...base, elementY: 300 }), null, 'flush with the top edge counts as visible');
  assert.equal(revealScrollOffset({ ...base, elementY: 640 }), null, 'ends exactly at the bottom edge: visible');
  assert.equal(revealScrollOffset({ ...base, elementY: 650 }), 100 + (650 - 300) - 16, 'partly below: scrolls so it sits 16 below the top edge');
  assert.equal(revealScrollOffset({ ...base, elementY: 900 }), 100 + 600 - 16, 'far below');
  assert.equal(revealScrollOffset({ ...base, elementY: 250 }), 100 - 50 - 16, 'above the visible area: scrolls up to it');
  assert.equal(revealScrollOffset({ ...base, elementY: 100 }), 0, 'never scrolls past the top');
  // keyboard up: the visible area is shorter, so an element that was fine before now needs a scroll
  assert.equal(revealScrollOffset({ ...base, viewportHeight: 150, elementY: 400 }), 100 + 100 - 16, 'a field under the keyboard is brought up');
  assert.equal(revealScrollOffset({ ...base, viewportHeight: 150, elementY: 340 }), null, 'a field above the keyboard stays put');
  // taller than the visible area: aligned to the top
  assert.equal(revealScrollOffset({ ...base, elementY: 350, elementHeight: 900 }), 100 + 50 - 16);
  console.log('1. scroll target: ok');
}

// ---------------------------------------------------------------- 2. which price to fix first
{
  const branches = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const v = [{ key: 'v1' }, { key: 'v2' }];
  const none = { mode: 'different', variants: [], uniformBase: '', uniformPrices: {}, branches, branchOn: { a: true, b: true, c: true }, drafts: {} };
  assert.deepEqual(firstPriceToFix(none), { field: 'a:base', card: 'a' }, 'first empty branch, in the order shown');
  assert.deepEqual(firstPriceToFix({ ...none, drafts: { a: { base: '40', variantPrices: {} } } }), { field: 'b:base', card: 'b' }, 'a fixed branch is passed over');
  assert.deepEqual(firstPriceToFix({ ...none, drafts: { a: { base: '0', variantPrices: {} } } }), { field: 'a:base', card: 'a' }, 'a typed 0 is a problem');
  assert.deepEqual(firstPriceToFix({ ...none, drafts: { a: { base: '4x', variantPrices: {} } } }), { field: 'a:base', card: 'a' }, 'so is a typo');
  assert.deepEqual(firstPriceToFix({ ...none, branchOn: { a: false, b: true, c: true } }), { field: 'b:base', card: 'b' }, 'a branch that is off has no price to fix');
  assert.equal(firstPriceToFix({ ...none, branchOn: { a: false, b: false, c: false } }), null, 'every branch off: no price is at fault');
  assert.equal(firstPriceToFix({ ...none, drafts: { a: { base: '1', variantPrices: {} }, b: { base: '2', variantPrices: {} }, c: { base: '3', variantPrices: {} } } }), null, 'all priced: nothing to fix');
  // options: the first empty option in the first branch that has one
  assert.deepEqual(firstPriceToFix({ ...none, variants: v, drafts: { a: { base: '', variantPrices: { v1: '30' } } } }), { field: 'a:v2', card: 'a' });
  assert.deepEqual(firstPriceToFix({ ...none, variants: v, drafts: { a: { base: '', variantPrices: { v1: '30', v2: '50' } } } }), { field: 'b:v1', card: 'b' });
  // same for all: no card, just the field
  assert.deepEqual(firstPriceToFix({ ...none, mode: 'same' }), { field: 'same:base' });
  assert.equal(firstPriceToFix({ ...none, mode: 'same', uniformBase: '45' }), null);
  assert.deepEqual(firstPriceToFix({ ...none, mode: 'same', variants: v, uniformPrices: { v1: '30' } }), { field: 'same:v2' });
  assert.equal(priceProblem('0.00'), 'Must be above ₱0');
  assert.equal(priceProblem(''), null, 'empty is only a problem once a save was tried');
  console.log('2. first price to fix: ok');
}

// ---------------------------------------------------------------- 3. wiring
{
  const sheet = read('src/components/BottomSheet.tsx');
  assert.match(sheet, /const next = revealScrollOffset\(\{/);
  assert.match(sheet, /if \(next !== null\) scrollView\.scrollTo\(\{ y: next, animated: false \}\);\n\s+options\?\.focus\?\.focus\(\);/, 'focus comes after the scroll, and only when asked for');
  assert.match(sheet, /<View ref=\{contentRef\} collapsable=\{false\} style=\{styles\.scrollContent\}>/);
  assert.match(sheet, /viewportHeightRef\.current = event\.nativeEvent\.layout\.height;/, 'the visible area is measured live, so the keyboard is already subtracted');

  const step = read('src/features/products/BranchPricingStep.tsx');
  assert.match(step, /useEffect\(\(\) => \{\n\s+if \(!revealKey\) return;/, 'nothing happens until a save was refused');
  assert.match(step, /\}, \[revealKey\]\);/, 'only a refused save triggers it, never typing or a re-render');
  assert.match(step, /reveal\(\(first\.card \? cards\.current\.get\(first\.card\) : undefined\) \?\? input, \{ focus: input \}\);/, 'the branch card is shown (with its name) and the price field is focused');
  assert.match(step, /if \(firstCard\) reveal\(firstCard\);/, 'no price at fault (every branch off): show the cards, no keyboard');

  const editor = read('src/features/products/VariantListEditor.tsx');
  assert.match(editor, /if \(revealKey\) pendingReveal\.current = true;/);
  assert.match(editor, /if \(variants\.some\(\(variant\) => !expanded\[variant\.key\]\)\) return;\n\s+pendingReveal\.current = false;\n\s+requestAnimationFrame\(/, 'waits until every card is open, then measures on the next frame (no fixed delay)');
  assert.doesNotMatch(editor, /setTimeout\(/, 'no timer guess');
  assert.match(editor, /if \(missingDrink\) \{\n\s+reveal\(cardRefs\.current\.get\(missingDrink\.key\) \?\? null\);\n\s+return;\n\s+\}/, 'a missing drink shows the card, no keyboard');
  assert.match(editor, /\}, \[error, revealKey\]\);/, 'the cards open again for a repeated refusal');

  for (const [name, src] of [['create', read('src/features/products/CreateProductWizard.tsx')], ['edit', read('src/features/products/EditProductWizard.tsx')]]) {
    assert.match(src, /function failStep3\(message: string\) \{\n    setStep3Error\(message\);\n    setStep3RevealKey\(\(key\) => key \+ 1\);/, `${name}: a refused save asks the step to show the first problem`);
    assert.match(src, /function failStep2\(message: string\) \{\n    setStep2Error\(message\);\n    setStep2RevealKey\(\(key\) => key \+ 1\);/);
    assert.doesNotMatch(src, /setStep3Error\('/, `${name}: no refusal skips the reveal`);
    assert.match(src, /revealKey=\{step3RevealKey\}/);
    assert.match(src, /revealKey=\{step2RevealKey\}/);
    assert.match(src, /ref=\{nameFieldRef\}/);
    assert.match(src, /ref=\{skuFieldRef\}/);
    // step changes still start at the top
    assert.match(src, /const scrollToTop = useSheetScrollToTop\(\);\n  useEffect\(\(\) => \{\n    scrollToTop\(\);\n  \}, \[step, scrollToTop\]\);/, `${name}: scroll-to-top on a step change is kept`);
  }
  console.log('3. wiring: ok');
}

console.log('validation_reveal: ALL PASS');
