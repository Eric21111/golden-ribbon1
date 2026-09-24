import Ionicons from '@react-native-vector-icons/ionicons';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { ManagerBottomSheet } from '@/components/dashboard/ManagerBottomSheet';
import { managerColors } from '@/components/dashboard/theme';
import { formatMoney } from '@/lib/format';
import { toCents } from '@/lib/money';
import type { InventoryItem, PosVariant } from '@/types/models';

type PosItemSheetProps = {
  item: InventoryItem | null;
  /** Cart quantity for this product, keyed by variant id (null key = no variant / single price). */
  quantityByVariant: Map<string | null, number>;
  onAdd: (variant: PosVariant | null, quantity: number) => void;
  onClose: () => void;
};

export function PosItemSheet({ item, quantityByVariant, onAdd, onClose }: PosItemSheetProps) {
  const variants = item?.variants ?? [];
  const hasVariants = variants.length > 0;
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [draft, setDraft] = useState('1');

  // Reset selection whenever a new item is opened.
  useEffect(() => {
    if (!item) return;
    setSelectedVariantId(item.variants?.[0]?.id ?? null);
    setQuantity(1);
    setDraft('1');
  }, [item]);

  const selectedVariant: PosVariant | null = hasVariants
    ? variants.find((variant) => variant.id === selectedVariantId) ?? variants[0] ?? null
    : null;

  const totalInCart = useMemo(
    () => [...quantityByVariant.values()].reduce((sum, qty) => sum + qty, 0),
    [quantityByVariant],
  );
  const remaining = item ? Math.max(0, item.quantity_on_hand - totalInCart) : 0;
  const atLimit = quantity >= remaining;
  const canAdd = remaining > 0 && quantity > 0;

  useEffect(() => {
    const next = Math.min(Math.max(quantity, remaining > 0 ? 1 : 0), remaining);
    setQuantity(next);
    setDraft(next > 0 ? String(next) : '');
    // Only re-clamp when the ceiling changes (new item / variant / cart change).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining]);

  const commitDraft = (raw: string) => {
    if (raw === '') {
      setQuantity(0);
      return;
    }
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) return;
    const next = Math.min(Math.max(0, parsed), remaining);
    setQuantity(next);
    setDraft(next > 0 ? String(next) : '');
  };

  const price = selectedVariant ? selectedVariant.selling_price : item?.product.selling_price ?? 0;
  const subtotal = (toCents(price) * quantity) / 100;

  return (
    <ManagerBottomSheet visible={item != null} title="Select item" onClose={onClose} scroll>
      {item ? (
        <View style={styles.body}>
          <View style={styles.heading}>
            <View style={styles.iconChip}>
              <Ionicons name="fast-food-outline" size={22} color={managerColors.royalBlue} />
            </View>
            <View style={styles.headingCopy}>
              <Text style={styles.name} numberOfLines={2}>{item.product.name}</Text>
              <Text style={styles.price}>{formatMoney(price)}</Text>
            </View>
          </View>
          <Text style={styles.stock}>
            {item.product.sku} · Available: {remaining}
          </Text>

          {hasVariants ? (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Options</Text>
              <View style={styles.optionList}>
                {variants.map((variant) => {
                  const selected = variant.id === selectedVariant?.id;
                  return (
                    <Pressable
                      key={variant.id}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      accessibilityLabel={variant.name}
                      onPress={() => setSelectedVariantId(variant.id)}
                      style={({ pressed }) => [
                        styles.option,
                        selected && styles.optionSelected,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Ionicons
                        name={selected ? 'radio-button-on' : 'radio-button-off'}
                        size={20}
                        color={selected ? managerColors.royalBlue : managerColors.subtext}
                      />
                      <Text style={[styles.optionName, selected && styles.optionNameSelected]}>
                        {variant.name}
                      </Text>
                      <Text style={[styles.optionPrice, selected && styles.optionNameSelected]}>
                        {formatMoney(variant.selling_price)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}

          <View style={styles.qtyCard}>
            <View style={styles.qtyCardLeft}>
              <Text style={styles.sectionLabel}>Quantity</Text>
              <View style={styles.stepperPill}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Decrease quantity"
                  hitSlop={8}
                  disabled={quantity <= 0}
                  onPress={() => commitDraft(String(Math.max(0, quantity - 1)))}
                  style={({ pressed }) => [
                    styles.stepperButton,
                    pressed && quantity > 0 && styles.stepperButtonPressed,
                  ]}
                >
                  <Text style={[styles.stepperSymbol, quantity <= 0 && styles.stepperSymbolDisabled]}>−</Text>
                </Pressable>
                <TextInput
                  accessibilityLabel="Quantity"
                  keyboardType="number-pad"
                  value={draft}
                  placeholder="0"
                  placeholderTextColor={managerColors.subtext}
                  maxLength={6}
                  selectTextOnFocus
                  onChangeText={(value) => {
                    if (value === '' || /^\d{1,6}$/.test(value)) {
                      setDraft(value);
                      if (value !== '') commitDraft(value);
                    }
                  }}
                  onBlur={() => commitDraft(draft)}
                  style={styles.quantityInput}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Increase quantity"
                  hitSlop={8}
                  disabled={atLimit || remaining <= 0}
                  onPress={() => commitDraft(String(quantity + 1))}
                  style={({ pressed }) => [
                    styles.stepperButton,
                    pressed && !atLimit && styles.stepperButtonPressed,
                  ]}
                >
                  <Text style={[styles.stepperSymbol, (atLimit || remaining <= 0) && styles.stepperSymbolDisabled]}>
                    +
                  </Text>
                </Pressable>
              </View>
              {remaining <= 0 ? (
                <Text style={styles.limit}>No more stock available.</Text>
              ) : atLimit ? (
                <Text style={styles.limit}>Maximum available quantity selected.</Text>
              ) : null}
            </View>
            <View style={styles.qtyCardDivider} />
            <View style={styles.qtyCardRight}>
              <Text style={styles.sectionLabel}>Subtotal</Text>
              <Text style={styles.subtotalValue}>{formatMoney(subtotal)}</Text>
            </View>
          </View>

          <ManagerActionButton
            label="Add to Order"
            disabled={!canAdd}
            onPress={() => {
              onAdd(selectedVariant, quantity);
              onClose();
            }}
          />
        </View>
      ) : null}
    </ManagerBottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: 16, paddingBottom: 4 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  iconChip: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EAF0FB',
  },
  headingCopy: { flex: 1, minWidth: 0, gap: 2 },
  name: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 16, lineHeight: 21 },
  price: { color: managerColors.royalBlue, fontFamily: 'Inter_700Bold', fontSize: 24 },
  stock: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 13 },
  section: { gap: 10 },
  qtyCard: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 14,
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 16,
    backgroundColor: managerColors.cardSurface,
    padding: 14,
  },
  qtyCardLeft: { gap: 10 },
  qtyCardDivider: { width: 1, backgroundColor: managerColors.cardBorder },
  qtyCardRight: { flex: 1, alignItems: 'flex-end', justifyContent: 'center', gap: 6 },
  subtotalValue: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 24 },
  sectionLabel: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  optionList: { gap: 8 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1.5,
    borderColor: managerColors.cardBorder,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
  },
  optionSelected: { borderColor: managerColors.royalBlue, backgroundColor: '#F7F9FD' },
  optionName: { flex: 1, color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  optionNameSelected: { color: managerColors.royalBlue },
  optionPrice: { color: managerColors.subtext, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  pressed: { opacity: 0.7 },
  stepperPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    height: 48,
    borderWidth: 1.5,
    borderColor: managerColors.cardBorder,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
  },
  stepperButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  stepperButtonPressed: { backgroundColor: '#E4E9F2' },
  stepperSymbol: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 20, lineHeight: 24 },
  stepperSymbolDisabled: { color: managerColors.cardBorder },
  quantityInput: {
    width: 56,
    height: 48,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: managerColors.cardBorder,
    backgroundColor: '#FFFFFF',
    color: managerColors.ink,
    fontFamily: 'Inter_700Bold',
    fontSize: 17,
    textAlign: 'center',
    paddingVertical: 0,
  },
  limit: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 6 },
});
