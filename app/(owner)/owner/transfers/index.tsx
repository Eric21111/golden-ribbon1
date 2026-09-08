import { router } from 'expo-router';
import { useState } from 'react';

import { EmptyState, ErrorState, LoadingState } from '@/components/Feedback';
import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';
import { TransferHub } from '@/features/transfers/TransferHub';
import {
  OWNER_STATUS_CHOICES,
  type TransferStatusFilter,
} from '@/features/transfers/transferFilters';
import { useBranches } from '@/hooks/useBranches';
import { useTransfers } from '@/hooks/useTransfers';
import { getErrorMessage } from '@/lib/errors';

export default function TransferHistoryScreen() {
  const [branchId, setBranchId] = useState('');
  const [status, setStatus] = useState<TransferStatusFilter>('');
  const branches = useBranches();
  const sellingBranches = branches.data?.filter((branch) => !branch.is_main_branch) ?? [];
  const query = useTransfers(branchId, status);

  if (branches.isLoading && !branches.data) {
    return (
      <Screen>
        <PageHeader title="Transfers" subtitle="Main → branches" />
        <LoadingState label="Loading transfers…" />
      </Screen>
    );
  }

  if (branches.error) {
    return (
      <Screen>
        <PageHeader title="Transfers" subtitle="Main → branches" />
        <ErrorState message={getErrorMessage(branches.error)} onRetry={() => void branches.refetch()} />
      </Screen>
    );
  }

  if (sellingBranches.length === 0) {
    return (
      <Screen>
        <PageHeader title="Transfers" subtitle="Main → branches" />
        <EmptyState
          title="No destination branches"
          message="Add an active selling branch before creating transfers."
        />
      </Screen>
    );
  }

  return (
    <TransferHub
      title="Transfers"
      subtitle="Main → branches"
      transfers={query.data}
      isLoading={query.isLoading}
      error={query.error ? getErrorMessage(query.error) : null}
      onRetry={() => void query.refetch()}
      onRefresh={() => {
        void branches.refetch();
        void query.refetch();
      }}
      isRefreshing={query.isRefetching || branches.isRefetching}
      defaultEmptyTitle="No transfer history"
      defaultEmptyMessage="Create a transfer to send Main Branch stock."
      statusFilter={status}
      onStatusFilterChange={setStatus}
      statusChoices={OWNER_STATUS_CHOICES}
      destinationBranches={sellingBranches}
      destinationBranchId={branchId}
      onDestinationChange={setBranchId}
      primaryAction={{
        label: 'Create transfer',
        onPress: () => router.push('/owner/transfers/create'),
      }}
      enableMasterDetail={false}
      filterPresentation="dropdown"
      overflowActions={[
        {
          label: 'Transfer discrepancies',
          onPress: () => router.push('/owner/reports/transfer-discrepancies' as any),
        },
      ]}
      onPressTransfer={(transfer) =>
        router.push({ pathname: '/owner/transfers/[id]', params: { id: transfer.id } })
      }
    />
  );
}
