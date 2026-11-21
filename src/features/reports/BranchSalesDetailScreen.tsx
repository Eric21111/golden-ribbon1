import { useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { Screen } from '@/components/Screen';
import { CurrencyText } from '@/components/dashboard/CurrencyText';
import { ListRowCard } from '@/components/dashboard/ListRowCard';
import { EmptyState, ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { StatTile } from '@/components/dashboard/StatTile';
import { managerColors } from '@/components/dashboard/theme';
import { ReportSectionHeading } from '@/features/reports/ReportSectionHeading';
import {
  DateRangeFilter,
  resolveReportRange,
  shouldShowBranchOrderLog,
  type DateFilterType,
} from '@/features/reports/DateRangeFilter';
import { useBranches } from '@/hooks/useBranches';
import { useBranchDailySales, useBranchSalesLog, useOwnerSalesByBranch } from '@/hooks/useSales';
import { getErrorMessage } from '@/lib/errors';
import { formatDate, formatManilaDate, formatMoney, isReportRangeReady } from '@/lib/format';

const DATE_FILTERS = new Set<DateFilterType>(['all_time', 'today', 'this_week', 'this_month', 'custom']);

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

function parseDateFilter(value: string): DateFilterType {
  return DATE_FILTERS.has(value as DateFilterType) ? (value as DateFilterType) : 'today';
}

/**
 * Dedicated branch drill-down from Sales Overview: daily sales history or order log
 * for one selling branch (no accordion list).
 */
export function BranchSalesDetailScreen() {
  const params = useLocalSearchParams<{
    branchId?: string | string[];
    range?: string | string[];
    start?: string | string[];
    end?: string | string[];
  }>();
  const branchId = firstParam(params.branchId);
  const initialRange = parseDateFilter(firstParam(params.range));
  const initialStart = firstParam(params.start);
  const initialEnd = firstParam(params.end);

  const [rangeType, setRangeType] = useState<DateFilterType>(initialRange);
  const [customStart, setCustomStart] = useState(initialRange === 'custom' ? initialStart : '');
  const [customEnd, setCustomEnd] = useState(initialRange === 'custom' ? initialEnd : '');

  const { rpcRangeType, startIso, endIso } = resolveReportRange(rangeType, customStart, customEnd);
  const ready = isReportRangeReady(rpcRangeType, startIso, endIso);

  const branches = useBranches();
  const catalogBranch = useMemo(
    () => (branches.data ?? []).find((branch) => branch.id === branchId) ?? null,
    [branchId, branches.data],
  );

  // Owner RPC so inactive branches with historical sales stay visible.
  const salesQuery = useOwnerSalesByBranch(rpcRangeType, startIso, endIso, Boolean(branchId) && ready);
  const branchRow = useMemo(
    () => (salesQuery.data ?? []).find((item) => item.branch_id === branchId) ?? null,
    [branchId, salesQuery.data],
  );

  const showOrders = shouldShowBranchOrderLog(rangeType, startIso, endIso);
  const log = useBranchSalesLog(branchId && showOrders ? branchId : '', rpcRangeType, startIso, endIso);
  const days = useBranchDailySales(branchId && !showOrders ? branchId : '', rpcRangeType, startIso, endIso);
  const detail = showOrders ? log : days;

  const salesReady = ready && !salesQuery.isError && salesQuery.data !== undefined;
  const totalSales = salesReady ? Number(branchRow?.total_sales) || 0 : 0;
  const totalTx = salesReady ? Math.max(0, Math.trunc(Number(branchRow?.transaction_count) || 0)) : 0;
  const totalsValue = !ready || salesQuery.isLoading || salesQuery.isError ? '—' : undefined;

  const titleName =
    branchRow?.branch_name ??
    catalogBranch?.name ??
    (branchId ? 'Branch' : 'Branch sales');
  const headerTitle =
    branchRow?.is_active === false || catalogBranch?.is_active === false
      ? `Inactive · ${titleName}`
      : titleName;

  if (!branchId) {
    return (
      <Screen backgroundColor="#FFFFFF" edges={['top']} contentContainerStyle={styles.screenContent}>
        <ManagerScreenHeader title="Branch sales" showBack />
        <ConstrainedWidth style={styles.column}>
          <EmptyState title="Branch not found" message="Open Sales Overview and choose a branch." />
        </ConstrainedWidth>
      </Screen>
    );
  }

  return (
    <Screen
      refreshing={salesQuery.isRefetching || detail.isRefetching}
      onRefresh={
        ready
          ? () => {
              void salesQuery.refetch();
              void detail.refetch();
            }
          : undefined
      }
      backgroundColor="#FFFFFF"
      edges={['top']}
      contentContainerStyle={styles.screenContent}
    >
      <ManagerScreenHeader title={headerTitle} showBack />
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
          value={totalsValue ?? formatMoney(totalSales)}
        />
        <StatTile layout="wide" icon="receipt-outline" label="Transactions" value={totalsValue ?? totalTx} />

        {rangeType === 'custom' && !ready ? (
          <EmptyState title="Select a date range" message="Enter both a start date and an end date to run this report." />
        ) : null}

        {salesQuery.isLoading ? <LoadingState label="Loading branch sales…" /> : null}
        {salesQuery.error ? (
          <ErrorState message={getErrorMessage(salesQuery.error)} onRetry={() => void salesQuery.refetch()} />
        ) : null}

        {salesReady && !salesQuery.isLoading && !branchRow ? (
          <EmptyState title="No sales recorded" message="This branch has no completed sales for this range." />
        ) : null}

        {salesReady && branchRow ? (
          <View style={styles.section}>
            <ReportSectionHeading title={showOrders ? 'ORDERS' : 'SALES BY DAY'} />
            {detail.isLoading ? (
              <LoadingState label={showOrders ? 'Loading sales…' : 'Loading daily totals…'} />
            ) : null}
            {detail.error ? (
              <ErrorState message={getErrorMessage(detail.error)} onRetry={() => void detail.refetch()} />
            ) : null}
            {detail.data?.length === 0 ? (
              <Text style={styles.logEmpty}>
                {showOrders
                  ? 'No completed sales in this range. Older detailed sales may have been archived.'
                  : 'No completed sales in this range.'}
              </Text>
            ) : null}
            {showOrders
              ? log.data?.map((sale) => (
                  <ListRowCard
                    key={sale.id}
                    title={sale.sale_number}
                    meta={`${formatDate(sale.sold_at)} · ${sale.cashier?.full_name ?? 'Cashier'}`}
                    trailing={
                      <CurrencyText
                        value={formatMoney(sale.total_amount)}
                        style={styles.amount}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                      />
                    }
                  />
                ))
              : days.data?.map((row) => (
                  <ListRowCard
                    key={row.business_date}
                    title={formatManilaDate(row.business_date)}
                    meta={`${row.transaction_count} ${Number(row.transaction_count) === 1 ? 'sale' : 'sales'}`}
                    trailing={
                      <CurrencyText
                        value={formatMoney(row.total_sales)}
                        style={styles.amount}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                      />
                    }
                  />
                ))}
          </View>
        ) : null}
      </ConstrainedWidth>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenContent: { flexGrow: 1, padding: 0, gap: 0 },
  column: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 24, gap: 14 },
  filterBleed: { marginHorizontal: -20 },
  section: { gap: 10 },
  logEmpty: {
    color: managerColors.subtext,
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    alignSelf: 'stretch',
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  amount: {
    color: managerColors.royalBlue,
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
    minWidth: 72,
    maxWidth: 132,
    flexShrink: 1,
    textAlign: 'right',
  },
});
