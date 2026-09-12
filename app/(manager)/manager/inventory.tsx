import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { ManagerBottomSheet as BottomSheet } from '@/components/dashboard/ManagerBottomSheet';
import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { EmptyState, ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { Screen } from '@/components/Screen';
import { FilterChipRow } from '@/components/dashboard/FilterChipRow';
import { ListRowCard } from '@/components/dashboard/ListRowCard';
import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { ManagerBadge, type ManagerBadgeTone } from '@/components/dashboard/ManagerBadge';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { SearchInput } from '@/components/dashboard/SearchInput';
import { SummaryCard } from '@/components/dashboard/SummaryCard';
import { managerColors } from '@/components/dashboard/theme';
import { useAuth } from '@/features/auth/AuthProvider';
import {
  filterEmptyMessage,
  getStockStatus,
  matchesStockFilter,
  type StockFilter,
} from '@/features/inventory/inventoryStatus';
import { useInventory } from '@/hooks/useInventory';
import { getErrorMessage } from '@/lib/errors';
import { formatDate, formatMoney } from '@/lib/format';
import type { InventoryItem } from '@/types/models';

const badgeToneForStatus: Record<ReturnType<typeof getStockStatus>, ManagerBadgeTone> = {
  in_stock: 'success',
  low: 'warning',
  out: 'danger',
  not_set: 'neutral',
};

/** One pill communicates both quantity and urgency, instead of two stacked signals. */
function stockPillLabel(status: ReturnType<typeof getStockStatus>, quantity: number): string {
  switch (status) {
    case 'in_stock':
      return `${quantity} in stock`;
    case 'low':
      return `${quantity} left`;
    case 'out':
      return 'Out of stock';
    case 'not_set':
      return 'Not tracked';
  }
}

export default function ManagerInventoryScreen() {
  const { profile } = useAuth();
  const branch = profile?.branch;
  const query = useInventory(branch, true);

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<StockFilter>('all');
  const [selected, setSelected] = useState<InventoryItem | null>(null);

  const filtered = useMemo(() => {
    const items = query.data ?? [];
    const term = search.trim().toLowerCase();
    return items.filter((item) => {
      if (!matchesStockFilter(item, filter)) return false;
      if (!term) return true;
      return `${item.product.name} ${item.product.sku}`.toLowerCase().includes(term);
    });
  }, [query.data, filter, search]);

  const counts = useMemo(() => {
    const items = query.data ?? [];
    const result = { all: items.length, in_stock: 0, low: 0, out: 0 };
    for (const item of items) {
      const status = getStockStatus(item);
      if (status === 'in_stock' || status === 'low' || status === 'out') result[status] += 1;
    }
    return result;
  }, [query.data]);

  const filterOptions = useMemo(
    () =>
      [
        { label: `All ${counts.all}`, value: 'all' as const },
        { label: `In stock ${counts.in_stock}`, value: 'in_stock' as const },
        { label: `Low ${counts.low}`, value: 'low' as const },
        { label: `Out ${counts.out}`, value: 'out' as const },
      ] satisfies Array<{ label: string; value: StockFilter }>,
    [counts],
  );

  const empty =
    filter === 'all' && !search.trim()
      ? { title: 'No inventory initialized', message: 'Received products will appear here.' }
      : filterEmptyMessage(filter, Boolean(search.trim()));

  if (!branch) {
    return (
      <Screen backgroundColor="#FFFFFF" edges={['top']}>
        <ManagerScreenHeader title="Inventory" subtitle="Assigned branch unavailable" />
        <EmptyState title="No assigned branch" message="Ask an owner to assign you to a branch." />
      </Screen>
    );
  }

  return (
    <Screen backgroundColor="#FFFFFF" edges={['top']} scroll={false} contentContainerStyle={styles.screenContent}>
      <ManagerScreenHeader title="Inventory" subtitle={branch.name} />

      <ConstrainedWidth style={styles.column}>
        <View style={styles.filters}>
          <SearchInput value={search} onChangeText={setSearch} placeholder="Search name or SKU" />
          <FilterChipRow options={filterOptions} value={filter} onChange={setFilter} />
        </View>

        {query.error ? (
          <ErrorState message={getErrorMessage(query.error)} onRetry={() => void query.refetch()} />
        ) : query.isLoading && !query.data ? (
          <LoadingState label="Loading branch inventory…" />
        ) : (
          <>
            <Text style={styles.resultsCount}>
              {filtered.length} {filtered.length === 1 ? 'product' : 'products'}
            </Text>
            <FlatList
              data={filtered}
              keyExtractor={(item) => item.product.id}
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
                const status = getStockStatus(item);
                return (
                  <ListRowCard
                    title={item.product.name}
                    subtitle={item.product.sku}
                    subtitleTag
                    trailing={
                      <ManagerBadge
                        label={stockPillLabel(status, item.quantity_on_hand)}
                        tone={badgeToneForStatus[status]}
                        size="md"
                      />
                    }
                    onPress={() => setSelected(item)}
                  />
                );
              }}
            />
          </>
        )}

        <View style={styles.footer}>
          <ManagerActionButton
            label="Return unsold stock"
            icon="return-up-back-outline"
            onPress={() => router.push('/manager/returns/create')}
          />
        </View>
      </ConstrainedWidth>

      <BottomSheet visible={selected != null} title="Stock details" onClose={() => setSelected(null)}>
        {selected ? (
          <View style={styles.detail}>
            <ListRowCard
              title={selected.product.name}
              subtitle={selected.product.sku}
              subtitleTag
              trailing={
                <ManagerBadge
                  label={stockPillLabel(getStockStatus(selected), selected.quantity_on_hand)}
                  tone={badgeToneForStatus[getStockStatus(selected)]}
                  size="md"
                />
              }
            />
            <SummaryCard
              rows={[
                { label: 'On hand', value: `${selected.quantity_on_hand} units`, emphasis: true },
                { label: 'Selling price', value: formatMoney(selected.product.selling_price) },
                {
                  label: 'Last updated',
                  value: selected.updated_at ? formatDate(selected.updated_at) : 'Not initialized',
                },
              ]}
            />
            <ManagerActionButton
              label="Return unsold stock"
              icon="return-up-back-outline"
              onPress={() => {
                setSelected(null);
                router.push('/manager/returns/create');
              }}
            />
          </View>
        ) : null}
      </BottomSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenContent: { flexGrow: 1, padding: 0, gap: 0 },
  column: { flex: 1, paddingHorizontal: 20, paddingTop: 16 },
  filters: { gap: 12, marginBottom: 14 },
  resultsCount: {
    color: managerColors.subtext,
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    marginBottom: 10,
  },
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
  detail: { gap: 14, paddingBottom: 8 },
});
