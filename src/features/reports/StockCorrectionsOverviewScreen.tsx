import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { Screen } from '@/components/Screen';
import { ListRowCard } from '@/components/dashboard/ListRowCard';
import { EmptyState, ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { StatTile } from '@/components/dashboard/StatTile';
import { managerColors } from '@/components/dashboard/theme';
import { useAuth } from '@/features/auth/AuthProvider';
import { firstSearchParam, parseReportDateFilter } from '@/features/reports/branchHub';
import { CorrectionCoverageNotice } from '@/features/reports/CorrectionCoverageNotice';
import { DATE_RANGE_OPTIONS, DateRangeFilter, type DateFilterType } from '@/features/reports/DateRangeFilter';
import { OwnerSummaryKpiPair } from '@/features/reports/OwnerSummaryKpiPair';
import { ReportSectionHeading } from '@/features/reports/ReportSectionHeading';
import {
  buildCorrectionBranchRows,
  correctionBranchHref,
  correctionBranchMeta,
  correctionCoverage,
  correctionsInRange,
  netChangeText,
  summarizeCorrections,
} from '@/features/reports/stockCorrectionBranches';
import { correctionDateWindow } from '@/features/reports/stockCorrectionFilters';
import { useBranches } from '@/hooks/useBranches';
import { useStockCorrectionScan } from '@/hooks/useStockCorrectionScan';
import { getErrorMessage } from '@/lib/errors';
import { accentForName } from '@/lib/nameAccent';

function initialRangeFromParams(range: string, start: string, end: string): { rangeType: DateFilterType; customStart: string; customEnd: string } {
  const rangeType = range ? parseReportDateFilter(range) : 'all_time';
  return { rangeType, customStart: rangeType === 'custom' ? start : '', customEnd: rangeType === 'custom' ? end : '' };
}

function rangeLabel(rangeType: DateFilterType): string {
  if (rangeType === 'custom') return 'Custom range';
  return DATE_RANGE_OPTIONS.find((option) => option.value === rangeType)?.label ?? 'All Time';
}

/**
 * Stock corrections > All branches. Same flow and look as Void logs and Waste History: a date range, summary cards, then a compact
 * row per selling branch. A tap opens that branch's history with the same date range. The Owner and the Main Branch Manager see the
 * same branches (the Main Branch itself makes no corrections).
 */
export function StockCorrectionsOverviewScreen() {
  const { profile } = useAuth();
  const isManager = profile?.role === 'manager';
  const role = isManager ? 'manager' : 'owner';
  const params = useLocalSearchParams<{ range?: string | string[]; start?: string | string[]; end?: string | string[] }>();
  const initial = initialRangeFromParams(firstSearchParam(params.range), firstSearchParam(params.start), firstSearchParam(params.end));
  const [rangeType, setRangeType] = useState<DateFilterType>(initial.rangeType);
  const [customStart, setCustomStart] = useState(initial.customStart);
  const [customEnd, setCustomEnd] = useState(initial.customEnd);
  const filters = { rangeType, customStart, customEnd };
  const customIncomplete = rangeType === 'custom' && correctionDateWindow(filters) === null;

  const branchesQuery = useBranches();
  const scanQuery = useStockCorrectionScan();
  const scan = scanQuery.data;

  const inRange = useMemo(() => (scan && !customIncomplete ? correctionsInRange(scan.rows, filters) : []), [scan, customIncomplete, rangeType, customStart, customEnd]);
  const totals = useMemo(() => summarizeCorrections(inRange), [inRange]);
  const coverage = useMemo(() => correctionCoverage(scan, filters), [scan, rangeType, customStart, customEnd]);
  const branchRows = useMemo(
    () =>
      buildCorrectionBranchRows(
        (branchesQuery.data ?? []).map((branch) => ({ id: branch.id, name: branch.name, is_active: branch.is_active, is_main_branch: branch.is_main_branch })),
        inRange,
      ),
    [branchesQuery.data, inRange],
  );

  const loading = Boolean(profile) && (scanQuery.isPending || branchesQuery.isLoading);
  const failed = scanQuery.isError;
  const dash = loading || customIncomplete || failed;
  const value = (n: number) => (dash ? '—' : n);
  const partialCaption = !dash && !coverage.complete ? `Partial · newest ${coverage.loaded} only` : undefined;
  const unitCaption = !dash ? netChangeText(totals) || undefined : undefined;
  const ready = !customIncomplete;
  const showRows = ready && !loading && !failed && !branchesQuery.error;

  return (
    <Screen
      backgroundColor="#FFFFFF"
      edges={['top']}
      refreshing={scanQuery.isRefetching || branchesQuery.isRefetching}
      onRefresh={() => {
        void scanQuery.refetch();
        void branchesQuery.refetch();
      }}
      contentContainerStyle={styles.screen}
    >
      {/* the manager has this in the sidebar (menu icon), like Waste History; the owner drills in from Reports (back) */}
      <ManagerScreenHeader title="Stock corrections" showBack={!isManager} />
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
          icon="swap-vertical-outline"
          label="Stock corrections"
          value={value(totals.corrections)}
          caption={partialCaption ?? unitCaption}
        />
        <OwnerSummaryKpiPair
          left={{ icon: 'trending-up-outline', label: 'Increased stock', value: value(totals.increases), caption: partialCaption }}
          right={{ icon: 'trending-down-outline', label: 'Reduced stock', value: value(totals.decreases), caption: partialCaption }}
        />
        {partialCaption && coverage.note ? (
          <CorrectionCoverageNotice
            message={coverage.note}
            onLoadOlder={coverage.canLoadOlder ? scanQuery.loadOlder : undefined}
            loading={scanQuery.loadingOlder}
            error={scanQuery.olderError ? getErrorMessage(scanQuery.olderError) : null}
          />
        ) : null}

        {customIncomplete ? <EmptyState title="Select a date range" message="Enter both a start date and an end date to run this report." /> : null}

        {ready && failed ? <ErrorState message={getErrorMessage(scanQuery.error)} onRetry={() => void scanQuery.refetch()} /> : null}
        {ready && !failed && branchesQuery.error ? <ErrorState message={getErrorMessage(branchesQuery.error)} onRetry={() => void branchesQuery.refetch()} /> : null}
        {loading ? <LoadingState label="Loading stock corrections…" /> : null}

        {showRows && branchRows.length === 0 ? <EmptyState title="No selling branches" message="Create or activate a selling branch to view stock corrections." /> : null}

        {showRows && branchRows.length > 0 ? (
          <View style={styles.section}>
            <ReportSectionHeading title="BRANCHES" meta={`${rangeLabel(rangeType)}${coverage.complete ? '' : ` · newest ${coverage.loaded}`}`} />
            {branchRows.map((branch) => {
              const title = branch.isActive ? branch.branchName : `Inactive · ${branch.branchName}`;
              const text = correctionBranchMeta(branch.totals, coverage);
              const href = branch.branchId ? correctionBranchHref({ role, branchId: branch.branchId, rangeType, customStart, customEnd }) : null;
              return (
                <ListRowCard
                  key={branch.branchId ?? branch.branchName}
                  icon="storefront-outline"
                  iconColor={accentForName(branch.branchName)}
                  title={title}
                  subtitle={text.subtitle}
                  meta={text.meta}
                  trailing={<Text style={styles.count} numberOfLines={1}>{branch.totals.corrections}</Text>}
                  onPress={href ? () => router.push(href as never) : undefined}
                  accessibilityLabel={`${title}. ${text.subtitle}${text.meta ? `. ${text.meta}` : ''}${coverage.complete ? '' : '. Newest corrections only'}`}
                  accessibilityHint={href ? 'Opens stock corrections for this branch' : undefined}
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
  count: { color: managerColors.royalBlue, fontFamily: 'Inter_700Bold', fontSize: 16, minWidth: 28, textAlign: 'right' },
});
