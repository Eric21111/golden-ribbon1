import Ionicons from '@react-native-vector-icons/ionicons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { Pagination } from '@/components/Pagination';
import { EmptyState, ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { Screen } from '@/components/Screen';
import { FilterChipRow } from '@/components/dashboard/FilterChipRow';
import { ListRowCard } from '@/components/dashboard/ListRowCard';
import { ManagerBadge } from '@/components/dashboard/ManagerBadge';
import { ManagerBottomSheet as BottomSheet } from '@/components/dashboard/ManagerBottomSheet';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { SearchInput } from '@/components/dashboard/SearchInput';
import { returnStatusBadgeLabel, returnStatusTone } from '@/components/dashboard/statusTone';
import { managerColors } from '@/components/dashboard/theme';
import { useAuth } from '@/features/auth/AuthProvider';
import { DateRangeFilter, type DateFilterType } from '@/features/reports/DateRangeFilter';
import type { StockReturnSummary } from '@/features/returns/ReturnListItem';
import { MANAGER_RETURN_STATUS_CHOICES, returnFilterEmptyMessage, type ReturnStatusFilter } from '@/features/returns/returnFilters';
import { useClientPagination } from '@/hooks/useClientPagination';
import { useReturns } from '@/hooks/useReturns';
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

export default function ManagerReturnsScreen() {
  const { profile } = useAuth();
  const [status, setStatus] = useState<ReturnStatusFilter>('in_transit');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortOption>('newest');
  const [sortOpen, setSortOpen] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const [dateRange, setDateRange] = useState<DateFilterType>('all_time');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const query = useReturns(profile?.branch_id ?? '', status);
  const returns = (query.data as StockReturnSummary[] | undefined) ?? [];

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    let rows = !term
      ? [...returns]
      : returns.filter((item) =>
          `${item.return_number} ${item.from_branch_name} ${item.to_branch_name}`.toLowerCase().includes(term),
        );

    const bounds = resolveDateBounds(dateRange, customStart, customEnd);
    if (bounds) {
      const startMs = Date.parse(bounds.start);
      const endMs = Date.parse(bounds.end);
      rows = rows.filter((item) => {
        const ms = Date.parse(item.created_at);
        return ms >= startMs && ms < endMs;
      });
    }

    return rows.sort((a, b) =>
      sort === 'oldest'
        ? a.created_at.localeCompare(b.created_at)
        : b.created_at.localeCompare(a.created_at),
    );
  }, [returns, search, sort, dateRange, customStart, customEnd]);

  const pagination = useClientPagination(
    filtered,
    `${search}|${status}|${sort}|${dateRange}|${customStart}|${customEnd}`,
    10,
  );

  const empty =
    status === '' && !search.trim() && dateRange === 'all_time'
      ? { title: 'No returns yet', message: 'Cashiers create returns from selling branches. Main receives them here.' }
      : returnFilterEmptyMessage(status, Boolean(search.trim()) || dateRange !== 'all_time');

  if (!profile?.branch_id) {
    return (
      <Screen backgroundColor="#FFFFFF" edges={['top']} scroll={false} contentContainerStyle={styles.screenContent}>
        <ManagerScreenHeader title="Returns" subtitle="Assigned branch unavailable" />
        <EmptyState title="No assigned branch" message="Ask an owner to assign you to a branch." />
      </Screen>
    );
  }

  return (
    <Screen backgroundColor="#FFFFFF" edges={['top']} scroll={false} contentContainerStyle={styles.screenContent}>
      <ManagerScreenHeader title="Stock Returns" subtitle={profile.branch?.name ?? 'Unsold stock to Main Branch'} />

      <ConstrainedWidth style={styles.column}>
        <View style={styles.filters}>
          <View style={styles.searchRow}>
            <View style={styles.searchField}>
              <SearchInput value={search} onChangeText={setSearch} placeholder="Search return # or branch" />
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Sort: ${SORT_OPTIONS.find((option) => option.value === sort)?.label}`}
              onPress={() => setSortOpen(true)}
              style={({ pressed }) => [styles.sortButton, pressed && styles.pressed]}
            >
              <Ionicons name="options-outline" size={20} color={managerColors.ink} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Date range: ${DATE_RANGE_LABELS[dateRange]}`}
              onPress={() => setDateOpen(true)}
              style={({ pressed }) => [
                styles.sortButton,
                dateRange !== 'all_time' && styles.sortButtonActive,
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
          <FilterChipRow options={MANAGER_RETURN_STATUS_CHOICES} value={status} onChange={setStatus} />
        </View>

        {query.error ? (
          <ErrorState message={getErrorMessage(query.error)} onRetry={() => void query.refetch()} />
        ) : query.isLoading && !query.data ? (
          <LoadingState label="Loading returns…" />
        ) : (
          <FlatList
            data={pagination.pageItems}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            refreshControl={
              <RefreshControl
                refreshing={query.isRefetching}
                onRefresh={() => void query.refetch()}
                tintColor={managerColors.royalBlue}
              />
            }
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
              const productCount = item.items[0]?.count ?? 0;
              return (
                <ListRowCard
                  title={item.return_number}
                  subtitle={`${item.from_branch_name} → ${item.to_branch_name}`}
                  meta={`${productCount} ${productCount === 1 ? 'item' : 'items'} · ${formatDateShort(item.returned_at)}`}
                  trailing={
                    <ManagerBadge label={returnStatusBadgeLabel(item.status)} tone={returnStatusTone(item.status)} size="md" />
                  }
                  onPress={() => router.push({ pathname: '/manager/returns/[id]', params: { id: item.id } })}
                />
              );
            }}
          />
        )}
      </ConstrainedWidth>

      <BottomSheet visible={sortOpen} title="Sort" onClose={() => setSortOpen(false)}>
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
      </BottomSheet>

      <BottomSheet visible={dateOpen} title="Date range" scroll onClose={() => setDateOpen(false)}>
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
      </BottomSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenContent: { flexGrow: 1, padding: 0, gap: 0 },
  column: { flex: 1, paddingHorizontal: 20, paddingTop: 16 },
  filters: { gap: 12, marginBottom: 14 },
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
  sortButtonActive: { borderColor: managerColors.royalBlue, backgroundColor: '#EAF0FB' },
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
  separator: { height: 10 },
  pager: { alignItems: 'center', gap: 4, paddingTop: 8 },
});
