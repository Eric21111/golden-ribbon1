import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

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
        disabled={atMax}
        onPress={onIncrease}
        style={({ pressed }) => [
          styles.stepperButton,
          compact && styles.stepperButtonCompact,
          pressed && !atMax && styles.stepperButtonPressed,
        ]}
      >
        <Text style={[styles.stepperSymbol, atMax && styles.stepperSymbolDisabled]}>+</Text>
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
  const selected = totalQuantity > 0;

  const toggleSelect = (variantId: string | null, quantity: number) => {
    if (quantity > 0) {
      onQuantityChange(variantId, 0);
      return;
    }
    if (atProductLimit) return;
    onIncrease(variantId);
  };

  return (
    <View
      style={[
        styles.card,
        compact && styles.cardCompact,
        selected && styles.cardSelected,
        outOfStock && styles.cardOut,
      ]}
    >
      <View style={outOfStock ? styles.dimmed : undefined} pointerEvents={outOfStock ? 'none' : 'auto'}>
        {hasVariants ? (
          <>
            <View style={styles.topRow}>
              <View style={styles.copy}>
                <Text style={[styles.name, compact && styles.nameCompact]} numberOfLines={compact ? 2 : undefined}>
                  {item.product.name}
                </Text>
                <Text style={styles.sku}>{item.product.sku}</Text>
              </View>
            </View>
            <Text style={styles.stock}>Available: {item.quantity_on_hand}</Text>
            <View style={styles.variantList}>
              {variants.map((variant: PosVariant) => {
                const quantity = quantityByVariant.get(variant.id) ?? 0;
                const otherQuantity = totalQuantity - quantity;
                const label = `${item.product.name} (${variant.name})`;
                return (
                  <View key={variant.id} style={styles.variantRow}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={quantity > 0 ? `Remove ${label} from order` : `Add ${label} to order`}
                      disabled={quantity <= 0 && atProductLimit}
                      onPress={() => toggleSelect(variant.id, quantity)}
                      style={({ pressed }) => [styles.variantCopy, pressed && styles.pressed]}
                    >
                      <Text style={styles.variantName} numberOfLines={1}>{variant.name}</Text>
                      <Text style={styles.variantPrice}>{formatMoney(variant.selling_price)}</Text>
                    </Pressable>
                    <Stepper
                      quantity={quantity}
                      atMin={quantity <= 0}
                      atMax={atProductLimit}
                      compact={compact}
                      label={label}
                      maxQuantity={Math.max(0, item.quantity_on_hand - otherQuantity)}
                      onIncrease={() => onIncrease(variant.id)}
                      onDecrease={() => onDecrease(variant.id)}
                      onQuantityChange={(next) => onQuantityChange(variant.id, next)}
                    />
                  </View>
                );
              })}
            </View>
          </>
        ) : (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                (quantityByVariant.get(null) ?? 0) > 0
                  ? `Remove ${item.product.name} from order`
                  : `Add ${item.product.name} to order`
              }
              disabled={(quantityByVariant.get(null) ?? 0) <= 0 && atProductLimit}
              onPress={() => toggleSelect(null, quantityByVariant.get(null) ?? 0)}
              style={({ pressed }) => [styles.selectArea, pressed && styles.pressed]}
            >
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
              <Text style={styles.stock}>Available: {item.quantity_on_hand}</Text>
            </Pressable>
            <View style={styles.controls}>
              <Stepper
                quantity={quantityByVariant.get(null) ?? 0}
                atMin={(quantityByVariant.get(null) ?? 0) <= 0}
                atMax={atProductLimit}
                compact={compact}
                label={item.product.name}
                maxQuantity={item.quantity_on_hand}
                onIncrease={() => onIncrease(null)}
                onDecrease={() => onDecrease(null)}
                onQuantityChange={(next) => onQuantityChange(null, next)}
              />
            </View>
          </>
        )}
        {atProductLimit && !outOfStock ? (
          <Text style={styles.limit}>Maximum available quantity selected.</Text>
        ) : null}
      </View>

      {outOfStock ? (
        <View pointerEvents="none" style={styles.outOverlay}>
          <Text style={styles.outLabel}>Out of stock</Text>
        </View>
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
    overflow: 'hidden',
    shadowColor: '#0A1224',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 1,
    minHeight: 112,
  },
  cardCompact: { padding: 10, gap: 6 },
  cardSelected: {
    borderColor: managerColors.royalBlue,
    backgroundColor: '#F7F9FD',
  },
  cardOut: {
    backgroundColor: '#F3F4F6',
    borderColor: '#D1D5DB',
    shadowOpacity: 0,
    elevation: 0,
  },
  dimmed: { opacity: 0.35 },
  selectArea: { gap: 8 },
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
  },
  stepperButton: { width: 36, height: 40, alignItems: 'center', justifyContent: 'center' },
  stepperButtonCompact: { width: 32 },
  stepperButtonPressed: { backgroundColor: '#E4E9F2' },
  stepperSymbol: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 17, lineHeight: 20 },
  stepperSymbolDisabled: { color: managerColors.cardBorder },
  quantityInput: {
    width: 48,
    height: 40,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: managerColors.cardBorder,
    backgroundColor: '#FFFFFF',
    color: managerColors.ink,
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
    textAlign: 'center',
    paddingVertical: 0,
  },
  quantityInputCompact: { width: 44 },
  limit: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12, textAlign: 'right' },
  pressed: { opacity: 0.7 },
  outOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  outLabel: {
    color: '#6B7280',
    fontFamily: 'Inter_700Bold',
    fontSize: 16,
    letterSpacing: 0.3,
    textAlign: 'center',
  },
});
