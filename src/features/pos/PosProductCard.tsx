import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ManagerBadge } from '@/components/dashboard/ManagerBadge';
import { managerColors } from '@/components/dashboard/theme';
import { formatMoney } from '@/lib/format';
import type { InventoryItem, PosVariant } from '@/types/models';

interface PosProductCardProps {
  item: InventoryItem;
  /** Cart quantity for this product, keyed by variant id (null key = no variant / single price). */
  quantityByVariant: Map<string | null, number>;
  onIncrease: (variantId: string | null) => void;
  onDecrease: (variantId: string | null) => void;
  onQuantityChange: (variantId: string | null, quantity: number) => void;
  /** Tighter card for tablet product grids. */
  compact?: boolean;
}

function Stepper({
  quantity,
  atMin,
  atMax,
  outOfStock,
  compact,
  label,
  maxQuantity,
  onIncrease,
  onDecrease,
  onQuantityChange,
}: {
  quantity: number;
  atMin: boolean;
  atMax: boolean;
  outOfStock: boolean;
  compact: boolean;
  label: string;
  maxQuantity: number;
  onIncrease: () => void;
  onDecrease: () => void;
  onQuantityChange: (quantity: number) => void;
}) {
  const [draft, setDraft] = useState(quantity > 0 ? String(quantity) : '');

  useEffect(() => {
    setDraft(quantity > 0 ? String(quantity) : '');
  }, [quantity]);

  const commit = (raw: string) => {
    if (raw === '') {
      onQuantityChange(0);
      return;
    }
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) return;
    onQuantityChange(Math.min(Math.max(0, parsed), maxQuantity));
  };

  return (
    <View style={styles.stepperPill}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Remove one ${label}`}
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
      <TextInput
        accessibilityLabel={`${label} quantity`}
        keyboardType="number-pad"
        value={draft}
        placeholder="0"
        placeholderTextColor={managerColors.subtext}
        maxLength={6}
        selectTextOnFocus
        editable={!outOfStock}
        onChangeText={(value) => {
          if (value === '' || /^\d{1,6}$/.test(value)) {
            setDraft(value);
            if (value !== '') commit(value);
          }
        }}
        onBlur={() => commit(draft)}
        style={[styles.quantityInput, compact && styles.quantityInputCompact]}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Add one ${label}`}
        hitSlop={6}
        disabled={outOfStock || atMax}
        onPress={onIncrease}
        style={({ pressed }) => [
          styles.stepperButton,
          compact && styles.stepperButtonCompact,
          pressed && !(outOfStock || atMax) && styles.stepperButtonPressed,
        ]}
      >
        <Text style={[styles.stepperSymbol, (outOfStock || atMax) && styles.stepperSymbolDisabled]}>+</Text>
      </Pressable>
    </View>
  );
}

export function PosProductCard({
  item,
  quantityByVariant,
  onIncrease,
  onDecrease,
  onQuantityChange,
  compact = false,
}: PosProductCardProps) {
  const outOfStock = item.quantity_on_hand === 0;
  const variants = item.variants ?? [];
  const hasVariants = variants.length > 0;
  const totalQuantity = [...quantityByVariant.values()].reduce((sum, qty) => sum + qty, 0);
  const atProductLimit = totalQuantity >= item.quantity_on_hand;

  return (
    <View style={[styles.card, compact && styles.cardCompact]}>
      <View style={styles.topRow}>
        <View style={styles.copy}>
          <Text style={[styles.name, compact && styles.nameCompact]} numberOfLines={compact ? 2 : undefined}>
            {item.product.name}
          </Text>
          <Text style={styles.sku}>{item.product.sku}</Text>
        </View>
        {hasVariants ? null : (
          <Text style={[styles.price, compact && styles.priceCompact]}>
            {formatMoney(item.product.selling_price)}
          </Text>
        )}
      </View>
      {outOfStock ? (
        <ManagerBadge label="Out of stock" tone="danger" />
      ) : (
        <Text style={styles.stock}>Available: {item.quantity_on_hand}</Text>
      )}

      {hasVariants ? (
        <View style={styles.variantList}>
          {variants.map((variant: PosVariant) => {
            const quantity = quantityByVariant.get(variant.id) ?? 0;
            const otherQuantity = totalQuantity - quantity;
            return (
              <View key={variant.id} style={styles.variantRow}>
                <View style={styles.variantCopy}>
                  <Text style={styles.variantName} numberOfLines={1}>{variant.name}</Text>
                  <Text style={styles.variantPrice}>{formatMoney(variant.selling_price)}</Text>
                </View>
                <Stepper
                  quantity={quantity}
                  atMin={quantity <= 0}
                  atMax={atProductLimit}
                  outOfStock={outOfStock}
                  compact={compact}
                  label={`${item.product.name} (${variant.name})`}
                  maxQuantity={Math.max(0, item.quantity_on_hand - otherQuantity)}
                  onIncrease={() => onIncrease(variant.id)}
                  onDecrease={() => onDecrease(variant.id)}
                  onQuantityChange={(next) => onQuantityChange(variant.id, next)}
                />
              </View>
            );
          })}
        </View>
      ) : (
        <View style={styles.controls}>
          <Stepper
            quantity={quantityByVariant.get(null) ?? 0}
            atMin={(quantityByVariant.get(null) ?? 0) <= 0}
            atMax={atProductLimit}
            outOfStock={outOfStock}
            compact={compact}
            label={item.product.name}
            maxQuantity={item.quantity_on_hand}
            onIncrease={() => onIncrease(null)}
            onDecrease={() => onDecrease(null)}
            onQuantityChange={(next) => onQuantityChange(null, next)}
          />
        </View>
      )}

      {atProductLimit && !outOfStock ? (
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
  variantList: { gap: 8 },
  variantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: managerColors.cardBorder,
    paddingTop: 8,
  },
  variantCopy: { flex: 1, minWidth: 0 },
  variantName: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  variantPrice: { color: managerColors.royalBlue, fontFamily: 'Inter_700Bold', fontSize: 13, marginTop: 1 },
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
  quantityInput: {
    width: 44,
    height: 40,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: managerColors.cardBorder,
    backgroundColor: 'transparent',
    color: managerColors.ink,
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
    textAlign: 'center',
    paddingVertical: 0,
  },
  quantityInputCompact: { width: 40 },
  limit: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12, textAlign: 'right' },
});
