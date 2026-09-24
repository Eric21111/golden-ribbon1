import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { managerColors } from '@/components/dashboard/theme';
import { formatMoney } from '@/lib/format';
import type { InventoryItem } from '@/types/models';

interface PosProductRowProps {
  item: InventoryItem;
  /** Total quantity of this product already in the order, across all variants. */
  cartQuantity: number;
  onPress: () => void;
}

function priceLabel(item: InventoryItem): string {
  const variants = item.variants ?? [];
  if (variants.length === 0) return formatMoney(item.product.selling_price);
  const prices = variants.map((variant) => variant.selling_price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return min === max ? formatMoney(min) : `From ${formatMoney(min)}`;
}

export function PosProductRow({ item, cartQuantity, onPress }: PosProductRowProps) {
  const outOfStock = item.quantity_on_hand === 0;

  const content = (
    <View style={styles.row}>
      <View style={[styles.iconChip, outOfStock && styles.iconChipOut]}>
        <Ionicons name="fast-food-outline" size={19} color={outOfStock ? managerColors.subtext : managerColors.royalBlue} />
      </View>
      <View style={styles.body}>
        <View style={styles.line1}>
          <Text style={[styles.name, outOfStock && styles.nameMuted]} numberOfLines={1}>
            {item.product.name}
          </Text>
          <View style={styles.priceGroup}>
            <Text style={[styles.price, outOfStock && styles.priceMuted]}>{priceLabel(item)}</Text>
            {cartQuantity > 0 ? (
              <View style={styles.badge}>
                <Text style={styles.badgeLabel}>×{cartQuantity}</Text>
              </View>
            ) : null}
          </View>
        </View>
        <Text style={[styles.stock, outOfStock && styles.stockOut]}>
          {outOfStock ? 'Out of stock' : `Available: ${item.quantity_on_hand}`}
        </Text>
      </View>
      {outOfStock ? null : (
        <Ionicons name="chevron-forward" size={18} color={managerColors.subtext} style={styles.chevron} />
      )}
    </View>
  );

  if (outOfStock) {
    return <View style={[styles.card, styles.cardOut]}>{content}</View>;
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Select ${item.product.name}`}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 16,
    shadowColor: '#0A1224',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 1,
  },
  cardOut: { backgroundColor: '#F8F9FB', shadowOpacity: 0, elevation: 0 },
  pressed: { backgroundColor: managerColors.cardSurface },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  iconChip: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EAF0FB',
  },
  iconChipOut: { backgroundColor: managerColors.cardBorder },
  body: { flex: 1, minWidth: 0, gap: 4 },
  line1: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  name: { flex: 1, color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 15.5 },
  nameMuted: { color: managerColors.subtext },
  priceGroup: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 0 },
  price: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 15 },
  priceMuted: { color: managerColors.subtext },
  badge: {
    backgroundColor: '#CFF3E8',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeLabel: { color: managerColors.teal, fontFamily: 'Inter_700Bold', fontSize: 11.5 },
  stock: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12.5 },
  stockOut: { color: '#B91C1C' },
  chevron: { marginLeft: -2 },
});
