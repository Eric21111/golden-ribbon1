import Ionicons, { type IoniconsIconName } from '@react-native-vector-icons/ionicons';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { FilterDropdown } from '@/components/FilterDropdown';
import { Screen } from '@/components/Screen';
import { EmptyState, ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { SearchInput } from '@/components/dashboard/SearchInput';
import { managerColors } from '@/components/dashboard/theme';
import { Pagination } from '@/components/Pagination';
import { InventoryListItem } from '@/features/inventory/InventoryListItem';
import {
  filterEmptyMessage,
  getStockStatus,
  matchesStockFilter,
  type StockFilter,
} from '@/features/inventory/inventoryStatus';
import { useBranches } from '@/hooks/useBranches';
import { useClientPagination } from '@/hooks/useClientPagination';
import { useInventory } from '@/hooks/useInventory';
import { getErrorMessage } from '@/lib/errors';

const STATUS_OPTIONS: Array<{ label: string; value: StockFilter }> = [
  { label: 'All', value: 'all' },
  { label: 'In Stock', value: 'in_stock' },
  { label: 'Low', value: 'low' },
  { label: 'Out', value: 'out' },
  { label: 'Not Set', value: 'not_set' },
];

function StockCountTile({
  icon,
  iconColor,
  chipColor,
  value,
  label,
}: {
  icon: IoniconsIconName;
  iconColor: string;
  chipColor: string;
  value: number;
  label: string;
}) {
  return (
    <View style={styles.countTile}>
      <View style={[styles.countIconChip, { backgroundColor: chipColor }]}>
        <Ionicons name={icon} size={18} color={iconColor} />
      </View>
      <Text style={[styles.countValue, { color: iconColor }]}>{value}</Text>
      <Text style={styles.countLabel}>{label}</Text>
    </View>
  );
}

export default function AllBranchInventoryScreen() {
  const branches = useBranches();
  const [branchId, setBranchId] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StockFilter>('all');

  useEffect(() => {
    if (!branchId && branches.data?.[0]) setBranchId(branches.data[0].id);
  }, [branchId, branches.data]);

  const selected = branches.data?.find((branch) => branch.id === branchId);
  const inventory = useInventory(selected);
  const items = inventory.data ?? [];

  const counts = useMemo(() => {
    let inStock = 0;
    let low = 0;
    let out = 0;
    for (const item of items) {
      const status = getStockStatus(item);
      if (status === 'in_stock') inStock += 1;
      else if (status === 'low') low += 1;
      else if (status === 'out') out += 1;
    }
    return { inStock, low, out };
  }, [items]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return items.filter(
      (item) =>
        matchesStockFilter(item, statusFilter) &&
        (query === '' ||
          item.product.name.toLowerCase().includes(query) ||
          item.product.sku.toLowerCase().includes(query))
    );
  }, [items, statusFilter, search]);

  const pagination = useClientPagination(filtered, `${branchId}|${statusFilter}|${search}`);
  const hasSearch = search.trim().length > 0;
  const empty = filterEmptyMessage(statusFilter, hasSearch);
  const branchOptions = (branches.data ?? []).map((branch) => ({ label: branch.name, value: branch.id }));

  return (
    <Screen backgroundColor="#FFFFFF" edges={['top']} contentContainerStyle={styles.screenContent}>
      <ConstrainedWidth>
        <ManagerScreenHeader showBack title="Inventory by branch" />
        <View style={styles.body}>
          {branches.isLoading || inventory.isLoading ? (
            <LoadingState label="Loading branch inventory…" />
          ) : null}
          {branches.error || inventory.error ? (
            <ErrorState message={getErrorMessage(branches.error ?? inventory.error)} />
          ) : null}

          <SearchInput value={search} onChangeText={setSearch} placeholder="Search name or SKU" />

          <View style={styles.filterRow}>
            <View style={styles.filterItem}>
              <FilterDropdown label="Branch" options={branchOptions} value={branchId} onChange={setBranchId} />
            </View>
            <View style={styles.filterItem}>
              <FilterDropdown label="Status" options={STATUS_OPTIONS} value={statusFilter} onChange={setStatusFilter} />
            </View>
          </View>

          {!inventory.isLoading && items.length === 0 ? (
            <EmptyState title="No inventory initialized" message="This branch has no product balances yet." />
          ) : (
            <>
              <View style={styles.summaryRow}>
                <StockCountTile
                  icon="checkmark-circle-outline"
                  iconColor="#166534"
                  chipColor="#DCFCE7"
                  value={counts.inStock}
                  label="In stock"
                />
                <StockCountTile
                  icon="alert-circle-outline"
                  iconColor="#92400E"
                  chipColor="#FEF3C7"
                  value={counts.low}
                  label="Low"
                />
                <StockCountTile
                  icon="close-circle-outline"
                  iconColor="#B91C1C"
                  chipColor="#FEE2E2"
                  value={counts.out}
                  label="Out"
                />
              </View>

              {pagination.pageItems.length === 0 ? (
                <EmptyState title={empty.title} message={empty.message} />
              ) : (
                <View style={styles.list}>
                  {pagination.pageItems.map((item) => (
                    <InventoryListItem key={item.product.id} item={item} />
                  ))}
                </View>
              )}

              {pagination.showPagination ? (
                <View style={styles.pager}>
                  <Pagination page={pagination.page} totalPages={pagination.totalPages} onPageChange={pagination.setPage} />
                </View>
              ) : null}
            </>
          )}
        </View>
      </ConstrainedWidth>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenContent: { flexGrow: 1, padding: 0, gap: 0 },
  body: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 32, gap: 14 },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  filterItem: { flexGrow: 1, flexBasis: 140, minWidth: 140 },
  summaryRow: { flexDirection: 'row', gap: 10 },
  countTile: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 14,
    padding: 12,
    gap: 4,
    shadowColor: '#0A1224',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 1,
  },
  countIconChip: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countValue: { fontFamily: 'Inter_700Bold', fontSize: 20 },
  countLabel: { fontFamily: 'Inter_500Medium', fontSize: 12, color: managerColors.subtext },
  list: { gap: 10 },
  pager: { paddingTop: 4 },
});
