import { router } from 'expo-router';

import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';
import { BranchForm } from '@/features/branches/BranchForm';
import type { BranchFormValues } from '@/features/branches/branchSchema';
import { useCreateBranch } from '@/hooks/useBranches';
import { getErrorMessage } from '@/lib/errors';

export default function CreateBranchScreen() {
  const mutation = useCreateBranch();
  const submit = (values: BranchFormValues) => {
    mutation.mutate({ ...values, address: values.address?.trim() || null }, { onSuccess: () => router.back() });
  };

  return (
    <Screen>
      <PageHeader title="New branch" subtitle="Add a branch without creating inventory records yet." />
      <BranchForm submitLabel="Create branch" loading={mutation.isPending} error={mutation.error ? getErrorMessage(mutation.error) : undefined} onSubmit={submit} />
    </Screen>
  );
}
