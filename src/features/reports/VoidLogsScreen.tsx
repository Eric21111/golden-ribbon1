import Ionicons from '@react-native-vector-icons/ionicons';
import { useQuery } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { Pagination } from '@/components/Pagination';
import { Screen } from '@/components/Screen';
import { ListRowCard } from '@/components/dashboard/ListRowCard';
import { ManagerBadge } from '@/components/dashboard/ManagerBadge';
import { ManagerBottomSheet } from '@/components/dashboard/ManagerBottomSheet';
import { EmptyState, ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { SearchInput } from '@/components/dashboard/SearchInput';
import { FilterIconButton, SortIconButton } from '@/components/dashboard/ToolbarIconButtons';
import { managerColors } from '@/components/dashboard/theme';
import { useAuth } from '@/features/auth/AuthProvider';
import {
  ListFilterSummary,
  ListFiltersSheet,
  type ExtraListFilter,
} from '@/features/products/ProductFilterControls';
import { DEFAULT_LIST_FILTERS, type ListFilterKey } from '@/features/products/listFilters';
import { categoryRowProps } from '@/features/products/productCategoryIndicator';
import {
  DateRangeFilter,
  resolveReportRange,
  type DateFilterType,
} from '@/features/reports/DateRangeFilter';
import { useClientPagination } from '@/hooks/useClientPagination';
import { getErrorMessage } from '@/lib/errors';
import { formatMoney, getTodayRangeManila } from '@/lib/format';
import { supabase } from '@/lib/supabase';

const SERVER_PAGE = 50;
const NO_LIST_FILTERS: ListFilterKey[] = [];
const ignoreListFilters = () => {};

type VoidLogRow = {
  event_id: string;
  recorded_at: string;
  sale_number: string;
  product_name: string;
  variant_name: string | null;
  product_category: string | null;
  branch_name: string;
  cashier_name: string;
  quantity: number;
  amount: number | string;
  reason: string | null;
  note: string | null;
};

type SortOption = 'newest' | 'oldest' | 'amount-desc' | 'qty-desc';

const SORT_OPTIONS: Array<{ label: string; value: SortOption }> = [
  { label: 'Newest first', value: 'newest' },
  { label: 'Oldest first', value: 'oldest' },
  { label: 'Amount (High to Low)', value: 'amount-desc' },
  { label: 'Qty voided (High to Low)', value: 'qty-desc' },
];

const DEFAULT_SORT: SortOption = 'newest';

async function listAllVoidLogs(): Promise<VoidLogRow[]> {
  const all: VoidLogRow[] = [];
  let offset = 0;
  for (;;) {
    const result = await supabase.rpc('list_sale_void_logs', { p_offset: offset });
    if (result.error) throw result.error;
    const batch = (result.data ?? []) as VoidLogRow[];
    if (batch.length === 0) break;
    const chunk = batch.length > SERVER_PAGE ? batch.slice(0, SERVER_PAGE) : batch;
    all.push(...chunk);
    if (batch.length <= SERVER_PAGE) break;
    offset += SERVER_PAGE;
  }
  return all;
}

function formatVoidRecordedAt(value: string): string {
  return new Date(value).toLocaleString('en-PH', { timeZone: 'Asia/Manila' });
}

function formatVoidTime(value: string): string {
  return new Date(value).toLocaleString('en-PH', {
    timeZone: 'Asia/Manila',
    month: 'numeric',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function reasonText(row: VoidLogRow): string {
  return [row.reason, row.note].filter(Boolean).join(' · ') || 'No reason recorded';
}

/** Prefer RPC fields; fall back to splitting the old "Name · Variant" product_name. */
function productDisplay(row: VoidLogRow): { name: string; variant: string | null } {
  const variant = row.variant_name?.trim() || null;
  if (variant) return { name: row.product_name, variant };
  const parts = row.product_name.split(' · ');
  if (parts.length >= 2) {
    return { name: parts[0]!, variant: parts.slice(1).join(' · ') };
  }
  return { name: row.product_name, variant: null };
}

function rangeBounds(
  rangeType: DateFilterType,
  customStart: string,
  customEnd: string,
): { start?: number; end?: number } {
  if (rangeType === 'today') {
    const today = getTodayRangeManila();
    return { start: Date.parse(today.start), end: Date.parse(today.end) };
  }
  const resolved = resolveReportRange(rangeType, customStart, customEnd);
  if (resolved.rpcRangeType === 'all_time' || !resolved.startIso || !resolved.endIso) return {};
  return { start: Date.parse(resolved.startIso), end: Date.parse(resolved.endIso) };
}

export default function VoidLogsScreen() {
  const { profile } = useAuth();
  const [search, setSearch] = useState('');
  const [rangeType, setRangeType] = useState<DateFilterType>('all_time');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [cashierFilter, setCashierFilter] = useState('all');
  const [reasonFilter, setReasonFilter] = useState('all');
  const [sort, setSort] = useState<SortOption>(DEFAULT_SORT);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [selected, setSelected] = useState<VoidLogRow | null>(null);

  const { data, error, isPending, isRefetching, refetch } = useQuery({
    queryKey: ['void-logs', profile?.id, profile?.branch_id, profile?.role],
    enabled: !!profile,
    queryFn: listAllVoidLogs,
  });

  const categoriesByName = useQuery({
    queryKey: ['void-log-product-categories'],
    enabled: !!profile,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data: products, error: productsError } = await supabase
        .from('products')
        .select('name, product_category');
      if (productsError || !products) return new Map<string, string | null>();
      return new Map(
        (products as Array<{ name: string; product_category: string | null }>).map((row) => [
          row.name,
          row.product_category,
        ]),
      );
    },
  });

  useFocusEffect(
    useCallback(() => {
      if (profile) void refetch();
    }, [profile, refetch]),
  );

  function categoryFor(row: VoidLogRow, productName: string): string | null {
    return row.product_category ?? categoriesByName.data?.get(productName) ?? null;
  }

  const cashierRow = useMemo<ExtraListFilter>(
    () => ({
      title: 'Cashier',
      options: [
        { label: 'All cashiers', value: 'all' },
        ...[...new Set((data ?? []).map((row) => row.cashier_name).filter(Boolean))]
          .sort((a, b) => a.localeCompare(b))
          .map((name) => ({ label: name, value: name })),
      ],
      value: cashierFilter,
      onChange: setCashierFilter,
    }),
    [data, cashierFilter],
  );

  const reasonRow = useMemo<ExtraListFilter>(
    () => ({
      title: 'Reason',
      options: [
        { label: 'All reasons', value: 'all' },
        ...[
          ...new Set(
            (data ?? [])
              .map((row) => row.reason?.trim())
              .filter((name): name is string => !!name),
          ),
        ]
          .sort((a, b) => a.localeCompare(b))
          .map((name) => ({ label: name, value: name })),
      ],
      value: reasonFilter,
      onChange: setReasonFilter,
    }),
    [data, reasonFilter],
  );

  const filterRows = useMemo(() => [cashierRow, reasonRow], [cashierRow, reasonRow]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const bounds = rangeBounds(rangeType, customStart, customEnd);
    const rows = (data ?? []).filter((row) => {
      if (cashierFilter !== 'all' && row.cashier_name !== cashierFilter) return false;
      if (reasonFilter !== 'all' && (row.reason?.trim() ?? '') !== reasonFilter) return false;
      if (bounds.start != null && bounds.end != null) {
        const at = Date.parse(row.recorded_at);
        if (!Number.isFinite(at) || at < bounds.start || at >= bounds.end) return false;
      }
      if (!term) return true;
      const haystack = [
        row.product_name,
        row.variant_name ?? '',
        row.sale_number,
        row.cashier_name,
        row.branch_name,
        row.reason ?? '',
        row.note ?? '',
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(term);
    });

    return [...rows].sort((a, b) => {
      switch (sort) {
        case 'oldest':
          return Date.parse(a.recorded_at) - Date.parse(b.recorded_at);
        case 'amount-desc':
          return Number(b.amount) - Number(a.amount);
        case 'qty-desc':
          return Number(b.quantity) - Number(a.quantity);
        default:
          return Date.parse(b.recorded_at) - Date.parse(a.recorded_at);
      }
    });
  }, [data, search, rangeType, customStart, customEnd, cashierFilter, reasonFilter, sort]);

  const pagination = useClientPagination(
    filtered,
    `${search}|${rangeType}|${customStart}|${customEnd}|${cashierFilter}|${reasonFilter}|${sort}`,
    10,
  );

  const filterCount = (cashierFilter !== 'all' ? 1 : 0) + (reasonFilter !== 'all' ? 1 : 0);
  const sortLabel = SORT_OPTIONS.find((option) => option.value === sort)?.label;
  const centered = !isPending && !error && filtered.length === 0;
  const hasActiveQuery =
    !!search.trim() || rangeType !== 'all_time' || cashierFilter !== 'all' || reasonFilter !== 'all';

  return (
    <Screen
      backgroundColor="#FFFFFF"
      edges={['top']}
      refreshing={isRefetching}
      onRefresh={() => void refetch()}
      contentContainerStyle={styles.screen}
    >
      <ManagerScreenHeader title="Void logs" showBack />
      <ConstrainedWidth fill={centered} style={[styles.column, centered && styles.centered]}>
        <View style={styles.filters}>
          <View style={styles.searchRow}>
            <View style={styles.searchField}>
              <SearchInput
                value={search}
                onChangeText={setSearch}
                placeholder="Search product or sale #"
              />
            </View>
            <FilterIconButton count={filterCount} onPress={() => setFiltersOpen(true)} />
            <SortIconButton
              currentLabel={sortLabel}
              active={sort !== DEFAULT_SORT}
              onPress={() => setSortOpen(true)}
            />
          </View>
          <DateRangeFilter
            value={rangeType}
            onChange={setRangeType}
            customStart={customStart}
            customEnd={customEnd}
            onCustomStartChange={setCustomStart}
            onCustomEndChange={setCustomEnd}
          />
          <ListFilterSummary
            countText={`${filtered.length} of ${data?.length ?? 0} ${(data?.length ?? 0) === 1 ? 'void' : 'voids'}`}
            filters={DEFAULT_LIST_FILTERS}
            keys={NO_LIST_FILTERS}
            extra={filterRows}
            onChange={ignoreListFilters}
          />
        </View>

        {error ? <ErrorState message={getErrorMessage(error)} onRetry={() => void refetch()} /> : null}
        {isPending ? <LoadingState label="Loading void logs…" /> : null}
        {!isPending && !error && filtered.length === 0 ? (
          <EmptyState
            title={hasActiveQuery ? 'No matching voids' : 'No voids'}
            message={
              hasActiveQuery
                ? 'Try another search, date range, or filter.'
                : 'There are no voided items yet.'
            }
          />
        ) : null}

        {pagination.pageItems.map((row) => {
          const product = productDisplay(row);
          return (
            <ListRowCard
              key={row.event_id}
              {...categoryRowProps(categoryFor(row, product.name))}
              title={product.name}
              titleTag={product.variant || undefined}
              meta={formatVoidTime(row.recorded_at)}
              trailing={<ManagerBadge label={`- ${formatMoney(Number(row.amount))}`} tone="danger" />}
              onPress={() => setSelected(row)}
              accessibilityLabel={`${product.name}${product.variant ? `, ${product.variant}` : ''}, - ${formatMoney(Number(row.amount))}`}
            />
          );
        })}

        {pagination.showPagination ? (
          <View style={styles.pager}>
            <Pagination
              page={pagination.page}
              totalPages={pagination.totalPages}
              onPageChange={pagination.setPage}
            />
          </View>
        ) : null}
      </ConstrainedWidth>

      <ManagerBottomSheet
        visible={selected != null}
        title={selected ? productDisplay(selected).name : 'Void details'}
        onClose={() => setSelected(null)}
        scroll
      >
        {selected ? <VoidDetailBody row={selected} /> : null}
      </ManagerBottomSheet>

      <ListFiltersSheet
        visible={filtersOpen}
        filters={DEFAULT_LIST_FILTERS}
        keys={NO_LIST_FILTERS}
        extra={filterRows}
        onChange={ignoreListFilters}
        onClose={() => setFiltersOpen(false)}
      />

      <ManagerBottomSheet visible={sortOpen} title="Sort" onClose={() => setSortOpen(false)}>
        <View style={styles.sortList}>
          {SORT_OPTIONS.map((option) => {
            const selectedOption = option.value === sort;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="button"
                accessibilityState={{ selected: selectedOption }}
                onPress={() => {
                  setSort(option.value);
                  setSortOpen(false);
                }}
                style={({ pressed }) => [
                  styles.optionRow,
                  selectedOption && styles.optionRowSelected,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.optionLabel, selectedOption && styles.optionLabelSelected]}>
                  {option.label}
                </Text>
                {selectedOption ? <Ionicons name="checkmark" size={20} color={managerColors.royalBlue} /> : null}
              </Pressable>
            );
          })}
        </View>
      </ManagerBottomSheet>
    </Screen>
  );
}

function VoidDetailBody({ row }: { row: VoidLogRow }) {
  const product = productDisplay(row);
  return (
    <View style={styles.detail}>
      <View style={styles.detailTop}>
        <ManagerBadge label={`${row.quantity} voided`} tone="danger" size="md" />
        <Text style={styles.detailAmount}>{formatMoney(Number(row.amount))} deducted</Text>
      </View>
      {product.variant ? <DetailLine label="Variant" value={product.variant} /> : null}
      <DetailLine label="Sale" value={row.sale_number} />
      <DetailLine label="Branch" value={row.branch_name} />
      <DetailLine label="Cashier" value={row.cashier_name} />
      <DetailLine label="Reason" value={reasonText(row)} />
      <DetailLine label="Recorded" value={formatVoidRecordedAt(row.recorded_at)} />
    </View>
  );
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailLine}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flexGrow: 1, padding: 0, gap: 0 },
  column: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 24, gap: 12 },
  centered: { flexGrow: 1, justifyContent: 'center', paddingBottom: 64 },
  filters: { gap: 12, marginBottom: 2 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  searchField: { flex: 1 },
  pager: { alignItems: 'center', gap: 4, paddingTop: 4 },
  detail: { gap: 14, paddingBottom: 8 },
  detailTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  detailAmount: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 17 },
  detailLine: { gap: 4 },
  detailLabel: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 12 },
  detailValue: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 15, lineHeight: 20 },
  sortList: { gap: 8, paddingBottom: 8 },
  optionRow: {
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
  optionRowSelected: { borderColor: managerColors.royalBlue, backgroundColor: '#EAF0FB' },
  optionLabel: { color: managerColors.ink, fontFamily: 'Inter_500Medium', fontSize: 15, flex: 1 },
  optionLabelSelected: { color: managerColors.royalBlue, fontFamily: 'Inter_700Bold' },
  pressed: { opacity: 0.75 },
});
