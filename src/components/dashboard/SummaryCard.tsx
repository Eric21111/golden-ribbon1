import Ionicons, { type IoniconsIconName } from '@react-native-vector-icons/ionicons';
import { StyleSheet, Text, View } from 'react-native';

import { managerColors } from './theme';

interface SummaryCardRow {
  label: string;
  value: string;
  emphasis?: boolean;
  icon?: IoniconsIconName;
  /** Colors the value text for an at-a-glance signal (e.g. a shortage in red, an excess in green). */
  tone?: 'danger' | 'success' | 'warning';
}

const toneColors: Record<NonNullable<SummaryCardRow['tone']>, string> = {
  danger: '#B91C1C',
  success: managerColors.green,
  warning: managerColors.goldMuted,
};

interface SummaryCardProps {
  title?: string;
  rows: SummaryCardRow[];
}

export function SummaryCard({ title, rows }: SummaryCardProps) {
  return (
    <View style={styles.card}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      {rows.map((row, index) => (
        <View
          key={row.label}
          style={[styles.row, index < rows.length - 1 && styles.rowDivider]}
        >
          <View style={styles.labelRow}>
            {row.icon ? <Ionicons name={row.icon} size={16} color={managerColors.subtext} /> : null}
            <Text style={styles.label}>{row.label}</Text>
          </View>
          <Text
            style={[
              styles.value,
              row.emphasis && styles.valueEmphasis,
              row.tone && { color: toneColors[row.tone] },
            ]}
            maxFontSizeMultiplier={1.5}
          >
            {row.value}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 16,
    padding: 16,
    gap: 4,
  },
  title: {
    color: managerColors.subtext,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  // The label wraps; the value keeps its own width, so an amount is never cut or broken. When the label and the value do not fit
  // on one line (a long label, a seven-figure amount, a larger system font) the value drops to its own line, right-aligned.
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    paddingVertical: 10,
    columnGap: 12,
    rowGap: 4,
  },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: managerColors.cardBorder },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexGrow: 1, flexShrink: 1, flexBasis: 110, minWidth: 0 },
  label: { flexShrink: 1, color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 14 },
  value: { flexShrink: 1, maxWidth: '100%', marginLeft: 'auto', textAlign: 'right', color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  valueEmphasis: { color: managerColors.royalBlue, fontFamily: 'Inter_700Bold', fontSize: 17 },
});
