import { useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import VoidLogsScreen from '@/features/reports/VoidLogsScreen';
import { useBranches } from '@/hooks/useBranches';

export default function OwnerVoidLogsBranch() {
  const params = useLocalSearchParams<{ branchId?: string | string[] }>();
  const branchId = Array.isArray(params.branchId) ? params.branchId[0] : params.branchId;
  const branches = useBranches();
  const branchName = useMemo(
    () => (branches.data ?? []).find((branch) => branch.id === branchId)?.name,
    [branches.data, branchId],
  );

  return <VoidLogsScreen branchId={branchId} branchName={branchName} />;
}
