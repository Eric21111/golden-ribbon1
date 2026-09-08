import { router } from 'expo-router';

import { EmptyState, LoadingState } from '@/components/Feedback';
import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';
import { useAuth } from '@/features/auth/AuthProvider';
import { InventoryHub } from '@/features/inventory/InventoryHub';
import { useInventory } from '@/hooks/useInventory';
import { getErrorMessage } from '@/lib/errors';

export default function ManagerInventoryScreen() {
  const { profile } = useAuth();
  const branch = profile?.branch;
  const query = useInventory(branch, true);

  if (!branch) {
    return (
      <Screen>
        <PageHeader title="Inventory" subtitle="Assigned branch unavailable" />
        <EmptyState title="No assigned branch" message="Ask an owner to assign you to a branch." />
      </Screen>
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
        { label: 'Inventory history', onPress: () => router.push('/manager/movements') },
      ]}
    />
  );
}
