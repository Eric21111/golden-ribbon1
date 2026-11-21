import { useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { Screen } from '@/components/Screen';
import { ErrorState } from '@/components/dashboard/ManagerFeedback';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { firstSearchParam, parseReportDateFilter } from '@/features/reports/branchHub';
import VoidLogsScreen from '@/features/reports/VoidLogsScreen';
import { useBranches } from '@/hooks/useBranches';
import { getErrorMessage } from '@/lib/errors';

export default function OwnerVoidLogsBranch() {
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
  const branchName = useMemo(
    () => (branches.data ?? []).find((branch) => branch.id === branchId)?.name,
    [branches.data, branchId],
  );

  if (branches.isError) {
    return (
      <Screen backgroundColor="#FFFFFF" edges={['top']}>
        <ManagerScreenHeader title="Void logs" showBack />
        <ConstrainedWidth>
          <ErrorState
            message={getErrorMessage(branches.error)}
            onRetry={() => void branches.refetch()}
          />
        </ConstrainedWidth>
      </Screen>
    );
  }

  return (
    <VoidLogsScreen
      branchId={branchId}
      branchName={branchName}
      branchLookupPending={Boolean(branchId) && !branchName && (branches.isPending || !branches.isFetched)}
      initialRangeType={initialRangeType}
      initialCustomStart={initialCustomStart}
      initialCustomEnd={initialCustomEnd}
    />
  );
}
