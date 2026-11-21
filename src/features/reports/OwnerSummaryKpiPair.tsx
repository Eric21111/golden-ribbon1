import { useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import type { IoniconsIconName } from '@react-native-vector-icons/ionicons';

import { StatTile } from '@/components/dashboard/StatTile';
import { shouldStackSummaryKpis } from '@/features/reports/reportDisplay';

export type OwnerSummaryKpi = {
  label: string;
  value: string | number;
  icon: IoniconsIconName;
  emphasis?: boolean;
  valueNumberOfLines?: number;
  caption?: string;
  onPress?: () => void;
};

/** Two Owner summary tiles: compact 2-col when figures fit, otherwise full-width rows. */
export function OwnerSummaryKpiPair({ left, right }: { left: OwnerSummaryKpi; right: OwnerSummaryKpi }) {
  const { width, fontScale } = useWindowDimensions();
  const [contentWidth, setContentWidth] = useState(0);
  const measureWidth = contentWidth > 0 ? contentWidth : Math.max(width - 40, 0);
  const stack = shouldStackSummaryKpis(String(left.value), String(right.value), measureWidth, fontScale);

  return (
    <View
      style={stack ? styles.stack : styles.row}
      onLayout={(event) => {
        const next = event.nativeEvent.layout.width;
        if (next !== contentWidth) setContentWidth(next);
      }}
    >
      <StatTile compact layout={stack ? 'wide' : 'square'} style={stack ? undefined : styles.half} {...left} />
      <StatTile compact layout={stack ? 'wide' : 'square'} style={stack ? undefined : styles.half} {...right} />
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 10 },
  row: { flexDirection: 'row', alignItems: 'stretch', gap: 10 },
  half: { flex: 1, minWidth: 0 },
});
