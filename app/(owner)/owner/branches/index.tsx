import { router } from 'expo-router';

import { AppButton } from '@/components/AppButton';
import { EmptyState, ErrorState, LoadingState } from '@/components/Feedback';
import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';
import { BranchListItem } from '@/features/branches/BranchListItem';
import { useBranches } from '@/hooks/useBranches';
import { getErrorMessage } from '@/lib/errors';

export default function BranchListScreen() {
  const query = useBranches();

  return (
    <Screen>
      <PageHeader title="Branches" subtitle="Main and selling branch master data." />
      <AppButton label="Create branch" onPress={() => router.push('/owner/branches/create')} />
      {query.isLoading ? <LoadingState label="Loading branches…" /> : null}
      {query.error ? <ErrorState message={getErrorMessage(query.error)} onRetry={() => void query.refetch()} /> : null}
      {query.data?.length === 0 ? <EmptyState title="No branches yet" message="Create the Main Branch to get started." /> : null}
      {query.data?.map((branch) => <BranchListItem key={branch.id} branch={branch} onPress={() => router.push({ pathname: '/owner/branches/[id]', params: { id: branch.id } })} />)}
    </Screen>
  );
}
