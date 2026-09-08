import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing } from '@/constants/theme';
import { formatDate, formatMoney } from '@/lib/format';
import type { SaleWithRelations } from '@/services/saleService';

export function SaleListItem({
  sale,
  onPress,
  selected = false,
}: {
  sale: SaleWithRelations;
  onPress: () => void;
  selected?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${sale.sale_number}, ${formatMoney(sale.total_amount)}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        selected && styles.selected,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.row}>
        <Text style={styles.number} numberOfLines={1}>
          {sale.sale_number}
        </Text>
        <View style={styles.trailing}>
          <Text style={styles.amount}>{formatMoney(sale.total_amount)}</Text>
          <Ionicons color={colors.muted} name="chevron-forward" size={18} />
        </View>
      </View>
      <Text style={styles.meta} numberOfLines={1}>
        {formatDate(sale.sold_at)}
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  number: { color: colors.text, fontSize: 16, fontWeight: '800', flexShrink: 1 },
  trailing: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  amount: { color: colors.primary, fontSize: 16, fontWeight: '900' },
  meta: { color: colors.muted, fontSize: 12 },
});
