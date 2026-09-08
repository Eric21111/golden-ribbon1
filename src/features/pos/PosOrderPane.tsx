import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { colors, radius, spacing } from '@/constants/theme';
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
        <Text style={styles.notice}>Stock is deducted when you confirm at checkout.</Text>
        {items.length > 0 ? (
          <AppButton
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
        <AppButton label="CHECKOUT" disabled={items.length === 0} onPress={onCheckout} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pane: {
    flex: 1,
    minHeight: 0,
    backgroundColor: colors.surface,
    borderLeftWidth: 1,
    borderLeftColor: colors.border,
  },
  title: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '900',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  scroll: { flex: 1, minHeight: 0 },
  scrollContent: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, gap: spacing.sm },
  empty: { color: colors.muted, fontSize: 14, lineHeight: 20, paddingVertical: spacing.md },
  line: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.sm,
    gap: spacing.sm,
    backgroundColor: colors.background,
  },
  lineCopy: { gap: 2 },
  name: { color: colors.text, fontSize: 14, fontWeight: '700' },
  calc: { color: colors.muted, fontSize: 12 },
  lineActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  stepper: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperText: { color: colors.primary, fontSize: 20, fontWeight: '800', lineHeight: 22 },
  qty: { minWidth: 24, textAlign: 'center', color: colors.text, fontSize: 16, fontWeight: '900' },
  subtotal: {
    marginLeft: 'auto',
    color: colors.text,
    fontSize: 14,
    fontWeight: '800',
  },
  disabled: { opacity: 0.35 },
  pressed: { opacity: 0.65 },
  footer: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  totalMeta: { color: colors.muted, fontSize: 14, fontWeight: '600', flex: 1 },
  totalAmount: { color: colors.primary, fontSize: 22, fontWeight: '900' },
  notice: { color: colors.muted, fontSize: 12, lineHeight: 18, textAlign: 'center' },
});
