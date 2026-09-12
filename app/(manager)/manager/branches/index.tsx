import { router } from 'expo-router';

import { MainBranchGuard } from '@/features/auth/MainBranchGuard';
import { BranchHub } from '@/features/branches/BranchHub';
import { useBranches } from '@/hooks/useBranches';
import { getErrorMessage } from '@/lib/errors';

export default function BranchListScreen() {
  const query = useBranches();

  return (
    <MainBranchGuard>
      <BranchHub
        branches={query.data}
        isLoading={query.isLoading}
        error={query.error ? getErrorMessage(query.error) : null}
        onRetry={() => void query.refetch()}
        onRefresh={() => void query.refetch()}
        isRefreshing={query.isRefetching}
        onPressBranch={(branch) =>
          router.push({ pathname: '/manager/branches/[id]', params: { id: branch.id } } as never)
        }
      />
    </MainBranchGuard>
  );
}
