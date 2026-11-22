// One KPI-card standard on every role's screens: money, counts and quantities are never cut off ("…"), tiles grow instead of
// clipping, and a pair of tiles stacks into full-width rows when a figure would not fit its half of the row.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { textWidth } from './_font_metrics.mjs';
import { loadTs } from './_load_ts.mjs';

const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const {
  estimateFigureWidth,
  shouldStackSummaryKpis,
  shouldStackStatTiles,
  figureFits,
  longestWordWidth,
  FIGURE_MAX_FONT_SCALE,
  COMPACT_H_PAD,
  SQUARE_H_PAD,
} = loadTs('src/features/reports/reportDisplay.ts');
const { quantityBoxWidth, QUANTITY_BOX_MAX_FONT_SCALE } = loadTs('src/lib/format.ts');

// ---- 1. the width estimate is built from the app's real font: never narrower than it (by more than a few percent), and not
// wildly wider (a "1" is a narrow digit, so a figure full of them is the worst case, ~25% over)
for (const sample of ['0', '47', '1812', '₱0.00', '₱363.00', '₱9,420.00', '₱11,802.50', '₱355,397.00', '₱1,234,567.89', '₱10,000,000.00']) {
  const real = textWidth(sample.replace('₱', ''), 'Inter_700Bold', 26) + (sample.includes('₱') ? 0.64 * 26 : 0);
  const estimate = estimateFigureWidth(sample);
  assert.ok(estimate >= real * 0.97, `${sample}: estimate ${estimate.toFixed(1)} is not narrower than the real ${real.toFixed(1)}`);
  assert.ok(estimate <= real * 1.3,`${sample}: estimate ${estimate.toFixed(1)} is not wildly wider than the real ${real.toFixed(1)}`);
}
assert.equal(COMPACT_H_PAD, 28, 'a compact tile pads 14 + 14');
assert.equal(SQUARE_H_PAD, 40, 'a regular tile pads 20 + 20');

// ---- 2. when two tiles share a row, and when they stack
// report screens (compact tiles, the existing rule is unchanged)
assert.equal(shouldStackSummaryKpis('47', '21', 320), false);
assert.equal(shouldStackSummaryKpis('355397.00', '21', 320), true);
// the Owner Today Quickview (compact tiles, a 312 / 344dp column on a 360 / 392dp phone): a four-digit branch total stays beside another on the wider phone,
// and takes full rows on 360dp rather than being squeezed (Android does not always shrink a figure to fit, so it must fit at full size)
assert.equal(shouldStackSummaryKpis('₱9,420.00', '₱2,382.50', 312, 1, COMPACT_H_PAD), true, 'on 360dp a four-digit pair stacks instead of being squeezed');
assert.equal(shouldStackSummaryKpis('₱9,420.00', '₱2,382.50', 344, 1, COMPACT_H_PAD), false, 'on 392dp it stays two columns');
assert.equal(shouldStackSummaryKpis('₱9,420.00', '₱0.00', 344, 1, COMPACT_H_PAD), false);
// a seven-figure total does not fit half a row: it takes a full row
assert.equal(shouldStackSummaryKpis('₱1,234,567.89', '₱0.00', 344, 1, COMPACT_H_PAD), true, '₱1,234,567.89 stacks');
assert.equal(shouldStackSummaryKpis('₱1,234,567.89', '₱0.00', 312, 1, SQUARE_H_PAD), true);
// Manager / Cashier dashboards (regular tiles): a count beside a count stays, a large sales figure takes the full row
assert.equal(shouldStackSummaryKpis('12', '7', 312, 1, SQUARE_H_PAD), false, 'two counts share a row');
assert.equal(shouldStackSummaryKpis('₱11,802.50', '120', 312, 1, SQUARE_H_PAD), true, "today's sales beside a count stacks when it would not fit");
assert.equal(shouldStackSummaryKpis('₱350.00', '8', 312, 1, SQUARE_H_PAD), false, 'a small sales figure still shares the row');
// a larger system font makes everything wider, so the same figures stack
assert.equal(shouldStackSummaryKpis('₱9,420.00', '₱2,382.50', 344, 1.3, COMPACT_H_PAD), true, 'font scale 1.3 stacks');
assert.equal(shouldStackSummaryKpis('12', '7', 312, 2, SQUARE_H_PAD), true, 'font scale 2 stacks even counts');
// a very narrow screen
assert.equal(shouldStackSummaryKpis('12', '7', 150, 1, SQUARE_H_PAD), true);

