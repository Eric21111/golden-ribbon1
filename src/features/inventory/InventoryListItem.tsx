import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing } from '@/constants/theme';
import { formatMoney } from '@/lib/format';
import type { InventoryItem } from '@/types/models';

import { getStockStatus, stockStatusLabel, type StockStatus } from './inventoryStatus';

type InventoryListItemProps = {
  item: InventoryItem;
  showBranch?: boolean;
  onPress?: () => void;
};

export function InventoryListItem({
  item,
  showBranch = false,
  onPress,
  selected = false,
}: InventoryListItemProps & { selected?: boolean }) {
  const status = getStockStatus(item);
  const showBadge = status === 'low' || status === 'out' || status === 'not_set';

  const content = (
    <>
      <View style={styles.row}>
        <View style={styles.copy}>
          <Text style={styles.name} numberOfLines={1}>
            {item.product.name}
          </Text>
          <Text style={styles.sku} numberOfLines={1}>
            {item.product.sku}
            {showBranch ? ` · ${item.branch.name}` : ''}
            {' · '}
            {formatMoney(item.product.selling_price)}
          </Text>
        </View>
        <View style={styles.trailing}>
          <Text style={[styles.stock, status === 'out' && styles.stockMuted]}>{item.quantity_on_hand}</Text>
          {onPress ? <Ionicons color={colors.muted} name="chevron-forward" size={18} /> : null}
        </View>
      </View>
      {showBadge ? (
        <Text style={[styles.badge, badgeStyle(status)]}>{stockStatusLabel(status)}</Text>
      ) : null}
    </>
  );

  if (!onPress) {
    return <View style={styles.card}>{content}</View>;
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${item.product.name}, ${item.quantity_on_hand} on hand`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        selected && styles.selected,
        pressed && styles.pressed,
      ]}
    >
      {content}
    </Pressable>
  );
}

function badgeStyle(status: StockStatus) {
  if (status === 'low') return styles.badgeLow;
  if (status === 'out') return styles.badgeOut;
  return styles.badgeMuted;
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
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  copy: { flex: 1, minWidth: 0 },
  name: { color: colors.text, fontSize: 16, fontWeight: '700' },
  sku: { color: colors.muted, fontSize: 13, marginTop: 2 },
  trailing: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  stock: { color: colors.primary, fontSize: 24, fontWeight: '900', minWidth: 28, textAlign: 'right' },
  stockMuted: { color: colors.muted },
  badge: {
    alignSelf: 'flex-start',
    fontSize: 11,
    fontWeight: '700',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
  },
  badgeLow: { backgroundColor: colors.warningSurface, color: '#92400E' },
  badgeOut: { backgroundColor: '#FEE2E2', color: colors.danger },
  badgeMuted: { backgroundColor: colors.background, color: colors.muted },
});
