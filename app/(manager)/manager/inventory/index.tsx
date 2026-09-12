import { router } from 'expo-router';

import { EmptyState, ErrorState, LoadingState } from '@/components/Feedback';
import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';
import { useAuth } from '@/features/auth/AuthProvider';
import { isMainBranchManager } from '@/features/auth/roles';
import { InventoryHub } from '@/features/inventory/InventoryHub';
import { useBranches } from '@/hooks/useBranches';
import { useInventory } from '@/hooks/useInventory';
import { getErrorMessage } from '@/lib/errors';

export default function ManagerInventoryScreen() {
  const { profile } = useAuth();
  const isMain = isMainBranchManager(profile);
  const branches = useBranches();
  const mainBranch = branches.data?.find((branch) => branch.is_main_branch);
  const branch = isMain ? mainBranch : profile?.branch;
  const query = useInventory(branch, !isMain);

  if (isMain && branches.isLoading && !branches.data) {
    return (
      <Screen>
        <PageHeader title="Main Inventory" subtitle="Main Branch" />
        <LoadingState label="Loading inventory…" />
      </Screen>
    );
  }

  if (isMain && branches.error) {
    return (
      <Screen>
        <PageHeader title="Main Inventory" subtitle="Main Branch" />
        <ErrorState message={getErrorMessage(branches.error)} onRetry={() => void branches.refetch()} />
      </Screen>
    );
  }

  if (!branch) {
    return (
      <Screen>
        <PageHeader title={isMain ? 'Main Inventory' : 'Inventory'} subtitle="Assigned branch unavailable" />
        <EmptyState
          title={isMain ? 'No Main Branch' : 'No assigned branch'}
          message={
            isMain
              ? 'Mark one active branch as the Main Branch first.'
              : 'Ask a Main Branch Manager to assign you to a branch.'
          }
        />
      </Screen>
    );
  }

  if (isMain) {
    return (
      <InventoryHub
        title="Main Inventory"
        subtitle="Main Branch"
        items={query.data}
        isLoading={query.isLoading}
        error={query.error ? getErrorMessage(query.error) : null}
        onRetry={() => void query.refetch()}
        onRefresh={() => {
          void branches.refetch();
          void query.refetch();
        }}
        isRefreshing={query.isRefetching || branches.isRefetching}
        defaultEmptyTitle="No inventory found"
        defaultEmptyMessage="Create active products, then initialize opening stock."
        primaryAction={{
          label: 'Send stock',
          onPress: () => router.push('/manager/transfers/create' as never),
        }}
        sheetPrimaryAction={{
          label: 'Send stock',
          onPress: () => router.push('/manager/transfers/create' as never),
        }}
        includeNotSetFilter
        enableMasterDetail={false}
        overflowActions={[
          { label: 'Set up opening stock', onPress: () => router.push('/manager/inventory/setup' as never) },
        ]}
      />
    );
  }

  return (
    <InventoryHub
      title="Inventory"
      subtitle={branch.name}
      items={query.data}
      isLoading={query.isLoading}
      error={query.error ? getErrorMessage(query.error) : null}
      onRetry={() => void query.refetch()}
      onRefresh={() => void query.refetch()}
      isRefreshing={query.isRefetching}
      loadingLabel="Loading branch inventory…"
      defaultEmptyTitle="No inventory initialized"
      defaultEmptyMessage="Received products will appear here."
      primaryAction={{
        label: 'Return unsold stock',
        onPress: () => router.push('/manager/returns/create'),
      }}
      sheetPrimaryAction={{
        label: 'Return unsold stock',
        onPress: () => router.push('/manager/returns/create'),
      }}
      overflowActions={[
        { label: 'Return history', onPress: () => router.push('/manager/returns') },
        { label: 'Transfer history', onPress: () => router.push('/manager/transfers' as never) },
      ]}
    />
  );
}
