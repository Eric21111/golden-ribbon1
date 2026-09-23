import Ionicons from '@react-native-vector-icons/ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { Screen } from '@/components/Screen';
import { ListRowCard } from '@/components/dashboard/ListRowCard';
import { ManagerBadge, type ManagerBadgeTone } from '@/components/dashboard/ManagerBadge';
import { EmptyState, ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { StatTile } from '@/components/dashboard/StatTile';
import { SummaryCard } from '@/components/dashboard/SummaryCard';
import { managerColors } from '@/components/dashboard/theme';
import { DateRangeFilter, resolveReportRange, type DateFilterType } from '@/features/reports/DateRangeFilter';
import { accentForRank } from '@/features/reports/reportAccents';
import { useBranchPerformance, useBranchPerformanceDetails } from '@/hooks/useReconciliation';
import { getErrorMessage } from '@/lib/errors';
import { formatDate, formatMoney } from '@/lib/format';
import type { BranchPerformanceItem } from '@/types/models';

function discrepancySummary(missing: number, excess: number): { label: string; tone: ManagerBadgeTone } {
  if (missing === 0 && excess === 0) return { label: 'None', tone: 'success' };
  const parts = [];
  if (missing > 0) parts.push(`${missing} missing`);
  if (excess > 0) parts.push(`${excess} excess`);
  return { label: parts.join(' · '), tone: missing > 0 ? 'danger' : 'warning' };
}

export function BranchPerformanceReportScreen() {
  const [rangeType, setRangeType] = useState<DateFilterType>('all_time');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const { rpcRangeType, startIso, endIso } = resolveReportRange(rangeType, customStart, customEnd);
  const query = useBranchPerformance(rpcRangeType, startIso, endIso);

  const report = query.data ?? [];
  const totalCompanySales = report.reduce((acc, b) => acc + Number(b.total_sales), 0);
  const totalCompanyTx = report.reduce((acc, b) => acc + Number(b.transaction_count), 0);
  const totalCompanyQtySold = report.reduce((acc, b) => acc + Number(b.quantity_sold), 0);
  const rankedBranches = useMemo(
    () => [...report].sort((a, b) => Number(b.total_sales) - Number(a.total_sales)),
    [report]
  );

  return (
    <Screen backgroundColor="#FFFFFF" edges={['top']} contentContainerStyle={styles.screenContent}>
      <ManagerScreenHeader title="Branch Performance" showBack />
      <ConstrainedWidth style={styles.column}>
        <DateRangeFilter
          value={rangeType}
          onChange={setRangeType}
          customStart={customStart}
          customEnd={customEnd}
          onCustomStartChange={setCustomStart}
          onCustomEndChange={setCustomEnd}
        />
        <Text style={styles.hint}>
          Return discrepancies appear after Main counts a leftover return. They are not created at the cashier. All Time
          is the default so earlier receives are not hidden.
        </Text>

        <Text style={styles.sectionTitle}>COMPANY TOTALS</Text>
        <StatTile layout="wide" emphasis icon="cash-outline" label="Total sales" value={formatMoney(totalCompanySales)} />
        <View style={styles.statsRow}>
          <StatTile style={styles.statHalf} compact icon="receipt-outline" label="Completed orders" value={totalCompanyTx} />
          <StatTile style={styles.statHalf} compact icon="cube-outline" label="Total items sold" value={totalCompanyQtySold} />
        </View>

        {query.isLoading ? <LoadingState label="Calculating branch performance…" /> : null}
        {query.error ? (
          <ErrorState message={getErrorMessage(query.error)} onRetry={() => void query.refetch()} />
        ) : null}
        {rangeType === 'custom' && !query.isFetched && !query.isLoading ? (
          <EmptyState title="Select a date range" message="Enter both a start date and an end date to run this report." />
        ) : null}
        {report.length === 0 && !query.isLoading && query.isFetched ? (
          <EmptyState title="No selling branches" message="No active selling branches found for this period." />
        ) : null}

        {rankedBranches.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>BRANCHES</Text>
            {rankedBranches.map((branch, index) => (
              <BranchPerformanceCard
                key={branch.branch_id}
                rank={index + 1}
                item={branch}
                share={totalCompanySales > 0 ? (Number(branch.total_sales) / totalCompanySales) * 100 : 0}
                showOlderReturnHint={rangeType !== 'all_time'}
              />
            ))}
          </View>
        ) : null}
      </ConstrainedWidth>
    </Screen>
  );
}

