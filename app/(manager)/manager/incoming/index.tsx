import { router } from 'expo-router';

import { EmptyState, ErrorState, LoadingState } from '@/components/Feedback';
import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';
import { useAuth } from '@/features/auth/AuthProvider';
import { TransferListItem } from '@/features/transfers/TransferListItem';
import { useTransfers } from '@/hooks/useTransfers';
import { getErrorMessage } from '@/lib/errors';

export default function IncomingTransfersScreen() {
  const { profile } = useAuth();
  const query = useTransfers(profile?.branch_id ?? '');

  return (
    <Screen>
      <PageHeader title="Incoming transfers" subtitle={`Transfers assigned to ${profile?.branch?.name ?? 'your branch'}.`} />
      {query.isLoading ? <LoadingState label="Loading incoming transfers…" /> : null}
      {query.error ? <ErrorState message={getErrorMessage(query.error)} onRetry={() => void query.refetch()} /> : null}
      {query.data?.length === 0 ? <EmptyState title="No incoming transfers" message="Transfers sent to your branch will appear here." /> : null}
      {query.data?.map((transfer) => <TransferListItem key={transfer.id} transfer={transfer} onPress={() => router.push({ pathname: '/manager/incoming/[id]', params: { id: transfer.id } })} />)}
    </Screen>
  );
}
