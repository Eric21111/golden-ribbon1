import { StyleSheet, Text, View } from 'react-native';

import { managerColors } from './theme';

interface SummaryCardRow {
  label: string;
  value: string;
  emphasis?: boolean;
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
          <Text style={styles.label} numberOfLines={1}>
            {row.label}
          </Text>
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
  },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: managerColors.cardBorder },
  label: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 14 },
  value: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  valueEmphasis: { color: managerColors.royalBlue, fontFamily: 'Inter_700Bold', fontSize: 17 },
});
