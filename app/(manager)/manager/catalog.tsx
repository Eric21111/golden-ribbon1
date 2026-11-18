import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { stockUnit } from '@/lib/stockUnits';
import Ionicons from '@react-native-vector-icons/ionicons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { Pagination } from '@/components/Pagination';
import { Screen } from '@/components/Screen';
import { FilterChipRow } from '@/components/dashboard/FilterChipRow';
import { ListRowCard } from '@/components/dashboard/ListRowCard';
import { ManagerBottomSheet } from '@/components/dashboard/ManagerBottomSheet';
import { ManagerBadge } from '@/components/dashboard/ManagerBadge';
import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { EmptyState, ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { SearchInput } from '@/components/dashboard/SearchInput';
import { SummaryCard } from '@/components/dashboard/SummaryCard';
import { managerColors } from '@/components/dashboard/theme';
import { FilterIconButton, SortIconButton } from '@/components/dashboard/ToolbarIconButtons';
import { MainBranchGuard } from '@/features/auth/MainBranchGuard';
import { LOW_STOCK_THRESHOLD } from '@/features/inventory/inventoryStatus';
import { CategoryIcon } from '@/features/products/CategoryIcon';
import {
  buildCatalogRows,
  catalogEmptyState,
  posLines,
  type CatalogRow,
} from '@/features/products/branchCatalogRows';
import { categoryRowProps } from '@/features/products/productCategoryIndicator';
import { DEFAULT_LIST_FILTERS, type ListFilterKey } from '@/features/products/listFilters';
import { ListFiltersSheet, type ExtraListFilter } from '@/features/products/ProductFilterControls';
import {
  CATEGORY_CHIP_CHOICES,
  categoryLabelOf,
  categoryOf,
  type CategoryFilter,
} from '@/features/products/productFilters';
import { useBranches } from '@/hooks/useBranches';
import { useBranchProducts, useBranchVariantsForBranch } from '@/hooks/useBranchProducts';
import { useClientPagination } from '@/hooks/useClientPagination';
import { useProductIdsWithOptions, useProducts } from '@/hooks/useProducts';
import { alertNotice } from '@/lib/confirmAction';
import { getErrorMessage } from '@/lib/errors';
import { formatMoney } from '@/lib/format';
import type { Product } from '@/types/models';

const COLUMN_PADDING = 20;
const NO_LIST_FILTERS: ListFilterKey[] = [];

type StockPresenceFilter = 'all' | 'has_qty' | 'qty_zero' | 'in_stock' | 'low' | 'out';
type SortOption = 'stock-then-name' | 'name-asc' | 'name-desc' | 'qty-desc' | 'qty-asc';

const DEFAULT_SORT: SortOption = 'stock-then-name';

const STOCK_FILTER_OPTIONS: Array<{ label: string; value: StockPresenceFilter }> = [
  { label: 'All', value: 'all' },
  { label: 'Has qty', value: 'has_qty' },
  { label: 'Qty 0', value: 'qty_zero' },
  { label: 'In stock', value: 'in_stock' },
  { label: 'Low', value: 'low' },
  { label: 'Out', value: 'out' },
];

const SORT_OPTIONS: Array<{ label: string; value: SortOption }> = [
  { label: 'In stock first (A–Z)', value: 'stock-then-name' },
  { label: 'Name (A–Z)', value: 'name-asc' },
  { label: 'Name (Z–A)', value: 'name-desc' },
  { label: 'Quantity (High to Low)', value: 'qty-desc' },
  { label: 'Quantity (Low to High)', value: 'qty-asc' },
];

const CATEGORY_CHIPS = CATEGORY_CHIP_CHOICES.map((choice) => ({
  ...choice,
  leading: choice.value === 'all' ? undefined : <CategoryIcon category={choice.value} size={18} decorative />,
}));

type StockBalance = { available?: number; on_hand?: number; held?: number; sellable?: number | null };

type ListItem = {
  product: Product;
  catalog: CatalogRow | null;
  available: number;
};

function stockParts(balance: StockBalance | undefined, unit: string) {
  const available = Number(balance?.available ?? 0);
  const onHand = Number(balance?.on_hand ?? 0);
  const held = Number(balance?.held ?? 0);
  const sellable = balance?.sellable;
  return {
    available,
    onHand,
    held,
    sellable,
    availableLabel: `${available} ${unit}`,
  };
}

function matchesStockPresence(available: number, filter: StockPresenceFilter): boolean {
  switch (filter) {
    case 'has_qty':
      return available > 0;
    case 'qty_zero':
    case 'out':
      return available <= 0;
    case 'low':
      return available > 0 && available <= LOW_STOCK_THRESHOLD;
    case 'in_stock':
      return available > LOW_STOCK_THRESHOLD;
    default:
      return true;
  }
}

function compareListItems(a: ListItem, b: ListItem, sort: SortOption): number {
  const byName = a.product.name.localeCompare(b.product.name);
  switch (sort) {
    case 'name-desc':
      return b.product.name.localeCompare(a.product.name);
    case 'qty-desc':
      return b.available - a.available || byName;
    case 'qty-asc':
      return a.available - b.available || byName;
    case 'name-asc':
      return byName;
    default: {
      const stockRank = Number(b.available > 0) - Number(a.available > 0);
      return stockRank || byName;
    }
  }
}

function CatalogDetails({
  row,
  branchName,
  balance,
}: {
  row: CatalogRow;
  branchName: string;
  balance?: StockBalance;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const unit = stockUnit(row.product.stock_unit_code)?.plural ?? 'pcs';
  const stock = stockParts(balance, unit);
  return (
    <View style={styles.detail}>
      <View style={styles.detailHead}>
        <CategoryIcon category={row.product.product_category} size={40} />
        <View style={styles.detailHeadCopy}>
          <Text style={styles.detailName}>{row.product.name}</Text>
          <Text style={styles.meta}>
            {row.product.sku} · {categoryLabelOf(row.product) ?? 'Category not set'}
          </Text>
        </View>
      </View>
      <SummaryCard
        rows={[
          {
            label: row.options.length > 0 ? 'Price range' : 'Branch price',
            value: row.priceText,
            emphasis: true,
          },
          { label: 'Available', value: stock.availableLabel, emphasis: true },
        ]}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: moreOpen }}
        onPress={() => setMoreOpen((open) => !open)}
        style={({ pressed }) => [styles.moreToggle, pressed && styles.pressed]}
      >
        <Text style={styles.moreToggleLabel}>More details</Text>
        <Ionicons
          name={moreOpen ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={managerColors.subtext}
        />
      </Pressable>
      {moreOpen ? (
        <View style={styles.moreBody}>
          <Text style={styles.sectionLabel}>STOCK AT {branchName.toUpperCase()}</Text>
          <View style={styles.stockStrip}>
            <View style={styles.stockItem}>
              <Text style={styles.stockLabel}>On hand</Text>
              <Text style={styles.stockValue}>{stock.onHand}</Text>
            </View>
            <View style={styles.stockDivider} />
            <View style={styles.stockItem}>
              <Text style={styles.stockLabel}>Held</Text>
              <Text style={styles.stockValue}>{stock.held}</Text>
            </View>
            {stock.sellable != null ? (
              <>
                <View style={styles.stockDivider} />
                <View style={styles.stockItem}>
                  <Text style={styles.stockLabel}>Can sell</Text>
                  <Text style={styles.stockValue}>{stock.sellable}</Text>
                </View>
              </>
            ) : null}
          </View>

          <View style={styles.statusBlock}>
            <View style={styles.statusHeader}>
              <Text style={styles.sectionLabel}>STATUS</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="POS listing help"
                hitSlop={10}
                onPress={() => {
                  const lines = posLines(row, branchName);
                  alertNotice(
                    'Cashier POS',
                    lines.length > 0
                      ? lines.join('\n\n')
                      : 'Change prices and product settings in Products.',
                  );
                }}
                style={({ pressed }) => [styles.infoHit, pressed && styles.pressed]}
              >
                <Ionicons name="information-circle-outline" size={18} color={managerColors.royalBlue} />
              </Pressable>
            </View>
            <View style={styles.badgeRow}>
              <ManagerBadge
                label={row.product.is_active ? 'Enabled' : 'Disabled'}
                tone={row.product.is_active ? 'success' : 'warning'}
              />
              <ManagerBadge
                label={row.product.sell_in_pos === false ? 'Stock only' : 'Shown in POS'}
                tone={row.product.sell_in_pos === false ? 'warning' : 'info'}
              />
              <ManagerBadge
                label={row.inPos ? 'In menu' : 'Not in menu'}
                tone={row.inPos ? 'success' : 'warning'}
              />
            </View>
          </View>

          {row.options.length > 0 ? (
            <SummaryCard
              title={`OPTIONS AT ${branchName.toUpperCase()}`}
              rows={row.options.map((option) => ({
                label: option.name,
                value: option.active ? formatMoney(option.price) : `${formatMoney(option.price)} · off`,
                tone: option.active ? undefined : ('warning' as const),
              }))}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function paramValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

export default function BranchCatalogScreen() {
  const params = useLocalSearchParams<{ branchId?: string | string[] }>();
  const requestedBranchId = paramValue(params.branchId);
  const branches = useBranches();
  const products = useProducts();
  const sellingBranches = useMemo(
    () => (branches.data ?? []).filter((branch) => branch.is_active && !branch.is_main_branch),
    [branches.data],
  );
  const [branchId, setBranchId] = useState(requestedBranchId);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [stockFilter, setStockFilter] = useState<StockPresenceFilter>('all');
  const [sort, setSort] = useState<SortOption>(DEFAULT_SORT);
  const [sortOpen, setSortOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const catalog = useBranchProducts(branchId, false);
  const stock = useQuery({
    queryKey: ['inventory', 'manager-branch', branchId],
    enabled: !!branchId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('manager_branch_stock', { p_branch: branchId });
      if (error) throw error;
      return new Map((data ?? []).map((item) => [item.product_id, item as StockBalance]));
    },
  });
  const branchVariants = useBranchVariantsForBranch(branchId);
  const productIdsWithOptions = useProductIdsWithOptions();
  const { refetch: refreshCatalog } = catalog;
  const { refetch: refreshStock } = stock;
  const { refetch: refreshVariants } = branchVariants;
  const { refetch: refreshProducts } = products;
  const { refetch: refreshOptions } = productIdsWithOptions;
  useFocusEffect(
    useCallback(() => {
      if (branchId) void Promise.all([refreshCatalog(), refreshStock(), refreshVariants(), refreshProducts(), refreshOptions()]);
    }, [branchId, refreshCatalog, refreshStock, refreshVariants, refreshProducts, refreshOptions]),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const branchName = sellingBranches.find((branch) => branch.id === branchId)?.name ?? 'this branch';

  useEffect(() => {
    if (requestedBranchId && sellingBranches.some((branch) => branch.id === requestedBranchId)) {
      setBranchId(requestedBranchId);
      return;
    }
    if (!branchId && sellingBranches[0]) setBranchId(sellingBranches[0].id);
  }, [requestedBranchId, branchId, sellingBranches]);

  useEffect(() => {
    setSelectedId(null);
  }, [branchId]);

  const branchRow = useMemo<ExtraListFilter>(
    () => ({
      title: 'Branch',
      options: sellingBranches.map((branch) => ({ label: branch.name, value: branch.id })),
      value: branchId,
      onChange: (value) => {
        if (value === 'all') return;
        setBranchId(value);
      },
      countsAsFilter: false,
    }),
    [sellingBranches, branchId],
  );
  const stockRow = useMemo<ExtraListFilter>(
    () => ({
      title: 'Stock',
      options: STOCK_FILTER_OPTIONS,
      value: stockFilter,
      onChange: (value) => setStockFilter(value as StockPresenceFilter),
    }),
    [stockFilter],
  );
  const filterRows = useMemo(() => [branchRow, stockRow], [branchRow, stockRow]);

  const catalogRows = useMemo(
    () =>
      buildCatalogRows(
        products.data ?? [],
        catalog.data ?? [],
        branchVariants.data ?? [],
        productIdsWithOptions.data ?? [],
      ),
    [products.data, catalog.data, branchVariants.data, productIdsWithOptions.data],
  );

  const visibleRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const byId = new Map(catalogRows.map((row) => [row.product.id, row]));
    const productById = new Map((products.data ?? []).map((product) => [product.id, product]));
    const ids = new Set<string>([...byId.keys(), ...(stock.data?.keys() ?? [])]);

    const items: ListItem[] = [];
    for (const id of ids) {
      const catalogRow = byId.get(id) ?? null;
      const product = catalogRow?.product ?? productById.get(id);
      if (!product) continue;
      const available = Number(stock.data?.get(id)?.available ?? 0);
      if (category !== 'all' && categoryOf(product) !== category) continue;
      if (!matchesStockPresence(available, stockFilter)) continue;
      if (term && !`${product.name} ${product.sku}`.toLowerCase().includes(term)) continue;
      items.push({ product, catalog: catalogRow, available });
    }

    return items.sort((a, b) => compareListItems(a, b, sort));
  }, [catalogRows, products.data, stock.data, search, sort, category, stockFilter]);

  const selected = useMemo(
    () => (selectedId ? catalogRows.find((row) => row.product.id === selectedId) ?? null : null),
    [selectedId, catalogRows],
  );

  const pagination = useClientPagination(
    visibleRows,
    `${branchId}|${search}|${sort}|${category}|${stockFilter}`,
    10,
  );

  const loading =
    (!!branchId && stock.isLoading) ||
    branches.isLoading ||
    products.isLoading ||
    (Boolean(branchId) && (catalog.isLoading || branchVariants.isLoading)) ||
    productIdsWithOptions.isLoading;
  const loadError =
    stock.error ?? branches.error ?? products.error ?? catalog.error ?? branchVariants.error ?? productIdsWithOptions.error;

  const filterCount = stockFilter === 'all' ? 0 : 1;
  const hasActiveNarrowing = Boolean(search.trim()) || category !== 'all' || stockFilter !== 'all';

  return (
    <MainBranchGuard>
      <Screen backgroundColor="#FFFFFF" edges={['top']} scroll={false} contentContainerStyle={styles.screen}>
        <ManagerScreenHeader
          title="Branch Catalogs"
          subtitle={sellingBranches.length > 0 ? branchName : undefined}
          showBack
        />

        <ConstrainedWidth style={styles.column}>
          {sellingBranches.length > 0 ? (
            <View style={styles.filters}>
              <View style={styles.searchRow}>
                <View style={styles.searchField}>
                  <SearchInput
                    value={search}
                    onChangeText={setSearch}
                    placeholder="Search product…"
                  />
                </View>
                <FilterIconButton count={filterCount} onPress={() => setFiltersOpen(true)} />
                <SortIconButton
                  currentLabel={SORT_OPTIONS.find((option) => option.value === sort)?.label}
                  active={sort !== DEFAULT_SORT}
                  onPress={() => setSortOpen(true)}
                />
              </View>
              <FilterChipRow
                options={CATEGORY_CHIPS}
                value={category}
                onChange={setCategory}
                bleed={COLUMN_PADDING}
                keepSelectedVisible
              />
            </View>
          ) : null}

          {loadError ? (
            <ErrorState
              message={getErrorMessage(loadError)}
              onRetry={() => {
                void branches.refetch();
                void products.refetch();
                void catalog.refetch();
                void stock.refetch();
                void branchVariants.refetch();
                void productIdsWithOptions.refetch();
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
            <>
              <Text style={styles.resultsCount}>
                {visibleRows.length} {visibleRows.length === 1 ? 'product' : 'products'}
              </Text>
              <FlatList
                refreshing={stock.isRefetching}
                onRefresh={() => void stock.refetch()}
                data={pagination.pageItems}
                keyExtractor={(row) => row.product.id}
                contentContainerStyle={styles.list}
                ItemSeparatorComponent={() => <View style={styles.separator} />}
                ListEmptyComponent={
                  <View style={styles.empty}>
                    <EmptyState
                      {...(search.trim()
                        ? { title: 'No matching stock', message: 'Try another name.' }
                        : stockFilter !== 'all'
                          ? { title: 'No matching stock', message: 'Try another stock filter.' }
                          : category !== 'all'
                            ? { title: 'No matching stock', message: 'No stock in this category.' }
                            : catalogEmptyState(branchName, false))}
                    />
                    {!hasActiveNarrowing ? (
                      <ManagerActionButton
                        label="Go to Products"
                        variant="secondary"
                        style={styles.emptyAction}
                        onPress={() => router.push('/manager/products')}
                      />
                    ) : null}
                  </View>
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
                  <ListRowCard
                    {...categoryRowProps(item.product.product_category)}
                    title={item.product.name}
                    accessibilityLabel={`${item.product.name}, Qty ${item.available}`}
                    trailing={
                      <ManagerBadge
                        label={`Qty: ${item.available}`}
                        tone={item.available > 0 ? 'info' : 'neutral'}
                        size="md"
                      />
                    }
                    onPress={item.catalog ? () => setSelectedId(item.product.id) : undefined}
                  />
                )}
              />
            </>
          )}
        </ConstrainedWidth>

        <ListFiltersSheet
          visible={filtersOpen}
          filters={DEFAULT_LIST_FILTERS}
          keys={NO_LIST_FILTERS}
          extra={filterRows}
          onChange={() => undefined}
          onClose={() => setFiltersOpen(false)}
        />

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

        <ManagerBottomSheet
          visible={selected != null}
          title={`Listed at ${branchName}`}
          scroll
          onClose={() => setSelectedId(null)}
        >
          {selected ? (
            <CatalogDetails
              row={selected}
              branchName={branchName}
              balance={stock.data?.get(selected.product.id)}
            />
          ) : null}
        </ManagerBottomSheet>
      </Screen>
    </MainBranchGuard>
  );
}

const styles = StyleSheet.create({
  screen: { flexGrow: 1, padding: 0, gap: 0 },
  column: { flex: 1, paddingHorizontal: COLUMN_PADDING, paddingTop: 16 },
  filters: { gap: 12, marginBottom: 14 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  searchField: { flex: 1 },
  resultsCount: {
    color: managerColors.subtext,
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    marginBottom: 10,
  },
  pressed: { opacity: 0.75 },
  emptyAction: { paddingHorizontal: 28 },
  empty: { flex: 1, alignItems: 'center', gap: 4, paddingHorizontal: 24 },
  detail: { gap: 12 },
  detailHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  detailHeadCopy: { flex: 1, gap: 2, minWidth: 0 },
  detailName: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 17 },
  meta: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12.5 },
  list: { paddingBottom: 24, flexGrow: 1 },
  separator: { height: 12 },
  pager: { alignItems: 'center', gap: 4, paddingTop: 8 },
  moreToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  moreToggleLabel: {
    color: managerColors.ink,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
  moreBody: { gap: 12 },
  stockStrip: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 8,
  },
  stockItem: { flex: 1, alignItems: 'center', gap: 4, paddingHorizontal: 4 },
  stockDivider: { width: 1, backgroundColor: managerColors.cardBorder },
  stockLabel: {
    color: managerColors.subtext,
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
  },
  stockValue: {
    color: managerColors.ink,
    fontFamily: 'Inter_700Bold',
    fontSize: 18,
  },
  statusBlock: { gap: 8 },
  statusHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  infoHit: { padding: 2 },
  sectionLabel: {
    color: managerColors.subtext,
    fontFamily: 'Inter_700Bold',
    fontSize: 11,
    letterSpacing: 0.6,
  },
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
