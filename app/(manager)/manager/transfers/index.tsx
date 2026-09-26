import Ionicons from '@react-native-vector-icons/ionicons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { FilterDropdown } from '@/components/FilterDropdown';
import { Pagination } from '@/components/Pagination';
import { EmptyState, ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { Screen } from '@/components/Screen';
import { ListRowCard } from '@/components/dashboard/ListRowCard';
import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { ManagerBadge } from '@/components/dashboard/ManagerBadge';
import { ManagerBottomSheet } from '@/components/dashboard/ManagerBottomSheet';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { SearchInput } from '@/components/dashboard/SearchInput';
import { transferStatusBadgeLabel, transferStatusTone } from '@/components/dashboard/statusTone';
import { managerColors } from '@/components/dashboard/theme';
import { useAuth } from '@/features/auth/AuthProvider';
import { isMainBranchManager } from '@/features/auth/roles';
import { DateRangeFilter, type DateFilterType } from '@/features/reports/DateRangeFilter';
import {
  MANAGER_STATUS_CHOICES,
  OWNER_STATUS_CHOICES,
  transferFilterEmptyMessage,
  type TransferStatusFilter,
} from '@/features/transfers/transferFilters';
import { useBranches } from '@/hooks/useBranches';
import { useClientPagination } from '@/hooks/useClientPagination';
import { useTransfers } from '@/hooks/useTransfers';
import { getErrorMessage } from '@/lib/errors';
import {
  formatDateShort,
  getThisMonthRangeManila,
  getThisWeekRangeManila,
  getTodayRangeManila,
  toNextDayStartManila,
  toStartOfDayManila,
} from '@/lib/format';

type SortOption = 'newest' | 'oldest';

const SORT_OPTIONS: Array<{ label: string; value: SortOption }> = [
  { label: 'Newest first', value: 'newest' },
  { label: 'Oldest first', value: 'oldest' },
];

const DATE_RANGE_LABELS: Record<DateFilterType, string> = {
  all_time: 'All Time',
  today: 'Today',
  this_week: 'This Week',
  this_month: 'This Month',
  custom: 'Custom range',
};

/** Local (non-report) date-range filtering — resolves a preset or custom range to real bounds. */
function resolveDateBounds(
  rangeType: DateFilterType,
  customStart: string,
  customEnd: string,
): { start: string; end: string } | null {
  if (rangeType === 'today') return getTodayRangeManila();
  if (rangeType === 'this_week') return getThisWeekRangeManila();
  if (rangeType === 'this_month') return getThisMonthRangeManila();
  if (rangeType === 'custom' && customStart && customEnd) {
    const start = toStartOfDayManila(customStart);
    const end = toNextDayStartManila(customEnd);
    if (start && end) return { start, end };
  }
  return null;
}

export default function TransferHistoryScreen() {
  const { profile } = useAuth();
  const isMain = isMainBranchManager(profile);
  const [branchId, setBranchId] = useState('');
  const [status, setStatus] = useState<TransferStatusFilter>(isMain ? '' : 'pending_receipt');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortOption>('newest');
  const [sortOpen, setSortOpen] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const [dateRange, setDateRange] = useState<DateFilterType>('all_time');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const branches = useBranches();
  const sellingBranches = branches.data?.filter((branch) => !branch.is_main_branch) ?? [];
  const query = useTransfers(isMain ? branchId : (profile?.branch_id ?? ''), status);

  const destinationOptions = useMemo(
    () => [{ label: 'All branches', value: '' }, ...sellingBranches.map((b) => ({ label: b.name, value: b.id }))],
    [sellingBranches],
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    let rows = !term
      ? [...(query.data ?? [])]
      : (query.data ?? []).filter((transfer) => {
          const haystack = [transfer.transfer_number, transfer.from_branch?.name ?? '', transfer.to_branch?.name ?? '']
            .join(' ')
            .toLowerCase();
          return haystack.includes(term);
        });

    const bounds = resolveDateBounds(dateRange, customStart, customEnd);
    if (bounds) {
      const startMs = Date.parse(bounds.start);
      const endMs = Date.parse(bounds.end);
      rows = rows.filter((transfer) => {
        const ms = Date.parse(transfer.created_at);
        return ms >= startMs && ms < endMs;
      });
    }

    return rows.sort((a, b) =>
      sort === 'oldest'
        ? a.created_at.localeCompare(b.created_at)
        : b.created_at.localeCompare(a.created_at),
    );
  }, [query.data, search, sort, dateRange, customStart, customEnd]);

  const pagination = useClientPagination(
    filtered,
    `${search}|${status}|${branchId}|${sort}|${dateRange}|${customStart}|${customEnd}`,
    10,
  );

  const empty =
    status === '' && !search.trim() && !branchId && dateRange === 'all_time'
      ? {
          title: 'No transfer history',
          message: isMain ? 'Create a transfer to send Main Branch stock.' : 'Transfers sent to your branch will appear here.',
        }
      : transferFilterEmptyMessage(status, Boolean(search.trim()), Boolean(branchId) || dateRange !== 'all_time');

  const title = isMain ? 'Transfers' : 'Transfer History';
  const subtitle = isMain ? 'Main → branches' : (profile?.branch?.name ?? 'Assigned branch');

  if (!isMain && !profile?.branch_id) {
    return (
      <Screen backgroundColor="#FFFFFF" edges={['top']} scroll={false} contentContainerStyle={styles.screenContent}>
        <ManagerScreenHeader title="Transfer History" subtitle="Assigned branch unavailable" />
        <EmptyState title="No assigned branch" message="Ask a Main Branch Manager to assign you to a branch." />
      </Screen>
    );
  }

  if (isMain && branches.isLoading && !branches.data) {
    return (
      <Screen backgroundColor="#FFFFFF" edges={['top']} scroll={false} contentContainerStyle={styles.screenContent}>
        <ManagerScreenHeader title={title} subtitle={subtitle} />
        <LoadingState label="Loading transfers…" />
      </Screen>
    );
  }

  if (isMain && branches.error) {
    return (
      <Screen backgroundColor="#FFFFFF" edges={['top']} scroll={false} contentContainerStyle={styles.screenContent}>
        <ManagerScreenHeader title={title} subtitle={subtitle} />
        <ErrorState message={getErrorMessage(branches.error)} onRetry={() => void branches.refetch()} />
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
              <SearchInput value={search} onChangeText={setSearch} placeholder="Search transfer # or branch" />
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Sort: ${SORT_OPTIONS.find((option) => option.value === sort)?.label}`}
              onPress={() => setSortOpen(true)}
              style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
            >
              <Ionicons name="options-outline" size={20} color={managerColors.ink} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Date range: ${DATE_RANGE_LABELS[dateRange]}`}
              onPress={() => setDateOpen(true)}
              style={({ pressed }) => [
                styles.iconButton,
                dateRange !== 'all_time' && styles.iconButtonActive,
                pressed && styles.pressed,
              ]}
            >
              <Ionicons
                name="calendar-outline"
                size={20}
                color={dateRange !== 'all_time' ? managerColors.royalBlue : managerColors.ink}
              />
            </Pressable>
          </View>
          <View style={styles.filterRow}>
            <View style={isMain ? styles.filterItem : styles.filterItemFull}>
              <FilterDropdown
                label="Status"
                options={isMain ? OWNER_STATUS_CHOICES : MANAGER_STATUS_CHOICES}
                value={status}
                onChange={setStatus}
              />
            </View>
            {isMain ? (
              <View style={styles.filterItem}>
                <FilterDropdown label="Destination branch" options={destinationOptions} value={branchId} onChange={setBranchId} />
              </View>
            ) : null}
          </View>
        </View>

        {query.error ? (
          <ErrorState message={getErrorMessage(query.error)} onRetry={() => void query.refetch()} />
        ) : query.isLoading && !query.data ? (
          <LoadingState label="Loading transfers…" />
        ) : (
          <FlatList
            data={pagination.pageItems}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            refreshControl={<RefreshControl refreshing={Boolean(refreshing)} onRefresh={refresh} tintColor={managerColors.royalBlue} />}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            ListEmptyComponent={<EmptyState title={empty.title} message={empty.message} />}
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
            renderItem={({ item }) => {
              const productCount = item.items.length;
              return (
                <ListRowCard
                  title={item.transfer_number}
                  subtitle={`${item.from_branch?.name ?? 'Sending branch'} → ${item.to_branch?.name ?? 'Receiving branch'}`}
                  meta={`${productCount} ${productCount === 1 ? 'item' : 'items'} · ${formatDateShort(item.sent_at ?? item.created_at)}`}
                  trailing={
                    <ManagerBadge label={transferStatusBadgeLabel(item.status)} tone={transferStatusTone(item.status)} size="md" />
                  }
                  onPress={() => router.push({ pathname: '/manager/transfers/[id]', params: { id: item.id } } as never)}
                />
              );
            }}
          />
        )}

        {isMain ? (
          <View style={styles.footer}>
            <ManagerActionButton
              label="Create transfer"
              icon="add-circle-outline"
              onPress={() => router.push('/manager/transfers/create' as never)}
            />
          </View>
        ) : null}
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
                {isSelected ? <Ionicons name="checkmark" size={20} color={managerColors.royalBlue} /> : null}
              </Pressable>
            );
          })}
        </View>
      </ManagerBottomSheet>

      <ManagerBottomSheet visible={dateOpen} title="Date range" scroll onClose={() => setDateOpen(false)}>
        <View style={styles.dateSheetBody}>
          <DateRangeFilter
            value={dateRange}
            onChange={(value) => {
              setDateRange(value);
              if (value !== 'custom') setDateOpen(false);
            }}
            customStart={customStart}
            customEnd={customEnd}
            onCustomStartChange={setCustomStart}
            onCustomEndChange={setCustomEnd}
          />
        </View>
      </ManagerBottomSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenContent: { flexGrow: 1, padding: 0, gap: 0 },
  column: { flex: 1, paddingHorizontal: 20, paddingTop: 16 },
  filters: { gap: 12, marginBottom: 14 },
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
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  filterItem: { flexGrow: 1, flexBasis: 140, minWidth: 140 },
  filterItemFull: { flex: 1 },
  pressed: { opacity: 0.75 },
  dateSheetBody: { paddingBottom: 8 },
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
  listContent: { paddingBottom: 12, flexGrow: 1 },
  separator: { height: 12 },
  pager: { alignItems: 'center', gap: 4, paddingTop: 8 },
  footer: {
    marginHorizontal: -20,
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 16,
    borderTopWidth: 1,
    borderTopColor: managerColors.cardBorder,
    backgroundColor: '#FFFFFF',
    shadowColor: '#0A1224',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 4,
  },
});
