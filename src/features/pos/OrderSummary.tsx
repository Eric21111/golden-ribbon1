import { StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing } from '@/constants/theme';
import { formatMoney } from '@/lib/format';
import { cartTotalCents, toCents } from '@/lib/money';
import type { CartItem } from '@/types/models';

export function OrderSummary({ items }: { items: CartItem[] }) {
  const total = cartTotalCents(items) / 100;

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Order Summary</Text>
      {items.length === 0 ? <Text style={styles.empty}>No products selected.</Text> : null}
      {items.map((item) => (
        <View key={item.product_id} style={styles.itemRow}>
          <View style={styles.copy}>
            <Text style={styles.name}>{item.product_name}</Text>
            <Text style={styles.calculation}>{item.quantity} × {formatMoney(item.unit_price)}</Text>
          </View>
          <Text style={styles.subtotal}>{formatMoney(toCents(item.unit_price) * item.quantity / 100)}</Text>
        </View>
      ))}
      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>TOTAL</Text>
        <Text style={styles.total}>{formatMoney(total)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md, gap: spacing.md },
  title: { color: colors.text, fontSize: 19, fontWeight: '900' },
  empty: { color: colors.muted, fontSize: 14 },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md, paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  copy: { flex: 1 },
  name: { color: colors.text, fontSize: 14, fontWeight: '700' },
  calculation: { color: colors.muted, fontSize: 12, marginTop: 2 },
  subtotal: { color: colors.text, fontSize: 14, fontWeight: '800' },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: spacing.xs },
  totalLabel: { color: colors.text, fontSize: 16, fontWeight: '900', letterSpacing: 0.8 },
  total: { color: colors.primary, fontSize: 23, fontWeight: '900' },
});
