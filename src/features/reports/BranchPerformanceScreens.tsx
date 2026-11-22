import Ionicons from '@react-native-vector-icons/ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { Screen } from '@/components/Screen';
import { CurrencyText } from '@/components/dashboard/CurrencyText';
import { ListRowCard } from '@/components/dashboard/ListRowCard';
import { ManagerBadge } from '@/components/dashboard/ManagerBadge';
import { EmptyState, ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { StatTile } from '@/components/dashboard/StatTile';
import { managerColors, statChipColors } from '@/components/dashboard/theme';
import {
  branchHubHref,
  branchInventoryReconciliationHref,
  firstSearchParam,
  parseReportDateFilter,
  salesOverviewHref,
  transferReturnIssuesHref,
} from '@/features/reports/branchHub';
import {
  branchOperationsIssueQty,
  branchOperationsMeta,
} from '@/features/reports/branchPerformanceCards';
import { DateRangeFilter, resolveReportRange, type DateFilterType } from '@/features/reports/DateRangeFilter';
import { ReportSectionHeading } from '@/features/reports/ReportSectionHeading';
import { productSalesBranchHref, productSalesOverviewHref } from '@/features/reports/productSalesDashboard';
import { useBranchPerformance, useBranchPerformanceDetails } from '@/hooks/useReconciliation';
import { getErrorMessage } from '@/lib/errors';
import { formatMoney } from '@/lib/format';
import { accentForName } from '@/lib/nameAccent';
import type { BranchPerformanceItem } from '@/types/models';

type NavRange = { rangeType: DateFilterType; customStart?: string; customEnd?: string };

function initialRangeFromParams(
  range: string,
  start: string,
  end: string,
  fallback: DateFilterType,
): { rangeType: DateFilterType; customStart: string; customEnd: string } {
  const rangeType = range ? parseReportDateFilter(range) : fallback;
  return {
    rangeType,
    customStart: rangeType === 'custom' ? start : '',
    customEnd: rangeType === 'custom' ? end : '',
  };
}

export function BranchPerformanceReportScreen() {
  const params = useLocalSearchParams<{
    range?: string | string[];
    start?: string | string[];
    end?: string | string[];
  }>();
  const initial = initialRangeFromParams(
    firstSearchParam(params.range),
    firstSearchParam(params.start),
    firstSearchParam(params.end),
    'all_time',
  );
  const [rangeType, setRangeType] = useState<DateFilterType>(initial.rangeType);
  const [customStart, setCustomStart] = useState(initial.customStart);
  const [customEnd, setCustomEnd] = useState(initial.customEnd);

  const { rpcRangeType, startIso, endIso } = resolveReportRange(rangeType, customStart, customEnd);
  const query = useBranchPerformance(rpcRangeType, startIso, endIso);
  const navRange: NavRange = { rangeType, customStart, customEnd };

  const report = query.data ?? [];
  const totalCompanyTx = report.reduce((acc, b) => acc + Number(b.transaction_count), 0);
  const totalCompanyQtySold = report.reduce((acc, b) => acc + Number(b.quantity_sold), 0);
  const totalIssueQty = report.reduce(
    (acc, b) => acc + Number(b.total_missing_qty) + Number(b.total_excess_qty),
    0,
  );
  const rankedBranches = useMemo(
    () => [...report].sort((a, b) => Number(b.total_sales) - Number(a.total_sales)),
    [report],
  );

  return (
    <Screen backgroundColor="#FFFFFF" edges={['top']} contentContainerStyle={styles.screenContent}>
      <ManagerScreenHeader title="Branch Operations" showBack />
      <ConstrainedWidth style={styles.column}>
        <View style={styles.filterBleed}>
          <DateRangeFilter
            value={rangeType}
            onChange={setRangeType}
            customStart={customStart}
            customEnd={customEnd}
            onCustomStartChange={setCustomStart}
            onCustomEndChange={setCustomEnd}
          />
        </View>
        <StatTile
          layout="wide"
          emphasis
          icon="cube-outline"
          label="Total items sold"
          value={totalCompanyQtySold}
          onPress={() => router.push(productSalesOverviewHref(navRange) as never)}
        />
        <StatTile
          layout="wide"
          icon="receipt-outline"
          label="Completed sales"
          value={totalCompanyTx}
          onPress={() => router.push(salesOverviewHref(navRange) as never)}
        />
        <StatTile
          layout="wide"
          icon="alert-circle-outline"
          label="Discrepancy units"
          value={totalIssueQty}
          onPress={() => router.push(transferReturnIssuesHref(navRange) as never)}
        />

        {query.isLoading ? <LoadingState label="Calculating branch operations…" /> : null}
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
            <ReportSectionHeading title="BRANCHES" />
            {rankedBranches.map((branch) => (
              <BranchOperationsCard key={branch.branch_id} item={branch} navRange={navRange} />
            ))}
          </View>
        ) : null}
      </ConstrainedWidth>
    </Screen>
  );
}

