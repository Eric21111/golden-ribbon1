import Ionicons, { type IoniconsIconName } from '@react-native-vector-icons/ionicons';
import { StyleSheet, Text, View } from 'react-native';

import { managerColors } from './theme';

interface SummaryCardRow {
  label: string;
  value: string;
  emphasis?: boolean;
  icon?: IoniconsIconName;
}

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
            <Text style={styles.label} numberOfLines={1}>
              {row.label}
            </Text>
          </View>
          <Text style={[styles.value, row.emphasis && styles.valueEmphasis]} numberOfLines={1}>
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    gap: 12,
  },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: managerColors.cardBorder },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  label: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 14 },
  value: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  valueEmphasis: { color: managerColors.royalBlue, fontFamily: 'Inter_700Bold', fontSize: 17 },
});
