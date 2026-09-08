import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { EmptyState, ErrorState, LoadingState } from '@/components/Feedback';
import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';
import { colors, radius, spacing } from '@/constants/theme';
import { useBranchPerformance, useBranchPerformanceDetails } from '@/hooks/useReconciliation';
import { getErrorMessage } from '@/lib/errors';
import { formatDate, formatMoney, toNextDayStartManila, toStartOfDayManila } from '@/lib/format';
import type { BranchPerformanceItem } from '@/types/models';

type DateFilterType = 'today' | 'all_time' | 'custom';

export function BranchPerformanceReportScreen() {
  const [rangeType, setRangeType] = useState<DateFilterType>('today');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const startDateIso = toStartOfDayManila(customStart);
  const endDateIso = toNextDayStartManila(customEnd);

  const query = useBranchPerformance(
    rangeType,
    rangeType === 'custom' ? startDateIso : undefined,
    rangeType === 'custom' ? endDateIso : undefined
  );

  const report = query.data ?? [];
  const totalCompanySales = report.reduce((acc, b) => acc + Number(b.total_sales), 0);
  const totalCompanyTx = report.reduce((acc, b) => acc + Number(b.transaction_count), 0);
  const totalCompanyQtySold = report.reduce((acc, b) => acc + Number(b.quantity_sold), 0);
  const totalCompanyMissing = report.reduce((acc, b) => acc + Number(b.total_missing_qty), 0);
  const totalCompanyExcess = report.reduce((acc, b) => acc + Number(b.total_excess_qty), 0);

  return (
    <Screen constrain>
      <PageHeader
        title="Branch Performance"
        subtitle="Compare completed sales, items sold, and discrepancy metrics across selling branches."
      />

      {/* Date Filter */}
      <View style={styles.rangeSelector}>
        <Text
          onPress={() => setRangeType('today')}
          style={[styles.rangeTab, rangeType === 'today' && styles.rangeTabActive]}
        >
          Today (PH)
        </Text>
        <Text
          onPress={() => setRangeType('all_time')}
          style={[styles.rangeTab, rangeType === 'all_time' && styles.rangeTabActive]}
        >
          All Time
        </Text>
        <Text
          onPress={() => setRangeType('custom')}
          style={[styles.rangeTab, rangeType === 'custom' && styles.rangeTabActive]}
        >
          Custom
        </Text>
      </View>

      {rangeType === 'custom' && (
        <View style={styles.customDateCard}>
          <Text style={styles.filterTitle}>Custom Date Range (YYYY-MM-DD)</Text>
          <View style={styles.customDateRow}>
            <TextInput
              style={styles.dateInput}
              placeholder="Start Date (YYYY-MM-DD)"
              placeholderTextColor={colors.muted}
              value={customStart}
              onChangeText={setCustomStart}
            />
            <TextInput
              style={styles.dateInput}
              placeholder="End Date (YYYY-MM-DD)"
              placeholderTextColor={colors.muted}
              value={customEnd}
              onChangeText={setCustomEnd}
            />
          </View>
        </View>
      )}

      {/* Company Overview Summary Card */}
      <View style={styles.summaryCard}>
        <Text style={styles.summaryTitle}>Company Totals</Text>
        <View style={styles.auditRow}>
          <Text style={styles.label}>Total Sales:</Text>
          <Text style={styles.grandTotal}>{formatMoney(totalCompanySales)}</Text>
        </View>
        <View style={styles.auditRow}>
          <Text style={styles.label}>Completed Orders:</Text>
          <Text style={styles.value}>{totalCompanyTx}</Text>
        </View>
        <View style={styles.auditRow}>
          <Text style={styles.label}>Total Items Sold:</Text>
          <Text style={styles.value}>{totalCompanyQtySold}</Text>
        </View>
        <View style={styles.auditRow}>
          <Text style={styles.label}>Total Discrepancies:</Text>
          <Text style={[styles.value, totalCompanyMissing > 0 ? styles.missingText : styles.okText]}>
            {totalCompanyMissing} missing
            {totalCompanyExcess > 0 ? ` · ${totalCompanyExcess} excess` : ''}
          </Text>
        </View>
      </View>

      {query.isLoading && <LoadingState label="Calculating branch performance…" />}
      {query.error && (
        <ErrorState
          message={getErrorMessage(query.error)}
          onRetry={() => void query.refetch()}
        />
      )}

      {rangeType === 'custom' && !query.isFetched && !query.isLoading && (
        <EmptyState title="Select a date range" message="Enter both a start date and an end date to run this report." />
      )}
      {report.length === 0 && !query.isLoading && query.isFetched && (
        <EmptyState
          title="No selling branches"
          message="No active selling branches found for this period."
        />
      )}

      {report.map((branch) => (
        <BranchPerformanceCard key={branch.branch_id} item={branch} />
      ))}
    </Screen>
  );
}