// ---- 2b. the pair rule the app really uses: figures stop growing at 1.3x, labels do not
const pairOf = (leftValue, leftLabel, rightValue, rightLabel, width, fontScale, hPad) =>
  shouldStackStatTiles({ left: { value: leftValue, label: leftLabel }, right: { value: rightValue, label: rightLabel }, width, fontScale, hPad });
assert.equal(FIGURE_MAX_FONT_SCALE, 1.3);
assert.equal(pairOf('12', 'Orders', '7', 'Sales', 312, 2, SQUARE_H_PAD), false, 'two small counts with short labels still share a row at 2x (the figures stop at 1.3x)');
assert.equal(pairOf('12', 'Pending incoming', '7', 'Returns in transit', 312, 2, SQUARE_H_PAD), true, 'a long label word does not fit its half at 2x: stack');
assert.equal(pairOf('12', 'Pending incoming', '7', 'Returns in transit', 312, 1, SQUARE_H_PAD), false, 'the same pair is fine at 1x');
assert.equal(pairOf('12', 'Reconciled shifts', '7', 'Pending shifts', 280, 1.5, COMPACT_H_PAD), true, '"Reconciled" at 1.5x does not fit half of 280dp');
assert.equal(pairOf('₱1,234,567.89', 'Total', '0', 'Orders', 344, 1, COMPACT_H_PAD), true, 'a seven-figure amount stacks');
assert.equal(pairOf('₱9,420.00', 'SM1', '₱2,382.50', 'SM2', 344, 1, COMPACT_H_PAD), false, 'branch totals share a row at 1x on 392dp');
assert.equal(shouldStackStatTiles({ left: { value: '12', label: 'Orders' }, width: 312, fontScale: 1, hPad: SQUARE_H_PAD }), false, 'an odd tile out is judged on its own');
assert.equal(shouldStackStatTiles({ left: { value: '12' }, right: { value: '7' }, width: 90, fontScale: 1, hPad: SQUARE_H_PAD }), true, 'a very narrow row stacks');
assert.ok(longestWordWidth('Pending incoming') > longestWordWidth('Orders'), 'the longest word is what must fit');
// a figure that does not fit beside the icon of a wide tile puts the icon above it instead of being shrunk hard
const wideTextColumn = (tileWidth) => tileWidth - (16 + 16 + 36 + 14);
assert.equal(figureFits('₱1,234,567.89', wideTextColumn(272), 1), false, 'at 320dp even at 1x a seven-figure amount needs the whole tile width: the icon goes on top');
assert.equal(figureFits('₱1,234,567.89', wideTextColumn(312), 1), true, 'on a 360dp phone it fits beside the icon');
assert.equal(figureFits('₱1,234,567.89', wideTextColumn(272), 1.3), false, 'at 1.3x it does not: the icon goes on top');
assert.ok((272 - 32) / (estimateFigureWidth('₱1,234,567.89') * 1.3) > 0.9, 'on top, with the whole tile width, it needs under a 10% shrink at 1.3x (the icon-on-top layout is the last resort before shrinking)');
assert.equal(figureFits('₱1,802.50', wideTextColumn(312), 1), true, 'a normal sales figure fits beside the icon on a 360dp phone');
assert.equal(figureFits('₱12.00', wideTextColumn(272), 2), true, 'a small amount fits at 2x because figures stop growing at 1.3x');

// ---- 2c. quantity boxes: sized for the digits and for the (capped) font scale
assert.equal(QUANTITY_BOX_MAX_FONT_SCALE, 1.3);
assert.equal(quantityBoxWidth('5', { min: 28, fontSize: 13 }), 28, 'a short number keeps the minimum width');
assert.ok(quantityBoxWidth('999999', { min: 28, fontSize: 13 }) >= 6 * 13 * 0.66, 'six digits fit');
assert.ok(quantityBoxWidth('1234', { min: 48, fontSize: 15, fontScale: 2 }) === quantityBoxWidth('1234', { min: 48, fontSize: 15, fontScale: 1.3 }), 'beyond 1.3x the input is capped, so the box stops growing too');
assert.ok(quantityBoxWidth('1234', { min: 48, fontSize: 15, fontScale: 1.3 }) > quantityBoxWidth('1234', { min: 48, fontSize: 15, fontScale: 1 }), 'at 1.3x the box is wider than at 1x');

