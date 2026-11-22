import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { Screen } from '@/components/Screen';
import { ListRowCard } from '@/components/dashboard/ListRowCard';
import { EmptyState, ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { StatTile } from '@/components/dashboard/StatTile';
import { useAuth } from '@/features/auth/AuthProvider';
import { firstSearchParam, parseReportDateFilter } from '@/features/reports/branchHub';
import { DateRangeFilter, resolveReportRange, type DateFilterType } from '@/features/reports/DateRangeFilter';
import { OwnerSummaryKpiPair } from '@/features/reports/OwnerSummaryKpiPair';
import { ReportSectionHeading } from '@/features/reports/ReportSectionHeading';
import {
  buildWasteHistoryBranchRows,
  summarizeWasteHistory,
  wasteHistoryBranchHref,
  wasteHistoryBranchMeta,
} from '@/features/reports/wasteHistoryBranches';
import { useBranches } from '@/hooks/useBranches';
import { useShiftWaste } from '@/hooks/useShifts';
import { getErrorMessage } from '@/lib/errors';
import { isReportRangeReady } from '@/lib/format';
import { accentForName } from '@/lib/nameAccent';

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

export function WasteHistoryBranchesScreen() {
  const { profile } = useAuth();
  const isManager = profile?.role === 'manager';
  const role = isManager ? 'manager' : 'owner';
  const params = useLocalSearchParams<{
    range?: string | string[];
    start?: string | string[];
    end?: string | string[];
  }>();
  const initial = initialRangeFromParams(
    firstSearchParam(params.range),
    firstSearchParam(params.start),
    firstSearchParam(params.end),
    // the Main Manager opens on today; the Owner on all time
    isManager ? 'today' : 'all_time',
  );
  const [rangeType, setRangeType] = useState<DateFilterType>(initial.rangeType);
  const [customStart, setCustomStart] = useState(initial.customStart);
  const [customEnd, setCustomEnd] = useState(initial.customEnd);

  const { rpcRangeType, startIso, endIso } = resolveReportRange(rangeType, customStart, customEnd);
  const ready = isReportRangeReady(rpcRangeType, startIso, endIso);
  const customIncomplete = rangeType === 'custom' && !ready;

  const branchesQuery = useBranches();
  const wasteQuery = useShiftWaste(rpcRangeType, startIso, endIso, null);

  const rows = useMemo(
    () => (ready && !wasteQuery.isError ? buildWasteHistoryBranchRows(branchesQuery.data, wasteQuery.data) : []),
    [ready, wasteQuery.isError, wasteQuery.data, branchesQuery.data],
  );
  const totals = useMemo(() => summarizeWasteHistory(wasteQuery.data), [wasteQuery.data]);

  const loading = (ready && wasteQuery.isLoading) || branchesQuery.isLoading;
  const kpiValue = (value: number) => (loading || wasteQuery.isError || customIncomplete ? '—' : value);

  return (
    <Screen
      refreshing={wasteQuery.isRefetching || branchesQuery.isRefetching}
      onRefresh={
        ready
          ? () => {
              void wasteQuery.refetch();
              void branchesQuery.refetch();
            }
          : undefined
      }
      backgroundColor="#FFFFFF"
      edges={['top']}
      contentContainerStyle={styles.screen}
    >
      <ManagerScreenHeader title="Waste History" showBack={!isManager} />
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
          icon="leaf-outline"
          label="Waste occurrences"
          value={kpiValue(totals.occurrences)}
        />
        <OwnerSummaryKpiPair
          left={{
            icon: 'calendar-outline',
            label: 'Days with waste',
            value: kpiValue(totals.daysWithWaste),
          }}
          right={{
            icon: 'storefront-outline',
            label: 'Branches with waste',
            value: kpiValue(totals.branchesWithWaste),
          }}
        />

        {customIncomplete ? (
          <EmptyState title="Select a date range" message="Enter both a start date and an end date to run this report." />
        ) : null}

        {ready && (wasteQuery.error || branchesQuery.error) ? (
          <ErrorState
            message={getErrorMessage(wasteQuery.error ?? branchesQuery.error)}
            onRetry={() => {
              void wasteQuery.refetch();
              void branchesQuery.refetch();
            }}
          />
        ) : null}
        {loading ? <LoadingState label="Loading waste history…" /> : null}

        {ready && !loading && !wasteQuery.error && !branchesQuery.error && rows.length === 0 ? (
          <EmptyState title="No branches" message="No branches are available for waste history." />
        ) : null}

        {ready && !loading && rows.length > 0 ? (
          <View style={styles.section}>
            <ReportSectionHeading title="BRANCHES" />
            {rows.map((row) => {
              const title = row.isActive ? row.branchName : `Inactive · ${row.branchName}`;
              const meta = wasteHistoryBranchMeta(row);
              return (
                <ListRowCard
                  key={row.branchId}
                  icon={row.isMain ? 'home-outline' : 'storefront-outline'}
                  iconColor={accentForName(row.branchName)}
                  title={title}
                  subtitle={meta}
                  onPress={() =>
                    router.push(
                      wasteHistoryBranchHref({
                        role,
                        branchId: row.branchId,
                        rangeType,
                        customStart,
                        customEnd,
                      }) as never,
                    )
                  }
                  accessibilityLabel={`${title} ${meta}`}
                  accessibilityHint="Opens recorded waste for this branch"
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
  column: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 24, gap: 12 },
  filterBleed: { marginHorizontal: -20 },
  section: { gap: 10, marginTop: 4 },
});
