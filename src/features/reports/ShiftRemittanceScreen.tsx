import Ionicons from '@react-native-vector-icons/ionicons';
import { router } from 'expo-router';
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
import { formatShiftTimeRange } from '@/features/reports/reportDisplay';
import { useAuth } from '@/features/auth/AuthProvider';
import { useClientPagination } from '@/hooks/useClientPagination';
import { useShiftRemittances } from '@/hooks/useShifts';
import { getErrorMessage } from '@/lib/errors';
import { formatManilaDate, formatMoney } from '@/lib/format';
import { accentForName } from '@/lib/nameAccent';
import type { CashReconciliationResult } from '@/types/models';

/** Each day block is a full hero card plus its shift rows, so a few per page is already dense —
 * unlike the usual 8-item pagination default used for flat lists. */
const DAYS_PER_PAGE = 3;

function formatKnownMoney(value: number | null | undefined) {
  if (value == null) return '—';
  return formatMoney(value);
}

/** Single badge carrying both the direction and the amount, so a shift row never has to say
 * the same thing twice (a separate "Shortage" chip plus a repeated "₱x shortage" caption). */
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
  info: { bg: '#DBEAFE', text: '#1E40AF' },
} as const;

export function ShiftRemittanceScreen() {
  const { profile } = useAuth();
  const [rangeType, setRangeType] = useState<DateFilterType>('today');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const { rpcRangeType, startIso, endIso } = resolveReportRange(rangeType, customStart, customEnd);
  const query = useShiftRemittances(rpcRangeType, startIso, endIso);
  const days = query.data?.days ?? [];
  const pagination = useClientPagination(days, rangeType, DAYS_PER_PAGE);
  const isManager = profile?.role === 'manager';
  const detailBase = isManager ? '/manager/reports/shift-remittances' : '/owner/reports/shift-remittances';

  return (
    <Screen backgroundColor="#FFFFFF" edges={['top']} contentContainerStyle={styles.screen}>
      {/* Manager reaches this screen from a dedicated sidebar entry (same as Home/Products) —
          hamburger, not back. Owner only reaches it by drilling into the Reports hub, so it
          keeps the back button there. */}
      <ManagerScreenHeader title="Shift remittances" showBack={!isManager} />
      <ConstrainedWidth style={styles.column}>
        <DateRangeFilter
          value={rangeType}
          onChange={setRangeType}
          customStart={customStart}
          customEnd={customEnd}
          onCustomStartChange={setCustomStart}
          onCustomEndChange={setCustomEnd}
        />
        {query.isLoading ? <LoadingState label="Loading remittances…" /> : null}
        {query.error ? <ErrorState message={getErrorMessage(query.error)} onRetry={() => void query.refetch()} /> : null}
        {rangeType === 'custom' && !query.isFetched && !query.isLoading ? (
          <EmptyState title="Select a date range" message="Enter both a start date and an end date to run this report." />
        ) : null}
        {!query.isLoading && !query.error && query.isFetched && days.length === 0 ? (
          <EmptyState title="No remittances" message="No reconciliation-aware closed shifts in this range." />
        ) : null}
        {pagination.pageItems.map((day) => {
          const shortage = Number(day.total_shortage);
          const excess = Number(day.total_excess);
          const pendingCash = Number(day.pending_expected_cash);
          const pendingCount = day.pending_shift_count;
          return (
            <View key={day.business_date} style={styles.dayBlock}>
              <Text style={styles.section}>{formatManilaDate(day.business_date)}</Text>

              <View style={styles.heroCard}>
                <View style={styles.heroStack}>
                  <View style={styles.heroRowFull}>
                    <View style={styles.heroLeft}>
                      <View style={styles.heroIconChip}>
                        <Ionicons name="cash-outline" size={18} color={managerColors.royalBlue} />
                      </View>
                      <Text style={styles.heroLabel}>Expected Cash</Text>
                    </View>
                    <Text style={styles.heroValue} numberOfLines={1} adjustsFontSizeToFit>
                      {formatMoney(Number(day.expected_cash))}
                    </Text>
                  </View>
                  <View style={styles.heroRowFull}>
                    <View style={styles.heroLeft}>
                      <View style={styles.heroIconChip}>
                        <Ionicons name="wallet-outline" size={18} color={managerColors.royalBlue} />
                      </View>
                      <Text style={styles.heroLabel}>Actual Remitted</Text>
                    </View>
                    <Text style={styles.heroValue} numberOfLines={1} adjustsFontSizeToFit>
                      {formatKnownMoney(day.actual_remitted == null ? null : Number(day.actual_remitted))}
                    </Text>
                  </View>
                </View>

                <View style={styles.pillRow}>
                  <View style={[styles.pill, { backgroundColor: shortage > 0 ? '#FEE2E2' : managerColors.cardSurface }]}>
                    <Ionicons
                      name="trending-down-outline"
                      size={13}
                      color={shortage > 0 ? '#B91C1C' : managerColors.subtext}
                    />
                    <Text
                      style={[styles.pillText, { color: shortage > 0 ? '#B91C1C' : managerColors.subtext }]}
                      numberOfLines={2}
                    >
                      {formatMoney(shortage)} shortage
                    </Text>
                  </View>
                  <View style={[styles.pill, { backgroundColor: excess > 0 ? '#DCFCE7' : managerColors.cardSurface }]}>
                    <Ionicons
                      name="trending-up-outline"
                      size={13}
                      color={excess > 0 ? managerColors.green : managerColors.subtext}
                    />
                    <Text
                      style={[styles.pillText, { color: excess > 0 ? managerColors.green : managerColors.subtext }]}
                      numberOfLines={2}
                    >
                      {formatMoney(excess)} excess
                    </Text>
                  </View>
                </View>

                <View style={styles.footerRow}>
                  <View style={styles.footerStat}>
                    <View style={styles.footerStatTop}>
                      <Ionicons name="checkmark-done-outline" size={13} color={managerColors.green} />
                      <Text style={styles.footerStatValue}>{day.reconciled_shift_count}</Text>
                    </View>
                    <Text style={styles.footerStatLabel}>Reconciled</Text>
                  </View>
                  <View style={styles.footerDivider} />
                  <View style={styles.footerStat}>
                    <View style={styles.footerStatTop}>
                      <Ionicons
                        name="time-outline"
                        size={13}
                        color={pendingCount > 0 ? managerColors.goldMuted : managerColors.subtext}
                      />
                      <Text style={[styles.footerStatValue, pendingCount > 0 && styles.footerStatWarning]}>
                        {pendingCount}
                      </Text>
                    </View>
                    <Text style={styles.footerStatLabel}>Pending shifts</Text>
                  </View>
                  <View style={styles.footerDivider} />
                  <View style={styles.footerStat}>
                    <View style={styles.footerStatTop}>
                      <Ionicons
                        name="hourglass-outline"
                        size={13}
                        color={pendingCash > 0 ? managerColors.goldMuted : managerColors.subtext}
                      />
                      <Text
                        style={[styles.footerStatValue, pendingCash > 0 && styles.footerStatWarning]}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                      >
                        {formatMoney(pendingCash)}
                      </Text>
                    </View>
                    <Text style={styles.footerStatLabel}>Pending cash</Text>
                  </View>
                </View>
              </View>

              {day.shifts.map((row) => {
                const badge = remittanceRowBadge(row.status, row.result, row.difference);
                const tone = badgeToneStyles[badge.tone];
                return (
                  <ListRowCard
                    key={row.shift_id}
                    icon="storefront-outline"
                    iconColor={accentForName(row.branch_name)}
                    title={row.branch_name}
                    metaRow={
                      <>
                        <View style={styles.metaItem}>
                          <Ionicons name="time-outline" size={13} color={managerColors.subtext} />
                          <Text style={styles.metaItemText}>{formatShiftTimeRange(row.started_at, row.ended_at)}</Text>
                        </View>
                        {row.branch_name !== row.cashier_name ? (
                          <View style={styles.metaItem}>
                            <Ionicons name="person-circle-outline" size={13} color={managerColors.subtext} />
                            <Text style={styles.metaItemText}>{row.cashier_name}</Text>
                          </View>
                        ) : null}
                      </>
                    }
                    onPress={() => router.push(`${detailBase}/${row.shift_id}` as never)}
                    trailing={
                      <>
                        <Text style={styles.amount}>
                          {row.status === 'pending'
                            ? formatMoney(Number(row.expected_cash))
                            : formatKnownMoney(row.actual_cash == null ? null : Number(row.actual_cash))}
                        </Text>
                        <View style={[styles.rowBadge, { backgroundColor: tone.bg }]}>
                          <Text style={[styles.rowBadgeText, { color: tone.text }]} numberOfLines={1}>
                            {badge.label}
                          </Text>
                        </View>
                      </>
                    }
                  />
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
  section: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 16 },
  amount: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 14 },
  heroCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 16,
    padding: 20,
    gap: 18,
    shadowColor: '#0A1224',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 1,
  },
  heroStack: { gap: 12 },
  heroRowFull: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  heroLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 },
  heroIconChip: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#DCE8FC',
  },
  heroLabel: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 13 },
  heroValue: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 20 },
  pillRow: { flexDirection: 'row', gap: 8 },
  pill: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRadius: 16,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  pillText: { flexShrink: 1, textAlign: 'center', fontFamily: 'Inter_600SemiBold', fontSize: 11.5, lineHeight: 14 },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: managerColors.cardBorder,
    paddingTop: 14,
  },
  footerStat: { flex: 1, alignItems: 'center', gap: 4 },
  footerStatTop: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  footerStatValue: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 15 },
  footerStatWarning: { color: managerColors.goldMuted },
  footerStatLabel: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 11.5 },
  footerDivider: { width: 1, height: 30, backgroundColor: managerColors.cardBorder },
  rowBadge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  rowBadgeText: { fontFamily: 'Inter_700Bold', fontSize: 12.5 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaItemText: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12 },
  pager: { paddingVertical: 8 },
});
