import { ItemVoidForm } from './ItemVoidForm';
import { paymentLabel } from '@/features/sales/paymentMethods';
import Ionicons from '@react-native-vector-icons/ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { ManagerBadge } from '@/components/dashboard/ManagerBadge';
import { StatTile } from '@/components/dashboard/StatTile';
import { SummaryCard } from '@/components/dashboard/SummaryCard';
import { CategoryIcon } from '@/features/products/CategoryIcon';
import { cartLineParts } from '@/features/pos/cartLine';
import { managerColors } from '@/components/dashboard/theme';
import { pricingProgramLabel } from '@/features/pos/pricingPrograms';
import { useSale } from '@/hooks/useSales';
import { formatDate, formatMoney } from '@/lib/format';
import { isSaleId, saleReadErrorMessage } from '@/lib/saleErrors';
import { AppButton } from '@/components/AppButton';

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

  if (!isSaleId(saleId)) return (
    <View>
      <ErrorState message={saleReadErrorMessage({ code: 'INVALID_SALE_ID' })} />
      <AppButton label="Back to Sales" onPress={() => router.replace('/cashier/sales')} />
    </View>
  );
  if (query.isLoading) return <LoadingState label="Loading sale details…" />;
  if (query.error || !query.data) {
    return (
      <View>
        <ErrorState message={saleReadErrorMessage(query.error)} onRetry={() => void query.refetch()} />
        {showBack ? <AppButton label="Back to Sales" onPress={() => router.replace('/cashier/sales')} /> : null}
      </View>
    );
  }

  const sale = query.data;
  const isCompleted = sale.status === 'completed';
  const showCatalog = sale.catalog_subtotal != null && Number(sale.catalog_subtotal) !== Number(sale.total_amount);
  const showDiscount = Number(sale.discount_amount ?? 0) > 0;
  // a plain sale needs no breakdown: the total is at the top already
  const hasBreakdown = showCatalog || showDiscount;
  const partiallyVoided = isCompleted && sale.items.some(item => item.void_history?.length);

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
          <Text style={styles.title}>{sale.sale_number}</Text>
          <View style={styles.metaRow}>
            <Text style={styles.subtitle}>Sold {formatDate(sale.sold_at)}</Text>
            <ManagerBadge
              label={partiallyVoided ? 'Partially voided' : isCompleted ? 'Completed' : 'Voided'}
              tone={partiallyVoided ? 'warning' : isCompleted ? 'success' : 'danger'}
            />
          </View>
        </View>
      </View>

      {/* the answer first: what was charged, how it was paid and under which pricing */}
      <StatTile
        layout="wide"
        emphasis
        icon="cash-outline"
        label="Charged total"
        value={formatMoney(sale.total_amount)}
        caption={`${paymentLabel(sale.payment_method)} · ${pricingProgramLabel(sale.pricing_program ?? 'standard')}`}
      />

      <Text style={styles.sectionTitle}>ITEMS ORDERED</Text>
      <View style={styles.receipt}>
        {sale.items.map((item, index) => {
          const baseName = item.variant_name
            ? `${item.product?.name ?? `Product (${item.product_id})`} (${item.variant_name})`
            : item.product?.name ?? `Product (${item.product_id})`;
          // a meal sold with a drink shows the drink chosen
          const name = item.drink_name ? `${baseName} · ${item.drink_name}` : baseName;
          const parts = cartLineParts({ product_name: item.product?.name ?? `Product (${item.product_id})`, variant_name: item.variant_name, drink_name: item.drink_name ?? null });
          return (
            <View key={item.id}>
              {index > 0 ? <View style={styles.receiptDivider} /> : null}
              <View style={styles.receiptRow}>
                <CategoryIcon category={item.product?.product_category} size={36} decorative />
                <View style={styles.receiptCopy}>
                  <Text style={styles.receiptName}>{parts.name}</Text>
                  <View style={styles.tags}>
                    <View style={styles.qtyTag}>
                      <Text style={styles.qtyTagLabel}>{`${item.quantity}×`}</Text>
                    </View>
                    {parts.option || parts.drink ? (
                      <>
                      {parts.option ? (
                        <View style={styles.tag}>
                          <Text style={styles.tagLabel}>{parts.option}</Text>
                        </View>
                      ) : null}
                      {parts.drink ? (
                        <View style={styles.tag}>
                          <Text style={styles.tagLabel}>{`+ ${parts.drink}`}</Text>
                        </View>
                      ) : null}
                      </>
                    ) : null}
                  </View>
                  <Text style={styles.receiptMeta}>{formatMoney(item.unit_price)} each</Text>
                </View>
                <View style={styles.receiptRight}>
                  <Text style={styles.receiptSubtotal}>{formatMoney(item.subtotal)}</Text>
                  {isCompleted && sale.shift?.status === 'open' && !sale.shift.sales_cutoff_at && item.quantity > 0 && item.stock_per_unit ? (
                    <ItemVoidForm key={item.quantity} item={item} name={name} cashierId={sale.cashier_id} />
                  ) : null}
                </View>
              </View>
              {!!item.void_history?.length && <Text style={styles.voidNote}>Originally ordered {Number(item.quantity) + item.void_history.reduce((sum, entry) => sum + entry.quantity, 0)}</Text>}
              {item.void_history?.map(entry => <Text key={entry.id} style={styles.voidNote}>Voided {entry.quantity} · −{formatMoney(entry.amount)} · {entry.reason === 'Other' ? entry.note : entry.reason}</Text>)}
            </View>
          );
        })}
      </View>

      {hasBreakdown ? (
        <>
          <Text style={styles.sectionTitle}>PAYMENT SUMMARY</Text>
          <SummaryCard
            rows={[
              ...(showCatalog ? [{ label: 'Catalog', value: formatMoney(sale.catalog_subtotal ?? 0) }] : []),
              ...(showDiscount ? [{ label: 'Discount', value: `−${formatMoney(sale.discount_amount ?? 0)}` }] : []),
              { label: 'Charged total', value: formatMoney(sale.total_amount), emphasis: true },
            ]}
          />
        </>
      ) : null}

      <Text style={styles.sectionTitle}>SALE DETAILS</Text>
      <SummaryCard
        rows={[
          { label: 'Branch', value: sale.branch?.name ?? 'Branch', icon: 'storefront-outline' },
          { label: 'Cashier', value: sale.cashier?.full_name ?? 'Cashier', icon: 'person-outline' },
          {
            label: 'Shift session',
            value: sale.shift ? formatDate(sale.shift.started_at) : 'Shift session',
            icon: 'time-outline',
          },
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
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 8, rowGap: 4 },
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
  voidNote: { color: '#B91C1C', fontFamily: 'Inter_500Medium', fontSize: 12.5, paddingBottom: 8 },
  receiptDivider: { height: StyleSheet.hairlineWidth, backgroundColor: managerColors.cardBorder },
  receiptRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 12,
  },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: { alignSelf: 'flex-start', backgroundColor: managerColors.cardSurface, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  tagLabel: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 11.5 },
  receiptRight: { alignItems: 'flex-end', gap: 8, flexShrink: 0 },
  qtyTag: { alignSelf: 'flex-start', backgroundColor: '#EAF0FB', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  qtyTagLabel: { color: managerColors.royalBlue, fontFamily: 'Inter_700Bold', fontSize: 11.5 },
  receiptCopy: { flex: 1, minWidth: 0, gap: 3 },
  receiptName: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 14.5 },
  receiptMeta: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12.5 },
  receiptSubtotal: { flexShrink: 0, color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 15 },
});
