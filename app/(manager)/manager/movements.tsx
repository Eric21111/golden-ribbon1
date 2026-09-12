import { useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { EmptyState, ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { Screen } from '@/components/Screen';
import { FilterChipRow } from '@/components/dashboard/FilterChipRow';
import { ListRowCard } from '@/components/dashboard/ListRowCard';
import { ManagerBadge } from '@/components/dashboard/ManagerBadge';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { managerColors } from '@/components/dashboard/theme';
import { useAuth } from '@/features/auth/AuthProvider';
import { useInventoryMovements } from '@/hooks/useInventory';
import { getErrorMessage } from '@/lib/errors';
import { formatDate, formatMovementType } from '@/lib/format';

export default function ManagerMovementsScreen() {
  const { profile } = useAuth();
  const branchId = profile?.branch_id ?? '';
  const query = useInventoryMovements(branchId);
  const [filterAccountId, setFilterAccountId] = useState('');

  const accountOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const movement of query.data ?? []) {
      const id = movement.created_by;
      const name = movement.created_by_profile?.full_name?.trim() || 'Employee';
      if (id && !map.has(id)) map.set(id, name);
    }
    return [
      { label: 'All Accounts', value: '' },
      ...[...map.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ label, value })),
    ];
  }, [query.data]);

  const filtered = useMemo(() => {
    return (query.data ?? []).filter((movement) => {
      if (filterAccountId && movement.created_by !== filterAccountId) return false;
      return true;
    });
  }, [query.data, filterAccountId]);

  return (
    <Screen backgroundColor="#FFFFFF" edges={['top']} scroll={false} contentContainerStyle={styles.screenContent}>
      <ManagerScreenHeader title="Inventory History" subtitle={`Signed movements for ${profile?.branch?.name ?? 'your branch'}`} />

      <ConstrainedWidth style={styles.column}>
        {accountOptions.length > 1 ? (
          <View style={styles.filters}>
            <FilterChipRow options={accountOptions} value={filterAccountId} onChange={setFilterAccountId} />
          </View>
        ) : null}

        {query.error ? (
          <ErrorState message={getErrorMessage(query.error)} onRetry={() => void query.refetch()} />
        ) : query.isLoading && !query.data ? (
          <LoadingState label="Loading movements…" />
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
            ListEmptyComponent={
              <EmptyState
                title="No inventory history"
                message={filterAccountId ? 'No movements match the selected filter.' : 'Opening stock and transfer movements will appear here.'}
              />
            }
            renderItem={({ item }) => (
              <ListRowCard
                icon="swap-vertical-outline"
                iconColor={item.quantity > 0 ? 'green' : 'gold'}
                title={item.product?.name ?? `Unavailable product (${item.product_id})`}
                subtitle={`${formatDate(item.created_at)} · ${item.created_by_profile?.full_name ?? 'Employee'}`}
                meta={item.transfer?.transfer_number ?? item.reference_type.replace('_', ' ')}
                trailing={
                  <View style={styles.trailing}>
                    <Text style={[styles.quantity, item.quantity > 0 ? styles.quantityPositive : styles.quantityNegative]}>
                      {item.quantity > 0 ? '+' : ''}
                      {item.quantity}
                    </Text>
                    <ManagerBadge label={formatMovementType(item.movement_type)} tone={item.quantity > 0 ? 'success' : 'warning'} />
                  </View>
                }
              />
            )}
          />
        )}
      </ConstrainedWidth>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenContent: { flexGrow: 1, padding: 0, gap: 0 },
  column: { flex: 1, paddingHorizontal: 20, paddingTop: 16 },
  filters: { marginBottom: 14 },
  listContent: { paddingBottom: 16, flexGrow: 1 },
  separator: { height: 10 },
  trailing: { alignItems: 'flex-end', gap: 4 },
  quantity: { fontFamily: 'Inter_700Bold', fontSize: 16 },
  quantityPositive: { color: managerColors.green },
  quantityNegative: { color: '#B91C1C' },
});
