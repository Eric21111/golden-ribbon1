import Ionicons from '@react-native-vector-icons/ionicons';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { managerColors } from '@/components/dashboard/theme';
import { formatMoney } from '@/lib/format';
import { toCents } from '@/lib/money';
import type { CartItem } from '@/types/models';

type OrderLineProps = {
  item: CartItem;
  label: string;
  atLimit: boolean;
  maxQuantity: number;
  onIncrease: () => void;
  onDecrease: () => void;
  onQuantityChange: (quantity: number) => void;
  onRemove: () => void;
};

export function OrderLine({
  item,
  label,
  atLimit,
  maxQuantity,
  onIncrease,
  onDecrease,
  onQuantityChange,
  onRemove,
}: OrderLineProps) {
  const [draft, setDraft] = useState(String(item.quantity));

  useEffect(() => {
    setDraft(String(item.quantity));
  }, [item.quantity]);

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
    <View style={styles.line}>
      <View style={styles.leftCol}>
        <Text style={styles.name} numberOfLines={2}>
          {label}
        </Text>
        <Text style={styles.calc}>
          {item.quantity} × {formatMoney(item.unit_price)}
        </Text>
      </View>

      <View style={styles.stepperPill}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Remove one ${label}`}
          hitSlop={6}
          onPress={onDecrease}
          style={({ pressed }) => [styles.stepperButton, pressed && styles.stepperButtonPressed]}
        >
          <Text style={styles.stepperSymbol}>−</Text>
        </Pressable>
        <TextInput
          accessibilityLabel={`${label} quantity`}
          keyboardType="number-pad"
          value={draft}
          maxLength={6}
          selectTextOnFocus
          onChangeText={(value) => {
            if (value === '' || /^\d{1,6}$/.test(value)) {
              setDraft(value);
              if (value !== '') commit(value);
            }
          }}
          onBlur={() => commit(draft)}
          style={styles.qtyInput}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Add one ${label}`}
          disabled={atLimit}
          hitSlop={6}
          onPress={onIncrease}
          style={({ pressed }) => [
            styles.stepperButton,
            atLimit && styles.disabled,
            pressed && !atLimit && styles.stepperButtonPressed,
          ]}
        >
          <Text style={[styles.stepperSymbol, atLimit && styles.stepperSymbolDisabled]}>+</Text>
        </Pressable>
      </View>

      <View style={styles.rightCol}>
        <Text style={styles.subtotal}>
          {formatMoney((toCents(item.unit_price) * item.quantity) / 100)}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Remove ${label} from order`}
          hitSlop={8}
          onPress={onRemove}
          style={({ pressed }) => [styles.removeButton, pressed && styles.pressed]}
        >
          <Ionicons name="close" size={15} color={managerColors.subtext} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: managerColors.cardSurface,
  },
  leftCol: { flex: 1, minWidth: 0, gap: 3 },
  name: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  calc: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12 },
  stepperPill: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    height: 34,
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
  },
  stepperButton: { width: 32, height: 34, alignItems: 'center', justifyContent: 'center' },
  stepperButtonPressed: { backgroundColor: managerColors.cardSurface },
  stepperSymbol: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 16, lineHeight: 18 },
  stepperSymbolDisabled: { color: managerColors.cardBorder },
  qtyInput: {
    width: 28,
    height: 34,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: managerColors.cardBorder,
    textAlign: 'center',
    color: managerColors.ink,
    fontFamily: 'Inter_700Bold',
    fontSize: 13,
    paddingVertical: 0,
    paddingHorizontal: 0,
  },
  rightCol: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0 },
  subtotal: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 14 },
  removeButton: {
    width: 22,
    height: 22,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.35 },
  pressed: { backgroundColor: managerColors.cardBorder },
});
