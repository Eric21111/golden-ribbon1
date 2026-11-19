import Ionicons from '@react-native-vector-icons/ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@/features/auth/AuthProvider';
import { supabase } from '@/lib/supabase';
import { Alert } from 'react-native';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { Pagination } from '@/components/Pagination';
import { Screen } from '@/components/Screen';
import { StockUnitHint } from '@/components/StockUnitHint';
import { FilterChipRow } from '@/components/dashboard/FilterChipRow';
import { ManagerBadge, type ManagerBadgeTone } from '@/components/dashboard/ManagerBadge';
import { EmptyState, ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { managerColors } from '@/components/dashboard/theme';
import { formatPcsQty, gcashResult } from '@/features/reports/reportDisplay';
import { useClientPagination } from '@/hooks/useClientPagination';
import { useShiftCloseReportDetail } from '@/hooks/useShifts';
import { getErrorMessage } from '@/lib/errors';
import { formatMoney } from '@/lib/format';
import type { ShiftCloseReportProduct, ShiftProductReconResult } from '@/types/models';

/** Display-only: soften ALL-CAPS cashier labels without changing stored names. */
function readablePersonName(name: string) {
  const trimmed = name.trim();
  if (!trimmed || trimmed !== trimmed.toUpperCase() || trimmed.length < 4) return trimmed;
  return trimmed
    .toLowerCase()
    .replace(/(^|[\s\-_/])([a-z])/g, (_, edge: string, letter: string) => `${edge}${letter.toUpperCase()}`);
}

const timeFormatter = new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit' });
const dateFormatter = new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium' });
const COLUMN_PAD = 20;

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

function ResultPill({ shortage, excess }: { shortage: number; excess: number }) {
  const color = shortage > 0 ? '#B91C1C' : excess > 0 ? managerColors.green : managerColors.subtext;
  return (
    <View
      style={[
        styles.resultPill,
        { backgroundColor: shortage > 0 ? '#FEE2E2' : excess > 0 ? '#DCFCE7' : managerColors.cardSurface },
      ]}
    >
      <Ionicons
        name={shortage > 0 ? 'trending-down-outline' : excess > 0 ? 'trending-up-outline' : 'checkmark-circle-outline'}
        size={14}
        color={color}
      />
      <Text style={[styles.resultPillText, { color }]}>
        {shortage > 0 ? `${formatMoney(shortage)} shortage` : excess > 0 ? `${formatMoney(excess)} excess` : 'Exact match'}
      </Text>
    </View>
  );
}

function MetricRow({
  icon,
  label,
  value,
}: {
  icon: 'cash-outline' | 'phone-portrait-outline' | 'wallet-outline';
  label: string;
  value: string;
}) {
  return (
    <View style={styles.metricRow}>
      <View style={styles.metricLeft}>
        <View style={styles.heroIconChip}>
          <Ionicons name={icon} size={16} color={managerColors.royalBlue} />
        </View>
        <Text style={styles.heroLabel}>{label}</Text>
      </View>
      <Text style={styles.heroValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}

function TenderRemittanceCard({
  title,
  expectedLabel,
  actualLabel,
  expected,
  actual,
  icon,
  pending,
  pendingMessage,
  result,
}: {
  title: string;
  expectedLabel: string;
  actualLabel: string;
  expected: number;
  actual: number | null;
  icon: 'cash-outline' | 'phone-portrait-outline';
  pending: boolean;
  pendingMessage: string;
  result: { shortage: number; excess: number } | null;
}) {
  return (
    <View style={styles.heroCard}>
      <Text style={styles.cardEyebrow}>{title}</Text>
      <MetricRow icon={icon} label={expectedLabel} value={formatMoney(expected)} />
      <MetricRow
        icon="wallet-outline"
        label={actualLabel}
        value={actual == null ? '—' : formatMoney(actual)}
      />
      {pending ? (
        <View style={styles.pendingNote}>
          <Ionicons name="hourglass-outline" size={14} color={managerColors.goldMuted} />
          <Text style={styles.pendingNoteText}>{pendingMessage}</Text>
        </View>
      ) : result ? (
        <ResultPill shortage={result.shortage} excess={result.excess} />
      ) : null}
    </View>
  );
}

export function ShiftRemittanceDetailScreen() {
  const { profile } = useAuth();
  async function openReturn(number: string) {
    try {
      const { data, error } = await supabase.from('stock_returns').select('id').eq('return_number', number).single();
      if (error) throw error;
      router.push({ pathname: '/manager/returns/[id]', params: { id: data.id } });
    } catch (error) {
      Alert.alert('Unable to open return', getErrorMessage(error));
    }
  }
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const query = useShiftCloseReportDetail(id ?? '');
  const detail = query.data;
  const [resultFilter, setResultFilter] = useState<ResultFilter>('shortage');

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
    if (detail?.selected_return_close || resultFilter === 'all') return products;
    return products.filter((p) => p.result === resultFilter);
  }, [detail?.products, detail?.selected_return_close, resultFilter]);

  const pagination = useClientPagination(filteredProducts, resultFilter);
  // No separate GCash remittance → single remittance card (cash-only split is unavailable).
  const combinedCollections = detail?.expected_gcash == null;

  const shortage = detail?.cash_result === 'shortage' ? Math.abs(Number(detail.difference ?? 0)) : 0;
  const excess = detail?.cash_result === 'excess' ? Math.abs(Number(detail.difference ?? 0)) : 0;

  const gcash = detail ? gcashResult(detail.expected_gcash, detail.actual_gcash) : null;

  const filterOptions: { label: string; value: ResultFilter }[] = [
    { label: `Shortage (${counts.shortage})`, value: 'shortage' },
    { label: `Excess (${counts.excess})`, value: 'excess' },
    { label: `Exact (${counts.exact})`, value: 'exact' },
    { label: `All (${counts.total})`, value: 'all' },
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
                  <Ionicons name="storefront-outline" size={18} color={managerColors.royalBlue} />
                </View>
                <Text style={styles.branchName} numberOfLines={2}>
                  {detail.branch_name}
                </Text>
              </View>
              <View style={styles.identityRow}>
                <Ionicons name="person-circle-outline" size={13} color={managerColors.subtext} />
                <Text style={styles.identityText} numberOfLines={3}>
                  {readablePersonName(detail.cashier_name)}
                </Text>
              </View>
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

            <View style={styles.sectionBlock}>
              <TenderRemittanceCard
                title={combinedCollections ? 'Remittance' : 'Cash'}
                expectedLabel={combinedCollections ? 'Expected remittance' : 'Expected cash'}
                actualLabel={combinedCollections ? 'Remitted' : 'Cash remitted'}
                expected={Number(detail.expected_cash)}
                actual={detail.actual_cash == null ? null : Number(detail.actual_cash)}
                icon="cash-outline"
                pending={detail.cash_status === 'pending'}
                pendingMessage="Remittance is still pending. Remitted amounts and inventory results are not available yet."
                result={detail.cash_status === 'pending' ? null : { shortage, excess }}
              />
              {detail.expected_gcash != null ? (
                <TenderRemittanceCard
                  title="GCash"
                  expectedLabel="Expected GCash"
                  actualLabel="GCash remitted"
                  expected={Number(detail.expected_gcash)}
                  actual={detail.actual_gcash == null ? null : Number(detail.actual_gcash)}
                  icon="phone-portrait-outline"
                  pending={gcash == null}
                  pendingMessage="GCash is still pending."
                  result={gcash}
                />
              ) : null}
            </View>

            <View style={styles.sectionBlock}>
              <Text style={styles.section}>{detail.selected_return_close ? 'End shift stock' : 'Inventory close'}</Text>
              {detail.selected_return_close ? (
                detail.return_number && profile?.role === 'manager' ? (
                  <Pressable accessibilityRole="link" onPress={() => void openReturn(detail.return_number!)}>
                    <Text style={styles.returnLink}>View return {detail.return_number} ›</Text>
                  </Pressable>
                ) : (
                  <Text style={styles.returnNote}>
                    {detail.return_number
                      ? `Return ${detail.return_number}`
                      : 'All remaining stock was kept at the branch.'}
                  </Text>
                )
              ) : null}

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
                  {!detail.selected_return_close ? (
                    <FilterChipRow
                      options={filterOptions}
                      value={resultFilter}
                      onChange={setResultFilter}
                      bleed={COLUMN_PAD}
                      keepSelectedVisible
                    />
                  ) : null}
                  {filteredProducts.length === 0 ? (
                    <EmptyState title="No matching products" message="Try a different filter." />
                  ) : (
                    pagination.pageItems.map((product) => (
                      <ProductCard key={product.id} product={product} systemClose={detail.selected_return_close} />
                    ))
                  )}
                  {pagination.showPagination ? (
                    <View style={styles.pager}>
                      <Pagination
                        page={pagination.page}
                        totalPages={pagination.totalPages}
                        onPageChange={pagination.setPage}
                      />
                    </View>
                  ) : null}
                </>
              )}
            </View>
          </>
        ) : null}
      </ConstrainedWidth>
    </Screen>
  );
}

