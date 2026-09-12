import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { EmptyState, ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { Screen } from '@/components/Screen';
import { FilterChipRow } from '@/components/dashboard/FilterChipRow';
import { ListRowCard } from '@/components/dashboard/ListRowCard';
import { ManagerBadge } from '@/components/dashboard/ManagerBadge';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { SearchInput } from '@/components/dashboard/SearchInput';
import { managerColors } from '@/components/dashboard/theme';
import { transferStatusTone } from '@/components/dashboard/statusTone';
import { useAuth } from '@/features/auth/AuthProvider';
import { MANAGER_STATUS_CHOICES, transferFilterEmptyMessage, type TransferStatusFilter } from '@/features/transfers/transferFilters';
import { useTransfers } from '@/hooks/useTransfers';
import { getErrorMessage } from '@/lib/errors';
import { formatDate, formatTransferStatus } from '@/lib/format';

export default function IncomingTransfersScreen() {
  const { profile } = useAuth();
  const branchId = profile?.branch_id ?? '';
  const [status, setStatus] = useState<TransferStatusFilter>('pending_receipt');
  const [search, setSearch] = useState('');
  const query = useTransfers(branchId, status);

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
    status === '' && !search.trim()
      ? { title: 'No incoming transfers', message: 'Transfers sent to your branch will appear here.' }
      : transferFilterEmptyMessage(status, Boolean(search.trim()), false);

  if (!profile?.branch_id || !profile.branch) {
    return (
      <Screen backgroundColor="#FFFFFF" edges={['top']}>
        <ManagerScreenHeader title="Incoming" subtitle="Assigned branch unavailable" />
        <EmptyState title="No assigned branch" message="Ask an owner to assign you to a branch." />
      </Screen>
    );
  }

  return (
    <Screen backgroundColor="#FFFFFF" edges={['top']} scroll={false} contentContainerStyle={styles.screenContent}>
      <ManagerScreenHeader title="Incoming Transfers" subtitle={profile.branch.name} />

      <ConstrainedWidth style={styles.column}>
        <View style={styles.filters}>
          <SearchInput value={search} onChangeText={setSearch} placeholder="Search transfer # or branch" />
          <FilterChipRow options={MANAGER_STATUS_CHOICES} value={status} onChange={setStatus} />
        </View>

        {query.error ? (
          <ErrorState message={getErrorMessage(query.error)} onRetry={() => void query.refetch()} />
        ) : query.isLoading && !query.data ? (
          <LoadingState label="Loading incoming transfers…" />
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            refreshControl={
              <RefreshControl
                refreshing={query.isRefetching}
                onRefresh={() => void query.refetch()}
                tintColor={managerColors.royalBlue}
              />
            }
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            ListEmptyComponent={<EmptyState title={empty.title} message={empty.message} />}
            renderItem={({ item }) => {
              const productCount = item.items.length;
              return (
                <ListRowCard
                  icon="download-outline"
                  iconColor="blue"
                  title={item.transfer_number}
                  subtitle={`${item.from_branch?.name ?? 'Sending branch'} → ${item.to_branch?.name ?? 'Receiving branch'}`}
                  meta={`${productCount} ${productCount === 1 ? 'item' : 'items'} · ${formatDate(item.sent_at ?? item.created_at)}`}
                  trailing={<ManagerBadge label={formatTransferStatus(item.status)} tone={transferStatusTone(item.status)} />}
                  onPress={() => router.push({ pathname: '/manager/incoming/[id]', params: { id: item.id } })}
                />
              );
            }}
          />
        )}
      </ConstrainedWidth>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenContent: { flexGrow: 1, padding: 0, gap: 0 },
  column: { flex: 1, paddingHorizontal: 20, paddingTop: 16 },
  filters: { gap: 12, marginBottom: 14 },
  listContent: { paddingBottom: 16, flexGrow: 1 },
  separator: { height: 10 },
});
