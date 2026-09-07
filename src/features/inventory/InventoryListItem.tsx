import { StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing } from '@/constants/theme';
import { formatDate, formatMoney } from '@/lib/format';
import type { InventoryItem } from '@/types/models';

export function InventoryListItem({ item, showBranch = false }: { item: InventoryItem; showBranch?: boolean }) {
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <View style={styles.copy}>
          <Text style={styles.name}>{item.product.name}</Text>
          <Text style={styles.sku}>{item.product.sku}{showBranch ? ` · ${item.branch.name}` : ''}</Text>
        </View>
        <Text style={styles.stock}>{item.quantity_on_hand}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.meta}>{formatMoney(item.product.selling_price)}</Text>
        <Text style={styles.meta}>{item.updated_at ? `Updated ${formatDate(item.updated_at)}` : 'Not initialized'}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  copy: { flex: 1 },
  name: { color: colors.text, fontSize: 17, fontWeight: '700' },
  sku: { color: colors.muted, fontSize: 13, marginTop: 2 },
  stock: { color: colors.primary, fontSize: 28, fontWeight: '900' },
  meta: { color: colors.muted, fontSize: 12, flexShrink: 1 },
});
