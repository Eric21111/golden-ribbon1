import { useQuery } from '@tanstack/react-query';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { Screen } from '@/components/Screen';
import { CurrencyText } from '@/components/dashboard/CurrencyText';
import { ListRowCard } from '@/components/dashboard/ListRowCard';
import { EmptyState, ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { StatTile } from '@/components/dashboard/StatTile';
import { managerColors } from '@/components/dashboard/theme';
import { useAuth } from '@/features/auth/AuthProvider';
import { firstSearchParam, parseReportDateFilter } from '@/features/reports/branchHub';
import { DATE_RANGE_OPTIONS, DateRangeFilter, resolveReportRange, type DateFilterType } from '@/features/reports/DateRangeFilter';
import { OwnerSummaryKpiPair } from '@/features/reports/OwnerSummaryKpiPair';
import { ReportSectionHeading } from '@/features/reports/ReportSectionHeading';
import { listAllVoidLogs } from '@/features/reports/voidLogData';
import {
  buildVoidLogBranchRows,
  voidLogTimeBounds,
  voidLogsBranchHref,
  voidLogsBranchMeta,
  voidLogsInRange,
  summarizeVoidLogs,
} from '@/features/reports/voidLogs';
import { useBranches } from '@/hooks/useBranches';
import { getErrorMessage } from '@/lib/errors';
import { formatMoney, getTodayRangeManila, isReportRangeReady } from '@/lib/format';
import { accentForName } from '@/lib/nameAccent';

function initialRangeFromParams(
  range: string,
  start: string,
  end: string,
): { rangeType: DateFilterType; customStart: string; customEnd: string } {
  const rangeType = range ? parseReportDateFilter(range) : 'all_time';
  return {
    rangeType,
    customStart: rangeType === 'custom' ? start : '',
    customEnd: rangeType === 'custom' ? end : '',
  };
}

function rangeLabel(rangeType: DateFilterType): string {
  if (rangeType === 'custom') return 'Custom range';
  return DATE_RANGE_OPTIONS.find((option) => option.value === rangeType)?.label ?? 'All Time';
}

export function VoidLogsOverviewScreen() {
  const { profile } = useAuth();
  const params = useLocalSearchParams<{
    range?: string | string[];
    start?: string | string[];
    end?: string | string[];
  }>();
  const initial = initialRangeFromParams(
    firstSearchParam(params.range),
    firstSearchParam(params.start),
    firstSearchParam(params.end),
  );
  const [rangeType, setRangeType] = useState<DateFilterType>(initial.rangeType);
  const [customStart, setCustomStart] = useState(initial.customStart);
  const [customEnd, setCustomEnd] = useState(initial.customEnd);

  const { rpcRangeType, startIso, endIso } = resolveReportRange(rangeType, customStart, customEnd);
  const ready = isReportRangeReady(rpcRangeType, startIso, endIso);
  const customIncomplete = rangeType === 'custom' && !ready;

  const branchesQuery = useBranches();
  const voidsQuery = useQuery({
    queryKey: ['void-logs', profile?.id, profile?.branch_id, profile?.role, 'all'],
    enabled: !!profile,
    queryFn: listAllVoidLogs,
  });

  useFocusEffect(
    useCallback(() => {
      if (profile) void voidsQuery.refetch();
    }, [profile, voidsQuery.refetch]),
  );

  const bounds = useMemo(() => {
    if (rangeType === 'today') return voidLogTimeBounds(getTodayRangeManila());
    return voidLogTimeBounds({ start: startIso, end: endIso });
  }, [rangeType, startIso, endIso]);

  const rangedRows = useMemo(
    () => (customIncomplete ? [] : voidLogsInRange(voidsQuery.data ?? [], bounds)),
    [customIncomplete, voidsQuery.data, bounds],
  );
  const totals = useMemo(() => summarizeVoidLogs(rangedRows), [rangedRows]);
  const branchRows = useMemo(
    () =>
      buildVoidLogBranchRows(
        (branchesQuery.data ?? []).map((branch) => ({
          id: branch.id,
          name: branch.name,
          is_active: branch.is_active,
          is_main_branch: branch.is_main_branch,
        })),
        rangedRows,
      ),
    [branchesQuery.data, rangedRows],
  );

  const loading = Boolean(profile) && (voidsQuery.isPending || branchesQuery.isLoading);
  const amountValue = loading || customIncomplete || voidsQuery.isError ? '—' : formatMoney(totals.amount);
  const itemsValue = loading || customIncomplete || voidsQuery.isError ? '—' : totals.items;
  const txValue = loading || customIncomplete || voidsQuery.isError ? '—' : totals.transactions;

  return (
    <Screen
      backgroundColor="#FFFFFF"
      edges={['top']}
      refreshing={voidsQuery.isRefetching || branchesQuery.isRefetching}
      onRefresh={
        ready
          ? () => {
              void voidsQuery.refetch();
              void branchesQuery.refetch();
            }
          : undefined
      }
      contentContainerStyle={styles.screen}
    >
      <ManagerScreenHeader title="Void logs" showBack />
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
          label="Total voided items"
          value={itemsValue}
        />
        <OwnerSummaryKpiPair
          left={{
            icon: 'receipt-outline',
            label: 'Total amount deducted',
            value: amountValue,
          }}
          right={{
            icon: 'documents-outline',
            label: 'Void transactions',
            value: txValue,
          }}
        />

        {customIncomplete ? (
          <EmptyState title="Select a date range" message="Enter both a start date and an end date to run this report." />
        ) : null}

        {ready && voidsQuery.error ? (
          <ErrorState message={getErrorMessage(voidsQuery.error)} onRetry={() => void voidsQuery.refetch()} />
        ) : null}
        {ready && !voidsQuery.error && branchesQuery.error ? (
          <ErrorState message={getErrorMessage(branchesQuery.error)} onRetry={() => void branchesQuery.refetch()} />
        ) : null}

        {loading ? <LoadingState label="Loading void logs…" /> : null}

        {ready && !loading && !voidsQuery.error && !branchesQuery.error && branchRows.length === 0 ? (
          <EmptyState title="No selling branches" message="Create or activate a selling branch to view void logs." />
        ) : null}

        {ready && !loading && !voidsQuery.error && !branchesQuery.error && branchRows.length > 0 ? (
          <View style={styles.section}>
            <ReportSectionHeading title="BRANCHES" meta={rangeLabel(rangeType)} />
            {branchRows.map((branch) => {
              const title = branch.isActive ? branch.branchName : `Inactive · ${branch.branchName}`;
              const meta = voidLogsBranchMeta(branch.items, branch.transactions);
              const href = branch.branchId
                ? voidLogsBranchHref({
                    branchId: branch.branchId,
                    rangeType,
                    customStart,
                    customEnd,
                  })
                : null;
              return (
                <ListRowCard
                  key={branch.branchId ?? branch.branchName}
                  icon="storefront-outline"
                  iconColor={accentForName(branch.branchName)}
                  title={title}
                  subtitle={meta}
                  trailing={
                    <CurrencyText
                      value={formatMoney(branch.amount)}
                      style={styles.amount}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.7}
                    />
                  }
                  onPress={href ? () => router.push(href as never) : undefined}
                  accessibilityLabel={`${title} ${meta}, ${formatMoney(branch.amount)} deducted`}
                  accessibilityHint={href ? 'Opens void history for this branch' : undefined}
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
  screen: { flexGrow: 1, padding: 0, gap: 0 },
  column: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 28, gap: 12 },
  filterBleed: { marginHorizontal: -20 },
  section: { gap: 10, marginTop: 4 },
  amount: {
    color: managerColors.royalBlue,
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
    flexShrink: 1,
    textAlign: 'right',
    minWidth: 72,
    maxWidth: 132,
  },
});
