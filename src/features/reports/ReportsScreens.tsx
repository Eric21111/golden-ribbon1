import { useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { Pagination } from '@/components/Pagination';
import { Screen } from '@/components/Screen';
import { EmptyState, ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { managerColors } from '@/components/dashboard/theme';
import { OwnerSummaryKpiPair } from '@/features/reports/OwnerSummaryKpiPair';
import {
  firstSearchParam,
  parseReportDateFilter,
} from '@/features/reports/branchHub';
import { DateRangeFilter, resolveReportRange, type DateFilterType } from '@/features/reports/DateRangeFilter';
import { RankProgressRow } from '@/features/reports/RankProgressRow';
import { ReportSectionHeading } from '@/features/reports/ReportSectionHeading';
import { useBranches } from '@/hooks/useBranches';
import { useClientPagination } from '@/hooks/useClientPagination';
import { useProductSales } from '@/hooks/useSales';
import { getErrorMessage } from '@/lib/errors';
import { formatMoney, isReportRangeReady } from '@/lib/format';
import type { ProductSalesReportItem } from '@/types/models';

const PRODUCTS_PAGE_SIZE = 10;

function unitLabel(item: ProductSalesReportItem): string {
  const code = item.stock_unit_code?.trim();
  return code || 'pcs';
}

export function ProductSalesSummaryScreen({
  role,
  branchId: branchIdProp,
}: {
  role: 'owner' | 'manager';
  /** Owner branch-first drill-in: lock the report to this selling branch. */
  branchId?: string;
}) {
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

  const branches = useBranches();
  const lockedBranch = useMemo(
    () => (branchIdProp ? (branches.data ?? []).find((branch) => branch.id === branchIdProp) : null),
    [branchIdProp, branches.data],
  );

  // Manager is locked server-side; owner hub passes a selling branch id.
  const branchId = role === 'owner' ? branchIdProp || undefined : undefined;

  const { rpcRangeType, startIso, endIso } = resolveReportRange(rangeType, customStart, customEnd);
  const ready = isReportRangeReady(rpcRangeType, startIso, endIso);
  const query = useProductSales(rpcRangeType, branchId, startIso, endIso);

  const products = query.data ?? [];
  const totalUnitsSold = products.reduce((acc, p) => acc + Number(p.quantity_sold), 0);
  const totalProductRevenue = products.reduce((acc, p) => acc + Number(p.total_revenue), 0);
  const rankedProducts = useMemo(
    () => [...products].sort((a, b) => Number(b.total_revenue) - Number(a.total_revenue)),
    [products],
  );
  const pagination = useClientPagination(
    rankedProducts,
    `${branchId ?? 'all'}|${rangeType}|${customStart}|${customEnd}`,
    PRODUCTS_PAGE_SIZE,
  );

  const title = 'Product Sales';
  const subtitle = lockedBranch?.name;

  const loading = ready && query.isLoading;
  const itemsValue = !ready || loading || query.isError ? '—' : totalUnitsSold;
  const revenueValue = !ready || loading || query.isError ? '—' : formatMoney(totalProductRevenue);

  return (
    <Screen
      refreshing={query.isRefetching}
      onRefresh={ready ? () => void query.refetch() : undefined}
      backgroundColor="#FFFFFF"
      edges={['top']}
      contentContainerStyle={styles.screenContent}
    >
      <ManagerScreenHeader title={title} subtitle={subtitle} showBack />
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

        {loading ? <LoadingState label="Calculating product sales…" /> : null}
        {query.error ? (
          <ErrorState message={getErrorMessage(query.error)} onRetry={() => void query.refetch()} />
        ) : null}
        {rangeType === 'custom' && !ready ? (
          <EmptyState title="Select a date range" message="Enter both a start date and an end date to run this report." />
        ) : null}
        {products.length === 0 && !loading && query.isFetched ? (
          <EmptyState title="No product sales" message="No completed product sales for this range." />
        ) : null}

        {rankedProducts.length > 0 ? (
          <View style={styles.section}>
            <ReportSectionHeading title="PRODUCTS" />
            {pagination.pageItems.map((item, index) => (
              <RankProgressRow
                key={item.product_id}
                rank={pagination.page * PRODUCTS_PAGE_SIZE + index + 1}
                title={item.product_name}
                amount={formatMoney(item.total_revenue)}
                share={totalProductRevenue > 0 ? (Number(item.total_revenue) / totalProductRevenue) * 100 : 0}
                meta={`Items sold: ${item.quantity_sold} ${unitLabel(item)}`}
                metaNode={
                  item.product_sku ? (
                    <View style={styles.skuTag}>
                      <Text style={styles.skuTagLabel} numberOfLines={1}>
                        {item.product_sku}
                      </Text>
                    </View>
                  ) : null
                }
              />
            ))}
            {pagination.showPagination && pagination.totalPages > 1 ? (
              <View style={styles.pager}>
                <Pagination
                  page={pagination.page}
                  totalPages={pagination.totalPages}
                  onPageChange={pagination.setPage}
                />
              </View>
            ) : null}
          </View>
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
  pager: { marginTop: 4 },
  skuTag: {
    alignSelf: 'flex-start',
    backgroundColor: managerColors.cardSurface,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  skuTagLabel: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 11.5, letterSpacing: 0.3 },
});
