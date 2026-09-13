import { StyleSheet, Text, View } from 'react-native';

import { managerColors } from '@/components/dashboard/theme';
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
  card: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 16,
    padding: 16,
    gap: 12,
    shadowColor: '#0A1224',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 1,
  },
  title: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 17 },
  empty: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 14 },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: managerColors.cardBorder,
  },
  copy: { flex: 1 },
  name: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  calculation: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 2 },
  subtotal: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 14 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 4 },
  totalLabel: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 15, letterSpacing: 0.6 },
  total: { color: managerColors.royalBlue, fontFamily: 'Inter_700Bold', fontSize: 22 },
});
