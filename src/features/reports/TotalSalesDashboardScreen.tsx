import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { Screen } from '@/components/Screen';
import { ListRowCard } from '@/components/dashboard/ListRowCard';
import { EmptyState, ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { StatTile } from '@/components/dashboard/StatTile';
import { managerColors } from '@/components/dashboard/theme';
import { DateRangeFilter, resolveReportRange, type DateFilterType } from '@/features/reports/DateRangeFilter';
import {
  buildTotalSalesBranchRows,
  salesByBranchHref,
  totalRemittance,
} from '@/features/reports/totalSalesDashboard';
import { useOwnerSalesByBranch } from '@/hooks/useSales';
import { useShiftRemittances } from '@/hooks/useShifts';
import { getErrorMessage } from '@/lib/errors';
import { formatMoney, isReportRangeReady } from '@/lib/format';
import { accentForName } from '@/lib/nameAccent';

export function TotalSalesDashboardScreen() {
  const [rangeType, setRangeType] = useState<DateFilterType>('today');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const { rpcRangeType, startIso, endIso } = resolveReportRange(rangeType, customStart, customEnd);
  const ready = isReportRangeReady(rpcRangeType, startIso, endIso);

  const salesQuery = useOwnerSalesByBranch(rpcRangeType, startIso, endIso, ready);
  const remittanceQuery = useShiftRemittances(rpcRangeType, startIso, endIso);

  const salesReady = ready && !salesQuery.isError && salesQuery.data !== undefined;
  const remittanceReady = ready && !remittanceQuery.isError && remittanceQuery.data !== undefined;

  const totalSales = useMemo(() => {
    if (!salesReady) return null;
    return (salesQuery.data ?? []).reduce((sum, row) => sum + (Number(row.total_sales) || 0), 0);
  }, [salesReady, salesQuery.data]);

  const cash = useMemo(
    () => (remittanceReady ? totalRemittance(remittanceQuery.data) : null),
    [remittanceReady, remittanceQuery.data],
  );

  const branches = useMemo(() => {
    if (!salesReady) return [];
    return buildTotalSalesBranchRows(salesQuery.data, remittanceReady ? remittanceQuery.data : undefined);
  }, [salesReady, remittanceReady, salesQuery.data, remittanceQuery.data]);

  const salesLoading = ready && salesQuery.isLoading;
  const remittanceLoading = ready && remittanceQuery.isLoading;
  const customIncomplete = rangeType === 'custom' && !ready;

  return (
    <Screen
      refreshing={salesQuery.isRefetching || remittanceQuery.isRefetching}
      onRefresh={
        ready
          ? () => {
              void salesQuery.refetch();
              void remittanceQuery.refetch();
            }
          : undefined
      }
      backgroundColor="#FFFFFF"
      edges={['top']}
      contentContainerStyle={styles.screenContent}
    >
      <ManagerScreenHeader title="Total Sales" showBack />
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
          Sales revenue is completed orders. Remittance is cash/GCash counted at shift close — not the same as sales.
        </Text>

        <StatTile
          layout="wide"
          emphasis
          icon="cash-outline"
          label="Total sales revenue"
          value={salesLoading || customIncomplete || salesQuery.isError ? '—' : formatMoney(totalSales ?? 0)}
        />
        <StatTile
          layout="wide"
          icon="wallet-outline"
          label="Total remittance"
          value={
            remittanceLoading || customIncomplete || remittanceQuery.isError
              ? '—'
              : cash == null || cash.remitted == null
                ? 'None yet'
                : formatMoney(cash.remitted)
          }
        />
        {remittanceReady && cash && cash.pendingShifts > 0 ? (
          <Text style={styles.pendingNote}>
            {cash.pendingShifts} shift{cash.pendingShifts === 1 ? '' : 's'} awaiting remittance (
            {formatMoney(cash.pendingExpected)} expected).
          </Text>
        ) : null}

        {customIncomplete ? (
          <EmptyState title="Select a date range" message="Enter both a start date and an end date to run this report." />
        ) : null}

        {ready && salesQuery.error ? (
          <ErrorState message={getErrorMessage(salesQuery.error)} onRetry={() => void salesQuery.refetch()} />
        ) : null}
        {ready && !salesQuery.error && remittanceQuery.error ? (
          <ErrorState
            message={`Couldn't load remittance. ${getErrorMessage(remittanceQuery.error)}`}
            onRetry={() => void remittanceQuery.refetch()}
          />
        ) : null}

        {salesLoading ? <LoadingState label="Loading company sales…" /> : null}

        {salesReady && !salesLoading && branches.length === 0 ? (
          <EmptyState
            title="No sales or remittance"
            message="Selling branches have no completed sales or remitted shifts in this range."
          />
        ) : null}

        {salesReady && branches.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>SELLING BRANCHES</Text>
            {branches.map((branch) => {
              const title = branch.isActive ? branch.branchName : `Inactive · ${branch.branchName}`;
              return (
                <ListRowCard
                  key={branch.branchId}
                  icon="storefront-outline"
                  iconColor={accentForName(branch.branchName)}
                  title={title}
                  meta={`${branch.transactions} ${branch.transactions === 1 ? 'sale' : 'sales'} · Remitted ${
                    remittanceReady
                      ? branch.remitted == null
                        ? 'none yet'
                        : formatMoney(branch.remitted)
                      : '—'
                  }`}
                  trailing={<Text style={styles.salesAmount}>{formatMoney(branch.sales)}</Text>}
                  onPress={() =>
                    router.push(
                      salesByBranchHref({
                        branchId: branch.branchId,
                        rangeType,
                        customStart,
                        customEnd,
                      }) as never,
                    )
                  }
                  accessibilityLabel={`${title} sales ${formatMoney(branch.sales)}`}
                  accessibilityHint="Opens Sales by Branch for this range"
                />
              );
            })}
          </View>
        ) : null}
      </ConstrainedWidth>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenContent: { flexGrow: 1, padding: 0, gap: 0 },
  column: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 24, gap: 12 },
  hint: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12.5, lineHeight: 18, marginTop: -4 },
  pendingNote: { color: managerColors.goldMuted, fontFamily: 'Inter_500Medium', fontSize: 12.5, lineHeight: 17, marginTop: -4 },
  section: { gap: 10 },
  sectionTitle: {
    color: managerColors.subtext,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    letterSpacing: 0.8,
  },
  salesAmount: { color: managerColors.royalBlue, fontFamily: 'Inter_700Bold', fontSize: 15 },
});
