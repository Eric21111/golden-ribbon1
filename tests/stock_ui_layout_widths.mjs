// Small-screen layout guard for the stock UI, without a device: real Inter text widths (see _font_metrics.mjs) against the
// widths the layout gives them at 320, 360, 393 and 411 dp. The model reads the style numbers it depends on from the source,
// so a padding or gap change that breaks the fit fails here. It is an estimate (no kerning, no OS font scaling), not a
// substitute for looking at a real Android screen.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { textWidth } from './_font_metrics.mjs';

const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const editor = read('src/features/products/VariantListEditor.tsx');
const recipe = read('src/features/products/VariantRecipePreview.tsx');
const wizard = read('src/features/products/CreateProductWizard.tsx');
const edit = read('src/features/products/EditProductWizard.tsx');
const sheet = read('src/components/BottomSheet.tsx');
const button = read('src/components/dashboard/ManagerActionButton.tsx');
const touch = read('src/features/products/touchTargets.ts');

const num = (source, pattern, what) => {
  const match = source.match(pattern);
  assert.ok(match, `could not read ${what} from the source`);
  return Number(match[1]);
};

// ---- the numbers the model depends on (read from the source)
const MIN_TOUCH = num(touch, /MIN_TOUCH_TARGET = (\d+)/, 'MIN_TOUCH_TARGET');
const SHEET_SIDE = 16; // spacing.md: BottomSheet pads each side with max(inset, spacing.md); inset is 0 in portrait
assert.match(sheet, /paddingLeft: Math\.max\(insets\.left, spacing\.md\)/);
const CARD_PADDING = num(editor, /  card: \{[^}]*?padding: (\d+),/s, 'card padding');
const CARD_BORDER = num(editor, /  card: \{[^}]*?borderWidth: (\d+),/s, 'card border');
const FOOTER_GAP = num(editor, /  footer: \{[^}]*?gap: (\d+)/s, 'card footer gap');
const REMOVE_WIDTH = num(editor, /  removeIconButton: \{\s*width: (\d+)/, 'trash button width');
const LINE_GAP = num(recipe, /  line: \{[^}]*?gap: (\d+)/s, 'stock line gap');
const BUTTON_ROW_GAP = num(wizard, /  buttonRow: \{[^}]*?gap: (\d+)/, 'wizard button row gap');
const BTN_FONT = num(button, /primaryLabel: \{[^}]*?fontSize: (\d+)/, 'button label size');
const STEPPER = MIN_TOUCH + 36 + MIN_TOUCH; // stepTouch + quantity input (36) + stepTouch
assert.match(recipe, /quantityInput: \{\s*width: 36,/, 'quantity input width');
const REMOVE_TOUCH = MIN_TOUCH; // removeButton / lock

const WIDTHS = [320, 360, 393, 411];
const sheetInner = (w) => w - 2 * SHEET_SIDE;
const cardInner = (w) => sheetInner(w) - 2 * (CARD_PADDING + CARD_BORDER);
const MARGIN = 6; // approximation safety margin, dp

// ---- 1. the wizard footer: "Back" + "Next: Pricing" share the row, one column each
{
  const label = 'Next: Pricing';
  assert.match(wizard, /label="Next: Pricing"/);
  assert.match(edit, /label="Next: Pricing"/);
  const need = textWidth(label, 'Inter_700Bold', BTN_FONT);
  for (const w of WIDTHS) {
    const column = (sheetInner(w) - BUTTON_ROW_GAP) / 2;
    assert.ok(need + MARGIN <= column, `"${label}" needs ${need.toFixed(0)}dp but its button is ${column.toFixed(0)}dp at ${w}dp wide`);
  }
  // the longer wording the first version used did NOT fit the narrow screens: this is why it was shortened
  const longer = textWidth('Next: Branch Pricing', 'Inter_700Bold', BTN_FONT);
  assert.ok(longer + MARGIN > (sheetInner(320) - BUTTON_ROW_GAP) / 2, '"Next: Branch Pricing" is wider than the button at 320dp');
  // every other footer label, for the record
  for (const text of ['Back', 'Next', 'Create product', 'Save changes', 'Save product']) {
    const width = textWidth(text, 'Inter_700Bold', BTN_FONT);
    if (!/Save|Create/.test(text)) continue;
    assert.ok(width + MARGIN <= sheetInner(320), `${text} fits the full-width button`);
  }
  console.log('1. footer buttons: ok');
}

// ---- 2. "Done editing" next to the trash button
{
  const need = textWidth('Done editing', 'Inter_700Bold', num(editor, /doneButtonText: \{[^}]*?fontSize: (\d+)/, 'done font')) + 18 + 6; // + check icon + gap
  for (const w of WIDTHS) {
    const done = cardInner(w) - REMOVE_WIDTH - FOOTER_GAP;
    assert.ok(need + MARGIN <= done, `"Done editing" needs ${need.toFixed(0)}dp but the button is ${done.toFixed(0)}dp at ${w}dp wide`);
  }
  assert.match(editor, /doneButton: \{[^}]*?minHeight: 48/s, 'Done editing is at least 48dp tall');
  console.log('2. Done editing: ok');
}

// ---- 3. the base product row: name + "Base product · Required" beside the stepper and the lock
{
  const room = (w) => cardInner(w) - STEPPER - REMOVE_TOUCH - 2 * LINE_GAP;
  const sub = textWidth('Base product · Required', 'Inter_400Regular', 12);
  // it is wider than the room on a small screen, so it must be allowed to wrap onto two lines (it used to truncate)
  assert.ok(sub > room(360), 'the label is wider than the room beside the stepper at 360dp');
  assert.match(recipe, /numberOfLines=\{locked \? 2 : 1\}/, 'the locked label may wrap to two lines');
  // each of its two halves fits on a line at every width, so wrapping never truncates it
  for (const w of WIDTHS) {
    const longestWord = Math.max(...'Base product · Required'.split(' ').map((word) => textWidth(word, 'Inter_400Regular', 12)));
    assert.ok(longestWord + MARGIN <= room(w), `a word of the label does not fit on a line at ${w}dp`);
  }
  // the name keeps one line (ellipsis) by design; flag the widest sensible meal name
  const name = textWidth('Beef Curry', 'Inter_600SemiBold', 14);
  console.log(`3. base product row: ok (room ${room(320).toFixed(0)} / ${room(360).toFixed(0)} / ${room(393).toFixed(0)} / ${room(411).toFixed(0)}dp; "Beef Curry" ${name.toFixed(0)}dp)`);
}

// ---- 4. Extras mode rows and the add chip
{
  const radio = 20 + 10 + textWidth('Take from other items', 'Inter_500Medium', 14);
  const chip = 8 + 14 + 2 + textWidth('Add Stock Item', 'Inter_600SemiBold', 13) + 12; // padding + icon + gap + label + padding (approx.)
  for (const w of WIDTHS) {
    assert.ok(radio + MARGIN <= cardInner(w), `the mode row fits at ${w}dp`);
    assert.ok(chip <= cardInner(w), `the Add Stock Item chip fits at ${w}dp`);
  }
  assert.match(recipe, /chipRow: \{ flexDirection: 'row', flexWrap: 'wrap'/, 'chips wrap onto the next line instead of overflowing');
  console.log('4. mode rows + chips: ok');
}

// ---- 5. touch targets and wrapping
{
  assert.match(recipe, /modeRow: \{[^}]*?minHeight: MIN_TOUCH_TARGET/, 'radio rows are 44dp tall');
  assert.match(recipe, /chipTouch: \{ minHeight: MIN_TOUCH_TARGET/, 'chips are 44dp tall');
  assert.match(recipe, /stepTouch: \{ width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET/, 'steppers are 44dp');
  assert.match(recipe, /removeButton: \{ width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET/, 'remove / lock are 44dp');
  // the deduction preview wraps freely (no numberOfLines) and its text column can shrink
  const preview = read('src/features/products/DeductionPreview.tsx');
  assert.doesNotMatch(preview, /numberOfLines/, 'preview text wraps, never truncates');
  assert.match(preview, /copy: \{ flex: 1,/, 'the text column takes the remaining width and wraps');
  console.log('5. touch targets + wrapping: ok');
}

console.log('stock_ui_layout_widths: ALL PASS');