// ---- 3. the tile itself grows instead of clipping, and nothing in it is cut
const tile = read('src/components/dashboard/StatTile.tsx');
assert.match(tile, /tileSquare: \{ minHeight: 152 \}/);
assert.match(tile, /tileWide: \{ minHeight: 92 \}/);
assert.match(tile, /tileWideWrap: \{ minHeight: 118 \}/);
assert.doesNotMatch(tile, /height: (152|92|118)\b/, 'no fixed tile heights');
assert.doesNotMatch(tile, /numberOfLines=\{2\}/, 'the label and the caption are never cut at two lines');
assert.doesNotMatch(tile, /adjustsFontSizeToFit=\{!statusWrap && !caption\}/, 'a figure with a caption shrinks to fit too');
const currency = read('src/components/dashboard/CurrencyText.tsx');
assert.match(currency, /minimumFontScale \?\? 0\.6/, 'an amount can shrink to 60% before anything would be cut');
assert.doesNotMatch(currency, /0\.85/);

// real render of the tile and the summary card with a seven-figure amount and long copy: which Text gets a line limit
{
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const rnw = require('react-native-web');
  const seen = [];
  const rn = { ...rnw, Text: (props) => { seen.push(props); return React.createElement(rnw.Text, props); } };
  const stubs = {
    'react-native': rn,
    '@react-native-vector-icons/ionicons': { __esModule: true, default: () => null },
    'expo-linear-gradient': { LinearGradient: (p) => React.createElement('div', null, p.children) },
  };
  const textOf = (props) => [].concat(props.children).flat(3).filter((c) => typeof c === 'string').join('');
  const LONG = 'Total remitted collections for every selling branch this month';
  const { StatTile } = loadTs('src/components/dashboard/StatTile.tsx', stubs);
  for (const layout of ['square', 'wide']) {
    seen.length = 0;
    renderToStaticMarkup(React.createElement(StatTile, { label: LONG, caption: 'A long caption that needs more than one line to read', value: '₱1,234,567.89', icon: 'cash-outline', layout, emphasis: layout === 'wide' }));
    const label = seen.find((p) => textOf(p) === LONG);
    assert.ok(label && label.numberOfLines === undefined, `${layout}: a long label wraps, it is not cut`);
    const caption = seen.find((p) => textOf(p).startsWith('A long caption'));
    assert.ok(caption && caption.numberOfLines === undefined, `${layout}: a long caption wraps`);
    const amount = seen.find((p) => textOf(p) === '1,234,567.89');
    assert.ok(amount, `${layout}: the whole amount is rendered`);
    const outer = seen.find((p) => p.adjustsFontSizeToFit);
    assert.ok(outer && outer.minimumFontScale === 0.6 && outer.numberOfLines === 1, `${layout}: the amount shrinks (to 60% at most) instead of being cut`);
  }
  const { SummaryCard } = loadTs('src/components/dashboard/SummaryCard.tsx', stubs);
  seen.length = 0;
  renderToStaticMarkup(React.createElement(SummaryCard, { rows: [{ label: 'A long label that is more than one line in a narrow card', value: '₱1,234,567.89' }] }));
  assert.ok(seen.every((p) => p.numberOfLines === undefined), 'summary card rows wrap, never cut');
  const { RecentSaleRow } = loadTs('src/components/dashboard/RecentSaleRow.tsx', stubs);
  seen.length = 0;
  renderToStaticMarkup(React.createElement(RecentSaleRow, { saleNumber: 'SM1-000123', amount: '₱1,234,567.89', cashierName: 'A cashier with a rather long full name', date: 'Nov 22, 2026, 4:51 PM' }));
  assert.ok(seen.every((p) => p.numberOfLines === undefined || p.adjustsFontSizeToFit), 'a sale row: nothing is cut');
}

