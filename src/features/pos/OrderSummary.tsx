import { StyleSheet, Text, View } from 'react-native';

import { managerColors } from '@/components/dashboard/theme';
import { CategoryIcon } from '@/features/products/CategoryIcon';
import { formatMoney } from '@/lib/format';
import { cartLineKey, toCents } from '@/lib/money';

import { cartLineLabel } from './cartLine';
import {
  chargedUnitPrice,
  previewOrderTotals,
  type SalePricingProgram,
  type SalePricingProgramSetting,
} from './pricingPrograms';
import type { CartItem } from '@/types/models';

/**
 * The order on the checkout screen: one card, a line per product (category icon, quantity x price, line total) and the total ONCE.
 * Catalog and Discount lines appear only when the chosen pricing actually changes the price, so a standard order is just lines + total.
 * The screen's header already says "Order Summary", so the card has no title of its own.
 */
export function OrderSummary({
  items,
  program = 'standard',
  settings = null,
  categoryByProductId,
}: {
  items: CartItem[];
  program?: SalePricingProgram;
  settings?: Partial<Record<SalePricingProgram, SalePricingProgramSetting>> | null;
  /** Saved category per product id, for the picture on each line. */
  categoryByProductId?: Map<string, string | null | undefined>;
}) {
  const totals = previewOrderTotals(items, program, settings);
  const discounted = totals.discountAmount > 0 || program === 'employee_meal';

  return (
    <View style={styles.card}>
      {items.length === 0 ? <Text style={styles.empty}>No products selected.</Text> : null}
      {items.map((item) => {
        const charged = chargedUnitPrice(item.unit_price, program, settings);
        return (
          <View key={cartLineKey(item.product_id, item.variant_id, item.drink_product_id ?? null)} style={styles.itemRow}>
            <CategoryIcon category={categoryByProductId?.get(item.product_id)} size={36} decorative />
            <View style={styles.copy}>
              <Text style={styles.name}>
                {cartLineLabel(item)}
              </Text>
              <Text style={styles.calculation}>
                {item.quantity} × {formatMoney(charged)}
                {charged !== item.unit_price ? ` (was ${formatMoney(item.unit_price)})` : ''}
              </Text>
            </View>
            <Text style={styles.subtotal}>{formatMoney(toCents(charged) * item.quantity / 100)}</Text>
          </View>
        );
      })}
      {discounted ? (
        <View style={styles.adjustments}>
          <View style={styles.adjustRow}>
            <Text style={styles.adjustLabel}>Catalog</Text>
            <Text style={styles.adjustValue}>{formatMoney(totals.catalogSubtotal)}</Text>
          </View>
          <View style={styles.adjustRow}>
            <Text style={styles.adjustLabel}>{program === 'employee_meal' ? 'Employee meal' : 'Discount'}</Text>
            <Text style={[styles.adjustValue, styles.discountValue]}>
              −{formatMoney(program === 'employee_meal' ? totals.catalogSubtotal : totals.discountAmount)}
            </Text>
          </View>
        </View>
      ) : null}
      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>Total</Text>
        <Text style={styles.total}>{formatMoney(totals.chargedTotal)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 14,
    shadowColor: '#0A1224',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 1,
  },
  empty: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 14, paddingVertical: 12 },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: managerColors.cardBorder,
  },
  copy: { flex: 1, minWidth: 0 },
  name: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 14.5 },
  calculation: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12.5, marginTop: 2 },
  subtotal: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 14.5 },
  adjustments: { gap: 6, paddingTop: 12 },
  adjustRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  adjustLabel: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 14 },
  adjustValue: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  discountValue: { color: '#B91C1C' },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 12 },
  totalLabel: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 16 },
  total: { color: managerColors.royalBlue, fontFamily: 'Inter_700Bold', fontSize: 24 },
});
