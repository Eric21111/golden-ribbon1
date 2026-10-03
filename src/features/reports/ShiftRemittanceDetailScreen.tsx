import Ionicons from '@react-native-vector-icons/ionicons';
import { useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { Pagination } from '@/components/Pagination';
import { Screen } from '@/components/Screen';
import { FilterChipRow } from '@/components/dashboard/FilterChipRow';
import { ManagerBadge, type ManagerBadgeTone } from '@/components/dashboard/ManagerBadge';
import { EmptyState, ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { managerColors } from '@/components/dashboard/theme';
import { closingDispositionLabel, formatPcsQty } from '@/features/reports/reportDisplay';
import { useClientPagination } from '@/hooks/useClientPagination';
import { useShiftCloseReportDetail } from '@/hooks/useShifts';
import { getErrorMessage } from '@/lib/errors';
import { formatMoney } from '@/lib/format';
import type { ShiftCloseReportProduct, ShiftProductReconResult } from '@/types/models';

const timeFormatter = new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit' });
const dateFormatter = new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium' });

function formatWhen(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return `${dateFormatter.format(date)}, ${timeFormatter.format(date)}`;
}

/** Shows the date once instead of repeating "Started <date> · Ended <date>" when the shift
 * never crosses midnight — that repetition was what wrapped this onto two lines. */
function formatShiftWindow(startedAt: string, endedAt: string | null) {
  const start = new Date(startedAt);
  const end = endedAt ? new Date(endedAt) : null;
  const sameDay = !end || start.toDateString() === end.toDateString();
  if (sameDay) {
    return `${dateFormatter.format(start)} · ${timeFormatter.format(start)} – ${end ? timeFormatter.format(end) : 'In progress'}`;
  }
  return `${formatWhen(startedAt)} – ${endedAt ? formatWhen(endedAt) : 'In progress'}`;
}

type ResultFilter = 'all' | ShiftProductReconResult;

const inventoryResultBadge: Record<ShiftProductReconResult, { label: string; tone: ManagerBadgeTone }> = {
  exact: { label: 'Exact', tone: 'info' },
  shortage: { label: 'Shortage', tone: 'danger' },
  excess: { label: 'Excess', tone: 'success' },
};

export function ShiftRemittanceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useShiftCloseReportDetail(id ?? '');
  const detail = query.data;
  const [resultFilter, setResultFilter] = useState<ResultFilter>('all');

  const counts = useMemo(() => {
    const products = detail?.products ?? [];
    return {
      total: products.length,
      exact: products.filter((p) => p.result === 'exact').length,
      shortage: products.filter((p) => p.result === 'shortage').length,
      excess: products.filter((p) => p.result === 'excess').length,
    };
  }, [detail?.products]);

  const filteredProducts = useMemo(() => {
    const products = detail?.products ?? [];
    if (resultFilter === 'all') return products;
    return products.filter((p) => p.result === resultFilter);
  }, [detail?.products, resultFilter]);

  const pagination = useClientPagination(filteredProducts, resultFilter);

  const shortage = detail?.cash_result === 'shortage' ? Math.abs(Number(detail.difference ?? 0)) : 0;
  const excess = detail?.cash_result === 'excess' ? Math.abs(Number(detail.difference ?? 0)) : 0;

  const filterOptions: { label: string; value: ResultFilter }[] = [
    { label: `All (${counts.total})`, value: 'all' },
    { label: `Shortage (${counts.shortage})`, value: 'shortage' },
    { label: `Excess (${counts.excess})`, value: 'excess' },
    { label: `Exact (${counts.exact})`, value: 'exact' },
  ];

  return (
    <Screen backgroundColor="#FFFFFF" edges={['top']} contentContainerStyle={styles.screen}>
      <ManagerScreenHeader title="Shift remittance detail" showBack />
      <ConstrainedWidth style={styles.column}>
        {query.isLoading ? <LoadingState label="Loading shift remittance…" /> : null}
        {query.error ? (
          <ErrorState message={getErrorMessage(query.error)} onRetry={() => void query.refetch()} />
        ) : null}
        {!query.isLoading && !query.error && !detail ? (
          <EmptyState title="Shift not found" message="This remittance record is unavailable." />
        ) : null}

        {detail ? (
          <>
            <View style={styles.identityCard}>
              <View style={styles.identityHeader}>
                <View style={styles.identityIconChip}>
                  <Ionicons name="storefront-outline" size={20} color={managerColors.royalBlue} />
                </View>
                <View style={styles.identityHeaderText}>
                  <Text style={styles.branchName}>{detail.branch_name}</Text>
                  <View style={styles.identityRow}>
                    <Ionicons name="person-circle-outline" size={13} color={managerColors.subtext} />
                    <Text style={styles.identityText}>{detail.cashier_name}</Text>
                  </View>
                </View>
              </View>

              <View style={styles.identityDivider} />

              <View style={styles.identityRow}>
                <Ionicons name="time-outline" size={13} color={managerColors.subtext} />
                <Text style={styles.identityText}>{formatShiftWindow(detail.started_at, detail.ended_at)}</Text>
              </View>
              {detail.sales_cutoff_at ? (
                <View style={styles.identityRow}>
                  <Ionicons name="cut-outline" size={13} color={managerColors.subtext} />
                  <Text style={styles.identityText}>Sales cutoff {formatWhen(detail.sales_cutoff_at)}</Text>
                </View>
              ) : null}
            </View>

            <Text style={styles.section}>Cash</Text>
            <View style={styles.heroCard}>
              <View style={styles.heroStack}>
                <View style={styles.heroRowFull}>
                  <View style={styles.heroLeft}>
                    <View style={styles.heroIconChip}>
                      <Ionicons name="cash-outline" size={18} color={managerColors.royalBlue} />
                    </View>
                    <Text style={styles.heroLabel}>Expected Cash</Text>
                  </View>
                  <Text style={styles.heroValue} numberOfLines={1} adjustsFontSizeToFit>
                    {formatMoney(detail.expected_cash)}
                  </Text>
                </View>
                <View style={styles.heroRowFull}>
                  <View style={styles.heroLeft}>
                    <View style={styles.heroIconChip}>
                      <Ionicons name="wallet-outline" size={18} color={managerColors.royalBlue} />
                    </View>
                    <Text style={styles.heroLabel}>Actual Cash</Text>
                  </View>
                  <Text style={styles.heroValue} numberOfLines={1} adjustsFontSizeToFit>
                    {detail.actual_cash == null ? '—' : formatMoney(detail.actual_cash)}
                  </Text>
                </View>
              </View>

              {detail.cash_status === 'pending' ? (
                <View style={styles.pendingNote}>
                  <Ionicons name="hourglass-outline" size={14} color={managerColors.goldMuted} />
                  <Text style={styles.pendingNoteText}>
                    Remittance is still pending. Actual cash and inventory results are not available yet.
                  </Text>
                </View>
              ) : (
                <View
                  style={[
                    styles.resultPill,
                    { backgroundColor: shortage > 0 ? '#FEE2E2' : excess > 0 ? '#DCFCE7' : managerColors.cardSurface },
                  ]}
                >
                  <Ionicons
                    name={shortage > 0 ? 'trending-down-outline' : excess > 0 ? 'trending-up-outline' : 'checkmark-circle-outline'}
                    size={14}
                    color={shortage > 0 ? '#B91C1C' : excess > 0 ? managerColors.green : managerColors.subtext}
                  />
                  <Text
                    style={[
                      styles.resultPillText,
                      { color: shortage > 0 ? '#B91C1C' : excess > 0 ? managerColors.green : managerColors.subtext },
                    ]}
                  >
                    {shortage > 0
                      ? `${formatMoney(shortage)} shortage`
                      : excess > 0
                        ? `${formatMoney(excess)} excess`
                        : 'Exact match'}
                  </Text>
                </View>
              )}
            </View>

            <Text style={styles.section}>Inventory close</Text>
            {detail.cash_status === 'pending' ? (
              <EmptyState
                title="Not available yet"
                message="Finish remittance before inventory results appear."
              />
            ) : detail.products.length === 0 ? (
              <EmptyState
                title="No inventory data"
                message={
                  detail.inventory_reconciliation_required
                    ? 'No product reconciliation rows were stored for this shift.'
                    : 'Cash reconciliation only — inventory close was not required for this historical shift.'
                }
              />
            ) : (
              <>
                <FilterChipRow options={filterOptions} value={resultFilter} onChange={setResultFilter} />
                {filteredProducts.length === 0 ? (
                  <EmptyState title="No matching products" message="Try a different filter." />
                ) : (
                  pagination.pageItems.map((product) => (
                    <ProductCard key={product.id} product={product} />
                  ))
                )}
                {pagination.showPagination ? (
                  <View style={styles.pager}>
                    <Pagination page={pagination.page} totalPages={pagination.totalPages} onPageChange={pagination.setPage} />
                  </View>
                ) : null}
              </>
            )}
          </>
        ) : null}
      </ConstrainedWidth>
    </Screen>
  );
}

function ProductCard({ product }: { product: ShiftCloseReportProduct }) {
  const [expanded, setExpanded] = useState(false);
  const badge = inventoryResultBadge[product.result];
  const isIssue = product.result !== 'exact';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={expanded ? 'Hide movement ledger' : 'Show movement ledger'}
      onPress={() => setExpanded((current) => !current)}
      style={({ pressed }) => [
        styles.card,
        product.result === 'shortage' && styles.shortageCard,
        product.result === 'excess' && styles.excessCard,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.headerRow}>
        <Text style={styles.productName} numberOfLines={2}>
          {product.product_name_snapshot}
        </Text>
        <ManagerBadge label={badge.label} tone={badge.tone} />
      </View>

      <View style={styles.subRow}>
        {product.sku_snapshot ? (
          <View style={styles.skuTag}>
            <Text style={styles.skuTagLabel} numberOfLines={1}>
              SKU {product.sku_snapshot}
            </Text>
          </View>
        ) : (
          <View />
        )}
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={managerColors.subtext} />
      </View>

      <View style={styles.summaryRow}>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryLabel} numberOfLines={1}>Expected</Text>
          <Text style={styles.summaryValue} numberOfLines={1}>{formatPcsQty(product.expected_remaining)}</Text>
        </View>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryLabel} numberOfLines={1}>Actual</Text>
          <Text style={styles.summaryValue} numberOfLines={1}>{formatPcsQty(product.actual_remaining)}</Text>
        </View>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryLabel} numberOfLines={1}>Discrepancy</Text>
          <Text
            style={[styles.summaryValue, isIssue && (product.result === 'shortage' ? styles.varianceDanger : styles.varianceSuccess)]}
            numberOfLines={1}
          >
            {product.discrepancy > 0 ? `+${formatPcsQty(product.discrepancy)}` : formatPcsQty(product.discrepancy)}
          </Text>
        </View>
      </View>

      {expanded ? (
        <View style={styles.ledger}>
          <View style={styles.ledgerRow}>
            <Text style={styles.ledgerLabel}>Opening</Text>
            <Text style={styles.ledgerValue}>{formatPcsQty(product.opening_quantity)}</Text>
          </View>
          <View style={styles.ledgerRow}>
            <Text style={styles.ledgerLabel}>Received</Text>
            <Text style={styles.ledgerValue}>{formatPcsQty(product.received_quantity)}</Text>
          </View>
          <View style={styles.ledgerRow}>
            <Text style={styles.ledgerLabel}>Outgoing</Text>
            <Text style={styles.ledgerValue}>{formatPcsQty(product.outgoing_quantity)}</Text>
          </View>
          <View style={styles.ledgerRow}>
            <Text style={styles.ledgerLabel}>Sold</Text>
            <Text style={styles.ledgerValue}>{formatPcsQty(product.sold_quantity)}</Text>
          </View>
          <View style={styles.ledgerRow}>
            <Text style={styles.ledgerLabel}>Adjustment</Text>
            <Text style={styles.ledgerValue}>{formatPcsQty(product.adjustment_quantity)}</Text>
          </View>
          <View style={styles.ledgerRow}>
            <Text style={styles.ledgerLabel}>Waste</Text>
            <Text style={styles.ledgerValue}>{formatPcsQty(product.waste_quantity)}</Text>
          </View>

          <View style={styles.dispositionBlock}>
            <View style={styles.ledgerRow}>
              <Text style={styles.ledgerLabel}>Unsold</Text>
              <Text style={styles.ledgerValue}>{formatPcsQty(product.unsold_quantity)}</Text>
            </View>
            <View style={styles.ledgerRow}>
              <Text style={styles.ledgerLabel}>Carried</Text>
              <Text style={styles.ledgerValue}>{formatPcsQty(product.carried_quantity)}</Text>
            </View>
            <Text style={styles.disposition}>{closingDispositionLabel(product)}</Text>
          </View>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flexGrow: 1, padding: 0, gap: 0 },
  column: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 28, gap: 12 },
  section: {
    color: managerColors.subtext,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    letterSpacing: 0.6,
    marginTop: 4,
  },
  identityCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 16,
    padding: 18,
    gap: 12,
    shadowColor: '#0A1224',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 1,
  },
  identityHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  identityIconChip: {
    width: 44,
    height: 44,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#DCE8FC',
  },
  identityHeaderText: { flex: 1, gap: 4, minWidth: 0 },
  identityDivider: { height: 1, backgroundColor: managerColors.cardBorder },
  branchName: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 18 },
  identityRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  identityText: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 13 },

  heroCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 16,
    padding: 20,
    gap: 16,
    shadowColor: '#0A1224',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 1,
  },
  heroStack: { gap: 12 },
  heroRowFull: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  heroLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 },
  heroIconChip: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#DCE8FC',
  },
  heroLabel: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 13 },
  heroValue: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 20 },
  resultPill: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  resultPillText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  pendingNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEF3C7',
    borderRadius: 12,
    padding: 12,
  },
  pendingNoteText: { flex: 1, color: managerColors.goldMuted, fontFamily: 'Inter_500Medium', fontSize: 12.5, lineHeight: 17 },

  pager: { paddingVertical: 8 },
  card: {
    backgroundColor: '#FFFFFF',
    borderColor: managerColors.cardBorder,
    borderWidth: 1,
    borderRadius: 16,
    padding: 18,
    gap: 12,
    shadowColor: '#0A1224',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 1,
  },
  shortageCard: { borderColor: '#F3C6C2', backgroundColor: '#FFFAF9' },
  excessCard: { borderColor: '#BBE8CC', backgroundColor: '#F6FDF9' },
  pressed: { opacity: 0.85 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  productName: { flex: 1, color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 16, lineHeight: 21 },
  subRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  skuTag: {
    alignSelf: 'flex-start',
    backgroundColor: managerColors.cardSurface,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  skuTagLabel: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 11.5, letterSpacing: 0.3 },
  summaryRow: { flexDirection: 'row', gap: 10 },
  summaryItem: { flex: 1, gap: 2 },
  summaryLabel: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 11.5 },
  summaryValue: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 14 },
  varianceDanger: { color: '#B91C1C' },
  varianceSuccess: { color: managerColors.green },
  ledger: {
    backgroundColor: managerColors.cardSurface,
    borderRadius: 12,
    padding: 10,
    gap: 4,
  },
  ledgerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  ledgerLabel: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12.5 },
  ledgerValue: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 12.5 },
  dispositionBlock: {
    borderTopWidth: 1,
    borderTopColor: managerColors.cardBorder,
    paddingTop: 8,
    marginTop: 4,
    gap: 4,
  },
  disposition: { color: managerColors.royalBlue, fontFamily: 'Inter_600SemiBold', fontSize: 12.5, marginTop: 2 },
});
