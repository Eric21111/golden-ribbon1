import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ManagerBadge } from '@/components/dashboard/ManagerBadge';
import { managerColors } from '@/components/dashboard/theme';
import { formatMoney } from '@/lib/format';
import type { InventoryItem } from '@/types/models';

interface PosProductCardProps {
  item: InventoryItem;
  quantity: number;
  onIncrease: () => void;
  onDecrease: () => void;
  /** Tighter card for tablet product grids. */
  compact?: boolean;
}

export function PosProductCard({
  item,
  quantity,
  onIncrease,
  onDecrease,
  compact = false,
}: PosProductCardProps) {
  const outOfStock = item.quantity_on_hand === 0;
  const atLimit = quantity >= item.quantity_on_hand;
  const atMin = quantity <= 0;

  return (
    <View style={[styles.card, compact && styles.cardCompact]}>
      <View style={styles.topRow}>
        <View style={styles.copy}>
          <Text style={[styles.name, compact && styles.nameCompact]} numberOfLines={compact ? 2 : undefined}>
            {item.product.name}
          </Text>
          <Text style={styles.sku}>{item.product.sku}</Text>
        </View>
        <Text style={[styles.price, compact && styles.priceCompact]}>
          {formatMoney(item.product.selling_price)}
        </Text>
      </View>
      {outOfStock ? (
        <ManagerBadge label="Out of stock" tone="danger" />
      ) : (
        <Text style={styles.stock}>Available: {item.quantity_on_hand}</Text>
      )}
      <View style={styles.controls}>
        <View style={styles.stepperPill}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Remove one ${item.product.name}`}
            hitSlop={6}
            disabled={atMin}
            onPress={onDecrease}
            style={({ pressed }) => [
              styles.stepperButton,
              compact && styles.stepperButtonCompact,
              pressed && !atMin && styles.stepperButtonPressed,
            ]}
          >
            <Text style={[styles.stepperSymbol, atMin && styles.stepperSymbolDisabled]}>−</Text>
          </Pressable>
          <Text accessibilityLabel={`${quantity} selected`} style={styles.quantity}>
            {quantity}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Add one ${item.product.name}`}
            hitSlop={6}
            disabled={outOfStock || atLimit}
            onPress={onIncrease}
            style={({ pressed }) => [
              styles.stepperButton,
              compact && styles.stepperButtonCompact,
              pressed && !(outOfStock || atLimit) && styles.stepperButtonPressed,
            ]}
          >
            <Text style={[styles.stepperSymbol, (outOfStock || atLimit) && styles.stepperSymbolDisabled]}>+</Text>
          </Pressable>
        </View>
      </View>
      {atLimit && !outOfStock ? (
        <Text style={styles.limit}>Maximum available quantity selected.</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 16,
    padding: 14,
    gap: 8,
    flex: 1,
    shadowColor: '#0A1224',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 1,
  },
  cardCompact: { padding: 10, gap: 6 },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
  },
  copy: { flex: 1, minWidth: 0 },
  name: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  nameCompact: { fontSize: 14 },
  sku: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 2 },
  price: { color: managerColors.royalBlue, fontFamily: 'Inter_700Bold', fontSize: 15 },
  priceCompact: { fontSize: 14 },
  stock: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 12.5 },
  controls: { flexDirection: 'row', justifyContent: 'flex-end' },
  stepperPill: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 40,
    borderWidth: 1.5,
    borderColor: managerColors.cardBorder,
    borderRadius: 10,
    backgroundColor: managerColors.cardSurface,
    overflow: 'hidden',
  },
  stepperButton: { width: 36, height: 40, alignItems: 'center', justifyContent: 'center' },
  stepperButtonCompact: { width: 32 },
  stepperButtonPressed: { backgroundColor: '#E4E9F2' },
  stepperSymbol: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 17, lineHeight: 20 },
  stepperSymbolDisabled: { color: managerColors.cardBorder },
  quantity: {
    minWidth: 32,
    color: managerColors.ink,
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
    textAlign: 'center',
  },
  limit: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12, textAlign: 'right' },
});
