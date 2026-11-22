import Ionicons from '@react-native-vector-icons/ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
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
import { StatTile } from '@/components/dashboard/StatTile';
import { FilterIconButton, SortIconButton } from '@/components/dashboard/ToolbarIconButtons';
import { managerColors } from '@/components/dashboard/theme';
import {
  ListFilterSummary,
  ListFiltersSheet,
  type ExtraListFilter,
} from '@/features/products/ProductFilterControls';
import { DEFAULT_LIST_FILTERS, type ListFilterKey } from '@/features/products/listFilters';
import { firstSearchParam, parseReportDateFilter, transferReturnIssuesHref } from '@/features/reports/branchHub';
import { DateRangeFilter, resolveReportRange, type DateFilterType } from '@/features/reports/DateRangeFilter';
import {
  buildIssueBranchRows,
  issueBranchBadge,
  issueBranchMeta,
  summarizeIssueRecords,
} from '@/features/reports/discrepancyOverview';
import { OwnerSummaryKpiPair } from '@/features/reports/OwnerSummaryKpiPair';
import { ReportSectionHeading } from '@/features/reports/ReportSectionHeading';
import { useBranches } from '@/hooks/useBranches';
import { useClientPagination } from '@/hooks/useClientPagination';
import { useReturnDiscrepanciesReport, useTransferDiscrepanciesReport } from '@/hooks/useReconciliation';
import { getErrorMessage } from '@/lib/errors';
import { isReportRangeReady } from '@/lib/format';
import { accentForName } from '@/lib/nameAccent';
import { stockUnit } from '@/lib/stockUnits';
import type { ReturnDiscrepancyReportItem, TransferDiscrepancyReportItem } from '@/types/models';

type KindFilter = 'all' | 'transfer' | 'return';
type TypeFilter = 'all' | 'missing' | 'excess';
type StatusFilter = 'all' | 'open' | 'resolved';
type SortOption = 'newest' | 'oldest' | 'units-desc';

const NO_LIST_FILTERS: ListFilterKey[] = [];
const ignoreListFilters = () => {};

const KIND_OPTIONS: Array<{ label: string; value: KindFilter }> = [
  { label: 'All', value: 'all' },
  { label: 'Transfers', value: 'transfer' },
  { label: 'Returns', value: 'return' },
];

const TYPE_OPTIONS: Array<{ label: string; value: TypeFilter }> = [
  { label: 'All', value: 'all' },
  { label: 'Missing', value: 'missing' },
  { label: 'Excess', value: 'excess' },
];

const STATUS_OPTIONS: Array<{ label: string; value: StatusFilter }> = [
  { label: 'All', value: 'all' },
  { label: 'Open', value: 'open' },
  { label: 'Resolved', value: 'resolved' },
];

const SORT_OPTIONS: Array<{ label: string; value: SortOption }> = [
  { label: 'Newest first', value: 'newest' },
  { label: 'Oldest first', value: 'oldest' },
  { label: 'Largest units', value: 'units-desc' },
];

function matchesSearch(
  item: TransferDiscrepancyReportItem | ReturnDiscrepancyReportItem,
  term: string,
  kind: 'transfer' | 'return',
): boolean {
  if (!term) return true;
  const number = kind === 'transfer'
    ? (item as TransferDiscrepancyReportItem).transfer_number
    : (item as ReturnDiscrepancyReportItem).return_number;
  return `${number} ${item.product_name} ${item.product_sku} ${item.branch_name}`.toLowerCase().includes(term);
}

