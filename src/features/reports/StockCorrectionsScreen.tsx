import Ionicons from '@react-native-vector-icons/ionicons';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { Pagination } from '@/components/Pagination';
import { Screen } from '@/components/Screen';
import { EmptyState, ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { SearchInput } from '@/components/dashboard/SearchInput';
import { managerColors } from '@/components/dashboard/theme';
import { CorrectionCoverageNotice } from '@/features/reports/CorrectionCoverageNotice';
import { DateRangeFilter, type DateFilterType } from '@/features/reports/DateRangeFilter';
import { scopeVoidLogRows } from '@/features/reports/voidLogs';
import { useClientPagination } from '@/hooks/useClientPagination';
import { useStockCorrectionScan } from '@/hooks/useStockCorrectionScan';
import { getErrorMessage } from '@/lib/errors';
import type { CorrectionHistory } from '@/services/stockCorrectionService';

import {
  correctionChange,
  correctionDirection,
  correctionQuantityLine,
  formatCorrectionChange,
  formatCorrectionTime,
} from './stockCorrectionDisplay';
import { correctionCoverage, netChangeText, summarizeCorrections } from './stockCorrectionBranches';
import { correctionDateWindow, correctionEmptyState, filterCorrections, hasCorrectionFilters } from './stockCorrectionFilters';

const CHANGE_COLORS = {
  increase: { bg: '#DCFCE7', text: '#15803D' },
  decrease: { bg: '#FEE2E2', text: '#B91C1C' },
  none: { bg: '#EAF0FB', text: managerColors.subtext },
} as const;

/** The corrections of one branch are shown 10 to a page, like Void logs. */
const PAGE_SIZE = 10;

function CorrectionCard({ row }: { row: CorrectionHistory }) {
  const change = correctionChange(row.details);
  const tone = CHANGE_COLORS[correctionDirection(change)];
  return (
    <View style={styles.card}>
      <View style={styles.top}>
        <View style={styles.iconChip}>
          <Ionicons name="create-outline" size={18} color={managerColors.royalBlue} />
        </View>
        <View style={styles.titleCol}>
          <Text style={styles.product} numberOfLines={2}>{row.product_name}</Text>
          <Text style={styles.meta} numberOfLines={1}>{row.cashier_name}</Text>
        </View>
        <View style={[styles.changePill, { backgroundColor: tone.bg }]}>
          <Text style={[styles.changeText, { color: tone.text }]}>{formatCorrectionChange(change)}</Text>
        </View>
      </View>
      <Text style={styles.meta}>{row.details.action === 'add' ? 'Added stock' : 'Recount'}</Text>
      <Text style={styles.quantity}>{correctionQuantityLine(row.details, row.stock_unit_code)}</Text>
      <View style={styles.bottom}>
        <View style={styles.reasonPill}>
          <Text style={styles.reasonText}>{row.details.reason}</Text>
        </View>
        <Text style={styles.time}>{formatCorrectionTime(row.created_at)}</Text>
      </View>
    </View>
  );
}

export type StockCorrectionsScreenProps = {
  branchId?: string;
  /** The selling branch's name. Undefined when the branch is unknown, or is the Main Branch (it makes no corrections). */
  branchName?: string;
  branchLookupPending?: boolean;
  initialRangeType?: DateFilterType;
  initialCustomStart?: string;
  initialCustomEnd?: string;
};

/**
 * Stock corrections > one branch. Same flow as Void logs and Waste History: opened from the All branches overview with the same
 * date range. The server can only list corrections page by page, so this works on the newest 500 first, offers "Load older
 * corrections" for the rest, and says so whenever the figures might not be the whole story.
 */
export default function StockCorrectionsScreen({
  branchId,
  branchName,
  branchLookupPending = false,
  initialRangeType = 'all_time',
  initialCustomStart = '',
  initialCustomEnd = '',
}: StockCorrectionsScreenProps = {}) {
  const [search, setSearch] = useState('');
  const [rangeType, setRangeType] = useState<DateFilterType>(initialRangeType);
  const [customStart, setCustomStart] = useState(initialCustomStart);
  const [customEnd, setCustomEnd] = useState(initialCustomEnd);
  const filters = { rangeType, customStart, customEnd };
  const customIncomplete = rangeType === 'custom' && correctionDateWindow(filters) === null;

  const query = useStockCorrectionScan();
  const scan = query.data;

  // only this branch's corrections (the server list is company-wide); no branch chosen is not "everything"
  const scope = useMemo(
    () => (branchId ? scopeVoidLogRows(scan?.rows, { branchId, branchName, branchLookupPending }) : { rows: [], waitingForBranch: false, branchMissing: true }),
    [scan, branchId, branchName, branchLookupPending],
  );
  const scoped = scope.rows;
  const active = { search, branch: 'all', rangeType, customStart, customEnd };
  const filtered = useMemo(() => (customIncomplete ? [] : filterCorrections(scoped, active)), [scoped, customIncomplete, search, rangeType, customStart, customEnd]);
  const totals = useMemo(() => summarizeCorrections(filtered), [filtered]);
  const coverage = useMemo(() => correctionCoverage(scan, filters), [scan, rangeType, customStart, customEnd]);
  const pagination = useClientPagination(filtered, `${branchId ?? ''}|${search}|${rangeType}|${customStart}|${customEnd}`, PAGE_SIZE);

  const pending = scope.waitingForBranch || query.isPending;
  const showRows = !pending && !query.error && !scope.branchMissing && !customIncomplete;
  const filtering = hasCorrectionFilters(active);
  const empty = correctionEmptyState({ filtering, page: 0, complete: coverage.complete });
  const centered = !pending && !query.error && (scope.branchMissing || customIncomplete || (filtered.length === 0 && !filtering && coverage.complete));
  const net = netChangeText(totals);

  return (
    <Screen
      backgroundColor="#FFFFFF"
      edges={['top']}
      refreshing={query.isRefetching}
      onRefresh={() => void query.refetch()}
      contentContainerStyle={styles.screen}
    >
      <ManagerScreenHeader title="Stock corrections" subtitle={branchName || undefined} showBack />
      <ConstrainedWidth fill={centered} style={[styles.column, centered && styles.centered]}>
        <View style={styles.filters}>
          <SearchInput value={search} onChangeText={setSearch} placeholder="Search product" />
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
          {showRows ? (
            <View style={styles.summary}>
              <Text style={styles.count}>{`${filtered.length} of ${scoped.length} ${scoped.length === 1 ? 'correction' : 'corrections'}`}</Text>
              {net ? <Text style={styles.net}>{net}</Text> : null}
            </View>
          ) : null}
          {showRows && !coverage.complete && coverage.note ? (
            <CorrectionCoverageNotice
              message={coverage.note}
              onLoadOlder={coverage.canLoadOlder ? query.loadOlder : undefined}
              loading={query.loadingOlder}
              error={query.olderError ? getErrorMessage(query.olderError) : null}
            />
          ) : null}
        </View>

        {query.error ? <ErrorState message={getErrorMessage(query.error)} onRetry={() => void query.refetch()} /> : null}
        {pending ? <LoadingState label="Loading stock corrections…" /> : null}
        {scope.branchMissing && !pending && !query.error ? (
          <EmptyState title="Branch not found" message="Open Stock corrections and choose a selling branch." />
        ) : null}
        {customIncomplete && !pending && !query.error ? (
          <EmptyState title="Select a date range" message="Enter both a start date and an end date to run this report." />
        ) : null}
        {showRows && filtered.length === 0 ? <EmptyState title={empty.title} message={empty.message} /> : null}

        {showRows ? pagination.pageItems.map((row) => <CorrectionCard key={row.id} row={row} />) : null}

        {showRows ? (
          <Pagination page={pagination.page} totalPages={pagination.totalPages} visible={pagination.showPagination} onPageChange={pagination.setPage} />
        ) : null}
      </ConstrainedWidth>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { flexGrow: 1, padding: 0, gap: 0 },
  column: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 24, gap: 12 },
  centered: { flexGrow: 1, justifyContent: 'center', paddingBottom: 64 },
  filters: { gap: 12 },
  filterBleed: { marginHorizontal: -20 },
  summary: { gap: 2 },
  count: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 12.5 },
  net: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  card: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 16,
    padding: 14,
    gap: 8,
  },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconChip: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E3EBFA' },
  titleCol: { flex: 1, minWidth: 0, gap: 1 },
  product: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 15 },
  meta: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12 },
  changePill: { minWidth: 44, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, alignItems: 'center' },
  changeText: { fontFamily: 'Inter_700Bold', fontSize: 13 },
  quantity: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 17 },
  bottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  reasonPill: { flexShrink: 1, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: '#EAF0FB' },
  reasonText: { color: managerColors.royalBlue, fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  time: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12 },
});
