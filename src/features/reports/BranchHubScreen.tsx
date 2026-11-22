import Ionicons from '@react-native-vector-icons/ionicons';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { Pagination } from '@/components/Pagination';
import { Screen } from '@/components/Screen';
import { CurrencyText } from '@/components/dashboard/CurrencyText';
import { EmptyState, ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { StatTile } from '@/components/dashboard/StatTile';
import { managerColors } from '@/components/dashboard/theme';
import { ReportSectionHeading } from '@/features/reports/ReportSectionHeading';
import {
  firstSearchParam,
  parseReportDateFilter,
} from '@/features/reports/branchHub';
import {
  DateRangeFilter,
  resolveReportRange,
  shouldShowBranchOrderLog,
  type DateFilterType,
} from '@/features/reports/DateRangeFilter';
import { useBranches } from '@/hooks/useBranches';
import { useClientPagination } from '@/hooks/useClientPagination';
import { useBranchDailySales, useBranchSalesLog, useOwnerSalesByBranch } from '@/hooks/useSales';
import { getErrorMessage } from '@/lib/errors';
import {
  formatDate,
  formatManilaDate,
  formatMoney,
  isReportRangeReady,
  toNextDayStartManila,
  toStartOfDayManila,
} from '@/lib/format';
import type { SaleWithRelations } from '@/services/saleService';
import type { BranchDailySalesItem } from '@/types/models';

/** Sales-by-day rows per page on Branch Hub. */
const DAY_PAGE_SIZE = 5;

function businessDateKey(value: string): string {
  return value.slice(0, 10);
}

function formatSaleTime(value: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}

function OrderRows({
  sales,
  emptyMessage,
  nested = false,
}: {
  sales: SaleWithRelations[] | undefined;
  emptyMessage: string;
  /** Compact divider list inside an expanded day (no nested cards). */
  nested?: boolean;
}) {
  if (!sales?.length) {
    return <Text style={[styles.quietNote, nested && styles.quietNoteNested]}>{emptyMessage}</Text>;
  }
  return (
    <View style={nested ? styles.orderListNested : styles.orderList}>
      {sales.map((sale, index) => {
        const when = nested ? formatSaleTime(sale.sold_at) : formatDate(sale.sold_at);
        const cashier = sale.cashier?.full_name ?? 'Cashier';
        return (
          <View
            key={sale.id}
            style={[styles.orderRow, index > 0 && styles.orderRowDivider]}
          >
            <View style={[styles.receiptChip, nested && styles.receiptChipNested]}>
              <Ionicons name="receipt-outline" size={nested ? 15 : 16} color={managerColors.royalBlue} />
            </View>
            <View style={styles.orderCopy}>
              <Text style={styles.orderTitle}>{sale.sale_number}</Text>
              <Text style={styles.orderMeta}>{`${when} · ${cashier}`}</Text>
            </View>
            <CurrencyText
              value={formatMoney(sale.total_amount)}
              style={styles.amount}
              numberOfLines={1}
              adjustsFontSizeToFit
            />
          </View>
        );
      })}
    </View>
  );
}

/** Loads one Manila business day’s completed sales when that day is expanded. */
function DayOrdersPanel({ branchId, businessDate }: { branchId: string; businessDate: string }) {
  const day = businessDateKey(businessDate);
  const startIso = toStartOfDayManila(day);
  const endIso = toNextDayStartManila(day);
  const ready = Boolean(startIso && endIso);
  const log = useBranchSalesLog(ready ? branchId : '', 'custom', startIso, endIso);

  if (log.isLoading) return <LoadingState label="Loading sales…" />;
  if (log.error) {
    return <ErrorState message={getErrorMessage(log.error)} onRetry={() => void log.refetch()} />;
  }
  return (
    <View style={styles.ordersPanel}>
      <Text style={styles.ordersLabel}>ORDERS</Text>
      <OrderRows nested sales={log.data} emptyMessage="No completed sales on this day." />
    </View>
  );
}

function DaySalesRow({
  branchId,
  day,
  expanded,
  onToggle,
}: {
  branchId: string;
  day: BranchDailySalesItem;
  expanded: boolean;
  onToggle: () => void;
}) {
  const dateLabel = formatManilaDate(day.business_date);
  const txLabel = `${day.transaction_count} ${Number(day.transaction_count) === 1 ? 'sale' : 'sales'}`;

  return (
    <View style={styles.dayBlock}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${dateLabel}, ${txLabel}, ${expanded ? 'collapse' : 'expand'} orders`}
        onPress={onToggle}
        style={({ pressed }) => [styles.dayHeader, pressed && styles.pressed]}
      >
        <View style={styles.calendarChip}>
          <Ionicons name="calendar-outline" size={18} color={managerColors.royalBlue} />
        </View>
        <View style={styles.dayHeaderCopy}>
          <Text style={styles.dayTitle}>{dateLabel}</Text>
          <Text style={styles.dayMeta}>{txLabel}</Text>
        </View>
        <CurrencyText
          value={formatMoney(day.total_sales)}
          style={styles.amount}
          numberOfLines={1}
          adjustsFontSizeToFit
        />
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={managerColors.subtext}
        />
      </Pressable>
      {expanded ? (
        <View style={styles.dayOrders}>
          <DayOrdersPanel branchId={branchId} businessDate={day.business_date} />
        </View>
      ) : null}
    </View>
  );
}

/**
 * Owner-only per-branch hub: KPIs + inline sales detail.
 * Today / one-day → orders list. Longer ranges → sales by day with expandable orders.
 */
export function BranchHubScreen() {
  const params = useLocalSearchParams<{
    branchId?: string | string[];
    range?: string | string[];
    start?: string | string[];
    end?: string | string[];
  }>();
  const branchId = firstSearchParam(params.branchId);
  const initialRange = parseReportDateFilter(firstSearchParam(params.range));
  const initialStart = firstSearchParam(params.start);
  const initialEnd = firstSearchParam(params.end);

  const [rangeType, setRangeType] = useState<DateFilterType>(initialRange);
  const [customStart, setCustomStart] = useState(initialRange === 'custom' ? initialStart : '');
  const [customEnd, setCustomEnd] = useState(initialRange === 'custom' ? initialEnd : '');
  const [expandedDate, setExpandedDate] = useState<string | null>(null);

  const { rpcRangeType, startIso, endIso } = resolveReportRange(rangeType, customStart, customEnd);
  const ready = isReportRangeReady(rpcRangeType, startIso, endIso);
  const showOrders = shouldShowBranchOrderLog(rangeType, startIso, endIso);

  const branches = useBranches();
  const catalogBranch = useMemo(
    () => (branches.data ?? []).find((branch) => branch.id === branchId) ?? null,
    [branchId, branches.data],
  );

  const salesQuery = useOwnerSalesByBranch(rpcRangeType, startIso, endIso, Boolean(branchId) && ready);

  const branchRow = useMemo(
    () => (salesQuery.data ?? []).find((item) => item.branch_id === branchId) ?? null,
    [branchId, salesQuery.data],
  );

  const isMain = Boolean(catalogBranch?.is_main_branch);
  const sellingReady = Boolean(branchId) && ready && !isMain;

  const daysQuery = useBranchDailySales(
    sellingReady && !showOrders ? branchId : '',
    rpcRangeType,
    startIso,
    endIso,
  );
  const ordersQuery = useBranchSalesLog(
    sellingReady && showOrders ? branchId : '',
    rpcRangeType,
    startIso,
    endIso,
  );

  const isInactive = catalogBranch?.is_active === false || branchRow?.is_active === false;
  const titleName = branchRow?.branch_name ?? catalogBranch?.name ?? (branchId ? 'Branch' : 'Branch');
  const headerTitle = isInactive ? `Inactive · ${titleName}` : titleName;
  const statusLabel = isMain ? 'Main warehouse' : isInactive ? 'Inactive selling branch' : undefined;

  const days = daysQuery.data ?? [];
  const daysPagination = useClientPagination(
    days,
    `${branchId}|${rangeType}|${customStart}|${customEnd}`,
    DAY_PAGE_SIZE,
  );

  useEffect(() => {
    setExpandedDate(null);
  }, [branchId, rangeType, customStart, customEnd, daysPagination.page]);

  const salesValue =
    !ready || salesQuery.isLoading || salesQuery.isError
      ? '—'
      : formatMoney(Number(branchRow?.total_sales) || 0);
  const txValue =
    !ready || salesQuery.isLoading || salesQuery.isError
      ? '—'
      : Math.max(0, Math.trunc(Number(branchRow?.transaction_count) || 0));

  if (!branchId) {
    return (
      <Screen backgroundColor="#FFFFFF" edges={['top']} contentContainerStyle={styles.screenContent}>
        <ManagerScreenHeader title="Branch" showBack />
        <ConstrainedWidth style={styles.column}>
          <EmptyState title="Branch not found" message="Open Sales Overview and choose a branch." />
        </ConstrainedWidth>
      </Screen>
    );
  }

  return (
    <Screen
      refreshing={
        salesQuery.isRefetching ||
        daysQuery.isRefetching ||
        ordersQuery.isRefetching ||
        branches.isRefetching
      }
      onRefresh={
        ready
          ? () => {
              void salesQuery.refetch();
              void daysQuery.refetch();
              void ordersQuery.refetch();
              void branches.refetch();
            }
          : undefined
      }
      backgroundColor="#FFFFFF"
      edges={['top']}
      contentContainerStyle={styles.screenContent}
    >
      <ManagerScreenHeader title={headerTitle} subtitle={statusLabel} showBack />
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

        {!isMain ? (
          <>
            <StatTile layout="wide" emphasis icon="cash-outline" label="Total sales revenue" value={salesValue} />
            <StatTile layout="wide" icon="receipt-outline" label="Transactions" value={txValue} />
          </>
        ) : null}

        {rangeType === 'custom' && !ready ? (
          <EmptyState title="Select a date range" message="Enter both a start date and an end date." />
        ) : null}

        {ready && salesQuery.error ? (
          <ErrorState message={getErrorMessage(salesQuery.error)} onRetry={() => void salesQuery.refetch()} />
        ) : null}

        {ready && salesQuery.isLoading ? <LoadingState label="Loading branch summary…" /> : null}

        {!isMain && ready && !salesQuery.isLoading && !salesQuery.error && showOrders ? (
          <View style={styles.section}>
            <ReportSectionHeading title="ORDERS" />
            {ordersQuery.isLoading ? <LoadingState label="Loading sales…" /> : null}
            {ordersQuery.error ? (
              <ErrorState
                message={getErrorMessage(ordersQuery.error)}
                onRetry={() => void ordersQuery.refetch()}
              />
            ) : null}
            {!ordersQuery.isLoading && !ordersQuery.error ? (
              <OrderRows
                sales={ordersQuery.data}
                emptyMessage="No completed sales in this range. Older detailed sales may have been archived."
              />
            ) : null}
          </View>
        ) : null}

        {!isMain && ready && !salesQuery.isLoading && !salesQuery.error && !showOrders ? (
          <View style={styles.section}>
            <ReportSectionHeading title="SALES BY DAY" />
            {daysQuery.isLoading ? <LoadingState label="Loading daily totals…" /> : null}
            {daysQuery.error ? (
              <ErrorState message={getErrorMessage(daysQuery.error)} onRetry={() => void daysQuery.refetch()} />
            ) : null}
            {!daysQuery.isLoading && !daysQuery.error && days.length === 0 ? (
              <Text style={styles.quietNote}>No completed sales in this range.</Text>
            ) : null}
            {daysPagination.pageItems.map((day) => {
              const key = businessDateKey(day.business_date);
              return (
                <DaySalesRow
                  key={key}
                  branchId={branchId}
                  day={day}
                  expanded={expandedDate === key}
                  onToggle={() => setExpandedDate((current) => (current === key ? null : key))}
                />
              );
            })}
            {daysPagination.showPagination && daysPagination.totalPages > 1 ? (
              <View style={styles.pager}>
                <Pagination
                  page={daysPagination.page}
                  totalPages={daysPagination.totalPages}
                  onPageChange={daysPagination.setPage}
                />
              </View>
            ) : null}
          </View>
        ) : null}

      </ConstrainedWidth>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenContent: { flexGrow: 1, padding: 0, gap: 0 },
  column: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 28, gap: 12 },
  filterBleed: { marginHorizontal: -20 },
  quietNote: {
    color: managerColors.subtext,
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    alignSelf: 'stretch',
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  quietNoteNested: { paddingVertical: 8 },
  section: { gap: 10, marginTop: 4 },
  amount: {
    color: managerColors.royalBlue,
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
    minWidth: 72,
    maxWidth: 132,
    flexShrink: 1,
    textAlign: 'right',
  },
  orderList: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 16,
    overflow: 'hidden',
  },
  orderListNested: { gap: 0 },
  ordersPanel: { gap: 6 },
  ordersLabel: {
    color: managerColors.subtext,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
    letterSpacing: 0.6,
    paddingHorizontal: 4,
  },
  orderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  orderRowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: managerColors.cardBorder,
  },
  receiptChip: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#DCE8FC',
    marginTop: 1,
  },
  receiptChipNested: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: '#E8EEF9',
  },
  orderCopy: { flex: 1, minWidth: 0, gap: 2 },
  orderTitle: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 14, lineHeight: 18 },
  orderMeta: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 16 },
  dayBlock: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 16,
    overflow: 'hidden',
  },
  dayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
  },
  calendarChip: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#DCE8FC',
  },
  dayHeaderCopy: { flex: 1, minWidth: 0, gap: 2 },
  dayTitle: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 15, lineHeight: 19 },
  dayMeta: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12.5 },
  dayOrders: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: managerColors.cardBorder,
    borderLeftWidth: 3,
    borderLeftColor: '#C5D4F0',
    backgroundColor: managerColors.cardSurface,
    paddingLeft: 10,
    paddingRight: 8,
    paddingTop: 10,
    paddingBottom: 8,
  },
  pager: { marginTop: 2 },
  pressed: { opacity: 0.75 },
});
