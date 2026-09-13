import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { managerColors } from '@/components/dashboard/theme';
import { confirmAction } from '@/lib/confirmAction';
import { formatMoney } from '@/lib/format';
import { cartTotalCents, toCents } from '@/lib/money';
import type { CartItem } from '@/types/models';

type PosOrderPaneProps = {
  items: CartItem[];
  /** Available stock per product; limits + on tablet cart. */
  stockByProductId: Map<string, number>;
  onIncrease: (productId: string) => void;
  onDecrease: (productId: string) => void;
  onClear: () => void;
  onCheckout: () => void;
};

export function PosOrderPane({
  items,
  stockByProductId,
  onIncrease,
  onDecrease,
  onClear,
  onCheckout,
}: PosOrderPaneProps) {
  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
  const totalCents = cartTotalCents(items);

  return (
    <View style={styles.pane}>
      <Text style={styles.title}>Current order</Text>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {items.length === 0 ? (
          <Text style={styles.empty}>Tap products to add them to this order.</Text>
        ) : (
          items.map((item) => {
            const stock = stockByProductId.get(item.product_id) ?? 0;
            const atLimit = item.quantity >= stock;
            return (
              <View key={item.product_id} style={styles.line}>
                <View style={styles.lineCopy}>
                  <Text style={styles.name} numberOfLines={2}>
                    {item.product_name}
                  </Text>
                  <Text style={styles.calc}>
                    {item.quantity} × {formatMoney(item.unit_price)}
                  </Text>
                </View>
                <View style={styles.lineActions}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Remove one ${item.product_name}`}
                    onPress={() => onDecrease(item.product_id)}
                    style={({ pressed }) => [styles.stepper, pressed && styles.pressed]}
                  >
                    <Text style={styles.stepperText}>−</Text>
                  </Pressable>
                  <Text style={styles.qty}>{item.quantity}</Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Add one ${item.product_name}`}
                    disabled={atLimit}
                    onPress={() => onIncrease(item.product_id)}
                    style={({ pressed }) => [
                      styles.stepper,
                      atLimit && styles.disabled,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={styles.stepperText}>+</Text>
                  </Pressable>
                  <Text style={styles.subtotal}>
                    {formatMoney((toCents(item.unit_price) * item.quantity) / 100)}
                  </Text>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.totalRow}>
          <Text style={styles.totalMeta}>
            {itemCount === 0
              ? 'No items'
              : `${itemCount} item${itemCount === 1 ? '' : 's'}`}
          </Text>
          <Text style={styles.totalAmount}>{formatMoney(totalCents / 100)}</Text>
        </View>
        <ManagerActionButton label="Checkout" icon="card-outline" disabled={items.length === 0} onPress={onCheckout} />
        {items.length > 0 ? (
          <ManagerActionButton
            label="Clear order"
            variant="secondary"
            onPress={() =>
              confirmAction(
                'Clear order?',
                'Remove all products from this unfinished order.',
                onClear,
              )
            }
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pane: {
    flex: 1,
    minHeight: 0,
    backgroundColor: '#FFFFFF',
    borderLeftWidth: 1,
    borderLeftColor: managerColors.cardBorder,
  },
  title: {
    color: managerColors.ink,
    fontFamily: 'Inter_700Bold',
    fontSize: 17,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 10,
  },
  scroll: { flex: 1, minHeight: 0 },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 16, gap: 10 },
  empty: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20, paddingVertical: 16 },
  line: {
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 14,
    padding: 12,
    gap: 10,
    backgroundColor: managerColors.cardSurface,
  },
  lineCopy: { gap: 2 },
  name: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  calc: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12 },
  lineActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  stepper: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperText: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 17, lineHeight: 19 },
  qty: { minWidth: 22, textAlign: 'center', color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 14 },
  subtotal: {
    marginLeft: 'auto',
    color: managerColors.ink,
    fontFamily: 'Inter_700Bold',
    fontSize: 14,
  },
  disabled: { opacity: 0.35 },
  pressed: { opacity: 0.7 },
  footer: {
    borderTopWidth: 1,
    borderTopColor: managerColors.cardBorder,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
    gap: 10,
  },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  totalMeta: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 14, flex: 1 },
  totalAmount: { color: managerColors.royalBlue, fontFamily: 'Inter_700Bold', fontSize: 21 },
});
