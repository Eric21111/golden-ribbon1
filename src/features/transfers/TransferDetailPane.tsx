import { ScrollView, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { EmptyState, ErrorState, LoadingState } from '@/components/Feedback';
import { masterDetailStyles } from '@/components/MasterDetailLayout';
import { useTransfer } from '@/hooks/useTransfers';

import { TransferDetailsView } from './TransferDetailsView';

type TransferDetailPaneProps = {
  transferId: string;
  /** Shown when transfer is pending receipt (e.g. manager receive). */
  receiveAction?: { label: string; onPress: () => void };
};

export function TransferDetailPane({ transferId, receiveAction }: TransferDetailPaneProps) {
  const query = useTransfer(transferId);

  if (query.isLoading) {
    return (
      <View style={masterDetailStyles.detailEmpty}>
        <LoadingState label="Loading transfer…" />
      </View>
    );
  }

  if (query.error || !query.data) {
    return (
      <View style={masterDetailStyles.detailEmpty}>
        <ErrorState message="Unable to load transfer." onRetry={() => void query.refetch()} />
      </View>
    );
  }

  const transfer = query.data;
  const showReceive = transfer.status === 'pending_receipt' && receiveAction;

  return (
    <ScrollView
      style={masterDetailStyles.detailScroll}
      contentContainerStyle={masterDetailStyles.detailContent}
      keyboardShouldPersistTaps="handled"
    >
      <TransferDetailsView transfer={transfer} />
      {showReceive ? (
        <AppButton label={receiveAction.label} onPress={receiveAction.onPress} />
      ) : null}
    </ScrollView>
  );
}

export function TransferDetailEmpty() {
  return (
    <View style={masterDetailStyles.detailEmpty}>
      <EmptyState title="Select a transfer" message="Choose a transfer from the list to view details." />
    </View>
  );
}
