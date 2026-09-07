import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing } from '@/constants/theme';
import { formatMoney } from '@/lib/format';
import type { InventoryItem } from '@/types/models';

interface PosProductCardProps {
  item: InventoryItem;
  quantity: number;
  onIncrease: () => void;
  onDecrease: () => void;
}

export function PosProductCard({ item, quantity, onIncrease, onDecrease }: PosProductCardProps) {
  const outOfStock = item.quantity_on_hand === 0;
  const atLimit = quantity >= item.quantity_on_hand;

  return (
    <View style={styles.card}>
      <View style={styles.topRow}>
        <View style={styles.copy}>
          <Text style={styles.name}>{item.product.name}</Text>
          <Text style={styles.sku}>{item.product.sku}</Text>
        </View>
        <Text style={styles.price}>{formatMoney(item.product.selling_price)}</Text>
      </View>
      <Text style={outOfStock ? styles.outOfStock : styles.stock}>
        {outOfStock ? 'OUT OF STOCK' : `Available: ${item.quantity_on_hand}`}
      </Text>
      <View style={styles.controls}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Remove one ${item.product.name}`} disabled={quantity === 0} onPress={onDecrease} style={({ pressed }) => [styles.controlButton, quantity === 0 && styles.disabled, pressed && styles.pressed]}>
          <Text style={styles.controlText}>−</Text>
        </Pressable>
        <Text accessibilityLabel={`${quantity} selected`} style={styles.quantity}>{quantity}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={`Add one ${item.product.name}`} disabled={outOfStock || atLimit} onPress={onIncrease} style={({ pressed }) => [styles.controlButton, (outOfStock || atLimit) && styles.disabled, pressed && styles.pressed]}>
          <Text style={styles.controlText}>+</Text>
        </Pressable>
      </View>
      {atLimit && !outOfStock ? <Text style={styles.limit}>Maximum available quantity selected.</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.md },
  copy: { flex: 1 },
  name: { color: colors.text, fontSize: 17, fontWeight: '800' },
  sku: { color: colors.muted, fontSize: 12, marginTop: 2 },
  price: { color: colors.primary, fontSize: 17, fontWeight: '900' },
  stock: { color: colors.success, fontSize: 13, fontWeight: '700' },
  outOfStock: { color: colors.danger, fontSize: 13, fontWeight: '900' },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: spacing.md },
  controlButton: { width: 44, height: 44, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  controlText: { color: colors.primary, fontSize: 25, fontWeight: '800', lineHeight: 28 },
  quantity: { minWidth: 28, color: colors.text, fontSize: 20, fontWeight: '900', textAlign: 'center' },
  disabled: { opacity: 0.35 },
  pressed: { opacity: 0.65 },
  limit: { color: colors.muted, fontSize: 12, textAlign: 'right' },
});
