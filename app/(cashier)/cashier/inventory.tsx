import { useCallback, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useQuery } from '@tanstack/react-query';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { Pagination } from '@/components/Pagination';
import { Screen } from '@/components/Screen';
import { FilterChipRow } from '@/components/dashboard/FilterChipRow';
import { ListRowCard } from '@/components/dashboard/ListRowCard';
import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { ManagerBadge } from '@/components/dashboard/ManagerBadge';
import { ManagerBottomSheet } from '@/components/dashboard/ManagerBottomSheet';
import { EmptyState, ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { SearchInput } from '@/components/dashboard/SearchInput';
import { FilterIconButton, SortIconButton } from '@/components/dashboard/ToolbarIconButtons';
import { managerColors } from '@/components/dashboard/theme';
import { useAuth } from '@/features/auth/AuthProvider';
import { LOW_STOCK_THRESHOLD } from '@/features/inventory/inventoryStatus';
import {
  BranchStockActions,
  type BranchStockActionKind,
  type StockRow,
} from '@/features/pos/BranchStockActions';
import { CategoryIcon } from '@/features/products/CategoryIcon';
import { categoryRowProps } from '@/features/products/productCategoryIndicator';
import { CATEGORY_CHIP_CHOICES, type CategoryFilter } from '@/features/products/productFilters';
import { useClientPagination } from '@/hooks/useClientPagination';
import { useActiveShift } from '@/hooks/useShifts';
import { getErrorMessage } from '@/lib/errors';
import { listCashierDayStock, listCashierProductCategories } from '@/services/inventoryService';

const COLUMN_PADDING = 20;

const CATEGORY_CHIPS = CATEGORY_CHIP_CHOICES.map((choice) => ({
  ...choice,
  leading: choice.value === 'all' ? undefined : <CategoryIcon category={choice.value} size={18} decorative />,
}));

type StockPresenceFilter = 'all' | 'has_qty' | 'qty_zero' | 'in_stock' | 'low' | 'out';
type SortOption = 'stock-then-name' | 'name-asc' | 'name-desc' | 'qty-desc' | 'qty-asc';

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

const DEFAULT_SORT: SortOption = 'stock-then-name';

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

function compareRows(a: StockRow, b: StockRow, sort: SortOption): number {
  const qtyA = Number(a.available);
  const qtyB = Number(b.available);
  const byName = a.product_name.localeCompare(b.product_name);
  switch (sort) {
    case 'name-desc':
      return b.product_name.localeCompare(a.product_name);
    case 'qty-desc':
      return qtyB - qtyA || byName;
    case 'qty-asc':
      return qtyA - qtyB || byName;
    case 'name-asc':
      return byName;
    default: {
      const stockRank = Number(qtyB > 0) - Number(qtyA > 0);
      return stockRank || byName;
    }
  }
}

export default function BranchStock() {
  const { profile } = useAuth();
  const shift = useActiveShift(profile?.id ?? '');
  const [selected, setSelected] = useState<StockRow | null>(null);
  const [sheetAction, setSheetAction] = useState<BranchStockActionKind | null>(null);
  const [menuRow, setMenuRow] = useState<StockRow | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const moreRefs = useRef<Record<string, View | null>>({});
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [stockFilter, setStockFilter] = useState<StockPresenceFilter>('all');
  const [sort, setSort] = useState<SortOption>(DEFAULT_SORT);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [search, setSearch] = useState('');

  const categories = useQuery({
    queryKey: ['cashier-product-categories', profile?.id],
    queryFn: listCashierProductCategories,
    enabled: !!profile,
  });
  const { data, error, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ['cashier-day-stock', profile?.id, profile?.branch_id],
    queryFn: listCashierDayStock,
    enabled: !!profile?.branch_id,
  });

  useFocusEffect(
    useCallback(() => {
      if (profile?.branch_id) void refetch();
    }, [refetch, profile?.branch_id]),
  );

  const rows = useMemo(() => {
    const filtered = (data ?? []).filter((row) => {
      const productCategory = categories.data?.get(row.product_id) ?? null;
      if (category !== 'all' && productCategory !== category) return false;
      if (!matchesStockPresence(Number(row.available), stockFilter)) return false;
      if (!row.product_name.toLowerCase().includes(search.trim().toLowerCase())) return false;
      return true;
    });
    return [...filtered].sort((a, b) => compareRows(a, b, sort));
  }, [data, categories.data, category, stockFilter, search, sort]);

  const pagination = useClientPagination(
    rows,
    `${search}|${category}|${stockFilter}|${sort}`,
    10,
  );

  function closeMenu() {
    setMenuRow(null);
    setMenuAnchor(null);
  }

  function openMenu(row: StockRow) {
    const node = moreRefs.current[row.product_id];
    if (!node) {
      setMenuAnchor(null);
      setMenuRow(row);
      return;
    }
    node.measureInWindow((x, y, width, height) => {
      setMenuAnchor({ x, y, width, height });
      setMenuRow(row);
    });
  }

  function openAction(action: BranchStockActionKind) {
    if (!menuRow) return;
    setSelected(menuRow);
    setSheetAction(action);
    closeMenu();
  }

  const menuWidth = 220;
  const menuTop = menuAnchor ? Math.min(menuAnchor.y + menuAnchor.height + 2, windowHeight - 140) : 0;
  const menuRight = menuAnchor
    ? Math.max(8, windowWidth - menuAnchor.x - menuAnchor.width)
    : 8;

  function closeSheet() {
    setSelected(null);
    setSheetAction(null);
  }

  const openShiftId = shift.data?.status === 'open' ? shift.data.id : undefined;
  const sortLabel = SORT_OPTIONS.find((option) => option.value === sort)?.label;
  const filterCount = stockFilter === 'all' ? 0 : 1;

  return (
    <Screen backgroundColor="#FFFFFF" edges={['top']} scroll={false} contentContainerStyle={styles.screenContent}>
      <ManagerScreenHeader title="Branch inventory" showBack />

      <ConstrainedWidth style={styles.column}>
        <View style={styles.filters}>
          <View style={styles.searchRow}>
            <View style={styles.searchField}>
              <SearchInput value={search} onChangeText={setSearch} placeholder="Search product…" />
            </View>
            <FilterIconButton count={filterCount} onPress={() => setFiltersOpen(true)} />
            <SortIconButton
              currentLabel={sortLabel}
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

        {profile && (
          <BranchStockActions
            key={profile.id}
            row={selected}
            userId={profile.id}
            shiftId={openShiftId}
            initialAction={sheetAction}
            productCategory={selected ? categories.data?.get(selected.product_id) ?? null : null}
            onClose={closeSheet}
          />
        )}

        <Modal transparent visible={!!menuRow} animationType="fade" onRequestClose={closeMenu}>
          <View style={styles.menuRoot}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Dismiss stock actions"
              style={StyleSheet.absoluteFill}
              onPress={closeMenu}
            />
            {menuAnchor ? (
              <View pointerEvents="box-none" style={[styles.menuPopoverWrap, { top: menuTop, right: menuRight, width: menuWidth }]}>
                <View style={styles.menuCaret} />
                <View style={styles.menuCard}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Add stock or quantity"
                    onPress={() => openAction('add')}
                    style={({ pressed }) => [styles.menuRow, pressed && styles.pressed]}
                  >
                    <Ionicons name="add-outline" size={18} color={managerColors.ink} />
                    <Text style={styles.menuRowLabel}>Add Stock / Quantity</Text>
                  </Pressable>
                  <View style={styles.menuDivider} />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Add to waste"
                    onPress={() => openAction('waste')}
                    style={({ pressed }) => [styles.menuRow, pressed && styles.pressed]}
                  >
                    <Ionicons name="trash-outline" size={17} color="#B91C1C" />
                    <Text style={[styles.menuRowLabel, styles.menuRowDanger]}>Add to Waste</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}
          </View>
        </Modal>

        <ManagerBottomSheet visible={filtersOpen} title="Filters" onClose={() => setFiltersOpen(false)}>
          <View style={styles.sortList}>
            {STOCK_FILTER_OPTIONS.map((option) => {
              const isSelected = option.value === stockFilter;
              return (
                <Pressable
                  key={option.value}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  onPress={() => {
                    setStockFilter(option.value);
                    setFiltersOpen(false);
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
        </ManagerBottomSheet>

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
                  {isSelected ? <Ionicons name="checkmark" size={20} color={managerColors.royalBlue} /> : null}
                </Pressable>
              );
            })}
          </View>
        </ManagerBottomSheet>

        {error ? (
          <ErrorState message={getErrorMessage(error)} onRetry={() => void refetch()} />
        ) : isLoading ? (
          <LoadingState label="Loading stock…" />
        ) : (
          <>
            <Text style={styles.resultsCount}>
              {rows.length} {rows.length === 1 ? 'product' : 'products'}
            </Text>
            <FlatList
            data={pagination.pageItems}
            keyExtractor={(row) => row.product_id}
            contentContainerStyle={styles.listContent}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            refreshControl={
              <RefreshControl
                refreshing={isRefetching}
                onRefresh={() => void refetch()}
                tintColor={managerColors.royalBlue}
              />
            }
            ListEmptyComponent={
              <EmptyState
                title={search ? 'No matching stock' : 'No stock recorded'}
                message={
                  search
                    ? 'Try another name.'
                    : stockFilter !== 'all'
                      ? 'Try another stock filter.'
                      : category !== 'all'
                        ? 'No stock in this category.'
                        : 'This branch has no stock recorded yet.'
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
            renderItem={({ item: row }) => {
              const available = Number(row.available);
              const productCategory = categories.data?.get(row.product_id) ?? null;
              return (
                <ListRowCard
                  {...categoryRowProps(productCategory)}
                  title={row.product_name}
                  accessibilityLabel={`${row.product_name}, Qty ${available}`}
                  trailing={
                    <View style={styles.trailing}>
                      <ManagerBadge
                        label={`Qty: ${available}`}
                        tone={available > 0 ? 'info' : 'neutral'}
                        size="md"
                      />
                      <Pressable
                        ref={(node) => {
                          moreRefs.current[row.product_id] = node;
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={`${row.product_name}, stock actions`}
                        hitSlop={10}
                        onPress={() => openMenu(row)}
                        style={({ pressed }) => [
                          styles.moreBtn,
                          menuRow?.product_id === row.product_id && styles.moreBtnActive,
                          pressed && styles.pressed,
                        ]}
                      >
                        <Ionicons name="ellipsis-vertical" size={20} color={managerColors.subtext} />
                      </Pressable>
                    </View>
                  }
                />
              );
            }}
          />
          </>
        )}

        <View style={styles.footer}>
          <View style={styles.footerRow}>
            <View style={styles.footerButton}>
              <ManagerActionButton
                variant="secondary"
                label="Void logs"
                icon="document-text-outline"
                onPress={() => router.push('/cashier/stock-corrections')}
              />
            </View>
            <View style={styles.footerButton}>
              <ManagerActionButton
                label="Local purchase"
                icon="cart-outline"
                onPress={() => router.push('/cashier/local-purchase')}
              />
            </View>
          </View>
        </View>
      </ConstrainedWidth>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenContent: { flexGrow: 1, padding: 0, gap: 0 },
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
  listContent: { paddingBottom: 12, flexGrow: 1 },
  separator: { height: 12 },
  pager: { alignItems: 'center', gap: 4, paddingTop: 8 },
  trailing: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  moreBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
  },
  moreBtnActive: { backgroundColor: '#EAF0FB' },
  menuRoot: { flex: 1 },
  menuPopoverWrap: {
    position: 'absolute',
    alignItems: 'flex-end',
  },
  menuCaret: {
    width: 12,
    height: 12,
    marginRight: 14,
    marginBottom: -6,
    backgroundColor: '#FFFFFF',
    transform: [{ rotate: '45deg' }],
    shadowColor: '#0A1224',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 3,
  },
  menuCard: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    overflow: 'hidden',
    shadowColor: '#0A1224',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 8,
  },
  menuRow: {
    minHeight: 48,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  menuRowLabel: {
    color: managerColors.ink,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    flexShrink: 1,
  },
  menuRowDanger: { color: '#B91C1C' },
  menuDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: managerColors.cardBorder,
    marginHorizontal: 12,
  },
  footer: {
    marginHorizontal: -COLUMN_PADDING,
    paddingHorizontal: COLUMN_PADDING,
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
  pressed: { opacity: 0.75 },
});
