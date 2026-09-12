import { router } from 'expo-router';
import { useState } from 'react';

import { EmptyState, ErrorState, LoadingState } from '@/components/Feedback';
import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';
import { useAuth } from '@/features/auth/AuthProvider';
import { isMainBranchManager } from '@/features/auth/roles';
import { TransferHub } from '@/features/transfers/TransferHub';
import {
  MANAGER_STATUS_CHOICES,
  OWNER_STATUS_CHOICES,
  type TransferStatusFilter,
} from '@/features/transfers/transferFilters';
import { useBranches } from '@/hooks/useBranches';
import { useTransfers } from '@/hooks/useTransfers';
import { getErrorMessage } from '@/lib/errors';

export default function TransferHistoryScreen() {
  const { profile } = useAuth();
  const isMain = isMainBranchManager(profile);
  const [branchId, setBranchId] = useState('');
  const [status, setStatus] = useState<TransferStatusFilter>(isMain ? '' : 'pending_receipt');
  const branches = useBranches();
  const sellingBranches = branches.data?.filter((branch) => !branch.is_main_branch) ?? [];
  const query = useTransfers(isMain ? branchId : (profile?.branch_id ?? ''), status);

  if (!isMain && !profile?.branch_id) {
    return (
      <Screen>
        <PageHeader title="Transfer History" subtitle="Assigned branch unavailable" />
        <EmptyState title="No assigned branch" message="Ask a Main Branch Manager to assign you to a branch." />
      </Screen>
    );
  }

  if (isMain && branches.isLoading && !branches.data) {
    return (
      <Screen>
        <PageHeader title="Transfers" subtitle="Main → branches" />
        <LoadingState label="Loading transfers…" />
      </Screen>
    );
  }

  if (isMain && branches.error) {
    return (
      <Screen>
        <PageHeader title="Transfers" subtitle="Main → branches" />
        <ErrorState message={getErrorMessage(branches.error)} onRetry={() => void branches.refetch()} />
      </Screen>
    );
  }

  return (
    <TransferHub
      title={isMain ? 'Transfers' : 'Transfer History'}
      subtitle={isMain ? 'Main → branches' : profile?.branch?.name ?? 'Assigned branch'}
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
      defaultEmptyMessage={
        isMain
          ? 'Create a transfer to send Main Branch stock.'
          : 'Transfers sent to your branch will appear here.'
      }
      statusFilter={status}
      onStatusFilterChange={setStatus}
      statusChoices={isMain ? OWNER_STATUS_CHOICES : MANAGER_STATUS_CHOICES}
      destinationBranches={isMain ? sellingBranches : undefined}
      destinationBranchId={isMain ? branchId : undefined}
      onDestinationChange={isMain ? setBranchId : undefined}
      primaryAction={
        isMain
          ? {
              label: 'Create transfer',
              onPress: () => router.push('/manager/transfers/create' as never),
            }
          : undefined
      }
      enableMasterDetail={false}
      filterPresentation="dropdown"
      onPressTransfer={(transfer) =>
        router.push({ pathname: '/manager/transfers/[id]', params: { id: transfer.id } } as never)
      }
    />
  );
}
