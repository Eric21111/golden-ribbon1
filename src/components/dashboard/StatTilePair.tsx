import { useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';

import { StatTile, type StatTileProps } from '@/components/dashboard/StatTile';
import { COMPACT_H_PAD, SQUARE_H_PAD, shouldStackStatTiles } from '@/features/reports/reportDisplay';

export type StatTilePairItem = Omit<StatTileProps, 'layout' | 'compact' | 'style'>;

/**
 * Two stat tiles that share a row while both figures fit at full size, and become two full-width rows (the "wide" tile,
 * same look as Company Operations) when either figure would not: a long amount, a narrow Android screen, or a larger
 * system font. Money and counts are never cut off or shrunk hard to squeeze in.
 *
 * `right` may be left out (an odd tile out): it keeps its half-width slot instead of stretching across the row.
 * `compact` (default) is the small tile used on report screens; pass `compact={false}` for the taller dashboard tiles.
 */
export function StatTilePair({
  left,
  right,
  compact = true,
}: {
  left: StatTilePairItem;
  right?: StatTilePairItem;
  compact?: boolean;
}) {
  const { width, fontScale } = useWindowDimensions();
  const [contentWidth, setContentWidth] = useState(0);
  const measureWidth = contentWidth > 0 ? contentWidth : Math.max(width - 40, 0);
  const stack = shouldStackStatTiles({
    left: { value: String(left.value), label: left.label },
    right: right ? { value: String(right.value), label: right.label } : undefined,
    width: measureWidth,
    fontScale,
    hPad: compact ? COMPACT_H_PAD : SQUARE_H_PAD,
  });
  const layout = stack ? 'wide' : 'square';

  return (
    <View
      style={stack ? styles.stack : styles.row}
      onLayout={(event) => {
        const next = event.nativeEvent.layout.width;
        if (next !== contentWidth) setContentWidth(next);
      }}
    >
      <StatTile compact={compact} layout={layout} style={stack ? undefined : styles.half} {...left} />
      {right ? (
        <StatTile compact={compact} layout={layout} style={stack ? undefined : styles.half} {...right} />
      ) : stack ? null : (
        <View style={styles.half} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 10 },
  row: { flexDirection: 'row', alignItems: 'stretch', gap: 10 },
  half: { flex: 1, minWidth: 0 },
});
