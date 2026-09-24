import { StyleSheet, Text, View } from 'react-native';

import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { ManagerBottomSheet } from '@/components/dashboard/ManagerBottomSheet';
import { managerColors } from '@/components/dashboard/theme';
import { confirmAction } from '@/lib/confirmAction';
import { formatMoney } from '@/lib/format';
import { cartLineKey, cartTotalCents } from '@/lib/money';
import type { CartItem } from '@/types/models';

import { OrderLine } from './PosOrderLine';

type PosViewOrderSheetProps = {
  visible: boolean;
  items: CartItem[];
  /** Available stock per product; limits +. Shared across a product's variant lines. */
  stockByProductId: Map<string, number>;
  onIncrease: (productId: string, variantId: string | null) => void;
  onDecrease: (productId: string, variantId: string | null) => void;
  onQuantityChange: (productId: string, variantId: string | null, quantity: number) => void;
  onClear: () => void;
  onConfirm: () => void;
  onClose: () => void;
};

export function PosViewOrderSheet({
  visible,
  items,
  stockByProductId,
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
              const maxQuantity = Math.max(0, stock - otherQuantity);
              const atLimit = (totalByProduct.get(item.product_id) ?? 0) >= stock;
              const label = item.variant_name ? `${item.product_name} (${item.variant_name})` : item.product_name;
              return (
                <OrderLine
                  key={cartLineKey(item.product_id, item.variant_id)}
                  item={item}
                  label={label}
                  atLimit={atLimit}
                  maxQuantity={maxQuantity}
                  onIncrease={() => onIncrease(item.product_id, item.variant_id)}
                  onDecrease={() => onDecrease(item.product_id, item.variant_id)}
                  onQuantityChange={(quantity) => onQuantityChange(item.product_id, item.variant_id, quantity)}
                  onRemove={() => onQuantityChange(item.product_id, item.variant_id, 0)}
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
