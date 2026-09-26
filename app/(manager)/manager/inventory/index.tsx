import Ionicons from '@react-native-vector-icons/ionicons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { EmptyState, ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { Screen } from '@/components/Screen';
import { FilterChipRow } from '@/components/dashboard/FilterChipRow';
import { ListRowCard } from '@/components/dashboard/ListRowCard';
import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { ManagerBadge, type ManagerBadgeTone } from '@/components/dashboard/ManagerBadge';
import { ManagerBottomSheet as BottomSheet } from '@/components/dashboard/ManagerBottomSheet';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { SearchInput } from '@/components/dashboard/SearchInput';
import { SummaryCard } from '@/components/dashboard/SummaryCard';
import { managerColors } from '@/components/dashboard/theme';
import { useAuth } from '@/features/auth/AuthProvider';
import { isMainBranchManager } from '@/features/auth/roles';
import {
  filterEmptyMessage,
  getStockStatus,
  matchesStockFilter,
  type StockFilter,
} from '@/features/inventory/inventoryStatus';
import { useBranches } from '@/hooks/useBranches';
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
      return 'Not set';
  }
}

type SortOption = 'name-asc' | 'name-desc' | 'qty-desc' | 'qty-asc';

const SORT_OPTIONS: Array<{ label: string; value: SortOption }> = [
  { label: 'Name (A–Z)', value: 'name-asc' },
  { label: 'Name (Z–A)', value: 'name-desc' },
  { label: 'Quantity (High to Low)', value: 'qty-desc' },
  { label: 'Quantity (Low to High)', value: 'qty-asc' },
];

