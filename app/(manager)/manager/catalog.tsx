import Ionicons from '@react-native-vector-icons/ionicons';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { Pagination } from '@/components/Pagination';
import { Screen } from '@/components/Screen';
import { FilterChipRow } from '@/components/dashboard/FilterChipRow';
import { ManagerBottomSheet } from '@/components/dashboard/ManagerBottomSheet';
import { EmptyState, ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { SearchInput } from '@/components/dashboard/SearchInput';
import { managerColors } from '@/components/dashboard/theme';
import { MainBranchGuard } from '@/features/auth/MainBranchGuard';
import { useBranches } from '@/hooks/useBranches';
import { useBranchProducts } from '@/hooks/useBranchProducts';
import { useClientPagination } from '@/hooks/useClientPagination';
import { useProducts } from '@/hooks/useProducts';
import { getErrorMessage } from '@/lib/errors';
import { formatMoney } from '@/lib/format';

type SortOption = 'name-asc' | 'name-desc' | 'price-asc' | 'price-desc';

const SORT_OPTIONS: Array<{ label: string; value: SortOption }> = [
  { label: 'Name (A–Z)', value: 'name-asc' },
  { label: 'Name (Z–A)', value: 'name-desc' },
  { label: 'Price (Low to High)', value: 'price-asc' },
  { label: 'Price (High to Low)', value: 'price-desc' },
];

export default function BranchCatalogScreen() {
  const branches = useBranches();
  const products = useProducts();
  const sellingBranches = useMemo(
    () => (branches.data ?? []).filter((branch) => branch.is_active && !branch.is_main_branch),
    [branches.data],
  );
  const [branchId, setBranchId] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortOption>('name-asc');
  const [sortOpen, setSortOpen] = useState(false);
  const catalog = useBranchProducts(branchId, false);

  useEffect(() => {
    if (!branchId && sellingBranches[0]) setBranchId(sellingBranches[0].id);
  }, [branchId, sellingBranches]);

  const visibleRows = useMemo(() => {
    const byId = new Map((catalog.data ?? []).map((row) => [row.product_id, row]));
    const term = search.trim().toLowerCase();
    const rows = (products.data ?? [])
      .filter((product) => {
        const entry = byId.get(product.id);
        if (!entry?.is_active) return false;
        if (!term) return true;
        return `${product.name} ${product.sku}`.toLowerCase().includes(term);
      })
      .map((product) => ({
        product,
        entry: byId.get(product.id)!,
      }));

    return rows.sort((a, b) => {
      switch (sort) {
        case 'name-desc':
          return b.product.name.localeCompare(a.product.name);
        case 'price-asc':
          return a.entry.selling_price - b.entry.selling_price;
        case 'price-desc':
          return b.entry.selling_price - a.entry.selling_price;
        default:
          return a.product.name.localeCompare(b.product.name);
      }
    });
  }, [catalog.data, products.data, search, sort]);

  const pagination = useClientPagination(visibleRows, `${branchId}|${search}|${sort}`, 10);

  const loading =
    branches.isLoading || products.isLoading || (Boolean(branchId) && catalog.isLoading);
  const loadError = branches.error ?? products.error ?? catalog.error;

  return (
    <MainBranchGuard>
      <Screen backgroundColor="#FFFFFF" edges={['top']} scroll={false} contentContainerStyle={styles.screen}>
        <ManagerScreenHeader title="Branch Catalogs" showBack />

        <ConstrainedWidth style={styles.column}>
          {sellingBranches.length > 0 ? (
            <View style={styles.filters}>
              <View style={styles.searchRow}>
                <View style={styles.searchField}>
                  <SearchInput
                    value={search}
                    onChangeText={setSearch}
                    placeholder="Search product name or SKU"
                  />
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
              <FilterChipRow
                options={sellingBranches.map((branch) => ({
                  label: branch.name,
                  value: branch.id,
                }))}
                value={branchId}
                onChange={setBranchId}
              />
            </View>
          ) : null}

          {sellingBranches.length > 0 && !loading && !loadError ? (
            <Text style={styles.summary}>
              {visibleRows.length} {visibleRows.length === 1 ? 'product' : 'products'}
            </Text>
          ) : null}

          {loadError ? (
            <ErrorState
              message={getErrorMessage(loadError)}
              onRetry={() => {
                void branches.refetch();
                void products.refetch();
                void catalog.refetch();
              }}
            />
          ) : loading ? (
            <LoadingState label="Loading branch catalog…" />
          ) : sellingBranches.length === 0 ? (
            <EmptyState
              title="No active selling branches"
              message="Create or activate a selling branch before viewing its catalog."
            />
          ) : (
            <FlatList
              data={pagination.pageItems}
              keyExtractor={(row) => row.product.id}
              contentContainerStyle={styles.list}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
              ListEmptyComponent={
                <EmptyState
                  title="No available products"
                  message={
                    search.trim()
                      ? 'Try another name or SKU.'
                      : 'Send stock or set a branch price from Products to make items available here.'
                  }
                />
              }
              ListFooterComponent={
                pagination.showPagination ? (
                  <View style={styles.pager}>
                    <Pagination
                      page={pagination.page}
                      totalPages={pagination.totalPages}
                      onPageChange={pagination.setPage}
                    />
                  </View>
                ) : null
              }
              renderItem={({ item }) => (
                <View style={styles.card}>
                  <View style={styles.row}>
                    <Text style={styles.name} numberOfLines={2}>
                      {item.product.name}
                    </Text>
                    <Text style={styles.priceValue}>{formatMoney(item.entry.selling_price)}</Text>
                  </View>
                  <Text style={styles.meta}>{item.product.sku}</Text>
                </View>
              )}
            />
          )}
        </ConstrainedWidth>

        <ManagerBottomSheet visible={sortOpen} title="Sort" onClose={() => setSortOpen(false)}>
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
                  {isSelected ? (
                    <Ionicons name="checkmark" size={20} color={managerColors.royalBlue} />
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        </ManagerBottomSheet>
      </Screen>
    </MainBranchGuard>
  );
}

const styles = StyleSheet.create({
  screen: { flexGrow: 1, padding: 0, gap: 0 },
  column: { flex: 1, paddingHorizontal: 20, paddingTop: 16, gap: 12 },
  filters: { gap: 12 },
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
  summary: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 13 },
  list: { paddingBottom: 24, flexGrow: 1 },
  separator: { height: 10 },
  pager: { alignItems: 'center', gap: 4, paddingTop: 8 },
  card: {
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 16,
    padding: 14,
    gap: 4,
    backgroundColor: '#FFFFFF',
    shadowColor: '#0A1224',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 1,
  },
  row: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  name: { flex: 1, color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 15 },
  meta: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12.5 },
  priceValue: { color: managerColors.royalBlue, fontFamily: 'Inter_700Bold', fontSize: 15 },
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
});
