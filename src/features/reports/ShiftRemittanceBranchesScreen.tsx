import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { Screen } from '@/components/Screen';
import { CurrencyText } from '@/components/dashboard/CurrencyText';
import { ListRowCard } from '@/components/dashboard/ListRowCard';
import { EmptyState, ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { managerColors } from '@/components/dashboard/theme';
import { useAuth } from '@/features/auth/AuthProvider';
import { remittanceSummary } from '@/features/reports/branchPerformanceCards';
import {
  firstSearchParam,
  parseReportDateFilter,
} from '@/features/reports/branchHub';
import { DateRangeFilter, resolveReportRange, type DateFilterType } from '@/features/reports/DateRangeFilter';
import { RemittanceSummaryCards } from '@/features/reports/RemittanceSummaryCards';
import {
  NO_REMITTANCE_RECORDED,
  remittanceAmountLabel,
  remittanceSummaryAmountLabel,
  remittanceTenderTotals,
} from '@/features/reports/reportDisplay';
import { ReportSectionHeading } from '@/features/reports/ReportSectionHeading';
import { shiftRemittanceBranchHref } from '@/features/reports/shiftRemittanceBranches';
import { remittanceByBranch } from '@/features/reports/totalSalesDashboard';
import { useBranches } from '@/hooks/useBranches';
import { useShiftRemittances } from '@/hooks/useShifts';
import { getErrorMessage } from '@/lib/errors';
import { isReportRangeReady } from '@/lib/format';
import { accentForName } from '@/lib/nameAccent';

export function ShiftRemittanceBranchesScreen() {
  const { profile } = useAuth();
  const isManager = profile?.role === 'manager';
  const role = isManager ? 'manager' : 'owner';
  const params = useLocalSearchParams<{
    range?: string | string[];
    start?: string | string[];
    end?: string | string[];
  }>();
  const initialRange = parseReportDateFilter(firstSearchParam(params.range) || 'today');
  const initialStart = firstSearchParam(params.start);
  const initialEnd = firstSearchParam(params.end);

  const [rangeType, setRangeType] = useState<DateFilterType>(initialRange);
  const [customStart, setCustomStart] = useState(initialRange === 'custom' ? initialStart : '');
  const [customEnd, setCustomEnd] = useState(initialRange === 'custom' ? initialEnd : '');
  const { rpcRangeType, startIso, endIso } = resolveReportRange(rangeType, customStart, customEnd);
  const ready = isReportRangeReady(rpcRangeType, startIso, endIso);

  const branchesQuery = useBranches();
  const remittanceQuery = useShiftRemittances(rpcRangeType, startIso, endIso);
  const summary = remittanceQuery.data !== undefined ? remittanceSummary(remittanceQuery.data) : null;
  const tenders = remittanceTenderTotals(remittanceQuery.data);
  const byBranch = useMemo(
    () => remittanceByBranch(remittanceQuery.data),
    [remittanceQuery.data],
  );
  const remittanceLoading = ready && remittanceQuery.isLoading;
  const kpiState = remittanceLoading || remittanceQuery.isError ? 'loading' : 'ready';
  const collectionsValue = remittanceSummaryAmountLabel(summary?.remitted, kpiState);
  const cashValue = remittanceSummaryAmountLabel(tenders.cash, kpiState);
  const gcashValue = remittanceSummaryAmountLabel(tenders.gcash, kpiState);

  const rows = useMemo(
    () =>
      (branchesQuery.data ?? [])
        .filter((branch) => !branch.is_main_branch && branch.is_active)
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name)),
    [branchesQuery.data],
  );

  return (
    <Screen
      refreshing={branchesQuery.isRefetching || remittanceQuery.isRefetching}
      onRefresh={() => {
        void branchesQuery.refetch();
        if (ready) void remittanceQuery.refetch();
      }}
      backgroundColor="#FFFFFF"
      edges={['top']}
      contentContainerStyle={styles.screen}
    >
      <ManagerScreenHeader title="Shift Remittances" showBack={!isManager} />
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

        <RemittanceSummaryCards
          combined={collectionsValue}
          pending={kpiState !== 'ready' ? '—' : (summary?.pendingShifts ?? 0)}
          reconciled={kpiState !== 'ready' ? '—' : (summary?.reconciledShifts ?? 0)}
          cash={cashValue}
          gcash={gcashValue}
          hasGcash={tenders.hasGcash}
        />

        {branchesQuery.error ? (
          <ErrorState
            message={getErrorMessage(branchesQuery.error)}
            onRetry={() => void branchesQuery.refetch()}
          />
        ) : null}
        {ready && remittanceQuery.error ? (
          <ErrorState
            message={getErrorMessage(remittanceQuery.error)}
            onRetry={() => void remittanceQuery.refetch()}
          />
        ) : null}
        {branchesQuery.isLoading ? <LoadingState label="Loading branches…" /> : null}

        {!branchesQuery.isLoading && !branchesQuery.error && rows.length === 0 ? (
          <EmptyState
            title="No selling branches"
            message="Create or activate a selling branch to view remittances."
          />
        ) : null}

        {!branchesQuery.isLoading && rows.length > 0 ? (
          <View style={styles.section}>
            <ReportSectionHeading title="BRANCHES" />
            {rows.map((branch) => {
              const cash = byBranch.get(branch.id);
              const amount = remittanceAmountLabel(cash?.remitted, kpiState);
              const emptyRemittance = amount === NO_REMITTANCE_RECORDED;
              return (
                <ListRowCard
                  key={branch.id}
                  icon="storefront-outline"
                  iconColor={accentForName(branch.name)}
                  title={branch.name}
                  subtitle={emptyRemittance ? amount : undefined}
                  trailing={
                    !emptyRemittance ? (
                      <CurrencyText
                        value={amount}
                        style={styles.amount}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.7}
                      />
                    ) : undefined
                  }
                  onPress={() =>
                    router.push(
                      shiftRemittanceBranchHref({
                        role,
                        branchId: branch.id,
                        rangeType,
                        customStart,
                        customEnd,
                      }) as never,
                    )
                  }
                  accessibilityLabel={`${branch.name} shift remittances`}
                  accessibilityHint="Opens remittances for this branch"
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
  amount: {
    color: managerColors.royalBlue,
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
    flexShrink: 1,
    textAlign: 'right',
  },
});
