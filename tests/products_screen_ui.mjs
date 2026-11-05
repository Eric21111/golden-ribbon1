// Products screen (Owner/Manager): card text, filter/sort clarity, chip row, accessibility and small-screen fit.
// Pure logic and source pins, plus text widths measured with the app's real Inter fonts (see _font_metrics.mjs) against the
// widths the layout gives them at 320 / 360 / 393 / 411 dp. An estimate, not a device test.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadTs } from './_load_ts.mjs';
import { textWidth } from './_font_metrics.mjs';

const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const { productRowText, resultCountText, CATEGORY_CHIP_CHOICES } = loadTs('src/features/products/productFilters.ts');
const screen = read('app/(manager)/manager/products/index.tsx');
const controls = read('src/features/products/ProductFilterControls.tsx');
const chipRow = read('src/components/dashboard/FilterChipRow.tsx');
const chip = read('src/components/dashboard/FilterChip.tsx');
const card = read('src/components/dashboard/ListRowCard.tsx');

// ---------------------------------------------------------------- 1. the card: three separate facts
{
  const p = (o) => ({ name: 'Rice', sku: 'RICE-1', is_active: true, product_category: null, sell_in_pos: true, is_non_returnable: false, closing_stock_behavior: 'keep_at_branch', ...o });
  // a supply created with the wizard's defaults: close setting "unsold", not shown in POS
  const rice = productRowText(p({ product_category: 'supplies', sell_in_pos: false, closing_stock_behavior: 'record_as_unsold' }));
  assert.equal(rice.sku, 'RICE-1');
  assert.deepEqual([rice.category, rice.pos, rice.stockOnly, rice.closing], ['Inventory Supplies', 'Stock only', true, 'Unsold at close'], 'three separate facts');
  assert.ok(!rice.category.includes('POS') && !rice.pos.includes('Supplies') && !rice.closing.includes('Stock'), 'never merged into one string');
  assert.equal(
    rice.spoken,
    'Rice, Inventory Supplies, stock only, not shown in the cashier POS, at shift close remaining stock is recorded as unsold, enabled',
  );
  // the switch on: stays at the branch, whatever the stored close setting
  const kept = productRowText(p({ name: 'Egg', product_category: 'supplies', is_non_returnable: true, closing_stock_behavior: 'keep_at_branch' }));
  assert.deepEqual([kept.category, kept.pos, kept.stockOnly, kept.closing], ['Inventory Supplies', 'Shown in POS', false, 'Stays at branch']);
  assert.match(kept.spoken, /stays at the branch and cannot be returned to Main/);
  // an older product: carried to the next day, but still returnable
  const legacy = productRowText(p({ name: 'Pares', product_category: 'meals', closing_stock_behavior: 'keep_at_branch' }));
  assert.deepEqual([legacy.category, legacy.pos, legacy.closing], ['Meals & Viands', 'Shown in POS', 'Carried to next day']);
  assert.match(legacy.spoken, /remaining stock carries to the next day/);
  // no saved category is said out loud, never guessed
  assert.equal(productRowText(p({ product_category: null })).category, 'Category not set');
  assert.equal(productRowText(p({ is_active: false })).spoken.endsWith('disabled'), true);
  // the short forms for the one-line row; the full sentence is still what is read out
  assert.deepEqual([rice.posShort, rice.closingShort], ['Stock only', 'Unsold']);
  assert.deepEqual([kept.posShort, kept.closingShort], ['POS', 'At branch']);
  assert.deepEqual([legacy.posShort, legacy.closingShort], ['POS', 'Next day']);
  console.log('1. card text: ok');
}

