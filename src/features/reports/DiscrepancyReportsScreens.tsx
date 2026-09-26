import Ionicons from '@react-native-vector-icons/ionicons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { FilterDropdown } from '@/components/FilterDropdown';
import { Pagination } from '@/components/Pagination';
import { Screen } from '@/components/Screen';
import { ListRowCard } from '@/components/dashboard/ListRowCard';
import { ManagerBadge } from '@/components/dashboard/ManagerBadge';
import { ManagerBottomSheet } from '@/components/dashboard/ManagerBottomSheet';
import { EmptyState, ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { SearchInput } from '@/components/dashboard/SearchInput';
import { StatTile } from '@/components/dashboard/StatTile';
import { managerColors } from '@/components/dashboard/theme';
import { DateRangeFilter, resolveReportRange, type DateFilterType } from '@/features/reports/DateRangeFilter';
import { useBranches } from '@/hooks/useBranches';
import { useClientPagination } from '@/hooks/useClientPagination';
import {
  useReturnDiscrepanciesReport,
  useTransferDiscrepanciesReport,
} from '@/hooks/useReconciliation';
import { getErrorMessage } from '@/lib/errors';

type DiscrepancyFilterType = 'all' | 'missing' | 'excess';
type StatusFilter = 'all' | 'open' | 'resolved';

const TYPE_OPTIONS: Array<{ label: string; value: DiscrepancyFilterType }> = [
  { label: 'All', value: 'all' },
  { label: 'Missing', value: 'missing' },
  { label: 'Excess', value: 'excess' },
];

const STATUS_OPTIONS: Array<{ label: string; value: StatusFilter }> = [
  { label: 'All', value: 'all' },
  { label: 'Open', value: 'open' },
  { label: 'Resolved', value: 'resolved' },
];

const DATE_RANGE_LABELS: Record<DateFilterType, string> = {
  all_time: 'All Time',
  today: 'Today',
  this_week: 'This Week',
  this_month: 'This Month',
  custom: 'Custom range',
};

export function TransferDiscrepanciesReportScreen({
  detailHref,
}: {
  detailHref: (id: string) => string;
}) {
  const branches = useBranches();
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [discrepancyType, setDiscrepancyType] = useState<DiscrepancyFilterType>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [rangeType, setRangeType] = useState<DateFilterType>('today');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [search, setSearch] = useState('');
  const [dateOpen, setDateOpen] = useState(false);
  const [typeOpen, setTypeOpen] = useState(false);

  const { rpcRangeType, startIso, endIso } = resolveReportRange(rangeType, customStart, customEnd);
  const query = useTransferDiscrepanciesReport(
    selectedBranchId || undefined,
    discrepancyType,
    rpcRangeType,
    startIso,
    endIso,
  );

  const discrepancies = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (query.data ?? []).filter((item) => {
      if (statusFilter !== 'all' && (item.status ?? 'open') !== statusFilter) return false;
      if (!term) return true;
      return `${item.transfer_number} ${item.product_name} ${item.product_sku} ${item.branch_name}`
        .toLowerCase()
        .includes(term);
    });
  }, [query.data, statusFilter, search]);
  const pagination = useClientPagination(
    discrepancies,
    `${selectedBranchId}|${discrepancyType}|${statusFilter}|${rangeType}|${customStart}|${customEnd}|${search}`,
    10,
  );
  const totalMissing = discrepancies
    .filter((d) => d.discrepancy_type === 'missing')
    .reduce((acc, d) => acc + Number(d.difference), 0);
  const totalExcess = discrepancies
    .filter((d) => d.discrepancy_type === 'excess')
    .reduce((acc, d) => acc + Math.abs(Number(d.difference)), 0);

  const branchOptions = [
    { label: 'All branches', value: '' },
    ...(branches.data?.filter((b) => !b.is_main_branch).map((b) => ({ label: b.name, value: b.id })) ?? []),
  ];

  return (
    <Screen backgroundColor="#FFFFFF" edges={['top']} contentContainerStyle={styles.screenContent}>
      <ManagerScreenHeader title="Transfer Discrepancies" showBack />
      <ConstrainedWidth style={styles.column}>
        <View style={styles.searchRow}>
          <View style={styles.searchField}>
            <SearchInput value={search} onChangeText={setSearch} placeholder="Search transfer # or branch" />
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Type: ${TYPE_OPTIONS.find((option) => option.value === discrepancyType)?.label}`}
            onPress={() => setTypeOpen(true)}
            style={({ pressed }) => [
              styles.iconButton,
              discrepancyType !== 'all' && styles.iconButtonActive,
              pressed && styles.pressed,
            ]}
          >
            <Ionicons
              name="options-outline"
              size={20}
              color={discrepancyType !== 'all' ? managerColors.royalBlue : managerColors.ink}
            />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Date range: ${DATE_RANGE_LABELS[rangeType]}`}
            onPress={() => setDateOpen(true)}
            style={({ pressed }) => [
              styles.iconButton,
              rangeType !== 'all_time' && styles.iconButtonActive,
              pressed && styles.pressed,
            ]}
          >
            <Ionicons
              name="calendar-outline"
              size={20}
              color={rangeType !== 'all_time' ? managerColors.royalBlue : managerColors.ink}
            />
          </Pressable>
        </View>
        <View style={styles.filterRow}>
          <View style={styles.filterItem}>
            <FilterDropdown label="Status" options={STATUS_OPTIONS} value={statusFilter} onChange={setStatusFilter} />
          </View>
          <View style={styles.filterItem}>
            <FilterDropdown label="Destination branch" options={branchOptions} value={selectedBranchId} onChange={setSelectedBranchId} />
          </View>
        </View>

        <StatTile
          layout="wide"
          emphasis
          icon="document-text-outline"
          label="Discrepancy records"
          value={discrepancies.length}
        />
        <View style={styles.statsRow}>
          <StatTile style={styles.statHalf} compact icon="arrow-down-circle-outline" label="Total missing items" value={totalMissing} />
          <StatTile style={styles.statHalf} compact icon="arrow-up-circle-outline" label="Total excess items" value={totalExcess} />
        </View>

        {query.isLoading ? <LoadingState label="Loading transfer discrepancies…" /> : null}
        {query.error ? (
          <ErrorState message={getErrorMessage(query.error)} onRetry={() => void query.refetch()} />
        ) : null}
        {rangeType === 'custom' && !query.isFetched && !query.isLoading ? (
          <EmptyState title="Select a date range" message="Enter both a start date and an end date to run this report." />
        ) : null}
        {discrepancies.length === 0 && !query.isLoading && query.isFetched ? (
          <EmptyState
            title="No transfer discrepancies"
            message="Notes appear when a cashier reports a short or over shipment instead of confirming the full sent quantity."
          />
        ) : null}

        {pagination.pageItems.map((item) => {
          const isMissing = item.discrepancy_type === 'missing';
          const status = item.status ?? 'open';
          return (
            <ListRowCard
              key={item.id}
              title={item.transfer_number}
              meta={`${item.branch_name} · Sent ${item.quantity_sent} → Received ${item.quantity_received}`}
              trailing={
                <View style={styles.trailing}>
                  <ManagerBadge label={status === 'resolved' ? 'Resolved' : 'Open'} tone={status === 'resolved' ? 'success' : 'warning'} />
                  <ManagerBadge
                    label={isMissing ? `${item.difference} missing` : `${Math.abs(item.difference)} excess`}
                    tone={isMissing ? 'danger' : 'warning'}
                  />
                </View>
              }
              onPress={() => router.push(detailHref(item.id) as never)}
            />
          );
        })}
        {pagination.showPagination ? (
          <View style={styles.pager}>
            <Pagination page={pagination.page} totalPages={pagination.totalPages} onPageChange={pagination.setPage} />
          </View>
        ) : null}
      </ConstrainedWidth>

      <ManagerBottomSheet visible={dateOpen} title="Date range" scroll onClose={() => setDateOpen(false)}>
        <View style={styles.sheetBody}>
          <DateRangeFilter
            value={rangeType}
            onChange={(value) => {
              setRangeType(value);
              if (value !== 'custom') setDateOpen(false);
            }}
            customStart={customStart}
            customEnd={customEnd}
            onCustomStartChange={setCustomStart}
            onCustomEndChange={setCustomEnd}
          />
        </View>
      </ManagerBottomSheet>

      <ManagerBottomSheet visible={typeOpen} title="Type" onClose={() => setTypeOpen(false)}>
        <View style={styles.sortList}>
          {TYPE_OPTIONS.map((option) => {
            const isSelected = option.value === discrepancyType;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                onPress={() => {
                  setDiscrepancyType(option.value);
                  setTypeOpen(false);
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
    </Screen>
  );
}

export function ReturnDiscrepanciesReportScreen({
  detailHref,
}: {
  detailHref: (id: string) => string;
}) {
  const branches = useBranches();
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [discrepancyType, setDiscrepancyType] = useState<DiscrepancyFilterType>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [rangeType, setRangeType] = useState<DateFilterType>('today');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [search, setSearch] = useState('');
  const [dateOpen, setDateOpen] = useState(false);
  const [typeOpen, setTypeOpen] = useState(false);

  const { rpcRangeType, startIso, endIso } = resolveReportRange(rangeType, customStart, customEnd);
  const query = useReturnDiscrepanciesReport(
    selectedBranchId || undefined,
    discrepancyType,
    rpcRangeType,
    startIso,
    endIso,
  );

  const discrepancies = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (query.data ?? []).filter((item) => {
      if (statusFilter !== 'all' && (item.status ?? 'open') !== statusFilter) return false;
      if (!term) return true;
      return `${item.return_number} ${item.product_name} ${item.product_sku} ${item.branch_name}`
        .toLowerCase()
        .includes(term);
    });
  }, [query.data, statusFilter, search]);
  const pagination = useClientPagination(
    discrepancies,
    `${selectedBranchId}|${discrepancyType}|${statusFilter}|${rangeType}|${customStart}|${customEnd}|${search}`,
    10,
  );
  const totalMissing = discrepancies
    .filter((d) => d.discrepancy_type === 'missing')
    .reduce((acc, d) => acc + Number(d.difference), 0);
  const totalExcess = discrepancies
    .filter((d) => d.discrepancy_type === 'excess')
    .reduce((acc, d) => acc + Math.abs(Number(d.difference)), 0);

  const branchOptions = [
    { label: 'All branches', value: '' },
    ...(branches.data?.filter((b) => !b.is_main_branch).map((b) => ({ label: b.name, value: b.id })) ?? []),
  ];

  return (
    <Screen backgroundColor="#FFFFFF" edges={['top']} contentContainerStyle={styles.screenContent}>
      <ManagerScreenHeader title="Return Discrepancies" showBack />
      <ConstrainedWidth style={styles.column}>
        <View style={styles.searchRow}>
          <View style={styles.searchField}>
            <SearchInput value={search} onChangeText={setSearch} placeholder="Search return # or branch" />
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Type: ${TYPE_OPTIONS.find((option) => option.value === discrepancyType)?.label}`}
            onPress={() => setTypeOpen(true)}
            style={({ pressed }) => [
              styles.iconButton,
              discrepancyType !== 'all' && styles.iconButtonActive,
              pressed && styles.pressed,
            ]}
          >
            <Ionicons
              name="options-outline"
              size={20}
              color={discrepancyType !== 'all' ? managerColors.royalBlue : managerColors.ink}
            />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Date range: ${DATE_RANGE_LABELS[rangeType]}`}
            onPress={() => setDateOpen(true)}
            style={({ pressed }) => [
              styles.iconButton,
              rangeType !== 'all_time' && styles.iconButtonActive,
              pressed && styles.pressed,
            ]}
          >
            <Ionicons
              name="calendar-outline"
              size={20}
              color={rangeType !== 'all_time' ? managerColors.royalBlue : managerColors.ink}
            />
          </Pressable>
        </View>
        <View style={styles.filterRow}>
          <View style={styles.filterItem}>
            <FilterDropdown label="Status" options={STATUS_OPTIONS} value={statusFilter} onChange={setStatusFilter} />
          </View>
          <View style={styles.filterItem}>
            <FilterDropdown label="Returning branch" options={branchOptions} value={selectedBranchId} onChange={setSelectedBranchId} />
          </View>
        </View>

        <StatTile
          layout="wide"
          emphasis
          icon="document-text-outline"
          label="Discrepancy records"
          value={discrepancies.length}
        />
        <View style={styles.statsRow}>
          <StatTile style={styles.statHalf} compact icon="arrow-down-circle-outline" label="Total missing items" value={totalMissing} />
          <StatTile style={styles.statHalf} compact icon="arrow-up-circle-outline" label="Total excess items" value={totalExcess} />
        </View>

        {query.isLoading ? <LoadingState label="Loading return discrepancies…" /> : null}
        {query.error ? (
          <ErrorState message={getErrorMessage(query.error)} onRetry={() => void query.refetch()} />
        ) : null}
        {rangeType === 'custom' && !query.isFetched && !query.isLoading ? (
          <EmptyState title="Select a date range" message="Enter both a start date and an end date to run this report." />
        ) : null}
        {discrepancies.length === 0 && !query.isLoading && query.isFetched ? (
          <EmptyState title="No return discrepancies" message="All return receipts matched the quantities returned." />
        ) : null}

        {pagination.pageItems.map((item) => {
          const isMissing = item.discrepancy_type === 'missing';
          const status = item.status ?? 'open';
          return (
            <ListRowCard
              key={item.id}
              title={item.return_number}
              meta={`${item.branch_name} · Returned ${item.quantity_returned} → Received ${item.quantity_received}`}
              trailing={
                <View style={styles.trailing}>
                  <ManagerBadge label={status === 'resolved' ? 'Resolved' : 'Open'} tone={status === 'resolved' ? 'success' : 'warning'} />
                  <ManagerBadge
                    label={isMissing ? `${item.difference} missing` : `${Math.abs(item.difference)} excess`}
                    tone={isMissing ? 'danger' : 'warning'}
                  />
                </View>
              }
              onPress={() => router.push(detailHref(item.id) as never)}
            />
          );
        })}
        {pagination.showPagination ? (
          <View style={styles.pager}>
            <Pagination page={pagination.page} totalPages={pagination.totalPages} onPageChange={pagination.setPage} />
          </View>
        ) : null}
      </ConstrainedWidth>

      <ManagerBottomSheet visible={dateOpen} title="Date range" scroll onClose={() => setDateOpen(false)}>
        <View style={styles.sheetBody}>
          <DateRangeFilter
            value={rangeType}
            onChange={(value) => {
              setRangeType(value);
              if (value !== 'custom') setDateOpen(false);
            }}
            customStart={customStart}
            customEnd={customEnd}
            onCustomStartChange={setCustomStart}
            onCustomEndChange={setCustomEnd}
          />
        </View>
      </ManagerBottomSheet>

      <ManagerBottomSheet visible={typeOpen} title="Type" onClose={() => setTypeOpen(false)}>
        <View style={styles.sortList}>
          {TYPE_OPTIONS.map((option) => {
            const isSelected = option.value === discrepancyType;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                onPress={() => {
                  setDiscrepancyType(option.value);
                  setTypeOpen(false);
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
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenContent: { flexGrow: 1, padding: 0, gap: 0 },
  column: { padding: 20, gap: 12 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  searchField: { flex: 1 },
  iconButton: {
    width: 46,
    height: 46,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    backgroundColor: managerColors.cardSurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButtonActive: { borderColor: managerColors.royalBlue, backgroundColor: '#EAF0FB' },
  pressed: { opacity: 0.75 },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  filterItem: { flexGrow: 1, flexBasis: 140, minWidth: 140 },
  sheetBody: { gap: 14, paddingBottom: 8 },
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
  statsRow: { flexDirection: 'row', gap: 10 },
  statHalf: { flex: 1 },
  trailing: { alignItems: 'flex-end', gap: 6 },
  pager: { paddingVertical: 8 },
});