export default function ManagerInventoryScreen() {
  const { profile } = useAuth();
  const isMain = isMainBranchManager(profile);
  const branches = useBranches();
  const mainBranch = branches.data?.find((b) => b.is_main_branch);
  const branch = isMain ? mainBranch : profile?.branch;
  const query = useInventory(branch, !isMain);

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<StockFilter>('all');
  const [sort, setSort] = useState<SortOption>('name-asc');
  const [sortOpen, setSortOpen] = useState(false);
  const [selected, setSelected] = useState<InventoryItem | null>(null);

  const filtered = useMemo(() => {
    const items = query.data ?? [];
    const term = search.trim().toLowerCase();
    const rows = items.filter((item) => {
      if (!matchesStockFilter(item, filter)) return false;
      if (!term) return true;
      return `${item.product.name} ${item.product.sku}`.toLowerCase().includes(term);
    });
    return [...rows].sort((a, b) => {
      switch (sort) {
        case 'name-desc':
          return b.product.name.localeCompare(a.product.name);
        case 'qty-desc':
          return b.quantity_on_hand - a.quantity_on_hand;
        case 'qty-asc':
          return a.quantity_on_hand - b.quantity_on_hand;
        default:
          return a.product.name.localeCompare(b.product.name);
      }
    });
  }, [query.data, filter, search, sort]);

  const filterOptions = useMemo(() => {
    const base: Array<{ label: string; value: StockFilter }> = [
      { label: 'All', value: 'all' },
      { label: 'In stock', value: 'in_stock' },
      { label: 'Low', value: 'low' },
      { label: 'Out', value: 'out' },
    ];
    if (isMain) base.push({ label: 'Not set', value: 'not_set' });
    return base;
  }, [isMain]);

  const empty =
    filter === 'all' && !search.trim()
      ? {
          title: isMain ? 'No inventory found' : 'No inventory initialized',
          message: isMain ? 'Create active products, then initialize opening stock.' : 'Received products will appear here.',
        }
      : filterEmptyMessage(filter, Boolean(search.trim()));

  const title = isMain ? 'Main Inventory' : 'Inventory';
  const subtitle = isMain ? 'Main Branch' : (branch?.name ?? 'Assigned branch unavailable');

  if (isMain && branches.isLoading && !branches.data) {
    return (
      <Screen backgroundColor="#FFFFFF" edges={['top']} scroll={false} contentContainerStyle={styles.screenContent}>
        <ManagerScreenHeader title={title} subtitle="Main Branch" />
        <LoadingState label="Loading inventory…" />
      </Screen>
    );
  }

  if (isMain && branches.error) {
    return (
      <Screen backgroundColor="#FFFFFF" edges={['top']} scroll={false} contentContainerStyle={styles.screenContent}>
        <ManagerScreenHeader title={title} subtitle="Main Branch" />
        <ErrorState message={getErrorMessage(branches.error)} onRetry={() => void branches.refetch()} />
      </Screen>
    );
  }

  if (!branch) {
    return (
      <Screen backgroundColor="#FFFFFF" edges={['top']} scroll={false} contentContainerStyle={styles.screenContent}>
        <ManagerScreenHeader title={title} subtitle="Assigned branch unavailable" />
        <EmptyState
          title={isMain ? 'No Main Branch' : 'No assigned branch'}
          message={
            isMain
              ? 'Mark one active branch as the Main Branch first.'
              : 'Ask a Main Branch Manager to assign you to a branch.'
          }
        />
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
          <View style={styles.searchRow}>
            <View style={styles.searchField}>
              <SearchInput value={search} onChangeText={setSearch} placeholder="Search name or SKU" />
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Sort: ${SORT_OPTIONS.find((option) => option.value === sort)?.label}`}
              onPress={() => setSortOpen(true)}
              style={({ pressed }) => [styles.sortButton, pressed && styles.pressed]}
            >
              <Ionicons name="options-outline" size={20} color={managerColors.ink} />
            </Pressable>
          </View>
          <FilterChipRow options={filterOptions} value={filter} onChange={setFilter} />
        </View>

        {query.error ? (
          <ErrorState message={getErrorMessage(query.error)} onRetry={() => void query.refetch()} />
        ) : query.isLoading && !query.data ? (
          <LoadingState label="Loading inventory…" />
        ) : (
          <>
            <Text style={styles.resultsCount}>
              {filtered.length} {filtered.length === 1 ? 'product' : 'products'}
            </Text>
            <FlatList
              data={filtered}
              keyExtractor={(item) => item.product.id}
              contentContainerStyle={styles.listContent}
              refreshControl={<RefreshControl refreshing={Boolean(refreshing)} onRefresh={refresh} tintColor={managerColors.royalBlue} />}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
              ListEmptyComponent={<EmptyState title={empty.title} message={empty.message} />}
              renderItem={({ item }) => {
                const status = getStockStatus(item);
                return (
                  <ListRowCard
                    title={item.product.name}
                    subtitle={`${item.product.sku}${
                      !isMain && !item.branch_product?.is_active
                        ? ' · Not carried (return only)'
                        : ''
                    }`}
                    subtitleTag
                    trailing={
                      <ManagerBadge label={stockPillLabel(status, item.quantity_on_hand)} tone={badgeToneForStatus[status]} size="md" />
                    }
                    onPress={() => setSelected(item)}
                  />
                );
              }}
            />
          </>
        )}

        <View style={styles.footer}>
          {isMain ? (
            <View style={styles.footerRow}>
              <View style={styles.footerButton}>
                <ManagerActionButton
                  label="Send stock"
                  icon="paper-plane-outline"
                  onPress={() => router.push('/manager/transfers/create' as never)}
                />
              </View>
              <View style={styles.footerButton}>
                <ManagerActionButton
                  label="Opening stock"
                  variant="secondary"
                  onPress={() => router.push('/manager/inventory/setup' as never)}
                />
              </View>
            </View>
          ) : (
            <ManagerActionButton
              label="View returns"
              icon="return-up-back-outline"
              onPress={() => router.push('/manager/returns')}
            />
          )}
        </View>
      </ConstrainedWidth>

      <BottomSheet visible={selected != null} title="Stock details" onClose={() => setSelected(null)}>
        {selected ? (
          <View style={styles.detail}>
            <ListRowCard
              title={selected.product.name}
              subtitle={`${selected.product.sku}${
                !isMain && !selected.branch_product?.is_active
                  ? ' · Not carried (return only)'
                  : ''
              }`}
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
                {
                  label: isMain ? 'Base price' : 'Branch price',
                  value: selected.branch_product
                    ? formatMoney(selected.branch_product.selling_price)
                    : 'Not assigned',
                },
                {
                  label: 'Last updated',
                  value: selected.updated_at ? formatDate(selected.updated_at) : 'Not initialized',
                },
              ]}
            />
            {isMain ? (
              <ManagerActionButton
                label="Send stock"
                icon="paper-plane-outline"
                onPress={() => {
                  setSelected(null);
                  router.push('/manager/transfers/create' as never);
                }}
              />
            ) : (
              <ManagerActionButton
                label="View returns"
                icon="return-up-back-outline"
                onPress={() => {
                  setSelected(null);
                  router.push('/manager/returns');
                }}
              />
            )}
          </View>
        ) : null}
      </BottomSheet>

      <BottomSheet visible={sortOpen} title="Sort" onClose={() => setSortOpen(false)}>
        <View style={styles.sortList}>
          {SORT_OPTIONS.map((option) => {
            const isSelected = option.value === sort;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                onPress={() => {
                  setSort(option.value);
                  setSortOpen(false);
                }}
                style={({ pressed }) => [
                  styles.sortRow,
                  isSelected && styles.sortRowSelected,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.sortRowLabel, isSelected && styles.sortRowLabelSelected]}>
                  {option.label}
                </Text>
                {isSelected ? <Ionicons name="checkmark" size={20} color={managerColors.royalBlue} /> : null}
              </Pressable>
            );
          })}
        </View>
      </BottomSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenContent: { flexGrow: 1, padding: 0, gap: 0 },
  column: { flex: 1, paddingHorizontal: 20, paddingTop: 16 },
  filters: { gap: 12, marginBottom: 14 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  searchField: { flex: 1 },
  sortButton: {
    width: 46,
    height: 46,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    backgroundColor: managerColors.cardSurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.75 },
  sortList: { gap: 8, paddingBottom: 8 },
  sortRow: {
    minHeight: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  sortRowSelected: { borderColor: managerColors.royalBlue, backgroundColor: '#EAF0FB' },
  sortRowLabel: { color: managerColors.ink, fontFamily: 'Inter_500Medium', fontSize: 15, flex: 1 },
  sortRowLabelSelected: { color: managerColors.royalBlue, fontFamily: 'Inter_700Bold' },
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
    gap: 10,
    shadowColor: '#0A1224',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 4,
  },
  footerRow: { flexDirection: 'row', gap: 10 },
  footerButton: { flex: 1 },
  detail: { gap: 14, paddingBottom: 8 },
});
