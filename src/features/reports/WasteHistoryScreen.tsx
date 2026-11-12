import Ionicons from '@react-native-vector-icons/ionicons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { GlyphIcon } from '@/components/GlyphIcon';
import { Pagination } from '@/components/Pagination';
import { Screen } from '@/components/Screen';
import { EmptyState, ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { ManagerBottomSheet } from '@/components/dashboard/ManagerBottomSheet';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { managerColors, statChipColors } from '@/components/dashboard/theme';
import { DateRangeFilter, resolveReportRange, type DateFilterType } from '@/features/reports/DateRangeFilter';
import { formatPcsQty, formatShiftTimeRange } from '@/features/reports/reportDisplay';
import { useAuth } from '@/features/auth/AuthProvider';
import { useClientPagination } from '@/hooks/useClientPagination';
import { useShiftWaste } from '@/hooks/useShifts';
import { getErrorMessage } from '@/lib/errors';
import { formatManilaDate } from '@/lib/format';
import { accentForName } from '@/lib/nameAccent';
import type { ShiftWasteOccurrenceRow, ShiftWasteShiftRow, ShiftWasteStatus } from '@/types/models';

/** A day is a summary card plus compact shift rows (or one quiet line when nothing was wasted), so a handful fit a page. */
const DAYS_PER_PAGE = 5;

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

/** A day with nothing wasted and no shift still waiting for its remittance. */
function isQuietDay(day: { occurrence_count: number; shifts: Array<{ waste_status: ShiftWasteStatus }> }): boolean {
  return day.occurrence_count === 0 && !day.shifts.some((shift) => shift.waste_status === 'pending');
}

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

const productCount = (shift: ShiftWasteShiftRow) => new Set(shift.occurrences.map((item) => item.product_id)).size;
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** What one shift wrote off, product by product (shown in the details sheet). */
export function WasteDetailsBody({ shift }: { shift: ShiftWasteShiftRow }) {
  const total = shiftTotalPcs(shift.occurrences);
  return (
    <View style={styles.sheetBody}>
            <View style={styles.sheetHead}>
              <Text style={styles.branchName}>{shift.branch_name}</Text>
              <Text style={styles.metaItemText}>{formatShiftTimeRange(shift.started_at, shift.ended_at)}</Text>
              {shift.branch_name !== shift.cashier_name ? <Text style={styles.metaItemText}>{shift.cashier_name}</Text> : null}
            </View>
            <View style={styles.sheetCard}>
              {shift.occurrences.map((item, index) => (
                <View
                  key={item.occurrence_id ?? `${shift.shift_id}-${item.product_id}`}
                  style={[styles.itemRow, index < shift.occurrences.length - 1 && styles.itemRowDivider]}
                >
                  <View style={styles.itemCopy}>
                    <Text style={styles.itemName} numberOfLines={2}>
                      {item.product_name}
                    </Text>
                    {occurrenceMeta(item) ? <Text style={styles.itemNote}>{occurrenceMeta(item)}</Text> : null}
                  </View>
                  {item.quantity != null && Number.isFinite(Number(item.quantity)) ? (
                    <Text style={styles.occurrenceQty}>{formatPcsQty(item.quantity, item.stock_unit_code)}</Text>
                  ) : null}
                </View>
              ))}
              <View style={styles.sheetTotal}>
                <Text style={styles.sheetTotalLabel}>Total</Text>
                <Text style={styles.sheetTotalValue}>
                  {total != null ? `${total} stock units (mixed items)` : '—'}
                </Text>
              </View>
            </View>
          </View>
  );
}

export function WasteHistoryScreen() {
  const { profile } = useAuth();
  const isManager = profile?.role === 'manager';
  const [rangeType, setRangeType] = useState<DateFilterType>('today');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [selected, setSelected] = useState<ShiftWasteShiftRow | null>(null);
  const { rpcRangeType, startIso, endIso } = resolveReportRange(rangeType, customStart, customEnd);
  const query = useShiftWaste(rpcRangeType, startIso, endIso);
  const days = query.data?.days ?? [];
  const pagination = useClientPagination(days, rangeType, DAYS_PER_PAGE);
  // Nothing wasted on any day (and no shift still pending): one centred "No waste recorded", like the other reports, instead of a
  // list of identical "No waste recorded" lines. If any day has waste or a pending shift, the day list is shown as before.
  const noWaste = query.isFetched && !query.error && days.length > 0 && days.every((day) => isQuietDay(day));

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
        {noWaste ? <EmptyState title="No waste recorded" message="No waste was recorded in this period." /> : null}

        {(noWaste ? [] : pagination.pageItems).map((day) => {
          const totalPcs = dayTotalPcs(day);

          // a day with no waste is one quiet line, not an empty summary card
          if (day.occurrence_count === 0) {
            const pending = day.shifts.some((shift) => shift.waste_status === 'pending');
            return (
              <View key={day.business_date} style={styles.quietDay}>
                <Text style={styles.quietDate}>{formatManilaDate(day.business_date)}</Text>
                <Text style={styles.quietText}>{pending ? 'Pending' : 'No waste recorded'}</Text>
              </View>
            );
          }

          return (
            <View key={day.business_date} style={styles.dayBlock}>
              <Text style={styles.section}>{formatManilaDate(day.business_date)}</Text>

              <View style={styles.heroCard}>
                <View style={styles.heroRow}>
                  <View style={styles.heroLeft}>
                    <View style={styles.heroIconChip}>
                      <Ionicons name="trash-outline" size={18} color={managerColors.royalBlue} />
                    </View>
                    <Text style={styles.heroLabel}>Total waste</Text>
                  </View>
                  <Text style={styles.heroValue} numberOfLines={1} adjustsFontSizeToFit>
                    {totalPcs != null ? `${totalPcs} stock units (mixed items)` : '—'}
                  </Text>
                </View>
                <View style={styles.pillRow}>
                  <View style={styles.pill}>
                    <Text style={styles.pillText}>{plural(day.occurrence_count, 'occurrence', 'occurrences')}</Text>
                  </View>
                  <View style={styles.pill}>
                    <Text style={styles.pillText}>{plural(day.distinct_product_count, 'product', 'products')}</Text>
                  </View>
                </View>
              </View>

              {day.shifts.map((shift) => {
                const badge = wasteStatusBadge[shift.waste_status];
                const tone = badgeToneStyles[badge.tone];
                const recorded = shift.waste_status === 'waste_recorded';
                const totalForShift = shiftTotalPcs(shift.occurrences);
                const chip = statChipColors[accentForName(shift.branch_name)];
                const content = (
                  <View style={styles.shiftRow}>
                    <View style={[styles.branchChip, { backgroundColor: chip.chip }]}>
                      <GlyphIcon name="storefront-outline" size={18} color={chip.icon} />
                    </View>
                    <View style={styles.shiftCopy}>
                      <Text style={styles.branchName} numberOfLines={2}>
                        {shift.branch_name}
                      </Text>
                      <View style={styles.metaItem}>
                        <Ionicons name="time-outline" size={13} color={managerColors.subtext} />
                        <Text style={styles.metaItemText}>{formatShiftTimeRange(shift.started_at, shift.ended_at)}</Text>
                      </View>
                      {shift.branch_name !== shift.cashier_name ? (
                        <View style={styles.metaItem}>
                          <Ionicons name="person-circle-outline" size={13} color={managerColors.subtext} />
                          <Text style={styles.metaItemText}>{shift.cashier_name}</Text>
                        </View>
                      ) : null}
                    </View>
                    <View style={styles.shiftTrail}>
                      {recorded ? (
                        <>
                          <Text style={styles.amount}>{totalForShift != null ? `${totalForShift} stock units (mixed items)` : '—'}</Text>
                          <Text style={styles.trailSub}>{plural(productCount(shift), 'product', 'products')}</Text>
                        </>
                      ) : (
                        <View style={[styles.rowBadge, { backgroundColor: tone.bg }]}>
                          <Text style={[styles.rowBadgeText, { color: tone.text }]} numberOfLines={1}>
                            {badge.label}
                          </Text>
                        </View>
                      )}
                    </View>
                    {recorded ? <Ionicons name="chevron-forward" size={18} color={managerColors.subtext} /> : null}
                  </View>
                );
                return recorded ? (
                  <Pressable
                    key={shift.shift_id}
                    accessibilityRole="button"
                    accessibilityLabel={`Waste details for ${shift.branch_name}`}
                    onPress={() => setSelected(shift)}
                    style={({ pressed }) => [styles.shiftCard, pressed && styles.pressed]}
                  >
                    {content}
                  </Pressable>
                ) : (
                  <View key={shift.shift_id} style={styles.shiftCard}>
                    {content}
                  </View>
                );
              })}
            </View>
          );
        })}
        {pagination.showPagination && !noWaste ? (
          <View style={styles.pager}>
            <Pagination page={pagination.page} totalPages={pagination.totalPages} onPageChange={pagination.setPage} />
          </View>
        ) : null}
      </ConstrainedWidth>

      <ManagerBottomSheet visible={selected != null} title="Waste details" scroll onClose={() => setSelected(null)}>
        {selected ? <WasteDetailsBody shift={selected} /> : null}
      </ManagerBottomSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { flexGrow: 1, padding: 0, gap: 0 },
  // flexGrow: with nothing to list, the loading / error / empty message fills the space under the filter and sits in the middle
  column: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 24, gap: 20 },
  dayBlock: { gap: 10 },
  section: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 16 },
  quietDay: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 2 },
  quietDate: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 16 },
  quietText: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 13 },
  heroCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 16,
    padding: 16,
    gap: 12,
    shadowColor: '#0A1224',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 1,
  },
  heroRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  heroLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 },
  heroIconChip: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#DCE8FC' },
  heroLabel: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 14 },
  heroValue: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 22, flexShrink: 1 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: managerColors.cardSurface },
  pillText: { color: managerColors.subtext, fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  shiftCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    shadowColor: '#0A1224',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 1,
  },
  pressed: { opacity: 0.75 },
  shiftRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  branchChip: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  shiftCopy: { flex: 1, minWidth: 0, gap: 3 },
  branchName: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 15 },
  shiftTrail: { alignItems: 'flex-end', gap: 2, flexShrink: 0 },
  amount: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 15 },
  trailSub: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 11.5 },
  rowBadge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  rowBadgeText: { fontFamily: 'Inter_700Bold', fontSize: 12 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaItemText: { flexShrink: 1, color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12 },
  sheetBody: { gap: 14, paddingBottom: 8 },
  sheetHead: { gap: 3 },
  sheetCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 16,
    paddingHorizontal: 16,
  },
  itemRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 12 },
  itemRowDivider: { borderBottomWidth: 1, borderBottomColor: managerColors.cardBorder },
  itemCopy: { flex: 1, minWidth: 0, gap: 2 },
  itemName: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 14.5 },
  itemNote: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12 },
  occurrenceQty: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 14.5 },
  sheetTotal: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: managerColors.cardBorder,
    paddingVertical: 12,
  },
  sheetTotalLabel: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 14 },
  sheetTotalValue: { color: managerColors.royalBlue, fontFamily: 'Inter_700Bold', fontSize: 17 },
  pager: { paddingVertical: 8 },
});
