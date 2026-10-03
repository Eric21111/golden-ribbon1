import Ionicons from '@react-native-vector-icons/ionicons';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { Pagination } from '@/components/Pagination';
import { Screen } from '@/components/Screen';
import { ListRowCard } from '@/components/dashboard/ListRowCard';
import { EmptyState, ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { managerColors } from '@/components/dashboard/theme';
import { DateRangeFilter, resolveReportRange, type DateFilterType } from '@/features/reports/DateRangeFilter';
import { formatPcsQty, formatShiftTimeRange } from '@/features/reports/reportDisplay';
import { useAuth } from '@/features/auth/AuthProvider';
import { useClientPagination } from '@/hooks/useClientPagination';
import { useShiftWaste } from '@/hooks/useShifts';
import { getErrorMessage } from '@/lib/errors';
import { formatManilaDate } from '@/lib/format';
import { accentForName } from '@/lib/nameAccent';
import type { ShiftWasteOccurrenceRow, ShiftWasteStatus } from '@/types/models';

/** Each day block is a full stat card plus its shift rows, so a few per page is already dense —
 * unlike the usual 8-item pagination default used for flat lists. */
const DAYS_PER_PAGE = 3;

const wasteStatusBadge: Record<ShiftWasteStatus, { label: string; tone: 'danger' | 'success' | 'warning' }> = {
  waste_recorded: { label: 'Waste recorded', tone: 'danger' },
  no_waste: { label: 'No waste', tone: 'success' },
  pending: { label: 'Pending', tone: 'warning' },
};

const badgeToneStyles = {
  danger: { bg: '#FEE2E2', text: '#B91C1C' },
  success: { bg: '#DCFCE7', text: managerColors.green },
  warning: { bg: '#FEF3C7', text: managerColors.goldMuted },
} as const;

function occurrenceMeta(item: ShiftWasteOccurrenceRow): string | undefined {
  return item.note ?? undefined;
}

function shiftTotalPcs(occurrences: ShiftWasteOccurrenceRow[]): number | null {
  let total = 0;
  let any = false;
  for (const item of occurrences) {
    if (item.quantity != null && Number.isFinite(Number(item.quantity))) {
      total += Number(item.quantity);
      any = true;
    }
  }
  return any ? total : null;
}

function dayTotalPcs(day: { shifts: Array<{ occurrences: ShiftWasteOccurrenceRow[] }> }): number | null {
  let total = 0;
  let any = false;
  for (const shift of day.shifts) {
    const shiftTotal = shiftTotalPcs(shift.occurrences);
    if (shiftTotal != null) {
      total += shiftTotal;
      any = true;
    }
  }
  return any ? total : null;
}

export function WasteHistoryScreen() {
  const { profile } = useAuth();
  const isManager = profile?.role === 'manager';
  const [rangeType, setRangeType] = useState<DateFilterType>('today');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const { rpcRangeType, startIso, endIso } = resolveReportRange(rangeType, customStart, customEnd);
  const query = useShiftWaste(rpcRangeType, startIso, endIso);
  const days = query.data?.days ?? [];
  const pagination = useClientPagination(days, rangeType, DAYS_PER_PAGE);

  return (
    <Screen backgroundColor="#FFFFFF" edges={['top']} contentContainerStyle={styles.screen}>
      {/* Manager reaches this screen from a dedicated sidebar entry (same as Home/Products) —
          hamburger, not back. Owner only reaches it by drilling into the Reports hub, so it
          keeps the back button there. */}
      <ManagerScreenHeader title="Waste History" showBack={!isManager} />
      <ConstrainedWidth style={styles.column}>
        <DateRangeFilter
          value={rangeType}
          onChange={setRangeType}
          customStart={customStart}
          customEnd={customEnd}
          onCustomStartChange={setCustomStart}
          onCustomEndChange={setCustomEnd}
        />
        {query.isLoading ? <LoadingState label="Loading waste history…" /> : null}
        {query.error ? <ErrorState message={getErrorMessage(query.error)} onRetry={() => void query.refetch()} /> : null}
        {rangeType === 'custom' && !query.isFetched && !query.isLoading ? (
          <EmptyState title="Select a date range" message="Enter both a start date and an end date to run this report." />
        ) : null}
        {!query.isLoading && !query.error && query.isFetched && days.length === 0 ? (
          <EmptyState title="No waste history" message="No reconciliation-aware closed shifts in this range." />
        ) : null}

        {pagination.pageItems.map((day) => {
          const totalPcs = dayTotalPcs(day);
          return (
            <View key={day.business_date} style={styles.dayBlock}>
              <Text style={styles.section}>{formatManilaDate(day.business_date)}</Text>

              <View style={styles.heroCard}>
                <View style={styles.statStrip}>
                  <View style={styles.statItem}>
                    <View style={styles.statIconChip}>
                      <Ionicons name="alert-circle-outline" size={18} color={managerColors.royalBlue} />
                    </View>
                    <Text style={styles.statValue}>{day.occurrence_count}</Text>
                    <Text style={styles.statLabel}>Occurrences</Text>
                  </View>
                  <View style={styles.statDivider} />
                  <View style={styles.statItem}>
                    <View style={styles.statIconChip}>
                      <Ionicons name="cube-outline" size={18} color={managerColors.royalBlue} />
                    </View>
                    <Text style={styles.statValue}>{day.distinct_product_count}</Text>
                    <Text style={styles.statLabel}>Products</Text>
                  </View>
                  <View style={styles.statDivider} />
                  <View style={styles.statItem}>
                    <View style={styles.statIconChip}>
                      <Ionicons name="trash-outline" size={18} color={managerColors.royalBlue} />
                    </View>
                    <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>
                      {totalPcs != null ? formatPcsQty(totalPcs) : '—'}
                    </Text>
                    <Text style={styles.statLabel}>Total waste</Text>
                  </View>
                </View>
              </View>

              {day.shifts.map((shift) => {
                const badge = wasteStatusBadge[shift.waste_status];
                const tone = badgeToneStyles[badge.tone];
                const totalForShift = shiftTotalPcs(shift.occurrences);
                return (
                  <View key={shift.shift_id} style={styles.shiftBlock}>
                    <ListRowCard
                      icon="storefront-outline"
                      iconColor={accentForName(shift.branch_name)}
                      title={shift.branch_name}
                      metaRow={
                        <>
                          <View style={styles.metaItem}>
                            <Ionicons name="time-outline" size={13} color={managerColors.subtext} />
                            <Text style={styles.metaItemText}>
                              {formatShiftTimeRange(shift.started_at, shift.ended_at)}
                            </Text>
                          </View>
                          {shift.branch_name !== shift.cashier_name ? (
                            <View style={styles.metaItem}>
                              <Ionicons name="person-circle-outline" size={13} color={managerColors.subtext} />
                              <Text style={styles.metaItemText}>{shift.cashier_name}</Text>
                            </View>
                          ) : null}
                        </>
                      }
                      trailing={
                        <>
                          {totalForShift != null ? (
                            <Text style={styles.amount}>{formatPcsQty(totalForShift)}</Text>
                          ) : null}
                          <View style={[styles.rowBadge, { backgroundColor: tone.bg }]}>
                            <Text style={[styles.rowBadgeText, { color: tone.text }]} numberOfLines={1}>
                              {badge.label}
                            </Text>
                          </View>
                        </>
                      }
                    />
                    {shift.waste_status === 'waste_recorded'
                      ? shift.occurrences.map((item) => (
                          <ListRowCard
                            key={item.occurrence_id ?? `${shift.shift_id}-${item.product_id}`}
                            icon="trash-outline"
                            iconColor="red"
                            title={item.product_name}
                            subtitle={occurrenceMeta(item)}
                            trailing={
                              item.quantity != null && Number.isFinite(Number(item.quantity)) ? (
                                <Text style={styles.occurrenceQty}>{formatPcsQty(item.quantity)}</Text>
                              ) : undefined
                            }
                          />
                        ))
                      : null}
                  </View>
                );
              })}
            </View>
          );
        })}
        {pagination.showPagination ? (
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
  column: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 24, gap: 16 },
  dayBlock: { gap: 12 },
  shiftBlock: { gap: 8 },
  section: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 16 },
  amount: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 14 },
  heroCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 16,
    padding: 20,
    shadowColor: '#0A1224',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 1,
  },
  statStrip: { flexDirection: 'row', alignItems: 'center' },
  statItem: { flex: 1, alignItems: 'center', gap: 6 },
  statIconChip: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#DCE8FC',
  },
  statValue: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 18 },
  statLabel: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 11.5, textAlign: 'center' },
  statDivider: { width: 1, height: 44, backgroundColor: managerColors.cardBorder },
  rowBadge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  rowBadgeText: { fontFamily: 'Inter_700Bold', fontSize: 12.5 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaItemText: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12 },
  occurrenceQty: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 14 },
  pager: { paddingVertical: 8 },
});
