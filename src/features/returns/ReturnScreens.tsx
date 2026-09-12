import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { EmptyState } from '@/components/Feedback';
import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';
import { useAuth } from '@/features/auth/AuthProvider';
import { isMainBranchManager } from '@/features/auth/roles';
import { useReturns } from '@/hooks/useReturns';
import { getErrorMessage } from '@/lib/errors';

import { ReturnHub } from './ReturnHub';
import type { StockReturnSummary } from './ReturnListItem';
import { ReturnDetailsBody } from './ReturnDetailPane';
import {
  MANAGER_RETURN_STATUS_CHOICES,
  OWNER_RETURN_STATUS_CHOICES,
  type ReturnStatusFilter,
} from './returnFilters';
export { returnStyles } from './returnStyles';

export function ReturnHistory({ role }: { role: 'owner' | 'manager' }) {
  const { profile } = useAuth();
  const isMainBranch = isMainBranchManager(profile);
  const [status, setStatus] = useState<ReturnStatusFilter>(
    role === 'manager' ? 'in_transit' : '',
  );

  const branchId = role === 'manager' && !isMainBranch ? (profile?.branch_id ?? '') : '';
  const query = useReturns(branchId, status);
  const returns = query.data as StockReturnSummary[] | undefined;

  if (role === 'manager' && !profile?.branch_id) {
    return (
      <Screen constrain>
        <PageHeader title="Returns" subtitle="Assigned branch unavailable" />
        <EmptyState title="No assigned branch" message="Ask a Main Branch Manager to assign you to a branch." />
      </Screen>
    );
  }

  return (
    <ReturnHub
      title={isMainBranch ? 'Return History' : 'Returns'}
      subtitle={
        isMainBranch
          ? 'Branches → Main Branch'
          : profile?.branch?.name ?? 'Unsold stock to Main Branch'
      }
      returns={returns}
      isLoading={query.isLoading}
      error={query.error ? getErrorMessage(query.error) : null}
      onRetry={() => void query.refetch()}
      onRefresh={() => void query.refetch()}
      isRefreshing={query.isRefetching}
      defaultEmptyTitle="No returns yet"
      defaultEmptyMessage={
        isMainBranch
          ? 'Confirmed stock returns will appear here.'
          : 'Create a return to send unsold stock to Main Branch.'
      }
      statusFilter={status}
      onStatusFilterChange={setStatus}
      statusChoices={isMainBranch ? OWNER_RETURN_STATUS_CHOICES : MANAGER_RETURN_STATUS_CHOICES}
      primaryAction={
        role === 'manager' && !isMainBranch
          ? {
              label: 'Create return',
              onPress: () => router.push('/manager/returns/create'),
            }
          : undefined
      }
      overflowActions={[]}
      onPressReturn={(stockReturn) =>
        router.push({ pathname: '/manager/returns/[id]', params: { id: stockReturn.id } })
      }
      enableMasterDetail
    />
  );
}

export function ReturnDetails() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const returnId = typeof id === 'string' ? id : '';

  return (
    <Screen constrain>
      <ReturnDetailsBody returnId={returnId} />
    </Screen>
  );
}
