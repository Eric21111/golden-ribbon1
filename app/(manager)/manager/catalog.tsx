import Ionicons from '@react-native-vector-icons/ionicons';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { Pagination } from '@/components/Pagination';
import { Screen } from '@/components/Screen';
import { FilterChipRow } from '@/components/dashboard/FilterChipRow';
import { ManagerBottomSheet } from '@/components/dashboard/ManagerBottomSheet';
import { ManagerBadge } from '@/components/dashboard/ManagerBadge';
import { EmptyState, ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { SearchInput } from '@/components/dashboard/SearchInput';
import { SummaryCard } from '@/components/dashboard/SummaryCard';
import { managerColors } from '@/components/dashboard/theme';
import { MainBranchGuard } from '@/features/auth/MainBranchGuard';
import { CategoryIcon } from '@/features/products/CategoryIcon';
import {
  buildCatalogRows,
  catalogEmptyState,
  catalogSummary,
  posLines,
  type CatalogRow,
} from '@/features/products/branchCatalogRows';
import { categoryLabelOf } from '@/features/products/productFilters';
import { useBranches } from '@/hooks/useBranches';
import { useBranchProducts, useBranchVariantsForBranch } from '@/hooks/useBranchProducts';
import { useClientPagination } from '@/hooks/useClientPagination';
import { useProductIdsWithOptions, useProducts } from '@/hooks/useProducts';
import { getErrorMessage } from '@/lib/errors';
import { formatMoney } from '@/lib/format';

type SortOption = 'name-asc' | 'name-desc' | 'price-asc' | 'price-desc';

const SORT_OPTIONS: Array<{ label: string; value: SortOption }> = [
  { label: 'Name (A–Z)', value: 'name-asc' },
  { label: 'Name (Z–A)', value: 'name-desc' },
  { label: 'Price (Low to High)', value: 'price-asc' },
  { label: 'Price (High to Low)', value: 'price-desc' },
];

/** The whole card read out loud: name, price, whether it is in the cashier POS, then why not / what is off. */
function spokenCard(row: CatalogRow, branchName: string): string {
  const blockers = row.badges.map((badge) => badge.label.toLowerCase());
  return [row.product.name, row.priceText, `listed at ${branchName}`, row.inPos ? 'in POS' : 'not in POS', ...blockers].join(', ');
}

function CatalogDetails({ row, branchName }: { row: CatalogRow; branchName: string }) {
  return (
    <View style={styles.detail}>
      <View style={styles.detailHead}>
        <CategoryIcon category={row.product.product_category} size={28} />
        <View style={styles.detailHeadCopy}>
          <Text style={styles.detailName}>{row.product.name}</Text>
          <Text style={styles.meta}>
            {row.product.sku} · {categoryLabelOf(row.product) ?? 'Category not set'}
          </Text>
        </View>
      </View>
      <SummaryCard
        rows={[
          { label: 'Branch', value: branchName },
          { label: row.options.length > 0 ? 'Price range' : 'Branch price', value: row.priceText, emphasis: true },
          { label: 'Product', value: row.product.is_active ? 'Enabled' : 'Disabled', tone: row.product.is_active ? undefined : 'warning' },
          { label: 'Show in Cashier POS', value: row.product.sell_in_pos === false ? 'Off (stock only)' : 'On', tone: row.product.sell_in_pos === false ? 'warning' : undefined },
          { label: 'Cashier menu', value: row.inPos ? 'In POS' : 'Not in POS', tone: row.inPos ? undefined : 'warning' },
        ]}
      />
      {row.options.length > 0 ? (
        <SummaryCard
          title={`Options at ${branchName}`}
          rows={row.options.map((option) => ({
            label: option.name,
            value: option.active ? formatMoney(option.price) : `${formatMoney(option.price)} · off`,
            tone: option.active ? undefined : 'warning',
          }))}
        />
      ) : null}
      {posLines(row, branchName).map((line) => (
        <Text key={line} style={styles.detailLine}>
          {line}
        </Text>
      ))}
      <Text style={styles.note}>Read only. Change prices and product settings in Products.</Text>
    </View>
  );
}

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
  const branchVariants = useBranchVariantsForBranch(branchId);
  const productIdsWithOptions = useProductIdsWithOptions();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const branchName = sellingBranches.find((branch) => branch.id === branchId)?.name ?? 'this branch';

  useEffect(() => {
    if (!branchId && sellingBranches[0]) setBranchId(sellingBranches[0].id);
  }, [branchId, sellingBranches]);

  const visibleRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const rows = buildCatalogRows(products.data ?? [], catalog.data ?? [], branchVariants.data ?? [], productIdsWithOptions.data ?? []).filter(
      (row) => !term || `${row.product.name} ${row.product.sku}`.toLowerCase().includes(term),
    );

    return rows.sort((a, b) => {
      switch (sort) {
        case 'name-desc':
          return b.product.name.localeCompare(a.product.name);
        case 'price-asc':
          return a.lowPrice - b.lowPrice;
        case 'price-desc':
          return b.lowPrice - a.lowPrice;
        default:
          return a.product.name.localeCompare(b.product.name);
      }
    });
  }, [catalog.data, branchVariants.data, productIdsWithOptions.data, products.data, search, sort]);

  const selected = visibleRows.find((row) => row.product.id === selectedId) ?? null;

  const pagination = useClientPagination(visibleRows, `${branchId}|${search}|${sort}`, 10);

  const loading =
    branches.isLoading || products.isLoading || (Boolean(branchId) && (catalog.isLoading || branchVariants.isLoading)) ||
    productIdsWithOptions.isLoading;
  const loadError = branches.error ?? products.error ?? catalog.error ?? branchVariants.error ?? productIdsWithOptions.error;

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
            <View style={styles.summaryBlock}>
              <Text accessibilityLiveRegion="polite" style={styles.summary}>
                {catalogSummary(visibleRows, branchName)}
              </Text>
              <Text style={styles.note}>
                Listed means priced at this branch. "In POS" means it is on the cashier menu, which does not guarantee stock or recipe ingredients. Stock levels are not shown here.
              </Text>
            </View>
          ) : null}

          {loadError ? (
            <ErrorState
              message={getErrorMessage(loadError)}
              onRetry={() => {
                void branches.refetch();
                void products.refetch();
                void catalog.refetch();
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
            <FlatList
              data={pagination.pageItems}
              keyExtractor={(row) => row.product.id}
              contentContainerStyle={styles.list}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
              ListEmptyComponent={<EmptyState {...catalogEmptyState(branchName, Boolean(search.trim()))} />}
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
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={spokenCard(item, branchName)}
                  accessibilityHint="Opens branch details"
                  onPress={() => setSelectedId(item.product.id)}
                  style={({ pressed }) => [styles.card, pressed && styles.pressed]}
                >
                  <View style={styles.row}>
                    <CategoryIcon category={item.product.product_category} size={22} />
                    <Text style={styles.name} numberOfLines={2}>
                      {item.product.name}
                    </Text>
                    <Text style={styles.priceValue}>{item.priceText}</Text>
                  </View>
                  <Text style={styles.meta}>
                    {item.product.sku}
                    {item.options.length > 0 ? ` · ${item.activeOptionCount} ${item.activeOptionCount === 1 ? 'option' : 'options'}` : ''}
                  </Text>
                  {item.badges.length > 0 ? (
                    <View style={styles.badges}>
                      {item.badges.map((badge) => (
                        <ManagerBadge key={badge.key} label={badge.label} tone={badge.tone} />
                      ))}
                    </View>
                  ) : null}
                </Pressable>
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

        <ManagerBottomSheet visible={selected != null} title={`Listed at ${branchName}`} scroll onClose={() => setSelectedId(null)}>
          {selected ? <CatalogDetails row={selected} branchName={branchName} /> : null}
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
  summaryBlock: { gap: 2 },
  summary: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 13 },
  note: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 17 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  detail: { gap: 12 },
  detailHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  detailHeadCopy: { flex: 1, gap: 2 },
  detailName: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 17 },
  detailLine: { color: managerColors.ink, fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 18 },
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
  priceValue: { color: managerColors.royalBlue, fontFamily: 'Inter_700Bold', fontSize: 15, flexShrink: 0 },
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
