import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { EmptyState, ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { Screen } from '@/components/Screen';
import { FilterChipRow } from '@/components/dashboard/FilterChipRow';
import { ListRowCard } from '@/components/dashboard/ListRowCard';
import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { ManagerBadge } from '@/components/dashboard/ManagerBadge';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { SearchInput } from '@/components/dashboard/SearchInput';
import { transferStatusBadgeLabel, transferStatusTone } from '@/components/dashboard/statusTone';
import { managerColors } from '@/components/dashboard/theme';
import { useAuth } from '@/features/auth/AuthProvider';
import { isMainBranchManager } from '@/features/auth/roles';
import {
  MANAGER_STATUS_CHOICES,
  OWNER_STATUS_CHOICES,
  transferFilterEmptyMessage,
  type TransferStatusFilter,
} from '@/features/transfers/transferFilters';
import { useBranches } from '@/hooks/useBranches';
import { useTransfers } from '@/hooks/useTransfers';
import { getErrorMessage } from '@/lib/errors';
import { formatDateShort } from '@/lib/format';

export default function TransferHistoryScreen() {
  const { profile } = useAuth();
  const isMain = isMainBranchManager(profile);
  const [branchId, setBranchId] = useState('');
  const [status, setStatus] = useState<TransferStatusFilter>(isMain ? '' : 'pending_receipt');
  const [search, setSearch] = useState('');
  const branches = useBranches();
  const sellingBranches = branches.data?.filter((branch) => !branch.is_main_branch) ?? [];
  const query = useTransfers(isMain ? branchId : (profile?.branch_id ?? ''), status);

  const destinationOptions = useMemo(
    () => [{ label: 'All branches', value: '' }, ...sellingBranches.map((b) => ({ label: b.name, value: b.id }))],
    [sellingBranches],
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return query.data ?? [];
    return (query.data ?? []).filter((transfer) => {
      const haystack = [transfer.transfer_number, transfer.from_branch?.name ?? '', transfer.to_branch?.name ?? '']
        .join(' ')
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [query.data, search]);

  const empty =
    status === '' && !search.trim() && !branchId
      ? {
          title: 'No transfer history',
          message: isMain ? 'Create a transfer to send Main Branch stock.' : 'Transfers sent to your branch will appear here.',
        }
      : transferFilterEmptyMessage(status, Boolean(search.trim()), Boolean(branchId));

  const title = isMain ? 'Transfers' : 'Transfer History';
  const subtitle = isMain ? 'Main → branches' : (profile?.branch?.name ?? 'Assigned branch');

  if (!isMain && !profile?.branch_id) {
    return (
      <Screen backgroundColor="#FFFFFF" edges={['top']} scroll={false} contentContainerStyle={styles.screenContent}>
        <ManagerScreenHeader title="Transfer History" subtitle="Assigned branch unavailable" />
        <EmptyState title="No assigned branch" message="Ask a Main Branch Manager to assign you to a branch." />
      </Screen>
    );
  }

  if (isMain && branches.isLoading && !branches.data) {
    return (
      <Screen backgroundColor="#FFFFFF" edges={['top']} scroll={false} contentContainerStyle={styles.screenContent}>
        <ManagerScreenHeader title={title} subtitle={subtitle} />
        <LoadingState label="Loading transfers…" />
      </Screen>
    );
  }

  if (isMain && branches.error) {
    return (
      <Screen backgroundColor="#FFFFFF" edges={['top']} scroll={false} contentContainerStyle={styles.screenContent}>
        <ManagerScreenHeader title={title} subtitle={subtitle} />
        <ErrorState message={getErrorMessage(branches.error)} onRetry={() => void branches.refetch()} />
      </Screen>
    );
  }

  const refresh = () => {
    if (isMain) void branches.refetch();
    void query.refetch();
  };
  const refreshing = query.isRefetching || (isMain && branches.isRefetching);

  return (
    <Screen backgroundColor="#FFFFFF" edges={['top']} scroll={false} contentContainerStyle={styles.screenContent}>
      <ManagerScreenHeader title={title} subtitle={subtitle} />

      <ConstrainedWidth style={styles.column}>
        <View style={styles.filters}>
          <SearchInput value={search} onChangeText={setSearch} placeholder="Search transfer # or branch" />
          <FilterChipRow options={isMain ? OWNER_STATUS_CHOICES : MANAGER_STATUS_CHOICES} value={status} onChange={setStatus} />
          {isMain ? <FilterChipRow options={destinationOptions} value={branchId} onChange={setBranchId} /> : null}
        </View>

        {query.error ? (
          <ErrorState message={getErrorMessage(query.error)} onRetry={() => void query.refetch()} />
        ) : query.isLoading && !query.data ? (
          <LoadingState label="Loading transfers…" />
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            refreshControl={<RefreshControl refreshing={Boolean(refreshing)} onRefresh={refresh} tintColor={managerColors.royalBlue} />}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            ListEmptyComponent={<EmptyState title={empty.title} message={empty.message} />}
            renderItem={({ item }) => {
              const productCount = item.items.length;
              return (
                <ListRowCard
                  title={item.transfer_number}
                  subtitle={`${item.from_branch?.name ?? 'Sending branch'} → ${item.to_branch?.name ?? 'Receiving branch'}`}
                  meta={`${productCount} ${productCount === 1 ? 'item' : 'items'} · ${formatDateShort(item.sent_at ?? item.created_at)}`}
                  trailing={
                    <ManagerBadge label={transferStatusBadgeLabel(item.status)} tone={transferStatusTone(item.status)} size="md" />
                  }
                  onPress={() => router.push({ pathname: '/manager/transfers/[id]', params: { id: item.id } } as never)}
                />
              );
            }}
          />
        )}

        {isMain ? (
          <View style={styles.footer}>
            <ManagerActionButton
              label="Create transfer"
              icon="add-circle-outline"
              onPress={() => router.push('/manager/transfers/create' as never)}
            />
          </View>
        ) : null}
      </ConstrainedWidth>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenContent: { flexGrow: 1, padding: 0, gap: 0 },
  column: { flex: 1, paddingHorizontal: 20, paddingTop: 16 },
  filters: { gap: 12, marginBottom: 14 },
  listContent: { paddingBottom: 12, flexGrow: 1 },
  separator: { height: 12 },
  footer: {
    marginHorizontal: -20,
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 16,
    borderTopWidth: 1,
    borderTopColor: managerColors.cardBorder,
    backgroundColor: '#FFFFFF',
    shadowColor: '#0A1224',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 4,
  },
});