function BranchPerformanceCard({ item }: { item: BranchPerformanceItem }) {
  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={() => router.push(`/owner/reports/branch-performance/${item.branch_id}` as any)}
      style={styles.card}
    >
      <View style={styles.headerRow}>
        <Text style={styles.branchTitle}>{item.branch_name}</Text>
        <Text style={styles.totalValue}>{formatMoney(item.total_sales)}</Text>
      </View>

      <View style={styles.auditRow}>
        <Text style={styles.label}>Transactions:</Text>
        <Text style={styles.value}>{item.transaction_count}</Text>
      </View>

      <View style={styles.auditRow}>
        <Text style={styles.label}>Items Sold:</Text>
        <Text style={styles.value}>{item.quantity_sold}</Text>
      </View>

      <View style={styles.divider} />

      <View style={styles.auditRow}>
        <Text style={styles.label}>Transfer Discrepancies:</Text>
        <Text style={[styles.statBadge, item.transfer_missing_qty > 0 ? styles.missingBadge : styles.neutralBadge]}>
          {item.transfer_missing_qty} missing
          {item.transfer_excess_qty > 0 ? ` · ${item.transfer_excess_qty} excess` : ''}
        </Text>
      </View>

      <View style={styles.auditRow}>
        <Text style={styles.label}>Return Discrepancies:</Text>
        <Text style={[styles.statBadge, item.return_missing_qty > 0 ? styles.missingBadge : styles.neutralBadge]}>
          {item.return_missing_qty} missing
          {item.return_excess_qty > 0 ? ` · ${item.return_excess_qty} excess` : ''}
        </Text>
      </View>

      <View style={styles.auditRow}>
        <Text style={styles.label}>Total Discrepancies:</Text>
        <Text style={[styles.boldValue, item.total_missing_qty > 0 ? styles.missingText : styles.okText]}>
          {item.total_missing_qty} missing
          {item.total_excess_qty > 0 ? ` · ${item.total_excess_qty} excess` : ''}
        </Text>
      </View>

      <Text style={styles.tapPrompt}>Tap for detailed branch breakdown →</Text>
    </TouchableOpacity>
  );
}

