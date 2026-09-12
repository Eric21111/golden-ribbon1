import { useLocalSearchParams } from 'expo-router';

import { ErrorState, LoadingState } from '@/components/Feedback';
import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';
import { TransferDetailsView } from '@/features/transfers/TransferDetailsView';
import { useTransfer } from '@/hooks/useTransfers';
import { getErrorMessage } from '@/lib/errors';

export default function ManagerTransferDetailsScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : '';
  const query = useTransfer(id);
  if (query.isLoading) return <LoadingState label="Loading transfer…" />;
  if (query.error || !query.data) {
    return (
      <Screen constrain>
        <ErrorState
          message={getErrorMessage(query.error)}
          onRetry={() => void query.refetch()}
        />
      </Screen>
    );
  }
  return (
    <Screen constrain>
      <PageHeader title="Transfer details" />
      <TransferDetailsView transfer={query.data} />
    </Screen>
  );
}