function hasQty(value: number) {
  return Number(value) !== 0;
}

function ProductCard({ product, systemClose }: { product: ShiftCloseReportProduct; systemClose?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const badge = inventoryResultBadge[product.result];
  const isIssue = product.result !== 'exact';
  const unit = product.stock_unit_code;
  // Collapse noise: only non-zero movement lines; disposition covers unsold/carried outcome.
  const movementRows = (
    [
      { label: 'Opening', value: Number(product.opening_quantity) },
      { label: 'Received', value: Number(product.received_quantity) },
      { label: 'Outgoing', value: Number(product.outgoing_quantity) },
      { label: 'Sold', value: Number(product.sold_quantity) },
      { label: 'Adjustments', value: Number(product.adjustment_quantity) },
      { label: 'Waste', value: Number(product.waste_quantity) },
    ] as const
  ).filter((row) => hasQty(row.value));

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
        <StockUnitHint code={unit} />
        {systemClose ? (
          <ManagerBadge label={product.unsold_quantity ? 'Sent back' : 'Kept at branch'} tone="info" />
        ) : (
          <ManagerBadge label={badge.label} tone={badge.tone} />
        )}
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

      {systemClose ? (
        <Text style={styles.systemQty}>
          System quantity after waste · {formatPcsQty(product.expected_remaining, unit)}
        </Text>
      ) : (
        <View style={styles.summaryRow}>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryLabel} numberOfLines={1}>
              Expected
            </Text>
            <Text style={styles.summaryValue} numberOfLines={1}>
              {formatPcsQty(product.expected_remaining, unit)}
            </Text>
          </View>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryLabel} numberOfLines={1}>
              Actual
            </Text>
            <Text style={styles.summaryValue} numberOfLines={1}>
              {formatPcsQty(product.actual_remaining, unit)}
            </Text>
          </View>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryLabel} numberOfLines={1}>
              Discrepancy
            </Text>
            <Text
              style={[
                styles.summaryValue,
                isIssue && (product.result === 'shortage' ? styles.varianceDanger : styles.varianceSuccess),
              ]}
              numberOfLines={1}
            >
              {product.discrepancy > 0
                ? `+${formatPcsQty(product.discrepancy, unit)}`
                : formatPcsQty(product.discrepancy, unit)}
            </Text>
          </View>
        </View>
      )}

      {product.discrepancy_note ? (
        <Text style={styles.noteLine} accessibilityLabel="Discrepancy note">
          Note: {product.discrepancy_note}
        </Text>
      ) : null}

      {expanded ? (
        <View style={styles.ledger}>
          {movementRows.length === 0 ? (
            <Text style={styles.ledgerEmpty}>No stock movement this shift</Text>
          ) : (
            movementRows.map((row, index) => (
              <View key={row.label} style={[styles.ledgerRow, index > 0 && styles.ledgerRowGap]}>
                <Text style={styles.ledgerLabel}>{row.label}</Text>
                <Text style={styles.ledgerValue}>{formatPcsQty(row.value, unit)}</Text>
              </View>
            ))
          )}
          <View style={styles.ledgerCloseRow}>
            <Text style={styles.ledgerCloseLabel}>
              {product.closing_stock_behavior === 'record_as_unsold' ? 'Unsold at close' : 'Carried to next day'}
            </Text>
            <Text style={styles.ledgerCloseValue}>
              {formatPcsQty(
                product.closing_stock_behavior === 'record_as_unsold'
                  ? product.unsold_quantity
                  : product.carried_quantity,
                unit,
              )}
            </Text>
          </View>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flexGrow: 1, padding: 0, gap: 0 },
  column: { flexGrow: 1, paddingHorizontal: COLUMN_PAD, paddingTop: 16, paddingBottom: 28, gap: 16 },
  sectionBlock: { gap: 10 },
  section: {
    color: managerColors.subtext,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    letterSpacing: 0.6,
  },
  cardEyebrow: {
    color: managerColors.subtext,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    letterSpacing: 0.4,
  },
  identityCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 16,
    padding: 14,
    gap: 10,
    shadowColor: '#0A1224',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 1,
  },
  identityHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  identityIconChip: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#DCE8FC',
  },
  branchName: {
    flex: 1,
    minWidth: 0,
    color: managerColors.ink,
    fontFamily: 'Inter_700Bold',
    fontSize: 17,
    lineHeight: 22,
  },
  identityRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  identityText: {
    flex: 1,
    minWidth: 0,
    color: managerColors.subtext,
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    lineHeight: 18,
  },
  heroCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 16,
    padding: 14,
    gap: 10,
    shadowColor: '#0A1224',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 1,
  },
  metricRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  metricLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1, minWidth: 0 },
  heroIconChip: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#DCE8FC',
  },
  heroLabel: { flexShrink: 1, color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 13 },
  heroValue: {
    flexShrink: 0,
    maxWidth: '48%',
    color: managerColors.ink,
    fontFamily: 'Inter_700Bold',
    fontSize: 18,
    textAlign: 'right',
  },
  resultPill: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
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
  pendingNoteText: {
    flex: 1,
    color: managerColors.goldMuted,
    fontFamily: 'Inter_500Medium',
    fontSize: 12.5,
    lineHeight: 17,
  },
  returnLink: { color: managerColors.royalBlue, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  returnNote: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 18 },

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
  systemQty: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 13 },
  summaryRow: { flexDirection: 'row', gap: 10 },
  summaryItem: { flex: 1, gap: 2 },
  summaryLabel: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 11.5 },
  summaryValue: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 14 },
  noteLine: {
    color: managerColors.subtext,
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 4,
  },
  varianceDanger: { color: '#B91C1C' },
  varianceSuccess: { color: managerColors.green },
  ledger: {
    marginTop: 4,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: managerColors.cardBorder,
    gap: 0,
  },
  ledgerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 7,
  },
  ledgerRowGap: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#EEF1F6',
  },
  ledgerLabel: { flex: 1, minWidth: 0, color: '#667085', fontFamily: 'Inter_500Medium', fontSize: 13 },
  ledgerValue: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  ledgerEmpty: {
    color: managerColors.subtext,
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    paddingVertical: 6,
  },
  ledgerCloseRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    marginTop: 4,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: managerColors.cardBorder,
  },
  ledgerCloseLabel: { flex: 1, minWidth: 0, color: managerColors.royalBlue, fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  ledgerCloseValue: { color: managerColors.royalBlue, fontFamily: 'Inter_700Bold', fontSize: 14 },
});