export function BranchPerformanceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [rangeType, setRangeType] = useState<DateFilterType>('today');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const startDateIso = toStartOfDayManila(customStart);
  const endDateIso = toNextDayStartManila(customEnd);

  const query = useBranchPerformanceDetails(
    id,
    rangeType,
    rangeType === 'custom' ? startDateIso : undefined,
    rangeType === 'custom' ? endDateIso : undefined
  );

  const data = query.data;

  return (
    <Screen constrain>
      <PageHeader
        title={data?.branch?.name ?? 'Branch Performance'}
        subtitle="In-depth sales, inventory levels, discrepancy audit, and movement logs."
      />

      {/* Date Filter */}
      <View style={styles.rangeSelector}>
        <Text
          onPress={() => setRangeType('today')}
          style={[styles.rangeTab, rangeType === 'today' && styles.rangeTabActive]}
        >
          Today (PH)
        </Text>
        <Text
          onPress={() => setRangeType('all_time')}
          style={[styles.rangeTab, rangeType === 'all_time' && styles.rangeTabActive]}
        >
          All Time
        </Text>
        <Text
          onPress={() => setRangeType('custom')}
          style={[styles.rangeTab, rangeType === 'custom' && styles.rangeTabActive]}
        >
          Custom
        </Text>
      </View>

      {rangeType === 'custom' && (
        <View style={styles.customDateCard}>
          <Text style={styles.filterTitle}>Custom Date Range (YYYY-MM-DD)</Text>
          <View style={styles.customDateRow}>
            <TextInput
              style={styles.dateInput}
              placeholder="Start Date (YYYY-MM-DD)"
              placeholderTextColor={colors.muted}
              value={customStart}
              onChangeText={setCustomStart}
            />
            <TextInput
              style={styles.dateInput}
              placeholder="End Date (YYYY-MM-DD)"
              placeholderTextColor={colors.muted}
              value={customEnd}
              onChangeText={setCustomEnd}
            />
          </View>
        </View>
      )}

      {query.isLoading && <LoadingState label="Loading branch details…" />}
      {query.error && (
        <ErrorState
          message={getErrorMessage(query.error)}
          onRetry={() => void query.refetch()}
        />
      )}

      {rangeType === 'custom' && !query.isFetched && !query.isLoading && (
        <EmptyState title="Select a date range" message="Enter both a start date and an end date to run this report." />
      )}

      {data && (
        <>
          {/* Key Metrics Card */}
          <View style={styles.summaryCard}>
            <Text style={styles.summaryTitle}>Branch Summary</Text>
            <View style={styles.auditRow}>
              <Text style={styles.label}>Total Sales:</Text>
              <Text style={styles.grandTotal}>{formatMoney(data.metrics.total_sales)}</Text>
            </View>
            <View style={styles.auditRow}>
              <Text style={styles.label}>Completed Transactions:</Text>
              <Text style={styles.value}>{data.metrics.transaction_count}</Text>
            </View>
            <View style={styles.auditRow}>
              <Text style={styles.label}>Items Sold:</Text>
              <Text style={styles.value}>{data.metrics.quantity_sold}</Text>
            </View>
            <View style={styles.divider} />
            <View style={styles.auditRow}>
              <Text style={styles.label}>Transfer Missing / Excess:</Text>
              <Text style={[styles.statBadge, data.metrics.transfer_missing_qty > 0 ? styles.missingBadge : styles.neutralBadge]}>
                {data.metrics.transfer_missing_qty} missing
                {data.metrics.transfer_excess_qty > 0 ? ` · ${data.metrics.transfer_excess_qty} excess` : ''}
              </Text>
            </View>
            <View style={styles.auditRow}>
              <Text style={styles.label}>Return Missing / Excess:</Text>
              <Text style={[styles.statBadge, data.metrics.return_missing_qty > 0 ? styles.missingBadge : styles.neutralBadge]}>
                {data.metrics.return_missing_qty} missing
                {data.metrics.return_excess_qty > 0 ? ` · ${data.metrics.return_excess_qty} excess` : ''}
              </Text>
            </View>
          </View>

          {/* Current Inventory (Read-Only) */}
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Current Inventory (Read-Only)</Text>
            {data.current_inventory.length === 0 ? (
              <Text style={styles.mutedText}>No active inventory at this branch.</Text>
            ) : (
              data.current_inventory.map((inv) => (
                <View key={inv.product_id} style={styles.itemRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemTitle}>{inv.product_name}</Text>
                    <Text style={styles.itemSku}>{inv.product_sku}</Text>
                  </View>
                  <Text style={styles.itemQty}>{inv.quantity_on_hand} in stock</Text>
                </View>
              ))
            )}
          </View>

          {/* Products Sold Breakdown */}
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Products Sold (Selected Period)</Text>
            {data.products_sold.length === 0 ? (
              <Text style={styles.mutedText}>No sales recorded for this period.</Text>
            ) : (
              data.products_sold.map((prod) => (
                <View key={prod.product_id} style={styles.itemRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemTitle}>{prod.product_name}</Text>
                    <Text style={styles.itemSku}>{prod.product_sku}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={styles.itemQty}>{prod.quantity_sold} sold</Text>
                    <Text style={styles.itemRevenue}>{formatMoney(prod.total_revenue)}</Text>
                  </View>
                </View>
              ))
            )}
          </View>

          {/* Transfer Discrepancies */}
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Transfer Discrepancies</Text>
            {data.transfer_discrepancies.length === 0 ? (
              <Text style={styles.mutedText}>No transfer discrepancies for this period.</Text>
            ) : (
              data.transfer_discrepancies.map((disc) => (
                <View key={disc.id} style={styles.subCard}>
                  <View style={styles.headerRow}>
                    <Text style={styles.subTitle}>{disc.transfer_number} · {disc.product_name}</Text>
                    <Text style={disc.discrepancy_type === 'missing' ? styles.missingText : styles.excessText}>
                      {disc.discrepancy_type === 'missing' ? `${disc.difference} missing` : `${Math.abs(disc.difference)} excess`}
                    </Text>
                  </View>
                  <Text style={styles.metaText}>
                    Sent: {disc.quantity_expected} | Received: {disc.quantity_received} | {formatDate(disc.created_at)}
                  </Text>
                  {Boolean(disc.notes) && <Text style={styles.notesText}>Note: {disc.notes}</Text>}
                </View>
              ))
            )}
          </View>

          {/* Return Discrepancies */}
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Return Discrepancies</Text>
            {data.return_discrepancies.length === 0 ? (
              <Text style={styles.mutedText}>No return discrepancies for this period.</Text>
            ) : (
              data.return_discrepancies.map((disc) => (
                <View key={disc.id} style={styles.subCard}>
                  <View style={styles.headerRow}>
                    <Text style={styles.subTitle}>{disc.return_number} · {disc.product_name}</Text>
                    <Text style={disc.discrepancy_type === 'missing' ? styles.missingText : styles.excessText}>
                      {disc.discrepancy_type === 'missing' ? `${disc.difference} missing` : `${Math.abs(disc.difference)} excess`}
                    </Text>
                  </View>
                  <Text style={styles.metaText}>
                    Returned: {disc.quantity_expected} | Main Received: {disc.quantity_received} | {formatDate(disc.created_at)}
                  </Text>
                  {Boolean(disc.notes) && <Text style={styles.notesText}>Note: {disc.notes}</Text>}
                </View>
              ))
            )}
          </View>

          {/* Recent Transfers */}
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Recent Stock Transfers</Text>
            {data.recent_transfers.length === 0 ? (
              <Text style={styles.mutedText}>No stock transfers recorded.</Text>
            ) : (
              data.recent_transfers.map((t) => (
                <View key={t.id} style={styles.itemRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemTitle}>{t.transfer_number}</Text>
                    <Text style={styles.itemSku}>Status: {t.status} · {t.items_count} products</Text>
                  </View>
                  <Text style={styles.metaText}>{formatDate(t.received_at || t.sent_at)}</Text>
                </View>
              ))
            )}
          </View>

          {/* Recent Returns */}
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Recent Stock Returns</Text>
            {data.recent_returns.length === 0 ? (
              <Text style={styles.mutedText}>No stock returns recorded.</Text>
            ) : (
              data.recent_returns.map((r) => (
                <View key={r.id} style={styles.itemRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemTitle}>{r.return_number}</Text>
                    <Text style={styles.itemSku}>Status: {r.status} · {r.items_count} products</Text>
                  </View>
                  <Text style={styles.metaText}>{formatDate(r.received_at || r.returned_at)}</Text>
                </View>
              ))
            )}
          </View>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  summaryCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  summaryTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
    marginBottom: spacing.xs,
  },
  branchTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '800',
  },
  rangeSelector: {
    flexDirection: 'row',
    backgroundColor: '#E5E7EB',
    borderRadius: radius.md,
    padding: 3,
    gap: 4,
  },
  rangeTab: {
    flex: 1,
    textAlign: 'center',
    paddingVertical: 8,
    borderRadius: radius.sm,
    fontSize: 13,
    fontWeight: '600',
    color: colors.muted,
  },
  rangeTabActive: {
    backgroundColor: colors.surface,
    color: colors.text,
    fontWeight: '800',
  },
  customDateCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  customDateRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  filterTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  dateInput: {
    flex: 1,
    backgroundColor: '#F9FAFB',
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
    color: colors.text,
    fontSize: 13,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  auditRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
  },
  label: {
    color: colors.muted,
    fontSize: 13,
  },
  value: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  boldValue: {
    fontSize: 13,
    fontWeight: '800',
  },
  totalValue: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: '800',
  },
  grandTotal: {
    color: colors.primary,
    fontSize: 18,
    fontWeight: '900',
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: 4,
  },
  statBadge: {
    fontSize: 12,
    fontWeight: '700',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  neutralBadge: {
    backgroundColor: '#F3F4F6',
    color: colors.muted,
  },
  missingBadge: {
    backgroundColor: '#FEE2E2',
    color: colors.danger,
  },
  missingText: {
    color: colors.danger,
    fontWeight: '800',
  },
  excessText: {
    color: '#D97706',
    fontWeight: '800',
  },

  okText: {
    color: colors.success,
    fontWeight: '700',
  },
  tapPrompt: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '700',
    marginTop: spacing.xs,
    textAlign: 'right',
  },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  itemTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  itemSku: {
    color: colors.muted,
    fontSize: 12,
  },
  itemQty: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  itemRevenue: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '800',
  },
  subCard: {
    backgroundColor: '#F9FAFB',
    borderRadius: radius.sm,
    padding: spacing.sm,
    marginVertical: 4,
    gap: 2,
  },
  subTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
    flex: 1,
  },
  metaText: {
    color: colors.muted,
    fontSize: 12,
  },
  notesText: {
    color: colors.text,
    fontSize: 12,
    fontStyle: 'italic',
  },
  mutedText: {
    color: colors.muted,
    fontSize: 13,
    fontStyle: 'italic',
    paddingVertical: spacing.xs,
  },
});
