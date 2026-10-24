import { StyleSheet, Text, View } from 'react-native';

import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { ManagerBottomSheet } from '@/components/dashboard/ManagerBottomSheet';
import { managerColors } from '@/components/dashboard/theme';
import { confirmAction } from '@/lib/confirmAction';
import { formatMoney } from '@/lib/format';
import { cartLineKey, cartTotalCents } from '@/lib/money';
import type { CartItem } from '@/types/models';

import { cartLineLabel } from './cartLine';

import { OrderLine } from './PosOrderLine';

type PosViewOrderSheetProps = {
  visible: boolean;
  items: CartItem[];
  /** Available stock per product; limits +. Shared across a product's variant lines. */
  stockByProductId: Map<string, number>;
  /** Cart-aware cap per cart line (shared ingredient stock). When a line is missing, the per-product limit applies. */
  maxByLine?: Map<string, number>;
  onIncrease: (productId: string, variantId: string | null, drinkId?: string | null) => void;
  onDecrease: (productId: string, variantId: string | null, drinkId?: string | null) => void;
  onQuantityChange: (productId: string, variantId: string | null, quantity: number, drinkId?: string | null) => void;
  onClear: () => void;
  onConfirm: () => void;
  onClose: () => void;
};

export function PosViewOrderSheet({
  visible,
  items,
  stockByProductId,
  maxByLine,
  onIncrease,
  onDecrease,
  onQuantityChange,
  onClear,
  onConfirm,
  onClose,
}: PosViewOrderSheetProps) {
  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
  const totalCents = cartTotalCents(items);
  const totalByProduct = new Map<string, number>();
  for (const item of items) {
    totalByProduct.set(item.product_id, (totalByProduct.get(item.product_id) ?? 0) + item.quantity);
  }

  return (
    <ManagerBottomSheet visible={visible} title="View Order" onClose={onClose} scroll>
      <View style={styles.body}>
        {items.length === 0 ? (
          <Text style={styles.empty}>Tap products to add them to this order.</Text>
        ) : (
          <View style={styles.lines}>
            {items.map((item) => {
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
            })}
          </View>
        )}

        <View style={styles.totalRow}>
          <Text style={styles.totalMeta}>
            {itemCount === 0 ? 'No items' : `${itemCount} item${itemCount === 1 ? '' : 's'}`}
          </Text>
          <Text style={styles.totalAmount}>{formatMoney(totalCents / 100)}</Text>
        </View>

        <View style={styles.buttonRow}>
          <View style={styles.buttonCol}>
            <ManagerActionButton
              label="Confirm Order"
              icon="checkmark-circle-outline"
              disabled={items.length === 0}
              onPress={onConfirm}
            />
          </View>
          {items.length > 0 ? (
            <View style={styles.buttonCol}>
              <ManagerActionButton
                label="Clear order"
                variant="secondary"
                onPress={() =>
                  confirmAction('Clear order?', 'Remove all products from this unfinished order.', onClear)
                }
              />
            </View>
          ) : null}
        </View>
      </View>
    </ManagerBottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: 14, paddingBottom: 4 },
  empty: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20, paddingVertical: 8 },
  lines: { gap: 10 },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: managerColors.cardBorder,
    paddingTop: 12,
  },
  totalMeta: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 14, flex: 1 },
  totalAmount: { color: managerColors.royalBlue, fontFamily: 'Inter_700Bold', fontSize: 21 },
  buttonRow: { flexDirection: 'row', gap: 10 },
  buttonCol: { flex: 1 },
});
