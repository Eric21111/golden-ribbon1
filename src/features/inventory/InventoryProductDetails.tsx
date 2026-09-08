import { StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { colors, spacing } from '@/constants/theme';
import { formatDate, formatMoney } from '@/lib/format';
import type { InventoryItem } from '@/types/models';

import { getStockStatus, stockStatusLabel } from './inventoryStatus';

type InventoryProductDetailsProps = {
  item: InventoryItem;
  primaryAction?: { label: string; onPress: () => void };
};

export function InventoryProductDetails({ item, primaryAction }: InventoryProductDetailsProps) {
  const status = getStockStatus(item);

  return (
    <View style={styles.body}>
      <Text style={styles.name}>{item.product.name}</Text>
      <Text style={styles.meta}>{item.product.sku}</Text>
      <View style={styles.statRow}>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>On hand</Text>
          <Text style={styles.statValue}>{item.quantity_on_hand}</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>Status</Text>
          <Text
            style={[
              styles.statValueSmall,
              status === 'low' && styles.warning,
              status === 'out' && styles.danger,
            ]}
          >
            {stockStatusLabel(status)}
          </Text>
        </View>
      </View>
      <Text style={styles.meta}>{formatMoney(item.product.selling_price)}</Text>
      <Text style={styles.meta}>
        {item.updated_at ? `Updated ${formatDate(item.updated_at)}` : 'Not initialized'}
      </Text>
      {primaryAction ? (
        <AppButton label={primaryAction.label} onPress={primaryAction.onPress} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.sm, paddingBottom: spacing.sm },
  name: { color: colors.text, fontSize: 22, fontWeight: '800' },
  meta: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  statRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xs },
  stat: { flex: 1, gap: spacing.xs },
  statLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  statValue: { color: colors.primary, fontSize: 32, fontWeight: '900' },
  statValueSmall: { color: colors.text, fontSize: 18, fontWeight: '800' },
  warning: { color: '#92400E' },
  danger: { color: colors.danger },
});
