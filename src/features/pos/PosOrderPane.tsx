import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { managerColors } from '@/components/dashboard/theme';
import { confirmAction } from '@/lib/confirmAction';
import { formatMoney } from '@/lib/format';
import { cartLineKey, cartTotalCents } from '@/lib/money';
import type { CartItem } from '@/types/models';

import { cartLineLabel } from './cartLine';

import { OrderLine } from './PosOrderLine';

type PosOrderPaneProps = {
  items: CartItem[];
  /** Available stock per product; limits + on tablet cart. Shared across a product's variant lines. */
  stockByProductId: Map<string, number>;
  /** Cart-aware cap per cart line (shared ingredient stock). When a line is missing, the per-product limit applies. */
  maxByLine?: Map<string, number>;
  onIncrease: (productId: string, variantId: string | null, drinkId?: string | null) => void;
  onDecrease: (productId: string, variantId: string | null, drinkId?: string | null) => void;
  onQuantityChange: (productId: string, variantId: string | null, quantity: number, drinkId?: string | null) => void;
  onClear: () => void;
  onCheckout: () => void;
};

export function PosOrderPane({
  items,
  stockByProductId,
  maxByLine,
  onIncrease,
  onDecrease,
  onQuantityChange,
  onClear,
  onCheckout,
}: PosOrderPaneProps) {
  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
  const totalCents = cartTotalCents(items);
  const totalByProduct = new Map<string, number>();
  for (const item of items) {
    totalByProduct.set(item.product_id, (totalByProduct.get(item.product_id) ?? 0) + item.quantity);
  }

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
            const otherQuantity = (totalByProduct.get(item.product_id) ?? 0) - item.quantity;
            const lineMax = maxByLine?.get(cartLineKey(item.product_id, item.variant_id, item.drink_product_id ?? null));
            const maxQuantity = lineMax ?? Math.max(0, stock - otherQuantity);
            const atLimit = lineMax != null ? item.quantity >= lineMax : (totalByProduct.get(item.product_id) ?? 0) >= stock;
            const label = cartLineLabel(item);
            return (
              <OrderLine
                key={cartLineKey(item.product_id, item.variant_id, item.drink_product_id ?? null)}
                item={item}
                label={label}
                atLimit={atLimit}
                maxQuantity={maxQuantity}
                onIncrease={() => onIncrease(item.product_id, item.variant_id, item.drink_product_id ?? null)}
                onDecrease={() => onDecrease(item.product_id, item.variant_id, item.drink_product_id ?? null)}
                onQuantityChange={(quantity) => onQuantityChange(item.product_id, item.variant_id, quantity, item.drink_product_id ?? null)}
                onRemove={() => onQuantityChange(item.product_id, item.variant_id, 0, item.drink_product_id ?? null)}
              />
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
        <ManagerActionButton label="Confirm Order" icon="checkmark-circle-outline" disabled={items.length === 0} onPress={onCheckout} />
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
