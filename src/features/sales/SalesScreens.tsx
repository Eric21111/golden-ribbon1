import Ionicons from '@react-native-vector-icons/ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { ManagerBadge } from '@/components/dashboard/ManagerBadge';
import { SummaryCard } from '@/components/dashboard/SummaryCard';
import { managerColors } from '@/components/dashboard/theme';
import { useSale } from '@/hooks/useSales';
import { formatDate, formatMoney } from '@/lib/format';

function goBack() {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace('/cashier/sales');
  }
}

type SaleDetailsBodyProps = {
  saleId: string;
  /** True for the full-page drill-in route; false inside a tablet master–detail pane. */
  showBack?: boolean;
};

/** Sale detail body reusable for full-page and tablet master–detail. */
export function SaleDetailsBody({ saleId, showBack = false }: SaleDetailsBodyProps) {
  const query = useSale(saleId);

  if (query.isLoading) return <LoadingState label="Loading sale details…" />;
  if (query.error || !query.data) {
    return (
      <ErrorState
        message="Unable to load sale details."
        onRetry={() => void query.refetch()}
      />
    );
  }

  const sale = query.data;
  const isCompleted = sale.status === 'completed';

  return (
    <View style={styles.body}>
      <View style={styles.headerRow}>
        {showBack ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back"
            hitSlop={14}
            onPress={goBack}
            style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
          >
            <Ionicons name="chevron-back" size={24} color={managerColors.ink} />
          </Pressable>
        ) : null}
        <View style={styles.headerCopy}>
          <Text style={styles.title} numberOfLines={1}>
            {sale.sale_number}
          </Text>
          <View style={styles.metaRow}>
            <Text style={styles.subtitle} numberOfLines={1}>
              Sold {formatDate(sale.sold_at)}
            </Text>
            <ManagerBadge
              label={isCompleted ? 'Completed' : 'Voided'}
              tone={isCompleted ? 'success' : 'danger'}
            />
          </View>
        </View>
      </View>

      <SummaryCard
        rows={[
          { label: 'Branch', value: sale.branch?.name ?? 'Branch', icon: 'storefront-outline' },
          { label: 'Cashier', value: sale.cashier?.full_name ?? 'Cashier', icon: 'person-outline' },
          {
            label: 'Shift session',
            value: sale.shift ? formatDate(sale.shift.started_at) : 'Shift session',
            icon: 'time-outline',
          },
          { label: 'Date / time', value: formatDate(sale.sold_at), icon: 'calendar-outline' },
        ]}
      />

      <Text style={styles.sectionTitle}>ITEMS ORDERED</Text>
      <View style={styles.receipt}>
        {sale.items.map((item, index) => {
          const name = item.variant_name
            ? `${item.product?.name ?? `Product (${item.product_id})`} (${item.variant_name})`
            : item.product?.name ?? `Product (${item.product_id})`;
          return (
            <View key={item.id}>
              {index > 0 ? <View style={styles.receiptDivider} /> : null}
              <View style={styles.receiptRow}>
                <View style={styles.receiptCopy}>
                  <Text style={styles.receiptName} numberOfLines={2}>{name}</Text>
                  <Text style={styles.receiptMeta}>
                    Qty {item.quantity} × {formatMoney(item.unit_price)}
                  </Text>
                </View>
                <Text style={styles.receiptSubtotal}>{formatMoney(item.subtotal)}</Text>
              </View>
            </View>
          );
        })}
      </View>

      <Text style={styles.sectionTitle}>PAYMENT SUMMARY</Text>
      <SummaryCard
        rows={[
          { label: 'Subtotal', value: formatMoney(sale.subtotal) },
          { label: 'Total amount', value: formatMoney(sale.total_amount), emphasis: true },
        ]}
      />
    </View>
  );
}

export function SaleDetailsScreen({ role: _role }: { role: 'cashier' }) {
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : '';

  return (
    <Screen backgroundColor="#FFFFFF" contentContainerStyle={styles.screen}>
      <SaleDetailsBody saleId={id} showBack />
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { padding: 20, gap: 16 },
  body: { gap: 16 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  backButton: { alignItems: 'center', justifyContent: 'center', paddingTop: 2 },
  pressed: { opacity: 0.6 },
  headerCopy: { flex: 1, minWidth: 0, gap: 4 },
  title: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 20 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  subtitle: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 13, flexShrink: 1 },
  sectionTitle: {
    color: managerColors.subtext,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    letterSpacing: 0.8,
  },
  receipt: {
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
  },
  receiptDivider: { height: StyleSheet.hairlineWidth, backgroundColor: managerColors.cardBorder },
  receiptRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 12,
  },
  receiptCopy: { flex: 1, minWidth: 0, gap: 3 },
  receiptName: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 14.5 },
  receiptMeta: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12.5 },
  receiptSubtotal: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 15 },
});