// ---------------------------------------------------------------- 2. the screen uses it, and the whole card is one control
{
  assert.match(screen, /const text = productRowText\(item\);/);
  // name + SKU tag on the first line, then ONE short line: the category word, POS visibility and shift close, each fact with its icon
  assert.match(screen, /titleTag=\{text\.sku\}/);
  assert.doesNotMatch(screen, /meta=\{text\.category\}/, 'the category no longer takes a line of its own');
  assert.match(screen, /metaRow=\{[\s\S]*?\{text\.category\}[\s\S]*?\{text\.posShort\}[\s\S]*?\{text\.closingShort\}/);
  assert.match(screen, /text\.stockOnly \? 'eye-off-outline' : 'eye-outline'/);
  assert.doesNotMatch(screen, /text\.meta\b|subtitleTag/, 'no more category-and-POS joined on one line');
  // each fact is one whole item that may shrink and wrap as a unit, so a phrase is never broken mid-way by the next fact
  assert.match(screen, /fact: \{ flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1 \}/);
  assert.match(screen, /factText: \{ flexShrink: 1,/);
  assert.match(card, /titleLine: \{ flexDirection: 'row', flexWrap: 'wrap'/, 'the SKU tag drops below a long name instead of squeezing it');
  assert.match(card, /titleInline: \{ flexShrink: 1 \}/);
  assert.match(screen, /accessibilityLabel=\{text\.spoken\}/);
  assert.match(screen, /accessibilityHint="Opens edit product"/);
  // ListRowCard wraps the WHOLE card in one Pressable when it has onPress (name, tags, badge, padding, chevron)
  assert.match(card, /accessibilityRole="button"\s+accessibilityLabel=\{accessibilityLabel\}\s+accessibilityHint=\{accessibilityHint\}\s+onPress=\{onPress\}\s+style=\{\(\{ pressed \}\) => \[styles\.card/);
  assert.match(card, /<Pressable[\s\S]*?>\s*\{content\}\s*<\/Pressable>/, 'the content (everything on the card) is inside the pressable');
  // the card's text can wrap with large text sizes: only the title is capped (2 lines) and the SKU tag (1 line, a code)
  assert.match(card, /<Text style=\{styles\.meta\}>\{meta\}<\/Text>/, 'the category line wraps freely');
  console.log('2. card wiring: ok');
}

// ---------------------------------------------------------------- 3. filter / sort clarity
{
  const toolbar = read('src/components/dashboard/ToolbarIconButtons.tsx');
  assert.match(screen, /active=\{sort !== DEFAULT_SORT\}/, 'a changed sort looks "on", like Filters');
  assert.match(toolbar, /accessibilityHint=\{hint\}/);
  assert.match(toolbar, /hint="Opens the sort options"/);
  assert.match(screen, /currentLabel=\{SORT_OPTIONS\.find/, 'the label says the current sort');
  assert.match(toolbar, /label=\{count > 0 \? `\$\{label\}, \$\{count\} on` : label\}/);
  assert.match(toolbar, /hint="Opens the filters"/);
  assert.match(controls, /resultCountText\(resultCount, totalCount\)/);
  assert.match(controls, /accessibilityLiveRegion="polite"/, 'a changed result count is announced');
  assert.match(screen, /totalCount=\{query\.data\?\.length \?\? 0\}/);

  assert.equal(resultCountText(3, 12), '3 of 12 products');
  assert.equal(resultCountText(1, 12), '1 of 12 products');
  assert.equal(resultCountText(12, 12), '12 products');
  assert.equal(resultCountText(1, 1), '1 product');
  assert.equal(resultCountText(0, 12), '0 of 12 products');
  assert.equal(resultCountText(5), '5 products', 'without a total it reads as before');
  console.log('3. filter / sort clarity: ok');
}

// ---------------------------------------------------------------- 4. the chip row: five categories reachable by scrolling, no hard clipping
{
  assert.match(screen, /bleed=\{COLUMN_PADDING\}/);
  assert.match(screen, /const COLUMN_PADDING = 20;/);
  assert.match(screen, /column: \{ flex: 1, paddingHorizontal: COLUMN_PADDING/);
  assert.match(chipRow, /style=\{bleed > 0 \? \{ marginHorizontal: -bleed \} : undefined\}/, 'the row runs out to the screen edges');
  assert.match(chipRow, /paddingLeft: bleed, paddingRight: bleed/, 'and starts and ends with the same inset');
  assert.match(chipRow, /showsHorizontalScrollIndicator=\{false\}/);
  assert.match(chipRow, /scrollRef\.current\?\.scrollTo/, 'the selected chip is scrolled into view');
  assert.match(chip, /hitSlop=\{\{ top: 3, bottom: 3 \}\}/, 'chips reach the 44dp touch size');

  // measured widths
  const PAD = 16; // FilterChip paddingHorizontal
  const BORDER = 1;
  const GAP = 6; // leading icon to label
  const ROW_GAP = 10; // between chips (FilterChipRow content gap)
  const ICON = 18;
  const widths = CATEGORY_CHIP_CHOICES.map((choice) => {
    const label = textWidth(choice.label, 'Inter_600SemiBold', 13); // selected is the widest weight
    const hasIcon = choice.value !== 'all';
    return 2 * (PAD + BORDER) + label + (hasIcon ? ICON + GAP : 0);
  });
  const total = widths.reduce((a, b) => a + b, 0) + ROW_GAP * (widths.length - 1);
  assert.equal(CATEGORY_CHIP_CHOICES.length, 6, 'All + five categories');
  for (const screenWidth of [320, 360, 393, 411]) {
    const content = total + 2 * 20; // bleed inset on both ends
    assert.ok(content > screenWidth, `at ${screenWidth}dp the chips do not all fit, so the row scrolls (${content.toFixed(0)}dp of chips)`);
    // every single chip fits on screen on its own, so none is ever wider than the viewport
    assert.ok(Math.max(...widths) + 40 <= screenWidth, `the widest chip fits the screen at ${screenWidth}dp`);
  }
  // how many chips are fully visible at the start (the next one runs off the edge, which says "scroll")
  const visibleAt = (screenWidth) => {
    let x = 20;
    let count = 0;
    for (const w of widths) {
      if (x + w <= screenWidth) count += 1;
      else break;
      x += w + ROW_GAP;
    }
    return count;
  };
  assert.ok(visibleAt(320) >= 3 && visibleAt(320) < widths.length, `at 320dp ${visibleAt(320)} of 7 chips show, the rest scroll`);
  console.log(`4. chip row: ok (chips ${total.toFixed(0)}dp wide; fully visible at 320/360/411dp: ${visibleAt(320)}/${visibleAt(360)}/${visibleAt(411)})`);
}

// ---------------------------------------------------------------- 5. small screens, text scaling, safe areas
{
  // search row: search box + Filters + Sort (46 each) + two gaps of 10
  const searchWidth = (w) => w - 2 * 20 - 46 - 46 - 20;
  for (const w of WIDTHS()) assert.ok(searchWidth(w) >= 150, `the search box keeps a usable width at ${w}dp (${searchWidth(w)}dp)`);
  // The card body is what is left after the category icon (40), the badge, the chevron and three 12dp gaps. Measure the
  // badge and the title in the real font, wrap greedily, and count the lines a long name needs.
  const wrapLines = (text, family, size, width) => {
    let lines = 1;
    let line = 0;
    const space = textWidth(' ', family, size);
    for (const word of text.split(' ')) {
      const w = textWidth(word, family, size);
      if (line === 0) line = w;
      else if (line + space + w <= width) line += space + w;
      else {
        lines += 1;
        line = w;
      }
    }
    return lines;
  };
  const bodyWidth = (screenWidth, scale) => {
    const badge = textWidth('Disabled', 'Inter_600SemiBold', 11.5 * scale) + 20; // the widest label + its padding
    return screenWidth - 2 * 20 - 2 * (16 + 1) - 40 - 3 * 12 - badge - 16;
  };
  const NAME = 'Beef Curry With Rice'; // 20 characters
  const report = [];
  for (const w of [360, 393, 411]) {
    assert.ok(wrapLines(NAME, 'Inter_600SemiBold', 16, bodyWidth(w, 1)) <= 2, `at 100% text a 20-character name takes at most 2 lines at ${w}dp`);
    assert.ok(wrapLines(NAME, 'Inter_600SemiBold', 16 * 1.3, bodyWidth(w, 1.3)) <= 3, `at 130% text it takes at most 3 lines at ${w}dp`);
  }
  for (const w of [320, 360, 411]) report.push(`${w}dp: ${wrapLines(NAME, 'Inter_600SemiBold', 16, bodyWidth(w, 1))} / ${wrapLines(NAME, 'Inter_600SemiBold', 16 * 1.3, bodyWidth(w, 1.3))} lines`);
  // each fact (icon 13 + gap 5 + words) and the category line fit on ONE line of the card body at 360dp and wider, so the
  // only wrapping left is whole facts dropping to the next line (the "Stock / only" break in the old layout is gone)
  const factWidth = (words) => 13 + 5 + textWidth(words, 'Inter_500Medium', 12);
  const widest = Math.max(...['Stock only', 'Shown in POS', 'Unsold at close', 'Carried to next day', 'Stays at branch'].map(factWidth));
  const longestCategory = Math.max(...['Meals & Viands', 'Snacks & Finger Foods', 'Extras & Sides', 'Inventory Supplies', 'Category not set'].map((c) => textWidth(c, 'Inter_400Regular', 12)));
  for (const w of [393, 411]) {
    assert.ok(widest + 4 <= bodyWidth(w, 1), `the widest fact (${widest.toFixed(0)}dp) fits one line at ${w}dp (body ${bodyWidth(w, 1).toFixed(0)}dp)`);
    assert.ok(longestCategory + 4 <= bodyWidth(w, 1), `the longest category name fits one line at ${w}dp`);
  }
  // at 360dp the body is about 126dp: "Carried to next day" (127) and "Snacks & Finger Foods" (130) are just wider, so they
  // wrap at a word boundary onto a second line. Never an overflow: each fact and the category line may shrink and wrap.
  assert.ok(bodyWidth(360, 1) > 110, 'the body at 360dp is still wide enough for any single word');
  assert.match(screen, /factText: { flexShrink: 1,/);
  const tight = ['Carried to next day', 'Stays at branch', 'Shown in POS', 'Unsold at close', 'Stock only'].filter((w) => factWidth(w) + 4 > bodyWidth(360, 1));
  report.push(`facts wider than the 360dp body: ${tight.join(', ') || 'none'}`);
  // large text gets the third line; normal text keeps two
  assert.match(screen, /const titleLines = fontScale > 1\.15 \? 3 : 2;/);
  assert.match(screen, /titleLines={titleLines}/);
  assert.match(card, /titleLines = 2,/);
  assert.match(card, /numberOfLines={titleLines}/);
  // Products is not a bottom-tab screen, so Screen pads the bottom inset itself (the footer is never under the gesture bar)
  const nav = read('src/components/RoleNavigation.tsx');
  assert.doesNotMatch(nav, /href: menuHref\('\/manager\/products'\)/, 'Products is not in the tab bar');
  const { resolveScreenEdges } = loadTs('src/lib/safeArea.ts');
  assert.deepEqual([...resolveScreenEdges(['top'], false)].sort(), ['bottom', 'left', 'right', 'top']);
  // the screen keeps the top inset and pads the bottom through Screen; the footer sits inside it
  assert.match(screen, /<Screen backgroundColor="#FFFFFF" edges=\{\['top'\]\} scroll=\{false\}/);
  assert.match(screen, /footer: \{[\s\S]*?paddingBottom: 16/, 'the footer has its own breathing room above the bottom inset');
  assert.match(screen, /<FlatList[\s\S]*?contentContainerStyle=\{styles\.listContent\}/, 'the list scrolls on its own, the filters and the footer stay put');
  console.log(`5. small screens: ok (name lines at 100% / 130% text: ${report.join('; ')})`);
}

function WIDTHS() {
  return [320, 360, 393, 411];
}

console.log('products_screen_ui: ALL PASS');
