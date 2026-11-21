import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { Screen } from '@/components/Screen';
import { EmptyState, ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { StatTile } from '@/components/dashboard/StatTile';
import { statChipColors } from '@/components/dashboard/theme';
import { DateRangeFilter, resolveReportRange, type DateFilterType } from '@/features/reports/DateRangeFilter';
import { RankProgressRow } from '@/features/reports/RankProgressRow';
import { ReportSectionHeading } from '@/features/reports/ReportSectionHeading';
import { branchHubHref, firstSearchParam, parseReportDateFilter } from '@/features/reports/branchHub';
import { buildTotalSalesBranchRows } from '@/features/reports/totalSalesDashboard';
import { useOwnerSalesByBranch } from '@/hooks/useSales';
import { getErrorMessage } from '@/lib/errors';
import { formatMoney, isReportRangeReady } from '@/lib/format';
import { accentForName } from '@/lib/nameAccent';

/** Company-wide sales + branch summary. Remittance lives on Shift Remittances. */
export function SalesOverviewScreen() {
  const params = useLocalSearchParams<{
    range?: string | string[];
    start?: string | string[];
    end?: string | string[];
  }>();
  const initialRange = parseReportDateFilter(firstSearchParam(params.range));
  const [rangeType, setRangeType] = useState<DateFilterType>(initialRange);
  const [customStart, setCustomStart] = useState(initialRange === 'custom' ? firstSearchParam(params.start) : '');
  const [customEnd, setCustomEnd] = useState(initialRange === 'custom' ? firstSearchParam(params.end) : '');
  const { rpcRangeType, startIso, endIso } = resolveReportRange(rangeType, customStart, customEnd);
  const ready = isReportRangeReady(rpcRangeType, startIso, endIso);

  const salesQuery = useOwnerSalesByBranch(rpcRangeType, startIso, endIso, ready);

  const salesReady = ready && !salesQuery.isError && salesQuery.data !== undefined;

  const totalSales = useMemo(() => {
    if (!salesReady) return null;
    return (salesQuery.data ?? []).reduce((sum, row) => sum + (Number(row.total_sales) || 0), 0);
  }, [salesReady, salesQuery.data]);

  const totalTransactions = useMemo(() => {
    if (!salesReady) return null;
    return (salesQuery.data ?? []).reduce(
      (sum, row) => sum + Math.max(0, Math.trunc(Number(row.transaction_count) || 0)),
      0,
    );
  }, [salesReady, salesQuery.data]);

  const branches = useMemo(() => {
    if (!salesReady) return [];
    return buildTotalSalesBranchRows(salesQuery.data, undefined);
  }, [salesReady, salesQuery.data]);

  const salesLoading = ready && salesQuery.isLoading;
  const customIncomplete = rangeType === 'custom' && !ready;
  const companySales = totalSales ?? 0;

  return (
    <Screen
      refreshing={salesQuery.isRefetching}
      onRefresh={ready ? () => void salesQuery.refetch() : undefined}
      backgroundColor="#FFFFFF"
      edges={['top']}
      contentContainerStyle={styles.screenContent}
    >
      <ManagerScreenHeader title="Sales Overview" showBack />
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
          icon="cash-outline"
          label="Total sales revenue"
          value={salesLoading || customIncomplete || salesQuery.isError ? '—' : formatMoney(totalSales ?? 0)}
        />
        <StatTile
          layout="wide"
          icon="receipt-outline"
          label="Completed transactions"
          value={salesLoading || customIncomplete || salesQuery.isError ? '—' : (totalTransactions ?? 0)}
        />

        {customIncomplete ? (
          <EmptyState title="Select a date range" message="Enter both a start date and an end date to run this report." />
        ) : null}

        {ready && salesQuery.error ? (
          <ErrorState message={getErrorMessage(salesQuery.error)} onRetry={() => void salesQuery.refetch()} />
        ) : null}

        {salesLoading ? <LoadingState label="Loading company sales…" /> : null}

        {salesReady && !salesLoading && branches.length === 0 ? (
          <EmptyState
            title="No sales recorded"
            message="Selling branches have no completed sales in this range."
          />
        ) : null}

        {salesReady && branches.length > 0 ? (
          <View style={styles.section}>
            <ReportSectionHeading title="BRANCH SALES" />
            {branches.map((branch, index) => {
              const title = branch.isActive ? branch.branchName : `Inactive · ${branch.branchName}`;
              const txLabel = `${branch.transactions} ${branch.transactions === 1 ? 'sale' : 'sales'}`;
              const chip = statChipColors[accentForName(branch.branchName)];
              return (
                <RankProgressRow
                  key={branch.branchId}
                  rank={index + 1}
                  icon="storefront-outline"
                  iconBackground={chip.chip}
                  iconColor={chip.icon}
                  title={title}
                  meta={txLabel}
                  amount={formatMoney(branch.sales)}
                  share={companySales > 0 ? (branch.sales / companySales) * 100 : 0}
                  accessibilityLabel={`${title} sales ${formatMoney(branch.sales)}, ${txLabel}`}
                  accessibilityHint="Opens Branch Hub for this range"
                  onPress={() =>
                    router.push(
                      branchHubHref({
                        branchId: branch.branchId,
                        rangeType,
                        customStart,
                        customEnd,
                      }) as never,
                    )
                  }
                />
              );
            })}
          </View>
        ) : null}
      </ConstrainedWidth>
    </Screen>
  );
}

/** Compat alias for older imports/tests. */
export const TotalSalesDashboardScreen = SalesOverviewScreen;

const styles = StyleSheet.create({
  screenContent: { flexGrow: 1, padding: 0, gap: 0 },
  column: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 28, gap: 12 },
  filterBleed: { marginHorizontal: -20 },
  section: { gap: 10, marginTop: 4 },
});
