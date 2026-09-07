import { router, useLocalSearchParams } from 'expo-router';

import { ErrorState, LoadingState } from '@/components/Feedback';
import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';
import { BranchForm } from '@/features/branches/BranchForm';
import type { BranchFormValues } from '@/features/branches/branchSchema';
import { useBranch, useUpdateBranch } from '@/hooks/useBranches';
import { getErrorMessage } from '@/lib/errors';

export default function EditBranchScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : '';
  const query = useBranch(id);
  const mutation = useUpdateBranch(id);

  if (query.isLoading) return <LoadingState label="Loading branch…" />;
  if (query.error || !query.data) return <Screen><ErrorState message={getErrorMessage(query.error)} onRetry={() => void query.refetch()} /></Screen>;

  const branch = query.data;
  const submit = (values: BranchFormValues) => {
    mutation.mutate({ ...values, address: values.address?.trim() || null }, { onSuccess: () => router.back() });
  };

  return (
    <Screen>
      <PageHeader title="Edit branch" subtitle="Use inactive status instead of deleting a branch." />
      <BranchForm
        defaultValues={{ name: branch.name, code: branch.code, address: branch.address ?? '', is_main_branch: branch.is_main_branch, is_active: branch.is_active }}
        submitLabel="Save changes"
        loading={mutation.isPending}
        error={mutation.error ? getErrorMessage(mutation.error) : undefined}
        onSubmit={submit}
      />
    </Screen>
  );
}
