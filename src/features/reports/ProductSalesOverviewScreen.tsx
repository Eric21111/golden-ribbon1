import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { Screen } from '@/components/Screen';
import { EmptyState, ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { OwnerSummaryKpiPair } from '@/features/reports/OwnerSummaryKpiPair';
import { statChipColors } from '@/components/dashboard/theme';
import {
  firstSearchParam,
  parseReportDateFilter,
} from '@/features/reports/branchHub';
import { DateRangeFilter, resolveReportRange, type DateFilterType } from '@/features/reports/DateRangeFilter';
import { RankProgressRow } from '@/features/reports/RankProgressRow';
import { ReportSectionHeading } from '@/features/reports/ReportSectionHeading';
import {
  buildProductSalesBranchRows,
  productSalesBranchHref,
  summarizeProductSales,
} from '@/features/reports/productSalesDashboard';
import { useBranches } from '@/hooks/useBranches';
import { useProductSales } from '@/hooks/useSales';
import { getErrorMessage } from '@/lib/errors';
import { formatMoney, isReportRangeReady } from '@/lib/format';
import { accentForName } from '@/lib/nameAccent';
import { queryKeys } from '@/lib/queryKeys';
import { reportProductSales } from '@/services/saleService';

/**
 * Owner company-wide Product Sales hub: product quantity + product revenue only
 * (no remittance). Branch rows drill into the existing per-branch report.
 */
export function ProductSalesOverviewScreen() {
  const params = useLocalSearchParams<{
    range?: string | string[];
    start?: string | string[];
    end?: string | string[];
  }>();
  const initialRange = parseReportDateFilter(firstSearchParam(params.range));
  const initialStart = firstSearchParam(params.start);
  const initialEnd = firstSearchParam(params.end);

  const [rangeType, setRangeType] = useState<DateFilterType>(initialRange);
  const [customStart, setCustomStart] = useState(initialRange === 'custom' ? initialStart : '');
  const [customEnd, setCustomEnd] = useState(initialRange === 'custom' ? initialEnd : '');

  const { rpcRangeType, startIso, endIso } = resolveReportRange(rangeType, customStart, customEnd);
  const ready = isReportRangeReady(rpcRangeType, startIso, endIso);
  const customIncomplete = rangeType === 'custom' && !ready;

  const branchesQuery = useBranches();
  const companyQuery = useProductSales(rpcRangeType, undefined, startIso, endIso);

  const sellingBranches = useMemo(
    () =>
      (branchesQuery.data ?? [])
        .filter((branch) => !branch.is_main_branch && branch.is_active)
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name)),
    [branchesQuery.data],
  );

  const branchIdsKey = sellingBranches.map((branch) => branch.id).join('|');

  const branchBundleQuery = useQuery({
    queryKey: [...queryKeys.productSales(rpcRangeType, 'by-branch', startIso, endIso), branchIdsKey],
    queryFn: async () => {
      const entries = await Promise.all(
        sellingBranches.map(async (branch) => {
          const items = await reportProductSales(rpcRangeType, branch.id, startIso, endIso);
          return [branch.id, summarizeProductSales(items)] as const;
        }),
      );
      return new Map(entries);
    },
    enabled: ready && sellingBranches.length > 0,
  });

  const companyTotals = useMemo(
    () => summarizeProductSales(companyQuery.data),
    [companyQuery.data],
  );

  const branchRows = useMemo(
    () =>
      buildProductSalesBranchRows(
        sellingBranches,
        branchBundleQuery.data ?? new Map(),
      ),
    [sellingBranches, branchBundleQuery.data],
  );

  const companyRevenue = companyTotals.revenue;
  const companyLoading = ready && (companyQuery.isLoading || branchesQuery.isLoading);
  const branchMetricsLoading = ready && sellingBranches.length > 0 && branchBundleQuery.isLoading;

  const itemsValue =
    companyLoading || customIncomplete || companyQuery.isError ? '—' : companyTotals.itemsSold;
  const revenueValue =
    companyLoading || customIncomplete || companyQuery.isError
      ? '—'
      : formatMoney(companyTotals.revenue);

  return (
    <Screen
      refreshing={
        companyQuery.isRefetching ||
        branchBundleQuery.isRefetching ||
        branchesQuery.isRefetching
      }
      onRefresh={
        ready
          ? () => {
              void companyQuery.refetch();
              void branchBundleQuery.refetch();
              void branchesQuery.refetch();
            }
          : undefined
      }
      backgroundColor="#FFFFFF"
      edges={['top']}
      contentContainerStyle={styles.screenContent}
    >
      <ManagerScreenHeader title="Product Sales" showBack />
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

        <OwnerSummaryKpiPair
          left={{
            icon: 'cube-outline',
            label: 'Items sold',
            value: itemsValue,
            emphasis: true,
          }}
          right={{
            icon: 'cash-outline',
            label: 'Product revenue',
            value: revenueValue,
          }}
        />

        {customIncomplete ? (
          <EmptyState
            title="Select a date range"
            message="Enter both a start date and an end date to run this report."
          />
        ) : null}

        {ready && companyQuery.error ? (
          <ErrorState
            message={getErrorMessage(companyQuery.error)}
            onRetry={() => void companyQuery.refetch()}
          />
        ) : null}
        {ready && !companyQuery.error && branchesQuery.error ? (
          <ErrorState
            message={getErrorMessage(branchesQuery.error)}
            onRetry={() => void branchesQuery.refetch()}
          />
        ) : null}
        {ready && !companyQuery.error && !branchesQuery.error && branchBundleQuery.error ? (
          <ErrorState
            message={getErrorMessage(branchBundleQuery.error)}
            onRetry={() => void branchBundleQuery.refetch()}
          />
        ) : null}

        {companyLoading ? <LoadingState label="Loading product sales…" /> : null}

        {ready && !companyQuery.error && sellingBranches.length > 0 ? (
          <View style={styles.section}>
            <ReportSectionHeading title="BRANCHES" />
            {branchMetricsLoading ? <LoadingState label="Loading branch totals…" /> : null}
            {!branchMetricsLoading && !branchBundleQuery.error
              ? branchRows.map((branch, index) => {
                  const title = branch.isActive ? branch.branchName : `Inactive · ${branch.branchName}`;
                  const itemsLabel = `${branch.itemsSold} ${branch.itemsSold === 1 ? 'item' : 'items'} sold`;
                  const chip = statChipColors[accentForName(branch.branchName)];
                  return (
                    <RankProgressRow
                      key={branch.branchId}
                      rank={index + 1}
                      icon="storefront-outline"
                      iconBackground={chip.chip}
                      iconColor={chip.icon}
                      title={title}
                      meta={itemsLabel}
                      amount={formatMoney(branch.revenue)}
                      share={companyRevenue > 0 ? (branch.revenue / companyRevenue) * 100 : 0}
                      accessibilityLabel={`${title} product sales ${formatMoney(branch.revenue)}, ${itemsLabel}`}
                      accessibilityHint="Opens product sales for this branch"
                      onPress={() =>
                        router.push(
                          productSalesBranchHref({
                            branchId: branch.branchId,
                            rangeType,
                            customStart,
                            customEnd,
                          }) as never,
                        )
                      }
                    />
                  );
                })
              : null}
          </View>
        ) : null}

        {ready && !branchesQuery.isLoading && !branchesQuery.error && sellingBranches.length === 0 ? (
          <EmptyState
            title="No selling branches"
            message="Create or activate a selling branch to view product sales."
          />
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
});