function BranchPerformanceCard({
  rank,
  item,
  share,
  showOlderReturnHint,
}: {
  rank: number;
  item: BranchPerformanceItem;
  share: number;
  showOlderReturnHint: boolean;
}) {
  const transferSummary = discrepancySummary(item.transfer_missing_qty, item.transfer_excess_qty);
  const returnSummary = discrepancySummary(item.return_missing_qty, item.return_excess_qty);
  const accent = accentForRank(rank);
  const barColors = [accent.icon, accent.gradient[0]] as const;

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(`/owner/reports/branch-performance/${item.branch_id}` as never)}
      style={({ pressed }) => [styles.branchCard, pressed && styles.pressed]}
    >
      <View style={styles.branchTop}>
        <View style={[styles.rankBadge, { backgroundColor: accent.gradient[0] }]}>
          <Text style={[styles.rankBadgeLabel, { color: accent.icon }]}>#{rank}</Text>
        </View>
        <Text style={styles.branchName} numberOfLines={1}>
          {item.branch_name}
        </Text>
        <View style={styles.branchTopRight}>
          <Text style={styles.branchTotal}>{formatMoney(item.total_sales)}</Text>
          <Ionicons name="chevron-forward" size={18} color={managerColors.subtext} />
        </View>
      </View>

      <View style={styles.barRow}>
        <View style={styles.barTrack}>
          <LinearGradient
            colors={barColors}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[styles.barFill, { width: `${Math.max(share, 0)}%` }]}
          />
        </View>
        <Text style={[styles.barPercent, { color: accent.icon }]}>{share.toFixed(0)}%</Text>
      </View>

      <View style={styles.branchStatsRow}>
        <View style={styles.branchStat}>
          <Text style={styles.branchStatValue}>{item.transaction_count}</Text>
          <Text style={styles.branchStatLabel}>Transactions</Text>
        </View>
        <View style={styles.branchStat}>
          <Text style={styles.branchStatValue}>{item.quantity_sold}</Text>
          <Text style={styles.branchStatLabel}>Items sold</Text>
        </View>
      </View>

      <View style={styles.branchDivider} />

      <View style={styles.branchBadgeRow}>
        <Text style={styles.branchBadgeLabel}>Transfer discrepancies</Text>
        <ManagerBadge label={transferSummary.label} tone={transferSummary.tone} />
      </View>
      <View style={styles.branchBadgeRow}>
        <Text style={styles.branchBadgeLabel}>Return discrepancies</Text>
        <ManagerBadge label={returnSummary.label} tone={returnSummary.tone} />
      </View>
      {showOlderReturnHint && returnSummary.label === 'None' ? (
        <Text style={styles.olderHint}>
          None in this range. Open the branch or switch to All Time to see older Main receive differences.
        </Text>
      ) : null}
    </Pressable>
  );
}

