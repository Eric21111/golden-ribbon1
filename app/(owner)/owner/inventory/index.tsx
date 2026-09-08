import { router } from 'expo-router';

import { InventoryHub } from '@/features/inventory/InventoryHub';
import { useBranches } from '@/hooks/useBranches';
import { useInventory } from '@/hooks/useInventory';
import { getErrorMessage } from '@/lib/errors';
import { EmptyState, ErrorState, LoadingState } from '@/components/Feedback';
import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';

export default function MainInventoryScreen() {
  const branches = useBranches();
  const mainBranch = branches.data?.find((branch) => branch.is_main_branch);
  const inventory = useInventory(mainBranch);

  if (branches.isLoading && !branches.data) {
    return (
      <Screen>
        <PageHeader title="Inventory" subtitle="Main Branch" />
        <LoadingState label="Loading inventory…" />
      </Screen>
    );
  }

  if (branches.error) {
    return (
      <Screen>
        <PageHeader title="Inventory" subtitle="Main Branch" />
        <ErrorState message={getErrorMessage(branches.error)} onRetry={() => void branches.refetch()} />
      </Screen>
    );
  }

  if (!mainBranch) {
    return (
      <Screen>
        <PageHeader title="Inventory" subtitle="Main Branch" />
        <EmptyState title="No Main Branch" message="Mark one active branch as the Main Branch first." />
      </Screen>
    );
  }

  return (
    <InventoryHub
      title="Inventory"
      subtitle="Main Branch"
      items={inventory.data}
      isLoading={inventory.isLoading}
      error={inventory.error ? getErrorMessage(inventory.error) : null}
      onRetry={() => void inventory.refetch()}
      onRefresh={() => {
        void branches.refetch();
        void inventory.refetch();
      }}
      isRefreshing={inventory.isRefetching || branches.isRefetching}
      defaultEmptyTitle="No inventory found"
      defaultEmptyMessage="Create active products, then initialize opening stock."
      primaryAction={{
        label: 'Send stock',
        onPress: () => router.push('/owner/transfers/create'),
      }}
      sheetPrimaryAction={{
        label: 'Send stock',
        onPress: () => router.push('/owner/transfers/create'),
      }}
      includeNotSetFilter
      enableMasterDetail={false}
      overflowActions={[
        { label: 'Set up opening stock', onPress: () => router.push('/owner/inventory/setup') },
        { label: 'Inventory history', onPress: () => router.push('/owner/movements') },
        { label: 'Inventory by branch', onPress: () => router.push('/owner/inventory-by-branch') },
        {
          label: 'Inventory reconciliation',
          onPress: () => router.push('/owner/reports/inventory-reconciliation' as any),
        },
      ]}
    />
  );
}
