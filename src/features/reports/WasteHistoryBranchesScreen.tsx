import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { Screen } from '@/components/Screen';
import { ListRowCard } from '@/components/dashboard/ListRowCard';
import { EmptyState, ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { managerColors } from '@/components/dashboard/theme';
import { useAuth } from '@/features/auth/AuthProvider';
import { DateRangeFilter, resolveReportRange, type DateFilterType } from '@/features/reports/DateRangeFilter';
import {
  buildWasteHistoryBranchRows,
  wasteHistoryBranchHref,
  wasteHistoryBranchMeta,
} from '@/features/reports/wasteHistoryBranches';
import { useBranches } from '@/hooks/useBranches';
import { useShiftWaste } from '@/hooks/useShifts';
import { getErrorMessage } from '@/lib/errors';
import { isReportRangeReady } from '@/lib/format';
import { accentForName } from '@/lib/nameAccent';

export function WasteHistoryBranchesScreen() {
  const { profile } = useAuth();
  const isManager = profile?.role === 'manager';
  const role = isManager ? 'manager' : 'owner';
  const [rangeType, setRangeType] = useState<DateFilterType>('today');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const { rpcRangeType, startIso, endIso } = resolveReportRange(rangeType, customStart, customEnd);
  const ready = isReportRangeReady(rpcRangeType, startIso, endIso);

  const branchesQuery = useBranches();
  const wasteQuery = useShiftWaste(rpcRangeType, startIso, endIso, null);

  const rows = useMemo(
    () => (ready && !wasteQuery.isError ? buildWasteHistoryBranchRows(branchesQuery.data, wasteQuery.data) : []),
    [ready, wasteQuery.isError, wasteQuery.data, branchesQuery.data],
  );

  const loading = (ready && wasteQuery.isLoading) || branchesQuery.isLoading;
  const customIncomplete = rangeType === 'custom' && !ready;

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
        <DateRangeFilter
          value={rangeType}
          onChange={setRangeType}
          customStart={customStart}
          customEnd={customEnd}
          onCustomStartChange={setCustomStart}
          onCustomEndChange={setCustomEnd}
        />
        <Text style={styles.hint}>
          Choose a branch to review recorded waste. Selling branches include shift and cashier waste; Main includes
          inventory write-offs only.
        </Text>

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
            <Text style={styles.sectionTitle}>BRANCHES</Text>
            {rows.map((row) => {
              const title = row.isActive ? row.branchName : `Inactive · ${row.branchName}`;
              return (
                <ListRowCard
                  key={row.branchId}
                  icon={row.isMain ? 'home-outline' : 'storefront-outline'}
                  iconColor={accentForName(row.branchName)}
                  title={title}
                  meta={wasteHistoryBranchMeta(row)}
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
                  accessibilityLabel={`${title} waste history`}
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
  hint: {
    color: managerColors.subtext,
    fontFamily: 'Inter_400Regular',
    fontSize: 12.5,
    lineHeight: 18,
    marginTop: -4,
  },
  section: { gap: 10, marginTop: 4 },
  sectionTitle: {
    color: managerColors.subtext,
    fontFamily: 'Inter_700Bold',
    fontSize: 12,
    letterSpacing: 0.6,
  },
});
