import Ionicons from '@react-native-vector-icons/ionicons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { Pagination } from '@/components/Pagination';
import { Screen } from '@/components/Screen';
import { EmptyState, ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { managerColors } from '@/components/dashboard/theme';
import { useAuth } from '@/features/auth/AuthProvider';
import { DateRangeFilter, resolveReportRange, type DateFilterType } from '@/features/reports/DateRangeFilter';
import { formatShiftTimeRange } from '@/features/reports/reportDisplay';
import { useBranches } from '@/hooks/useBranches';
import { useClientPagination } from '@/hooks/useClientPagination';
import { useShiftRemittances } from '@/hooks/useShifts';
import { getErrorMessage } from '@/lib/errors';
import { formatManilaDate, formatMoney, isReportRangeReady } from '@/lib/format';
import type { CashReconciliationResult, ShiftRemittanceDay, ShiftRemittanceRow } from '@/types/models';

const DAYS_PER_PAGE = 5;

const DATE_FILTERS = new Set<DateFilterType>(['today', 'this_week', 'this_month', 'custom', 'all_time']);

function paramValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

function parseRangeParam(value: string): DateFilterType {
  return DATE_FILTERS.has(value as DateFilterType) ? (value as DateFilterType) : 'today';
}

function formatKnownMoney(value: number | null | undefined) {
  if (value == null) return '—';
  return formatMoney(value);
}

function remittanceRowBadge(
  status: 'pending' | 'reconciled',
  result: CashReconciliationResult | null,
  difference: number | null,
): { label: string; tone: 'danger' | 'success' | 'warning' | 'info' } {
  if (status === 'pending') return { label: 'Pending', tone: 'warning' };
  if (result === 'shortage') return { label: `−${formatMoney(Math.abs(Number(difference ?? 0)))}`, tone: 'danger' };
  if (result === 'excess') return { label: `+${formatMoney(Math.abs(Number(difference ?? 0)))}`, tone: 'success' };
  return { label: 'Exact', tone: 'info' };
}

const badgeToneStyles = {
  danger: { bg: '#FEE2E2', text: '#B91C1C' },
  success: { bg: '#DCFCE7', text: managerColors.green },
  warning: { bg: '#FEF3C7', text: managerColors.goldMuted },
  info: { bg: '#E8EEF9', text: managerColors.royalBlue },
} as const;

function dayTotalAmount(day: ShiftRemittanceDay) {
  const cash = day.actual_remitted == null ? null : Number(day.actual_remitted);
  const gcash = day.actual_gcash == null ? null : Number(day.actual_gcash);
  if (cash == null && gcash == null) return null;
  return Number(cash ?? 0) + Number(gcash ?? 0);
}

function dayDifferenceLabel(day: ShiftRemittanceDay) {
  const shortage = Number(day.total_shortage);
  const excess = Number(day.total_excess);
  if (shortage > 0) return formatMoney(shortage);
  if (excess > 0) return formatMoney(excess);
  return formatMoney(0);
}

function MetricChipRow({
  icon,
  label,
  value,
}: {
  icon: 'cash-outline' | 'checkmark-circle-outline' | 'phone-portrait-outline' | 'swap-vertical-outline';
  label: string;
  value: string;
}) {
  return (
    <View style={styles.metricRow}>
      <View style={styles.metricLeft}>
        <Ionicons name={icon} size={16} color={managerColors.subtext} />
        <Text style={styles.metricLabel} numberOfLines={1}>
          {label}
        </Text>
      </View>
      <View style={styles.valueChip}>
        <Text style={styles.valueChipText} numberOfLines={1} adjustsFontSizeToFit>
          {value}
        </Text>
      </View>
    </View>
  );
}

function RemittanceDayCard({
  day,
  expanded,
  onToggle,
}: {
  day: ShiftRemittanceDay;
  expanded: boolean;
  onToggle: () => void;
}) {
  const shortage = Number(day.total_shortage);
  const excess = Number(day.total_excess);
  const hasGcash = day.expected_gcash != null;
  const total = dayTotalAmount(day);
  const dateLabel = formatManilaDate(day.business_date);

  return (
    <View style={styles.dayCard}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${dateLabel}, ${expanded ? 'collapse' : 'expand'}`}
        onPress={onToggle}
        style={({ pressed }) => [styles.dayHeader, pressed && styles.pressed]}
      >
        <View style={styles.calendarChip}>
          <Ionicons name="calendar-outline" size={18} color={managerColors.royalBlue} />
        </View>
        <View style={styles.dayHeaderCopy}>
          <Text style={styles.section}>{dateLabel}</Text>
          <Text style={styles.dayMeta} numberOfLines={1}>
            {`Total Amount: ${total == null ? '—' : formatMoney(total)}`}
          </Text>
        </View>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={managerColors.subtext}
        />
      </Pressable>

      {expanded ? (
        <View style={styles.dayBody}>
          <MetricChipRow
            icon="cash-outline"
            label="Expected Cash:"
            value={formatMoney(Number(day.expected_cash))}
          />
          <MetricChipRow
            icon="checkmark-circle-outline"
            label="Cash remitted:"
            value={formatKnownMoney(day.actual_remitted == null ? null : Number(day.actual_remitted))}
          />

          {hasGcash ? (
            <>
              <MetricChipRow
                icon="phone-portrait-outline"
                label="Expected GCash:"
                value={formatMoney(Number(day.expected_gcash))}
              />
              <MetricChipRow
                icon="phone-portrait-outline"
                label="GCash remitted:"
                value={formatKnownMoney(day.actual_gcash == null ? null : Number(day.actual_gcash))}
              />
              {Number(day.pending_gcash ?? 0) > 0 ? (
                <View style={styles.pendingNote}>
                  <Ionicons name="hourglass-outline" size={14} color={managerColors.goldMuted} />
                  <Text style={styles.pendingNoteText}>
                    {`${formatMoney(Number(day.pending_gcash))} GCash pending`}
                  </Text>
                </View>
              ) : null}
            </>
          ) : (
            <MetricChipRow icon="swap-vertical-outline" label="Difference:" value={dayDifferenceLabel(day)} />
          )}

          <View style={styles.footerRow}>
            <View style={[styles.footerCell, styles.shortageCell]}>
              <Ionicons name="arrow-down" size={13} color="#B91C1C" />
              <Text style={styles.shortageText} numberOfLines={1}>
                {`Shortage: ${formatMoney(shortage)}`}
              </Text>
            </View>
            <View style={styles.footerDivider} />
            <View style={[styles.footerCell, styles.excessCell]}>
              <Ionicons name="arrow-up" size={13} color={managerColors.green} />
              <Text style={styles.excessText} numberOfLines={1}>
                {`Excess: ${formatMoney(excess)}`}
              </Text>
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function ShiftRemittanceRowCard({
  row,
  branchName,
  detailBase,
}: {
  row: ShiftRemittanceRow;
  branchName: string;
  detailBase: string;
}) {
  const badge = remittanceRowBadge(row.status, row.result, row.difference);
  const tone = badgeToneStyles[badge.tone];
  const timeLabel = formatShiftTimeRange(row.started_at, row.ended_at);
  const cashierLabel =
    row.cashier_name && row.cashier_name !== row.branch_name && row.cashier_name !== branchName
      ? row.cashier_name
      : null;
  const amount =
    row.status === 'pending'
      ? formatMoney(Number(row.expected_cash))
      : formatKnownMoney(row.actual_cash == null ? null : Number(row.actual_cash));
  const tenderMeta =
    row.expected_gcash == null
      ? row.status === 'pending'
        ? 'Remittance expected'
        : 'Remitted'
      : row.status === 'pending'
        ? 'Cash expected'
        : 'Cash remitted';
  const badgeLabel = `${row.expected_gcash != null ? 'Cash: ' : ''}${badge.label}`;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Remittance details for ${timeLabel}`}
      onPress={() => router.push(`${detailBase}/${row.shift_id}` as never)}
      style={({ pressed }) => [styles.shiftCard, pressed && styles.pressed]}
    >
      <View style={styles.shiftTop}>
        <Text style={styles.shiftTitle} numberOfLines={2}>
          {timeLabel}
        </Text>
        <Ionicons name="chevron-forward" size={18} color={managerColors.subtext} />
      </View>

      {cashierLabel ? (
        <View style={styles.metaItem}>
          <Ionicons name="person-circle-outline" size={13} color={managerColors.subtext} />
          <Text style={styles.metaItemText} numberOfLines={2}>
            {cashierLabel}
          </Text>
        </View>
      ) : null}

      <Text style={styles.tenderMeta} numberOfLines={1}>
        {tenderMeta}
      </Text>

      {row.expected_gcash != null ? (
        <Text style={styles.gcashLine} numberOfLines={2}>
          {`GCash remitted ${formatKnownMoney(row.actual_gcash == null ? null : Number(row.actual_gcash))} · expected ${formatMoney(Number(row.expected_gcash))}`}
        </Text>
      ) : null}

      <View style={styles.shiftBottom}>
        <Text style={styles.amount} numberOfLines={1} adjustsFontSizeToFit>
          {amount}
        </Text>
        <View style={[styles.rowBadge, { backgroundColor: tone.bg }]}>
          <Text style={[styles.rowBadgeText, { color: tone.text }]} numberOfLines={1}>
            {badgeLabel}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

export function ShiftRemittanceScreen({
  branchId: branchIdProp,
  branchName: branchNameProp,
}: {
  branchId?: string;
  branchName?: string;
} = {}) {
  const { profile } = useAuth();
  const params = useLocalSearchParams<{
    branchId?: string | string[];
    range?: string | string[];
    start?: string | string[];
    end?: string | string[];
  }>();
  const branchId = branchIdProp || paramValue(params.branchId);
  const initialRange = parseRangeParam(paramValue(params.range));
  const [rangeType, setRangeType] = useState<DateFilterType>(initialRange || 'today');
  const [customStart, setCustomStart] = useState(paramValue(params.start));
  const [customEnd, setCustomEnd] = useState(paramValue(params.end));
  // undefined = follow default (open the only day on the page); null/string = user choice
  const [manualExpanded, setManualExpanded] = useState<string | null | undefined>(undefined);
  const { rpcRangeType, startIso, endIso } = resolveReportRange(rangeType, customStart, customEnd);
  const ready = isReportRangeReady(rpcRangeType, startIso, endIso);
  const query = useShiftRemittances(rpcRangeType, startIso, endIso, branchId || null);
  const branches = useBranches();
  const refresh = query.refetch;
  useFocusEffect(
    useCallback(() => {
      if (ready && branchId) void refresh();
    }, [ready, branchId, refresh]),
  );
  const days = query.data?.days ?? [];
  const pagination = useClientPagination(days, `${branchId}|${rangeType}`, DAYS_PER_PAGE);
  const pageDays = branchId ? pagination.pageItems : [];
  const isManager = profile?.role === 'manager';
  const detailBase = isManager ? '/manager/reports/shift-remittances' : '/owner/reports/shift-remittances';

  const pageKey = pageDays.map((day) => day.business_date).join('|');
  useEffect(() => {
    setManualExpanded(undefined);
  }, [branchId, rangeType, pagination.page, pageKey]);

  const defaultExpanded = pageDays.length === 1 ? pageDays[0].business_date : null;
  const expandedDate = manualExpanded === undefined ? defaultExpanded : manualExpanded;

  const branchName = useMemo(() => {
    if (branchNameProp) return branchNameProp;
    const fromTable = branches.data?.find((branch) => branch.id === branchId)?.name;
    if (fromTable) return fromTable;
    const fromDays = days.flatMap((day) => day.shifts).find((shift) => shift.branch_id === branchId)?.branch_name;
    return fromDays ?? 'Branch';
  }, [branchNameProp, branches.data, branchId, days]);

  const title = branchId ? `Remittance · ${branchName}` : 'Shift remittances';

  return (
    <Screen
      refreshing={query.isRefetching}
      onRefresh={ready && branchId ? () => void refresh() : undefined}
      backgroundColor="#FFFFFF"
      edges={['top']}
      contentContainerStyle={styles.screen}
    >
      <ManagerScreenHeader title={title} showBack />
      <ConstrainedWidth style={styles.column}>
        <DateRangeFilter
          value={rangeType}
          onChange={setRangeType}
          customStart={customStart}
          customEnd={customEnd}
          onCustomStartChange={setCustomStart}
          onCustomEndChange={setCustomEnd}
        />

        {!branchId ? (
          <EmptyState
            title="Choose a branch"
            message="Open Shift remittances and select a branch to view closed shifts."
          />
        ) : null}

        {branchId && query.isLoading ? <LoadingState label="Loading remittances…" /> : null}
        {branchId && query.error ? (
          <ErrorState message={getErrorMessage(query.error)} onRetry={() => void query.refetch()} />
        ) : null}
        {branchId && rangeType === 'custom' && !query.isFetched && !query.isLoading ? (
          <EmptyState
            title="Select a date range"
            message="Enter both a start date and an end date to run this report."
          />
        ) : null}
        {branchId && !query.isLoading && !query.error && query.isFetched && days.length === 0 ? (
          <EmptyState
            title="No remittances"
            message="No closed shifts for this branch in this date range. Try another date."
          />
        ) : null}

        {pageDays.map((day) => {
          const expanded = expandedDate === day.business_date;
          return (
            <View key={day.business_date} style={styles.dayBlock}>
              <RemittanceDayCard
                day={day}
                expanded={expanded}
                onToggle={() =>
                  setManualExpanded((current) => {
                    const open = current === undefined ? defaultExpanded : current;
                    return open === day.business_date ? null : day.business_date;
                  })
                }
              />
              {expanded
                ? day.shifts.map((row) => (
                    <ShiftRemittanceRowCard
                      key={row.shift_id}
                      row={row}
                      branchName={branchName}
                      detailBase={detailBase}
                    />
                  ))
                : null}
            </View>
          );
        })}
        {branchId && pagination.showPagination ? (
          <View style={styles.pager}>
            <Pagination page={pagination.page} totalPages={pagination.totalPages} onPageChange={pagination.setPage} />
          </View>
        ) : null}
      </ConstrainedWidth>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { flexGrow: 1, padding: 0, gap: 0 },
  column: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 24, gap: 20 },
  dayBlock: { gap: 10 },
  dayCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#0A1224',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 1,
  },
  dayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
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
  section: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 16 },
  dayMeta: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 13 },
  pressed: { opacity: 0.75 },
  dayBody: {
    gap: 10,
    paddingHorizontal: 14,
    paddingBottom: 14,
    borderTopWidth: 1,
    borderTopColor: managerColors.cardBorder,
    paddingTop: 12,
  },
  metricRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  metricLeft: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8 },
  metricLabel: {
    flexShrink: 1,
    color: managerColors.subtext,
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
  },
  valueChip: {
    flexShrink: 0,
    maxWidth: '48%',
    backgroundColor: managerColors.cardSurface,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  valueChipText: {
    color: managerColors.ink,
    fontFamily: 'Inter_700Bold',
    fontSize: 14,
    textAlign: 'center',
  },
  pendingNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEF3C7',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  pendingNoteText: {
    flex: 1,
    minWidth: 0,
    color: managerColors.goldMuted,
    fontFamily: 'Inter_500Medium',
    fontSize: 12.5,
    lineHeight: 17,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    marginTop: 2,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
  },
  footerCell: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 9,
  },
  footerDivider: { width: 1, backgroundColor: managerColors.cardBorder },
  shortageCell: { backgroundColor: '#FEE2E2' },
  excessCell: { backgroundColor: '#DCFCE7' },
  shortageText: { flexShrink: 1, color: '#B91C1C', fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  excessText: { flexShrink: 1, color: managerColors.green, fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  shiftCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 8,
    shadowColor: '#0A1224',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 1,
  },
  shiftTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  shiftTitle: {
    flex: 1,
    minWidth: 0,
    color: managerColors.ink,
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
    lineHeight: 20,
  },
  metaItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 4 },
  metaItemText: {
    flex: 1,
    minWidth: 0,
    color: managerColors.subtext,
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    lineHeight: 16,
  },
  tenderMeta: {
    color: managerColors.subtext,
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    lineHeight: 16,
  },
  gcashLine: {
    color: managerColors.subtext,
    fontFamily: 'Inter_500Medium',
    fontSize: 11.5,
    lineHeight: 15,
  },
  shiftBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 2,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: managerColors.cardBorder,
  },
  amount: {
    flexShrink: 1,
    color: managerColors.ink,
    fontFamily: 'Inter_700Bold',
    fontSize: 17,
  },
  rowBadge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, flexShrink: 0 },
  rowBadgeText: { fontFamily: 'Inter_700Bold', fontSize: 12 },
  pager: { paddingVertical: 8 },
});
