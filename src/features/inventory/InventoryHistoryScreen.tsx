import { EmptyState, ErrorState, LoadingState } from '@/components/Feedback';
import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';
import { useInventoryMovements } from '@/hooks/useInventory';
import { getErrorMessage } from '@/lib/errors';
import { MovementListItem } from './MovementListItem';

export function InventoryHistoryScreen({ branchId = '', branchName }: { branchId?: string; branchName?: string }) {
  const query = useInventoryMovements(branchId);
  return (
    <Screen>
      <PageHeader title="Inventory history" subtitle={branchName ? `Signed movements for ${branchName}.` : 'Signed movements across all branches.'} />
      {query.isLoading ? <LoadingState label="Loading movements…" /> : null}
      {query.error ? <ErrorState message={getErrorMessage(query.error)} onRetry={() => void query.refetch()} /> : null}
      {query.data?.length === 0 ? <EmptyState title="No inventory history" message="Opening stock and transfer movements will appear here." /> : null}
      {query.data?.map((movement) => <MovementListItem key={movement.id} movement={movement} />)}
    </Screen>
  );
}
