import { router } from 'expo-router';

import { BranchHub } from '@/features/branches/BranchHub';
import { useBranches } from '@/hooks/useBranches';
import { getErrorMessage } from '@/lib/errors';

export default function BranchListScreen() {
  const query = useBranches();

  return (
    <BranchHub
      branches={query.data}
      isLoading={query.isLoading}
      error={query.error ? getErrorMessage(query.error) : null}
      onRetry={() => void query.refetch()}
      onRefresh={() => void query.refetch()}
      isRefreshing={query.isRefetching}
      onPressBranch={(branch) =>
        router.push({ pathname: '/owner/branches/[id]', params: { id: branch.id } })
      }
    />
  );
}
