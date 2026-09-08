import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing } from '@/constants/theme';
import { formatDate } from '@/lib/format';
import type { StockReturn } from '@/types/returns';

import { ReturnStatusBadge } from './ReturnStatusBadge';

export type StockReturnSummary = StockReturn & { items: [{ count: number }] };

export function ReturnListItem({
  stockReturn,
  onPress,
  selected = false,
}: {
  stockReturn: StockReturnSummary;
  onPress: () => void;
  selected?: boolean;
}) {
  const productCount = stockReturn.items[0]?.count ?? 0;
  const route = `${stockReturn.from_branch_name} → ${stockReturn.to_branch_name}`;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${stockReturn.return_number}, ${route}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        selected && styles.selected,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.row}>
        <Text style={styles.number} numberOfLines={1}>
          {stockReturn.return_number}
        </Text>
        <View style={styles.trailing}>
          <ReturnStatusBadge status={stockReturn.status} compact />
          <Ionicons color={colors.muted} name="chevron-forward" size={18} />
        </View>
      </View>
      <Text style={styles.route} numberOfLines={1}>
        {route}
      </Text>
      <Text style={styles.meta} numberOfLines={1}>
        {productCount} {productCount === 1 ? 'item' : 'items'} · {formatDate(stockReturn.returned_at)}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    gap: spacing.xs,
  },
  selected: {
    borderColor: colors.primary,
    backgroundColor: '#FFF1E8',
  },
  pressed: { opacity: 0.82 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  number: { color: colors.text, fontSize: 16, fontWeight: '800', flexShrink: 1 },
  trailing: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  route: { color: colors.muted, fontSize: 14, fontWeight: '600' },
  meta: { color: colors.muted, fontSize: 12 },
});