// ---- 4. every role's tile pairs use the one component
const pair = read('src/components/dashboard/StatTilePair.tsx');
assert.match(pair, /shouldStackStatTiles\(/);
assert.match(pair, /label: left\.label/, 'the labels are measured too');
const tileSrc = read('src/components/dashboard/StatTile.tsx');
assert.match(tileSrc, /maxFontSizeMultiplier=\{FIGURE_MAX_FONT_SCALE\}/, 'a figure stops growing at 1.3x');
assert.match(tileSrc, /iconOnTop/, 'a wide tile puts the icon above a figure that does not fit beside it');
assert.match(tileSrc, /contentWideStacked/);
// controls are at least as tall as before, never a fixed height that clips a wrapped label
const actionButton = read('src/components/dashboard/ManagerActionButton.tsx');
assert.doesNotMatch(actionButton, /^\s+height: 54/m, 'buttons are minHeight 54, not exactly 54');
assert.equal((actionButton.match(/minHeight: 54/g) ?? []).length, 4, 'all four variants');
assert.match(read('src/components/dashboard/ManagerSignOutButton.tsx'), /minHeight: 52/);
// the quantity boxes of the POS and the incoming shipment grow with the number instead of a fixed width
for (const file of ['src/features/pos/PosOrderLine.tsx', 'src/features/pos/PosProductCard.tsx', 'src/features/pos/PosItemSheet.tsx', 'app/(cashier)/cashier/incoming.tsx']) {
  const source = read(file);
  assert.match(source, /quantityBoxWidth\(/, `${file}: a quantity box sized for its digits`);
  assert.match(source, /maxFontSizeMultiplier=\{QUANTITY_BOX_MAX_FONT_SCALE\}/, `${file}: the number stops growing at 1.3x`);
}
assert.match(pair, /compact \? COMPACT_H_PAD : SQUARE_H_PAD/, 'it knows the padding of the tile it lays out');
assert.match(pair, /right \? \(/, 'an odd tile out keeps its half-width slot');
assert.match(read('src/features/reports/OwnerSummaryKpiPair.tsx'), /<StatTilePair left=\{left\} right=\{right\} \/>/, 'report screens use the same pair');
for (const screen of ['app/(owner)/owner/dashboard.tsx', 'app/(manager)/manager/dashboard.tsx', 'app/(cashier)/cashier/dashboard.tsx']) {
  const source = read(screen);
  assert.match(source, /<StatTilePair/, `${screen}: tile pairs stack when a figure does not fit`);
  assert.doesNotMatch(source, /style=\{styles\.half\}\s*\n?\s*(emphasis|icon|compact)/, `${screen}: no hand-made half-width StatTile`);
}
assert.match(read('app/(manager)/manager/dashboard.tsx'), /compact=\{false\}/);
assert.match(read('app/(cashier)/cashier/dashboard.tsx'), /compact=\{false\}/);

// ---- 5. money, counts and quantities are not capped to one line (an amount is cut only by a line limit)
const noLineLimit = (file, patterns) => {
  const source = read(file);
  for (const pattern of patterns) assert.doesNotMatch(source, pattern, `${file}: ${pattern}`);
};
noLineLimit('src/components/dashboard/SummaryCard.tsx', [/numberOfLines/]);
noLineLimit('src/components/dashboard/RecentSaleRow.tsx', [/numberOfLines/]);
noLineLimit('src/components/dashboard/NavTile.tsx', [/numberOfLines=\{1\}/, /numberOfLines=\{2\}/]);
noLineLimit('src/components/dashboard/RouteBanner.tsx', [/numberOfLines/]);
noLineLimit('src/components/dashboard/ManagerBadge.tsx', [/numberOfLines/]);
noLineLimit('src/features/reports/DiscrepancyDetailScreen.tsx', [/styles\.heroValue[^\n]*numberOfLines/, /heroValue, differenceTone\][^\n]*numberOfLines/]);
const remit = read('src/features/reports/ShiftRemittanceScreen.tsx');
assert.match(remit, /<Text style=\{styles\.shortageText\}>/, 'Shortage: ₱… wraps instead of being cut');
assert.match(remit, /<Text style=\{styles\.excessText\}>/, 'Excess: ₱… wraps instead of being cut');
assert.doesNotMatch(remit, /styles\.(metricLabel|dayMeta|tenderMeta)[^>]*numberOfLines/);
const remitDetail = read('src/features/reports/ShiftRemittanceDetailScreen.tsx');
assert.doesNotMatch(remitDetail, /styles\.summary(Label|Value)\}[^>]*numberOfLines/, 'Expected / Actual / Discrepancy quantities are not cut');
for (const file of ['src/features/transfers/TransferListItem.tsx', 'src/features/returns/ReturnListItem.tsx']) {
  noLineLimit(file, [/numberOfLines/]);
}
noLineLimit('src/features/pos/PosProductRow.tsx', [/numberOfLines/]);
noLineLimit('src/features/pos/PosOrderLine.tsx', [/numberOfLines/]);
for (const file of ['src/features/inventory/InventorySetupScreen.tsx', 'src/features/transfers/CreateTransferScreen.tsx', 'src/features/stock/QuantityListScreen.tsx']) {
  noLineLimit(file, [/styles\.available(Text|Label)[^>]*numberOfLines/, /styles\.onHandText[^>]*numberOfLines/]);
}
// rows that carry an amount: the amount keeps its width and drops to its own line when it does not fit (found by
// scripts/layout-check.mjs at 2x font: the amount wrapped over lines and squeezed the name to one letter per line)
assert.match(read('src/components/dashboard/SummaryCard.tsx'), /row: \{\s*flexDirection: 'row',\s*flexWrap: 'wrap'/);
assert.match(read('src/components/dashboard/RecentSaleRow.tsx'), /line: \{ flexDirection: 'row', flexWrap: 'wrap'/);
assert.match(read('src/components/dashboard/RecentSaleRow.tsx'), /maxFontSizeMultiplier=\{FIGURE_MAX_FONT_SCALE\}/);
assert.match(read('src/components/dashboard/NavTile.tsx'), /titleRow: \{ flexDirection: 'row', flexWrap: 'wrap'/);
assert.match(read('src/features/reports/TodayLogList.tsx'), /head: \{ flexDirection: 'row', flexWrap: 'wrap'/);
// the header and the list card may wrap, so a long title or name is read in full
assert.match(read('src/components/dashboard/ManagerScreenHeader.tsx'), /styles\.title\} numberOfLines=\{2\}/);
assert.doesNotMatch(read('src/components/dashboard/ListRowCard.tsx'), /styles\.subtitle\} numberOfLines/);

console.log('Figures never cut: estimate matches the font, tile pairs stack, tiles grow, no money/quantity is capped.');

// ---- 7. the cause of "₱3,999.…" on the Cashier dashboard: CurrencyText put the font size on its inner pieces too. Android shrinks the
// outer text to fit but leaves a piece with its own size alone, so the amount was cut off with "…" instead of shrinking.
{
  const currency = readFileSync('src/components/dashboard/CurrencyText.tsx', 'utf8').replace(/\r\n/g, '\n');
  assert.match(currency, /\{symbol \? <Text>\{symbol\}<\/Text> : null\}/, 'the ₱ piece has no style of its own (it inherits the size)');
  assert.match(currency, /<Text style=\{fontFamily \? \{ fontFamily \} : undefined\}>\{amount\}<\/Text>/, 'the amount piece sets only the font family');
  assert.doesNotMatch(currency, /\[rest, \{ fontFamily \}\]|<Text style=\{rest\}>/, 'no inner piece repeats the font size');
  // and a figure is allowed to shrink only 4% before its tile stacks, so the shrink is a safety net, not what keeps it on screen
  assert.equal(shouldStackSummaryKpis('₱3,999.00', '4', 344, 1, SQUARE_H_PAD), true, 'the Cashier "Total sales ₱3,999.00" + Orders pair takes full rows on 392dp');
  assert.equal(shouldStackSummaryKpis('₱3,999.00', '4', 312, 1, SQUARE_H_PAD), true, 'and on 360dp');
  assert.equal(shouldStackSummaryKpis('₱350.00', '4', 344, 1, SQUARE_H_PAD), false, 'a small figure still shares the row');
}
