import Ionicons from '@react-native-vector-icons/ionicons';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { ManagerBottomSheet } from '@/components/dashboard/ManagerBottomSheet';
import { managerColors } from '@/components/dashboard/theme';
import { CategoryIcon } from '@/features/products/CategoryIcon';
import { sortMealVariants } from '@/features/pos/pricingPrograms';
import { formatMoney } from '@/lib/format';
import { toCents } from '@/lib/money';
import type { PosDrinkChoice } from '@/stores/cartStore';
import type { InventoryItem, PosVariant } from '@/types/models';

type PosItemSheetProps = {
  item: InventoryItem | null;
  /** Cart quantity for this product, keyed by variant id (null key = no variant / single price). */
  quantityByVariant: Map<string | null, number>;
  /** Cart quantity per line when a drink is chosen, keyed "<variantId>:<drinkId>". */
  quantityByLine?: Map<string, number>;
  /** `drink` is set when the option includes a drink: the one the cashier picked. */
  onAdd: (variant: PosVariant | null, quantity: number, drink?: PosDrinkChoice | null) => void;
  onClose: () => void;
  onCorrectStock?: () => void;
};

export function PosItemSheet({ item, quantityByVariant, quantityByLine, onAdd, onClose, onCorrectStock }: PosItemSheetProps) {
  const variants = useMemo(() => sortMealVariants(item?.variants ?? []), [item?.variants]);
  const hasVariants = variants.length > 0;
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  const [selectedDrinkId, setSelectedDrinkId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [draft, setDraft] = useState('1');

  // Reset selection whenever a new item is opened.
  useEffect(() => {
    if (!item) return;
    setSelectedVariantId((item.variants?.find((variant) => !variant.unavailable) ?? item.variants?.[0])?.id ?? null);
    setQuantity(1);
    setDraft('1');
  }, [item]);

  const selectedVariant: PosVariant | null = hasVariants
    ? variants.find((variant) => variant.id === selectedVariantId) ?? variants[0] ?? null
    : null;

  // Drink Choice: an option that includes a drink needs exactly one of its eligible drinks. Each drink has its own
  // limit (stock left for that meal + drink, counting the whole cart).
  const drinkOptions = selectedVariant?.drink_options ?? [];
  const needsDrink = drinkOptions.length > 0;
  const lineQuantity = (drinkId: string) => quantityByLine?.get(`${selectedVariant?.id ?? ''}:${drinkId}`) ?? 0;
  const drinkLeft = (option: { id: string; max_quantity: number }) => Math.max(0, option.max_quantity - lineQuantity(option.id));
  const selectedDrink = needsDrink ? drinkOptions.find((option) => option.id === selectedDrinkId) ?? null : null;

  // Start on the first drink that is in stock, and re-pick when the option changes or the chosen drink runs out.
  useEffect(() => {
    if (!needsDrink) {
      setSelectedDrinkId(null);
      return;
    }
    const current = drinkOptions.find((option) => option.id === selectedDrinkId);
    if (current && drinkLeft(current) > 0) return;
    setSelectedDrinkId(drinkOptions.find((option) => drinkLeft(option) > 0)?.id ?? drinkOptions[0]?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVariant?.id, item, quantityByLine]);

  const totalInCart = useMemo(
    () => [...quantityByVariant.values()].reduce((sum, qty) => sum + qty, 0),
    [quantityByVariant],
  );
  // Shared-stock aware: the cap of the selected line (max_quantity) minus what that line already has in the cart.
  // Without recipe data it is the original per-product remaining stock.
  const remaining = !item
    ? 0
    : needsDrink
      ? selectedDrink
        ? drinkLeft(selectedDrink)
        : 0
      : selectedVariant?.max_quantity != null
      ? Math.max(0, selectedVariant.max_quantity - (quantityByVariant.get(selectedVariant.id) ?? 0))
      : !hasVariants && item.max_quantity != null
        ? Math.max(0, item.max_quantity - (quantityByVariant.get(null) ?? 0))
        : Math.max(0, item.quantity_on_hand - totalInCart);
  const atLimit = quantity >= remaining;
  const canAdd = remaining > 0 && quantity > 0 && (!needsDrink || selectedDrink !== null);

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

  const unitsLeft = remaining <= 0 ? 'Out of stock' : `${remaining} available`;

  return (
    <ManagerBottomSheet visible={item != null} title="Select item" onClose={onClose} scroll>
      {item ? (
        <View style={styles.body}>
          <View style={styles.heading}>
            <CategoryIcon category={item.product.product_category} size={44} decorative />
            <View style={styles.headingCopy}>
              <Text style={styles.name} numberOfLines={2}>{item.product.name}</Text>
              <Text style={[styles.stock, remaining <= 0 && styles.stockOut]}>
                {item.product.sku} · {unitsLeft}
              </Text>
            </View>
            {hasVariants ? null : <Text style={styles.headingPrice}>{formatMoney(price)}</Text>}
          </View>

          {hasVariants ? (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Choose an option</Text>
              <View style={styles.optionList}>
                {variants.map((variant) => {
                  const selected = variant.id === selectedVariant?.id;
                  const unavailable = variant.unavailable === true;
                  return (
                    <Pressable
                      key={variant.id}
                      accessibilityRole="button"
                      accessibilityState={{ selected, disabled: unavailable }}
                      accessibilityLabel={unavailable ? `${variant.name}, unavailable` : variant.name}
                      disabled={unavailable}
                      onPress={() => setSelectedVariantId(variant.id)}
                      style={({ pressed }) => [
                        styles.option,
                        selected && styles.optionSelected,
                        unavailable && styles.optionOut,
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
                      <Text style={[styles.optionPrice, selected && styles.optionPriceSelected]}>
                        {unavailable ? 'Unavailable' : formatMoney(variant.selling_price)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}

          {needsDrink ? (
            <View style={styles.section}>
              <View style={styles.sectionHead}>
                <Text style={styles.sectionLabel}>Choose a drink</Text>
                <Text style={styles.sectionNote}>Included in price</Text>
              </View>
              <View style={styles.drinkRow}>
                {drinkOptions.map((option) => {
                  const selected = option.id === selectedDrink?.id;
                  const out = drinkLeft(option) <= 0;
                  return (
                    <Pressable
                      key={option.id}
                      accessibilityRole="button"
                      accessibilityState={{ selected, disabled: out }}
                      accessibilityLabel={out ? `${option.name}, out of stock` : `Drink: ${option.name}`}
                      disabled={out}
                      onPress={() => setSelectedDrinkId(option.id)}
                      style={({ pressed }) => [
                        styles.drinkChip,
                        selected && styles.drinkChipSelected,
                        out && styles.optionOut,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Ionicons
                        name="cafe-outline"
                        size={16}
                        color={selected ? managerColors.royalBlue : managerColors.subtext}
                      />
                      <View style={styles.drinkCopy}>
                        <Text style={[styles.drinkName, selected && styles.optionNameSelected]} numberOfLines={1}>
                          {option.name}
                        </Text>
                        {out ? <Text style={styles.drinkOut}>Out of stock</Text> : null}
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}

          <View style={styles.actionRow}>
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
            <View style={styles.addButton}>
              <ManagerActionButton
                label={quantity > 0 ? `Add · ${formatMoney(subtotal)}` : 'Add'}
                disabled={!canAdd}
                onPress={() => {
                  onAdd(selectedVariant, quantity, selectedDrink ? { id: selectedDrink.id, name: selectedDrink.name } : null);
                  onClose();
                }}
              />
            </View>
          </View>
          {remaining <= 0 ? <Text style={styles.limit}>No more stock available.</Text> : null}
          {remaining <= 0 && onCorrectStock ? <ManagerActionButton label="Check actual stock" variant="secondary" onPress={onCorrectStock} /> : null}
        </View>
      ) : null}
    </ManagerBottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: 18, paddingBottom: 4 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headingCopy: { flex: 1, minWidth: 0, gap: 3 },
  name: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 17, lineHeight: 22 },
  headingPrice: { color: managerColors.royalBlue, fontFamily: 'Inter_600SemiBold', fontSize: 17 },
  stock: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 12.5 },
  stockOut: { color: '#B91C1C' },
  section: { gap: 10 },
  sectionHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  sectionLabel: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  sectionNote: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 12 },
  optionList: { gap: 8 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1.5,
    borderColor: managerColors.cardBorder,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 13,
    backgroundColor: '#FFFFFF',
  },
  optionSelected: { borderColor: managerColors.royalBlue, backgroundColor: '#F3F7FE' },
  optionOut: { opacity: 0.55 },
  optionName: { flex: 1, color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 14.5 },
  optionNameSelected: { color: managerColors.royalBlue },
  optionPrice: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 14 },
  optionPriceSelected: { color: managerColors.royalBlue, fontFamily: 'Inter_600SemiBold' },
  drinkRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  drinkChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexGrow: 1,
    flexBasis: '45%',
    borderWidth: 1.5,
    borderColor: managerColors.cardBorder,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 11,
    backgroundColor: '#FFFFFF',
  },
  drinkChipSelected: { borderColor: managerColors.royalBlue, backgroundColor: '#F3F7FE' },
  drinkCopy: { flexShrink: 1, minWidth: 0 },
  drinkName: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  drinkOut: { color: '#B91C1C', fontFamily: 'Inter_500Medium', fontSize: 11 },
  pressed: { opacity: 0.7 },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  addButton: { flex: 1, minWidth: 0 },
  stepperPill: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 52,
    borderWidth: 1.5,
    borderColor: managerColors.cardBorder,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
  },
  stepperButton: { width: 40, height: 52, alignItems: 'center', justifyContent: 'center' },
  stepperButtonPressed: { backgroundColor: '#E4E9F2' },
  stepperSymbol: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 20, lineHeight: 24 },
  stepperSymbolDisabled: { color: managerColors.cardBorder },
  quantityInput: {
    width: 48,
    height: 52,
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
  limit: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: -8 },
});
