import { Redirect, router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';

import { Screen } from '@/components/Screen';
import { ListRowCard } from '@/components/dashboard/ListRowCard';
import { EmptyState, ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { SearchInput } from '@/components/dashboard/SearchInput';
import { FilterIconButton } from '@/components/dashboard/ToolbarIconButtons';
import { managerColors } from '@/components/dashboard/theme';
import { spacing } from '@/constants/theme';
import { useAuth } from '@/features/auth/AuthProvider';
import { ListFilterSummary, ListFiltersSheet } from '@/features/products/ProductFilterControls';
import { DEFAULT_LIST_FILTERS, type ListFilterKey } from '@/features/products/listFilters';
import { SALE_DISCOUNT_OPTIONS, matchesSaleDiscount, type SaleDiscountFilter } from '@/features/sales/saleFilters';
import { SaleDetailsBody } from '@/features/sales/SalesScreens';
import { useActiveShift } from '@/hooks/useShifts';
import { getShiftErrorMessage } from '@/lib/errors';
import { formatDate, formatMoney } from '@/lib/format';
import { useLayout } from '@/lib/layout';
import { listShiftSales } from '@/services/saleService';

// The shared filter sheet and tags are used with only this screen's own row (Discount): no product list-filter rows here.
const NO_LIST_FILTERS: ListFilterKey[] = [];
const ignoreListFilters = () => {};

export default function CurrentShiftSales() {
  const { profile } = useAuth();
  const { isTablet, salesMasterWidth } = useLayout();
  const [search, setSearch] = useState('');
  const [discount, setDiscount] = useState<SaleDiscountFilter>('all');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const shift = useActiveShift(profile?.id ?? '');
  const sales = useQuery({
    queryKey: ['shift-sales', shift.data?.id],
    queryFn: () => listShiftSales(shift.data!.id),
    enabled: Boolean(shift.data),
  });

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (sales.data ?? []).filter(
      (sale) => matchesSaleDiscount(sale, discount) && (!term || sale.sale_number.toLowerCase().includes(term)),
    );
  }, [sales.data, search, discount]);

  // the funnel's one row: how the order was priced (Standard, Employee / guest meal, PWD, Back office / guard)
  const discountFilter = useMemo(
    () => ({
      title: 'Discount',
      options: SALE_DISCOUNT_OPTIONS,
      value: discount,
      onChange: (value: string) => setDiscount(value as SaleDiscountFilter),
    }),
    [discount],
  );

  useEffect(() => {
    if (!isTablet) return;
    if (filtered.length === 0) {
      setSelectedId(null);
      return;
    }
    if (selectedId && filtered.some((sale) => sale.id === selectedId)) return;
    setSelectedId(filtered[0]?.id ?? null);
  }, [filtered, isTablet, selectedId]);

  if (shift.isLoading) return <LoadingState label="Checking active shift…" />;
  if (shift.error) {
    return (
      <Screen backgroundColor="#FFFFFF">
        <ErrorState
          message={getShiftErrorMessage(shift.error)}
          onRetry={() => void shift.refetch()}
        />
      </Screen>
    );
  }
  if (!shift.data) return <Redirect href="/cashier/dashboard" />;

  const refreshing = sales.isRefetching || shift.isRefetching;
  const onRefresh = () => {
    void Promise.all([sales.refetch(), shift.refetch()]);
  };

  const listHeader = (
    <View style={styles.top}>
      <ManagerScreenHeader title="Current Shift Sales" hideMenu />
      <View style={styles.searchWrap}>
        <View style={styles.searchRow}>
          <View style={styles.searchGrow}>
            <SearchInput value={search} onChangeText={setSearch} placeholder="Search sale #" />
          </View>
          <FilterIconButton count={discount !== 'all' ? 1 : 0} onPress={() => setFiltersOpen(true)} />
        </View>
        <ListFilterSummary
          countText={`${filtered.length} of ${sales.data?.length ?? 0} ${(sales.data?.length ?? 0) === 1 ? 'sale' : 'sales'}`}
          filters={DEFAULT_LIST_FILTERS}
          keys={NO_LIST_FILTERS}
          extra={discountFilter}
          onChange={ignoreListFilters}
        />
      </View>
    </View>
  );

  const saleList = (
    <FlatList
      data={filtered}
      keyExtractor={(item) => item.id}
      style={styles.list}
      contentContainerStyle={styles.listContent}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={managerColors.royalBlue}
        />
      }
      ListEmptyComponent={
        <EmptyState
          title={search.trim() || discount !== 'all' ? 'No matching sales' : 'No sales yet'}
          message={
            search.trim() || discount !== 'all'
              ? 'Try another sale number or change the filter.'
              : 'Confirmed orders will appear here.'
          }
        />
      }
      renderItem={({ item }) => (
        <ListRowCard
          title={item.sale_number}
          meta={formatDate(item.sold_at)}
          trailing={<Text style={styles.amount}>{formatMoney(item.total_amount)}</Text>}
          onPress={() => {
            if (isTablet) {
              setSelectedId(item.id);
              return;
            }
            router.push(`/cashier/sales/${item.id}` as never);
          }}
        />
      )}
    />
  );

  return (
    <Screen backgroundColor="#FFFFFF" edges={['top']} scroll={false} contentContainerStyle={styles.screen}>
      {isTablet ? (
        <View style={styles.split}>
          <View style={[styles.master, { width: salesMasterWidth }]}>
            {listHeader}
            {sales.isLoading && !sales.data ? (
              <LoadingState label="Loading shift sales…" />
            ) : null}
            {sales.error ? (
              <ErrorState
                message="Unable to load sales."
                onRetry={() => void sales.refetch()}
              />
            ) : null}
            {!sales.error && (sales.data || !sales.isLoading) ? saleList : null}
          </View>
          <View style={styles.detail}>
            {selectedId ? (
              <ScrollView
                style={styles.detailScroll}
                contentContainerStyle={styles.detailContent}
                keyboardShouldPersistTaps="handled"
              >
                <SaleDetailsBody saleId={selectedId} />
              </ScrollView>
            ) : (
              <View style={styles.detailEmpty}>
                <EmptyState
                  title="Select a sale"
                  message="Choose a sale from the list to view details."
                />
              </View>
            )}
          </View>
        </View>
      ) : (
        <View style={styles.layout}>
          {listHeader}
          {sales.isLoading && !sales.data ? (
            <LoadingState label="Loading shift sales…" />
          ) : null}
          {sales.error ? (
            <ErrorState
              message="Unable to load sales."
              onRetry={() => void sales.refetch()}
            />
          ) : null}
          {!sales.error && (sales.data || !sales.isLoading) ? saleList : null}
        </View>
      )}
      <ListFiltersSheet
        visible={filtersOpen}
        filters={DEFAULT_LIST_FILTERS}
        keys={NO_LIST_FILTERS}
        extra={discountFilter}
        onChange={ignoreListFilters}
        onClose={() => setFiltersOpen(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { flexGrow: 1, padding: 0, gap: 0 },
  layout: { flex: 1, minHeight: 0 },
  split: { flex: 1, minHeight: 0, flexDirection: 'row' },
  master: {
    flexGrow: 0,
    flexShrink: 0,
    minWidth: 280,
    minHeight: 0,
    borderRightWidth: 1,
    borderRightColor: managerColors.cardBorder,
  },
  detail: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    backgroundColor: '#FFFFFF',
  },
  detailScroll: { flex: 1 },
  detailContent: { padding: 20, flexGrow: 1 },
  detailEmpty: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  top: { gap: spacing.sm },
  searchWrap: { paddingHorizontal: 20, paddingBottom: spacing.sm, gap: spacing.sm },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  searchGrow: { flex: 1 },
  amount: { color: managerColors.royalBlue, fontFamily: 'Inter_700Bold', fontSize: 15 },
  list: { flex: 1, minHeight: 0 },
  listContent: {
    paddingHorizontal: 20,
    paddingVertical: spacing.sm,
    flexGrow: 1,
    gap: spacing.sm,
  },
});