function BranchOperationsCard({ item, navRange }: { item: BranchPerformanceItem; navRange: NavRange }) {
  const issues = branchOperationsIssueQty(item);
  const chip = statChipColors[accentForName(item.branch_name)];
  const range = { branchId: item.branch_id, ...navRange };
  const meta = branchOperationsMeta(item.quantity_sold, item.transaction_count);

  return (
    <View style={styles.branchCard}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${item.branch_name}, ${meta}, ${formatMoney(item.total_sales)} sales`}
        accessibilityHint="Opens Branch Hub for this range"
        onPress={() => router.push(branchHubHref(range) as never)}
        style={({ pressed }) => [styles.branchTop, pressed && styles.pressed]}
      >
        <View style={[styles.iconChip, { backgroundColor: chip.chip }]}>
          <Ionicons name="storefront-outline" size={18} color={chip.icon} />
        </View>
        <View style={styles.branchCopy}>
          <Text style={styles.branchName} numberOfLines={1}>
            {item.branch_name}
          </Text>
          <Text style={styles.branchMeta} numberOfLines={2}>
            {meta}
          </Text>
        </View>
        <CurrencyText
          value={formatMoney(item.total_sales)}
          style={styles.branchAmount}
          numberOfLines={1}
          adjustsFontSizeToFit
        />
        <Ionicons name="chevron-forward" size={16} color={managerColors.subtext} />
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          issues.missing === 0 && issues.excess === 0
            ? `${item.branch_name} no transfer or return issues`
            : `${item.branch_name} ${[issues.missing > 0 ? `${issues.missing} missing` : null, issues.excess > 0 ? `${issues.excess} excess` : null].filter(Boolean).join(', ')}`
        }
        accessibilityHint="Opens Transfer and Return Issues for this branch and range"
        onPress={() => router.push(transferReturnIssuesHref(range) as never)}
        style={({ pressed }) => [styles.badgeRow, pressed && styles.pressed]}
      >
        {issues.missing === 0 && issues.excess === 0 ? (
          <ManagerBadge label="No issues" tone="success" />
        ) : (
          <>
            {issues.missing > 0 ? <ManagerBadge label={`${issues.missing} missing`} tone="danger" /> : null}
            {issues.excess > 0 ? <ManagerBadge label={`${issues.excess} excess`} tone="warning" /> : null}
          </>
        )}
      </Pressable>
    </View>
  );
}

export function BranchPerformanceDetailScreen() {
  const params = useLocalSearchParams<{
    id?: string | string[];
    range?: string | string[];
    start?: string | string[];
    end?: string | string[];
  }>();
  const id = firstSearchParam(params.id);
  const initial = initialRangeFromParams(
    firstSearchParam(params.range),
    firstSearchParam(params.start),
    firstSearchParam(params.end),
    'all_time',
  );
  const [rangeType, setRangeType] = useState<DateFilterType>(initial.rangeType);
  const [customStart, setCustomStart] = useState(initial.customStart);
  const [customEnd, setCustomEnd] = useState(initial.customEnd);

  const { rpcRangeType, startIso, endIso } = resolveReportRange(rangeType, customStart, customEnd);
  const query = useBranchPerformanceDetails(id, rpcRangeType, startIso, endIso);
  const data = query.data;
  const navRange: NavRange = { rangeType, customStart, customEnd };
  const range = { branchId: id, ...navRange };
  const issues = data ? branchOperationsIssueQty(data.metrics) : null;

  return (
    <Screen backgroundColor="#FFFFFF" edges={['top']} contentContainerStyle={styles.screenContent}>
      <ManagerScreenHeader title={data?.branch?.name ?? 'Branch Operations'} showBack />
      <ConstrainedWidth style={styles.column}>
        <View style={styles.filterBleed}>
          <DateRangeFilter
            value={rangeType}
            onChange={setRangeType}
            customStart={customStart}
            customEnd={customEnd}
            onCustomStartChange={setCustomStart}
            onCustomEndChange={setCustomEnd}
          />
        </View>

        {query.isLoading ? <LoadingState label="Loading branch details…" /> : null}
        {query.error ? (
          <ErrorState message={getErrorMessage(query.error)} onRetry={() => void query.refetch()} />
        ) : null}
        {rangeType === 'custom' && !query.isFetched && !query.isLoading ? (
          <EmptyState title="Select a date range" message="Enter both a start date and an end date to run this report." />
        ) : null}

        {data && issues ? (
          <>
            <StatTile
              layout="wide"
              emphasis
              icon="cube-outline"
              label="Items sold"
              value={data.metrics.quantity_sold}
            />
            <StatTile
              layout="wide"
              icon="receipt-outline"
              label="Completed sales"
              value={data.metrics.transaction_count}
            />
            <StatTile
              layout="wide"
              icon="alert-circle-outline"
              label="Discrepancy units"
              value={Number(data.metrics.total_missing_qty) + Number(data.metrics.total_excess_qty)}
            />

            <ReportSectionHeading title="REPORTS" />
            <ListRowCard
              icon="storefront-outline"
              iconColor="blue"
              title="Branch Hub"
              subtitle="Sales and orders for this range"
              accessibilityLabel="Branch Hub"
              onPress={() => router.push(branchHubHref(range) as never)}
            />
            <ListRowCard
              icon="pricetag-outline"
              iconColor="gold"
              title="Product Sales"
              subtitle="Items sold by SKU"
              accessibilityLabel="Product Sales"
              onPress={() => router.push(productSalesBranchHref(range) as never)}
            />
            <ListRowCard
              icon="alert-circle-outline"
              iconColor="red"
              title="Transfer & Return Issues"
              subtitle={
                issues.missing === 0 && issues.excess === 0
                  ? 'No issues'
                  : [issues.missing > 0 ? `${issues.missing} missing` : null, issues.excess > 0 ? `${issues.excess} excess` : null]
                      .filter(Boolean)
                      .join(' · ')
              }
              accessibilityLabel="Transfer & Return Issues"
              onPress={() => router.push(transferReturnIssuesHref(range) as never)}
            />
            <ListRowCard
              icon="checkmark-done-outline"
              iconColor="green"
              title="Inventory Reconciliation"
              subtitle="Physical stock versus the ledger"
              accessibilityLabel="Inventory Reconciliation"
              onPress={() => router.push(branchInventoryReconciliationHref(range) as never)}
            />
          </>
        ) : null}
      </ConstrainedWidth>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenContent: { flexGrow: 1, padding: 0, gap: 0 },
  column: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 28, gap: 12 },
  filterBleed: { marginHorizontal: -20 },
  section: { gap: 10, marginTop: 4 },
  branchCard: {
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
  branchTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconChip: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  branchCopy: { flex: 1, minWidth: 0, gap: 3 },
  branchName: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 15, lineHeight: 19 },
  branchMeta: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12.5 },
  branchAmount: {
    flexShrink: 1,
    minWidth: 72,
    maxWidth: 132,
    color: managerColors.royalBlue,
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
    textAlign: 'right',
  },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  pressed: { opacity: 0.85 },
});
