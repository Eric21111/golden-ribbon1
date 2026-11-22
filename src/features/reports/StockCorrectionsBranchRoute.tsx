import { useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { Screen } from '@/components/Screen';
import { ErrorState } from '@/components/dashboard/ManagerFeedback';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { firstSearchParam, parseReportDateFilter } from '@/features/reports/branchHub';
import StockCorrectionsScreen from '@/features/reports/StockCorrectionsScreen';
import { useBranches } from '@/hooks/useBranches';
import { getErrorMessage } from '@/lib/errors';

/**
 * The route body for Stock corrections > one branch (Owner and Main Branch Manager). It reads the branch and the date range from the
 * link, finds the branch in the branch list, and only a selling branch from that list is shown: an unknown id, or the Main Branch
 * (it makes no corrections), is "Branch not found" and never falls back to showing every branch's corrections.
 */
export function StockCorrectionsBranchRoute() {
  const params = useLocalSearchParams<{
    branchId?: string | string[];
    range?: string | string[];
    start?: string | string[];
    end?: string | string[];
  }>();
  const branchId = firstSearchParam(params.branchId) || undefined;
  const rangeParam = firstSearchParam(params.range);
  const initialRangeType = rangeParam ? parseReportDateFilter(rangeParam) : 'all_time';
  const initialCustomStart = initialRangeType === 'custom' ? firstSearchParam(params.start) : '';
  const initialCustomEnd = initialRangeType === 'custom' ? firstSearchParam(params.end) : '';
  const branches = useBranches();
  const branch = useMemo(() => (branches.data ?? []).find((item) => item.id === branchId), [branches.data, branchId]);
  const branchName = branch && !branch.is_main_branch ? branch.name : undefined;

  if (branches.isError) {
    return (
      <Screen backgroundColor="#FFFFFF" edges={['top']}>
        <ManagerScreenHeader title="Stock corrections" showBack />
        <ConstrainedWidth>
          <ErrorState message={getErrorMessage(branches.error)} onRetry={() => void branches.refetch()} />
        </ConstrainedWidth>
      </Screen>
    );
  }

  return (
    <StockCorrectionsScreen
      branchId={branchId}
      branchName={branchName}
      branchLookupPending={Boolean(branchId) && !branch && (branches.isPending || !branches.isFetched)}
      initialRangeType={initialRangeType}
      initialCustomStart={initialCustomStart}
      initialCustomEnd={initialCustomEnd}
    />
  );
}
