import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { EmptyState, ErrorState, LoadingState } from '@/components/Feedback';
import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';
import { colors, spacing } from '@/constants/theme';
import { BranchSelector } from '@/features/inventory/BranchSelector';
import { TransferListItem } from '@/features/transfers/TransferListItem';
import { useBranches } from '@/hooks/useBranches';
import { useTransfers } from '@/hooks/useTransfers';
import { getErrorMessage } from '@/lib/errors';
import type { TransferStatus } from '@/types/models';

const statuses: Array<{ label: string; value: TransferStatus | '' }> = [
  { label: 'All statuses', value: '' },
  { label: 'Pending', value: 'pending_receipt' },
  { label: 'Received', value: 'received' },
  { label: 'Discrepancy', value: 'received_with_discrepancy' },
];

export default function TransferHistoryScreen() {
  const [branchId, setBranchId] = useState('');
  const [status, setStatus] = useState<TransferStatus | ''>('');
  const branches = useBranches();
  const sellingBranches = branches.data?.filter((branch) => !branch.is_main_branch) ?? [];
  const query = useTransfers(branchId, status);

  return (
    <Screen>
      <PageHeader title="Stock transfers" subtitle="Main Branch distribution history and receipt status." />
      <AppButton label="Create transfer" onPress={() => router.push('/owner/transfers/create')} />
      <Text style={styles.filterLabel}>Destination</Text>
      <BranchSelector branches={sellingBranches} value={branchId} onChange={setBranchId} allowAll />
      <Text style={styles.filterLabel}>Status</Text>
      <View style={styles.statuses}>
        {statuses.map((item) => <AppButton key={item.label} label={item.label} variant={status === item.value ? 'primary' : 'secondary'} onPress={() => setStatus(item.value)} style={styles.filterButton} />)}
      </View>
      {query.isLoading ? <LoadingState label="Loading transfers…" /> : null}
      {query.error ? <ErrorState message={getErrorMessage(query.error)} onRetry={() => void query.refetch()} /> : null}
      {query.data?.length === 0 ? <EmptyState title="No transfer history" message="Create a transfer or change the current filters." /> : null}
      {query.data?.map((transfer) => <TransferListItem key={transfer.id} transfer={transfer} onPress={() => router.push({ pathname: '/owner/transfers/[id]', params: { id: transfer.id } })} />)}
    </Screen>
  );
}

const styles = StyleSheet.create({
  filterLabel: { color: colors.text, fontSize: 14, fontWeight: '700' },
  statuses: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  filterButton: { minHeight: 42 },
});
