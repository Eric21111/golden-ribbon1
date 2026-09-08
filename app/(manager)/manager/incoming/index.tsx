import { router } from 'expo-router';
import { useState } from 'react';

import { EmptyState } from '@/components/Feedback';
import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';
import { useAuth } from '@/features/auth/AuthProvider';
import { TransferHub } from '@/features/transfers/TransferHub';
import {
  MANAGER_STATUS_CHOICES,
  type TransferStatusFilter,
} from '@/features/transfers/transferFilters';
import { useTransfers } from '@/hooks/useTransfers';
import { getErrorMessage } from '@/lib/errors';

export default function IncomingTransfersScreen() {
  const { profile } = useAuth();
  const branchId = profile?.branch_id ?? '';
  const [status, setStatus] = useState<TransferStatusFilter>('pending_receipt');
  const query = useTransfers(branchId, status);

  if (!profile?.branch_id || !profile.branch) {
    return (
      <Screen>
        <PageHeader title="Incoming" subtitle="Assigned branch unavailable" />
        <EmptyState title="No assigned branch" message="Ask an owner to assign you to a branch." />
      </Screen>
    );
  }

  return (
    <TransferHub
      title="Incoming"
      subtitle={profile.branch.name}
      transfers={query.data}
      isLoading={query.isLoading}
      error={query.error ? getErrorMessage(query.error) : null}
      onRetry={() => void query.refetch()}
      onRefresh={() => void query.refetch()}
      isRefreshing={query.isRefetching}
      loadingLabel="Loading incoming transfers…"
      defaultEmptyTitle="No incoming transfers"
      defaultEmptyMessage="Transfers sent to your branch will appear here."
      statusFilter={status}
      onStatusFilterChange={setStatus}
      statusChoices={MANAGER_STATUS_CHOICES}
      showReceiveAction
      receiveActionLabel="Count & receive"
      onPressTransfer={(transfer) =>
        router.push({ pathname: '/manager/incoming/[id]', params: { id: transfer.id } })
      }
    />
  );
}
