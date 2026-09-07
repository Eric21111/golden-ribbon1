import { EmptyState, ErrorState, LoadingState } from '@/components/Feedback';
import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';
import { useAuth } from '@/features/auth/AuthProvider';
import { InventoryListItem } from '@/features/inventory/InventoryListItem';
import { useInventory } from '@/hooks/useInventory';
import { getErrorMessage } from '@/lib/errors';
import { router } from 'expo-router';
import { AppButton } from '@/components/AppButton';

export default function ManagerInventoryScreen() {
  const { profile } = useAuth();
  const query = useInventory(profile?.branch, true);

  return (
    <Screen>
      <PageHeader title="Branch inventory" subtitle={`${profile?.branch?.name ?? 'Assigned branch'} physical stock.`} />
      <AppButton label="Return unsold stock" onPress={() => router.push('/manager/returns/create')} />
      <AppButton label="Return history" variant="secondary" onPress={() => router.push('/manager/returns')} />
      {query.isLoading ? <LoadingState label="Loading branch inventory…" /> : null}
      {query.error ? <ErrorState message={getErrorMessage(query.error)} onRetry={() => void query.refetch()} /> : null}
      {query.data?.length === 0 ? <EmptyState title="No inventory initialized" message="Received products will appear here." /> : null}
      {query.data?.map((item) => <InventoryListItem key={item.product.id} item={item} />)}
    </Screen>
  );
}
