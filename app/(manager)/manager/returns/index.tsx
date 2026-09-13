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
import { returnStatusBadgeLabel, returnStatusTone } from '@/components/dashboard/statusTone';
import { managerColors } from '@/components/dashboard/theme';
import { useAuth } from '@/features/auth/AuthProvider';
import type { StockReturnSummary } from '@/features/returns/ReturnListItem';
import { MANAGER_RETURN_STATUS_CHOICES, returnFilterEmptyMessage, type ReturnStatusFilter } from '@/features/returns/returnFilters';
import { useReturns } from '@/hooks/useReturns';
import { getErrorMessage } from '@/lib/errors';
import { formatDateShort } from '@/lib/format';

export default function ManagerReturnsScreen() {
  const { profile } = useAuth();
  const isMainBranch = Boolean(profile?.branch?.is_main_branch);
  const [status, setStatus] = useState<ReturnStatusFilter>('in_transit');
  const [search, setSearch] = useState('');
  const query = useReturns(profile?.branch_id ?? '', status);
  const returns = (query.data as StockReturnSummary[] | undefined) ?? [];

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return returns;
    return returns.filter((item) =>
      `${item.return_number} ${item.from_branch_name} ${item.to_branch_name}`.toLowerCase().includes(term),
    );
  }, [returns, search]);

  const empty =
    status === '' && !search.trim()
      ? { title: 'No returns yet', message: 'Create a return to send unsold stock to Main Branch.' }
      : returnFilterEmptyMessage(status, Boolean(search.trim()));

  if (!profile?.branch_id) {
    return (
      <Screen backgroundColor="#FFFFFF" edges={['top']} scroll={false} contentContainerStyle={styles.screenContent}>
        <ManagerScreenHeader title="Returns" subtitle="Assigned branch unavailable" />
        <EmptyState title="No assigned branch" message="Ask an owner to assign you to a branch." />
      </Screen>
    );
  }

  return (
    <Screen backgroundColor="#FFFFFF" edges={['top']} scroll={false} contentContainerStyle={styles.screenContent}>
      <ManagerScreenHeader title="Stock Returns" subtitle={profile.branch?.name ?? 'Unsold stock to Main Branch'} />

      <ConstrainedWidth style={styles.column}>
        <View style={styles.filters}>
          <SearchInput value={search} onChangeText={setSearch} placeholder="Search return # or branch" />
          <FilterChipRow options={MANAGER_RETURN_STATUS_CHOICES} value={status} onChange={setStatus} />
        </View>

        {query.error ? (
          <ErrorState message={getErrorMessage(query.error)} onRetry={() => void query.refetch()} />
        ) : query.isLoading && !query.data ? (
          <LoadingState label="Loading returns…" />
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
              const productCount = item.items[0]?.count ?? 0;
              return (
                <ListRowCard
                  title={item.return_number}
                  subtitle={`${item.from_branch_name} → ${item.to_branch_name}`}
                  meta={`${productCount} ${productCount === 1 ? 'item' : 'items'} · ${formatDateShort(item.returned_at)}`}
                  trailing={
                    <ManagerBadge label={returnStatusBadgeLabel(item.status)} tone={returnStatusTone(item.status)} size="md" />
                  }
                  onPress={() => router.push({ pathname: '/manager/returns/[id]', params: { id: item.id } })}
                />
              );
            }}
          />
        )}

        {!isMainBranch ? (
          <View style={styles.footer}>
            <ManagerActionButton
              label="Create return"
              icon="add-circle-outline"
              onPress={() => router.push('/manager/returns/create')}
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
  separator: { height: 10 },
  footer: { paddingTop: 12, paddingBottom: 16 },
});