export function BranchPerformanceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [rangeType, setRangeType] = useState<DateFilterType>('all_time');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const { rpcRangeType, startIso, endIso } = resolveReportRange(rangeType, customStart, customEnd);
  const query = useBranchPerformanceDetails(id, rpcRangeType, startIso, endIso);

  const data = query.data;

  return (
    <Screen backgroundColor="#FFFFFF" edges={['top']} contentContainerStyle={styles.screenContent}>
      <ManagerScreenHeader title={data?.branch?.name ?? 'Branch Performance'} showBack />
      <ConstrainedWidth style={styles.column}>
        <DateRangeFilter
          value={rangeType}
          onChange={setRangeType}
          customStart={customStart}
          customEnd={customEnd}
          onCustomStartChange={setCustomStart}
          onCustomEndChange={setCustomEnd}
        />
        <Text style={styles.hint}>
          Return rows appear after Main counts the leftover return. A cashier leftover confirm does not create a
          discrepancy by itself.
        </Text>

        {query.isLoading ? <LoadingState label="Loading branch details…" /> : null}
        {query.error ? (
          <ErrorState message={getErrorMessage(query.error)} onRetry={() => void query.refetch()} />
        ) : null}
        {rangeType === 'custom' && !query.isFetched && !query.isLoading ? (
          <EmptyState title="Select a date range" message="Enter both a start date and an end date to run this report." />
        ) : null}

        {data ? (
          <>
            <SummaryCard
              title="BRANCH SUMMARY"
              rows={[
                { label: 'Total sales', value: formatMoney(data.metrics.total_sales), emphasis: true, icon: 'cash-outline' },
                { label: 'Completed transactions', value: String(data.metrics.transaction_count), icon: 'receipt-outline' },
                { label: 'Items sold', value: String(data.metrics.quantity_sold), icon: 'cube-outline' },
                {
                  label: 'Transfer missing/excess',
                  value: discrepancySummary(data.metrics.transfer_missing_qty, data.metrics.transfer_excess_qty).label,
                  icon: 'swap-horizontal-outline',
                },
                {
                  label: 'Return missing/excess',
                  value: discrepancySummary(data.metrics.return_missing_qty, data.metrics.return_excess_qty).label,
                  icon: 'return-up-back-outline',
                },
              ]}
            />

            <Text style={styles.sectionTitle}>CURRENT INVENTORY (READ-ONLY)</Text>
            {data.current_inventory.length === 0 ? (
              <Text style={styles.mutedText}>No active inventory at this branch.</Text>
            ) : (
              data.current_inventory.map((inv) => (
                <ListRowCard
                  key={inv.product_id}
                  title={inv.product_name}
                  subtitle={inv.product_sku}
                  subtitleTag
                  trailing={<Text style={styles.highlight}>{inv.quantity_on_hand} in stock</Text>}
                />
              ))
            )}

            <Text style={styles.sectionTitle}>PRODUCTS SOLD (SELECTED PERIOD)</Text>
            {data.products_sold.length === 0 ? (
              <Text style={styles.mutedText}>No sales recorded for this period.</Text>
            ) : (
              data.products_sold.map((prod) => (
                <ListRowCard
                  key={prod.product_id}
                  title={prod.product_name}
                  subtitle={prod.product_sku}
                  subtitleTag
                  meta={`Sold: ${prod.quantity_sold}`}
                  trailing={<Text style={styles.highlight}>{formatMoney(prod.total_revenue)}</Text>}
                />
              ))
            )}

            <Text style={styles.sectionTitle}>TRANSFER DISCREPANCIES</Text>
            {data.transfer_discrepancies.length === 0 ? (
              <Text style={styles.mutedText}>No transfer discrepancies for this period.</Text>
            ) : (
              data.transfer_discrepancies.map((disc) => (
                <ListRowCard
                  key={disc.id}
                  title={`${disc.transfer_number} · ${disc.product_name}`}
                  meta={`Sent: ${disc.quantity_expected} · Received: ${disc.quantity_received} · ${formatDate(disc.created_at)}${disc.notes ? ` · Note: ${disc.notes}` : ''}`}
                  trailing={
                    <ManagerBadge
                      label={
                        disc.discrepancy_type === 'missing'
                          ? `${disc.difference} missing`
                          : `${Math.abs(disc.difference)} excess`
                      }
                      tone={disc.discrepancy_type === 'missing' ? 'danger' : 'warning'}
                    />
                  }
                />
              ))
            )}

            <Text style={styles.sectionTitle}>RETURN DISCREPANCIES</Text>
            {data.return_discrepancies.length === 0 ? (
              <Text style={styles.mutedText}>No return discrepancies for this period.</Text>
            ) : (
              data.return_discrepancies.map((disc) => (
                <ListRowCard
                  key={disc.id}
                  title={`${disc.return_number} · ${disc.product_name}`}
                  meta={`Returned: ${disc.quantity_expected} · Main received: ${disc.quantity_received} · ${formatDate(disc.created_at)}${disc.notes ? ` · Note: ${disc.notes}` : ''}`}
                  trailing={
                    <ManagerBadge
                      label={
                        disc.discrepancy_type === 'missing'
                          ? `${disc.difference} missing`
                          : `${Math.abs(disc.difference)} excess`
                      }
                      tone={disc.discrepancy_type === 'missing' ? 'danger' : 'warning'}
                    />
                  }
                />
              ))
            )}

            <Text style={styles.sectionTitle}>RECENT STOCK TRANSFERS</Text>
            {data.recent_transfers.length === 0 ? (
              <Text style={styles.mutedText}>No stock transfers recorded.</Text>
            ) : (
              data.recent_transfers.map((t) => (
                <ListRowCard
                  key={t.id}
                  title={t.transfer_number}
                  meta={`Status: ${t.status} · ${t.items_count} products`}
                  trailing={<Text style={styles.dateText}>{formatDate(t.received_at || t.sent_at)}</Text>}
                />
              ))
            )}

            <Text style={styles.sectionTitle}>RECENT STOCK RETURNS</Text>
            {data.recent_returns.length === 0 ? (
              <Text style={styles.mutedText}>No stock returns recorded.</Text>
            ) : (
              data.recent_returns.map((r) => (
                <ListRowCard
                  key={r.id}
                  title={r.return_number}
                  meta={`Status: ${r.status} · ${r.items_count} products`}
                  trailing={<Text style={styles.dateText}>{formatDate(r.received_at || r.returned_at)}</Text>}
                />
              ))
            )}
          </>
        ) : null}
      </ConstrainedWidth>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenContent: { flexGrow: 1, padding: 0, gap: 0 },
  column: { padding: 20, gap: 14 },
  sectionTitle: {
    color: managerColors.subtext,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    letterSpacing: 0.8,
    marginTop: 4,
  },
  mutedText: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 13, fontStyle: 'italic' },
  hint: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19 },
  olderHint: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 17 },
  highlight: { color: managerColors.royalBlue, fontFamily: 'Inter_700Bold', fontSize: 14 },
  dateText: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 12 },
  statsRow: { flexDirection: 'row', gap: 10 },
  statHalf: { flex: 1 },
  section: { gap: 8 },
  rankBadge: {
    minWidth: 26,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankBadgeLabel: { fontFamily: 'Inter_700Bold', fontSize: 11 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  barTrack: {
    flex: 1,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#EDEFF5',
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    overflow: 'hidden',
  },
  barFill: { height: '100%', borderRadius: 5, minWidth: 4 },
  barPercent: { fontFamily: 'Inter_700Bold', fontSize: 12.5, minWidth: 34, textAlign: 'right' },
  branchCard: {
    backgroundColor: '#FFFFFF',
    borderColor: managerColors.cardBorder,
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 12,
    shadowColor: '#0A1224',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 1,
  },
  pressed: { opacity: 0.85 },
  branchTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  branchName: { flex: 1, color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 16 },
  branchTopRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  branchTotal: { color: managerColors.royalBlue, fontFamily: 'Inter_700Bold', fontSize: 16 },
  branchStatsRow: { flexDirection: 'row', gap: 20 },
  branchStat: { gap: 2 },
  branchStatValue: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 16 },
  branchStatLabel: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12 },
  branchDivider: { height: 1, backgroundColor: managerColors.cardBorder },
  branchBadgeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  branchBadgeLabel: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 13 },
});