export default function OwnerDiscrepancyAnalytics() {
  const params = useLocalSearchParams<{
    branchId?: string | string[];
    range?: string | string[];
    start?: string | string[];
    end?: string | string[];
  }>();
  const selectedBranchId = firstSearchParam(params.branchId);
  const initialRange = parseReportDateFilter(firstSearchParam(params.range) || 'all_time');
  const initialStart = firstSearchParam(params.start);
  const initialEnd = firstSearchParam(params.end);

  const [rangeType, setRangeType] = useState<DateFilterType>(initialRange);
  const [customStart, setCustomStart] = useState(initialRange === 'custom' ? initialStart : '');
  const [customEnd, setCustomEnd] = useState(initialRange === 'custom' ? initialEnd : '');
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortOption>('newest');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);

  const { rpcRangeType, startIso, endIso } = resolveReportRange(rangeType, customStart, customEnd);
  const ready = isReportRangeReady(rpcRangeType, startIso, endIso);
  const branches = useBranches();
  const transferQuery = useTransferDiscrepanciesReport(
    selectedBranchId || undefined,
    'all',
    rpcRangeType,
    startIso,
    endIso,
  );
  const returnQuery = useReturnDiscrepanciesReport(
    selectedBranchId || undefined,
    'all',
    rpcRangeType,
    startIso,
    endIso,
  );

  const transferRows = transferQuery.data ?? [];
  const returnRows = returnQuery.data ?? [];
  const showHub = !selectedBranchId;
  const loading = transferQuery.isLoading || returnQuery.isLoading || branches.isLoading;
  const error = transferQuery.error ?? returnQuery.error;
  const customIncomplete = rangeType === 'custom' && !ready;

  const branchRows = useMemo(
    () => (showHub && ready && !error ? buildIssueBranchRows(transferRows, returnRows, branches.data) : []),
    [showHub, ready, error, transferRows, returnRows, branches.data],
  );

  const term = search.trim().toLowerCase();
  const scopedTransfers = useMemo(
    () =>
      transferRows.filter((row) => {
        if (typeFilter !== 'all' && row.discrepancy_type !== typeFilter) return false;
        return matchesSearch(row, term, 'transfer');
      }),
    [transferRows, typeFilter, term],
  );
  const scopedReturns = useMemo(
    () =>
      returnRows.filter((row) => {
        if (typeFilter !== 'all' && row.discrepancy_type !== typeFilter) return false;
        return matchesSearch(row, term, 'return');
      }),
    [returnRows, typeFilter, term],
  );

  const kpiTransfers = kindFilter === 'return' ? [] : scopedTransfers;
  const kpiReturns = kindFilter === 'transfer' ? [] : scopedReturns;
  const kpiTotals = summarizeIssueRecords(kpiTransfers, kpiReturns);

  type ListRow =
    | { kind: 'transfer'; item: TransferDiscrepancyReportItem }
    | { kind: 'return'; item: ReturnDiscrepancyReportItem };

  const listRows = useMemo(() => {
    const rows: ListRow[] = [];
    if (kindFilter !== 'return') {
      for (const item of scopedTransfers) {
        if (statusFilter !== 'all' && (item.status ?? 'open') !== statusFilter) continue;
        rows.push({ kind: 'transfer', item });
      }
    }
    if (kindFilter !== 'transfer') {
      for (const item of scopedReturns) {
        if (statusFilter !== 'all' && (item.status ?? 'open') !== statusFilter) continue;
        rows.push({ kind: 'return', item });
      }
    }
    return rows.sort((a, b) => {
      if (sort === 'oldest') return Date.parse(a.item.created_at) - Date.parse(b.item.created_at);
      if (sort === 'units-desc') {
        return Math.abs(Number(b.item.difference) || 0) - Math.abs(Number(a.item.difference) || 0);
      }
      return Date.parse(b.item.created_at) - Date.parse(a.item.created_at);
    });
  }, [kindFilter, scopedTransfers, scopedReturns, statusFilter, sort]);

  const pagination = useClientPagination(
    listRows,
    `${selectedBranchId}|${kindFilter}|${typeFilter}|${statusFilter}|${rangeType}|${customStart}|${customEnd}|${search}|${sort}`,
    10,
  );

  const filterRows = useMemo<ExtraListFilter[]>(
    () => [
      { title: 'Kind', options: KIND_OPTIONS, value: kindFilter, onChange: (value) => setKindFilter(value as KindFilter) },
      { title: 'Type', options: TYPE_OPTIONS, value: typeFilter, onChange: (value) => setTypeFilter(value as TypeFilter) },
      { title: 'Status', options: STATUS_OPTIONS, value: statusFilter, onChange: (value) => setStatusFilter(value as StatusFilter) },
    ],
    [kindFilter, typeFilter, statusFilter],
  );
  const filterCount =
    (kindFilter !== 'all' ? 1 : 0) + (typeFilter !== 'all' ? 1 : 0) + (statusFilter !== 'all' ? 1 : 0);
  const recordTotal = transferRows.length + returnRows.length;

  const rangeArgs = { rangeType, customStart, customEnd };

  const kpiValue = (value: number) => (loading || error || customIncomplete ? '—' : value);
  const selectedBranchName =
    (branches.data ?? []).find((branch) => branch.id === selectedBranchId)?.name ??
    transferRows.find((row) => row.branch_id === selectedBranchId)?.branch_name ??
    returnRows.find((row) => row.branch_id === selectedBranchId)?.branch_name;
  const title = 'Transfer & Return Issues';
  const subtitle = selectedBranchId ? selectedBranchName ?? 'Branch' : undefined;

  return (
    <Screen backgroundColor="#FFFFFF" edges={['top']} contentContainerStyle={styles.screenContent}>
      <ManagerScreenHeader title={title} subtitle={subtitle} showBack />
      <ConstrainedWidth style={styles.column}>
        <View style={styles.filterBleed}>
          <DateRangeFilter
            value={rangeType}
            onChange={setRangeType}
            customStart={customStart}
            customEnd={customEnd}
            onCustomStartChange={setCustomStart}
            onCustomEndChange={setCustomEnd}
          />
        </View>

        <StatTile
          layout="wide"
          emphasis
          icon="swap-horizontal-outline"
          label="Total discrepancy units"
          value={kpiValue(kpiTotals.totalUnits)}
        />
        <OwnerSummaryKpiPair
          left={{
            icon: 'arrow-forward-outline',
            label: 'Transfer units',
            value: kpiValue(kpiTotals.transferUnits),
          }}
          right={{
            icon: 'return-up-back-outline',
            label: 'Return units',
            value: kpiValue(kpiTotals.returnUnits),
          }}
        />

        {!showHub ? (
          <OwnerSummaryKpiPair
            left={{
              icon: 'alert-circle-outline',
              label: 'Open',
              value: kpiValue(kpiTotals.openCount),
            }}
            right={{
              icon: 'checkmark-circle-outline',
              label: 'Resolved',
              value: kpiValue(kpiTotals.resolvedCount),
            }}
          />
        ) : null}

        {customIncomplete ? (
          <EmptyState title="Select a date range" message="Enter both a start date and an end date to run this report." />
        ) : null}
        {ready && error ? (
          <ErrorState
            message={getErrorMessage(error)}
            onRetry={() => {
              void transferQuery.refetch();
              void returnQuery.refetch();
            }}
          />
        ) : null}
        {ready && loading ? <LoadingState label="Loading transfer and return issues…" /> : null}

        {showHub && ready && !loading && !error ? (
          <View style={styles.section}>
            <ReportSectionHeading title="BRANCHES" />
            {branchRows.length === 0 ? (
              <EmptyState title="No branches" message="No branches are available for transfer and return issues." />
            ) : (
              branchRows.map((row) => {
                const title = row.isActive ? row.branchName : `Inactive · ${row.branchName}`;
                const meta = issueBranchMeta(row);
                const badge = issueBranchBadge(row);
                return (
                  <ListRowCard
                    key={row.branchId}
                    icon={row.isMain ? 'home-outline' : 'storefront-outline'}
                    iconColor={accentForName(row.branchName)}
                    title={title}
                    subtitle={meta}
                    trailing={<ManagerBadge label={badge.label} tone={badge.tone} />}
                    onPress={() =>
                      router.push(transferReturnIssuesHref({ ...rangeArgs, branchId: row.branchId }) as never)
                    }
                    accessibilityLabel={`${title} ${meta}, ${badge.label}`}
                    accessibilityHint="Opens transfer and return issues for this branch"
                  />
                );
              })
            )}
          </View>
        ) : null}

        {!showHub ? (
          <View style={styles.filters}>
            <View style={styles.searchRow}>
              <View style={styles.searchField}>
                <SearchInput value={search} onChangeText={setSearch} placeholder="Search transfer # or product" />
              </View>
              <FilterIconButton count={filterCount} onPress={() => setFiltersOpen(true)} />
              <SortIconButton
                currentLabel={SORT_OPTIONS.find((option) => option.value === sort)?.label}
                active={sort !== 'newest'}
                onPress={() => setSortOpen(true)}
              />
            </View>
            <ListFilterSummary
              countText={`${listRows.length} of ${recordTotal} ${recordTotal === 1 ? 'record' : 'records'}`}
              filters={DEFAULT_LIST_FILTERS}
              keys={NO_LIST_FILTERS}
              extra={filterRows}
              onChange={ignoreListFilters}
            />
          </View>
        ) : null}

        {!showHub && ready && !loading && !error && listRows.length === 0 ? (
          <EmptyState
            title="No transfer or return issues"
            message="No missing or excess counts in this range for the selected branch."
          />
        ) : null}

        {!showHub
          ? pagination.pageItems.map((row) => {
              const isTransfer = row.kind === 'transfer';
              const item = row.item;
              const number = isTransfer
                ? (item as TransferDiscrepancyReportItem).transfer_number
                : (item as ReturnDiscrepancyReportItem).return_number;
              const sent = isTransfer
                ? (item as TransferDiscrepancyReportItem).quantity_sent
                : (item as ReturnDiscrepancyReportItem).quantity_returned;
              const isMissing = item.discrepancy_type === 'missing';
              const status = item.status ?? 'open';
              const unit = stockUnit(item.stock_unit_code)?.plural ?? 'pcs';
              return (
                <ListRowCard
                  key={`${row.kind}-${item.id}`}
                  title={number}
                  subtitle={item.product_name}
                  meta={`${item.branch_name} · ${unit} · ${isTransfer ? 'Sent' : 'Returned'} ${sent} → Received ${item.quantity_received}`}
                  trailing={
                    <View style={styles.trailing}>
                      <ManagerBadge
                        label={status === 'resolved' ? 'Resolved' : 'Open'}
                        tone={status === 'resolved' ? 'success' : 'warning'}
                      />
                      <ManagerBadge
                        label={isMissing ? `${item.difference} missing` : `${Math.abs(item.difference)} excess`}
                        tone={isMissing ? 'danger' : 'warning'}
                      />
                    </View>
                  }
                  onPress={() =>
                    router.push(
                      `/owner/reports/discrepancies/${row.kind}/${item.id}` as never,
                    )
                  }
                />
              );
            })
          : null}

        {!showHub && pagination.showPagination ? (
          <View style={styles.pager}>
            <Pagination page={pagination.page} totalPages={pagination.totalPages} onPageChange={pagination.setPage} />
          </View>
        ) : null}
      </ConstrainedWidth>

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

const styles = StyleSheet.create({
  screenContent: { flexGrow: 1, padding: 0, gap: 0 },
  column: { flexGrow: 1, padding: 20, gap: 16 },
  filterBleed: { marginHorizontal: -20 },
  filters: { gap: 12 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  searchField: { flex: 1, minWidth: 0 },
  section: { gap: 10, marginTop: 4 },
  trailing: { alignItems: 'flex-end', gap: 6 },
  pager: { paddingVertical: 8 },
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
