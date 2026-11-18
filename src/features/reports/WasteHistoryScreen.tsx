import Ionicons from '@react-native-vector-icons/ionicons';
import { useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
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
  const time = item.recorded_at
    ? new Date(item.recorded_at).toLocaleTimeString('en-PH', {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'Asia/Manila',
      })
    : '';
  const staff = item.recorded_by_name?.trim() ? item.recorded_by_name.trim() : '';
  const reason = item.note?.trim() ? 'Reason: ' + item.note.trim() : 'No reason recorded';
  return [time, staff, reason].filter(Boolean).join(' · ');
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
const rowKey = (shift: ShiftWasteShiftRow) =>
  shift.shift_id ?? `main-${shift.branch_id}-${shift.business_date}-${shift.started_at ?? 'x'}`;

function paramValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

const DATE_FILTERS = new Set<DateFilterType>(['today', 'this_week', 'this_month', 'custom', 'all_time']);

function parseRangeParam(value: string): DateFilterType {
  return DATE_FILTERS.has(value as DateFilterType) ? (value as DateFilterType) : 'today';
}

/** What one shift / Main inventory day wrote off, product by product (shown in the details sheet). */
export function WasteDetailsBody({ shift }: { shift: ShiftWasteShiftRow }) {
  const total = shiftTotalPcs(shift.occurrences);
  const isMain = shift.entry_kind === 'main_inventory' || shift.shift_id == null;
  return (
    <View style={styles.sheetBody}>
      <View style={styles.sheetHead}>
        <Text style={styles.branchName}>{shift.branch_name}</Text>
        <Text style={styles.metaItemText}>
          {isMain ? 'Main inventory write-off' : formatShiftTimeRange(shift.started_at, shift.ended_at)}
        </Text>
        {!isMain && shift.branch_name !== shift.cashier_name ? (
          <Text style={styles.metaItemText}>{shift.cashier_name}</Text>
        ) : null}
      </View>
      <View style={styles.sheetCard}>
        {shift.occurrences.map((item, index) => (
          <View
            key={item.occurrence_id ?? `${rowKey(shift)}-${item.product_id}-${index}`}
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
            {total != null ? `${total} stock units` : '—'}
          </Text>
        </View>
      </View>
    </View>
  );
}

export function WasteHistoryScreen({
  branchId: branchIdProp,
  branchName: branchNameProp,
}: {
  branchId?: string;
  branchName?: string;
} = {}) {
  const params = useLocalSearchParams<{ branchId?: string; range?: string; start?: string; end?: string }>();
  const branchId = branchIdProp || paramValue(params.branchId);
  const initialRange = parseRangeParam(paramValue(params.range));
  // Default matches other reports when the hub did not pass a range query param.
  const [rangeType, setRangeType] = useState<DateFilterType>(initialRange || 'today');
  const [customStart, setCustomStart] = useState(paramValue(params.start));
  const [customEnd, setCustomEnd] = useState(paramValue(params.end));
  const [selected, setSelected] = useState<ShiftWasteShiftRow | null>(null);
  const { rpcRangeType, startIso, endIso } = resolveReportRange(rangeType, customStart, customEnd);
  const query = useShiftWaste(rpcRangeType, startIso, endIso, branchId || null);
  const days = query.data?.days ?? [];
  const pagination = useClientPagination(days, rangeType, DAYS_PER_PAGE);
  const title = useMemo(() => {
    if (branchNameProp) return `Waste · ${branchNameProp}`;
    const fromDays = days.flatMap((day) => day.shifts).find((shift) => shift.branch_id === branchId)?.branch_name;
    return fromDays ? `Waste · ${fromDays}` : 'Waste History';
  }, [branchNameProp, days, branchId]);

  // Nothing wasted on any day (and no shift still pending): one centred "No waste recorded".
  const noWaste = query.isFetched && !query.error && days.length > 0 && days.every((day) => isQuietDay(day));

  return (
    <Screen backgroundColor="#FFFFFF" edges={['top']} contentContainerStyle={styles.screen}>
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
          <EmptyState title="Choose a branch" message="Open Waste History and select a branch to view recorded waste." />
        ) : null}
        {branchId && query.isLoading ? <LoadingState label="Loading waste history…" /> : null}
        {branchId && query.error ? (
          <ErrorState message={getErrorMessage(query.error)} onRetry={() => void query.refetch()} />
        ) : null}
        {branchId && rangeType === 'custom' && !query.isFetched && !query.isLoading ? (
          <EmptyState title="Select a date range" message="Enter both a start date and an end date to run this report." />
        ) : null}
        {branchId && !query.isLoading && !query.error && query.isFetched && days.length === 0 ? (
          <EmptyState title="No waste history" message="No recorded waste for this branch in this range." />
        ) : null}
        {branchId && noWaste ? (
          <EmptyState title="No waste recorded" message="No waste was recorded in this period." />
        ) : null}

        {(branchId && !noWaste ? pagination.pageItems : []).map((day) => {
          const totalPcs = dayTotalPcs(day);

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
                <View style={styles.heroTop}>
                  <View style={styles.heroIconChip}>
                    <Ionicons name="trash-outline" size={18} color={managerColors.royalBlue} />
                  </View>
                  <Text style={styles.heroLabel}>Total waste</Text>
                </View>
                <Text style={styles.heroValue}>
                  {totalPcs != null ? `${totalPcs} stock units` : '—'}
                </Text>
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
                const isMain = shift.entry_kind === 'main_inventory' || shift.shift_id == null;
                const timeLabel = isMain
                  ? 'Main inventory write-off'
                  : formatShiftTimeRange(shift.started_at, shift.ended_at);
                const cashierLabel =
                  !isMain && shift.cashier_name.trim() && shift.branch_name !== shift.cashier_name
                    ? shift.cashier_name
                    : null;
                const content = (
                  <View style={styles.shiftRow}>
                    <View style={[styles.branchChip, { backgroundColor: chip.chip }]}>
                      <GlyphIcon
                        name={isMain ? 'home-outline' : 'storefront-outline'}
                        size={18}
                        color={chip.icon}
                      />
                    </View>
                    <View style={styles.shiftCopy}>
                      <Text style={styles.branchName} numberOfLines={2}>
                        {timeLabel}
                      </Text>
                      {cashierLabel ? (
                        <View style={styles.metaItem}>
                          <Ionicons name="person-circle-outline" size={13} color={managerColors.subtext} />
                          <Text style={styles.metaItemText}>{cashierLabel}</Text>
                        </View>
                      ) : null}
                    </View>
                    <View style={styles.shiftTrail}>
                      {recorded ? (
                        <>
                          <Text style={styles.amount}>
                            {totalForShift != null ? String(totalForShift) : '—'}
                          </Text>
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
                    key={rowKey(shift)}
                    accessibilityRole="button"
                    accessibilityLabel={`Waste details for ${timeLabel}`}
                    onPress={() => setSelected(shift)}
                    style={({ pressed }) => [styles.shiftCard, pressed && styles.pressed]}
                  >
                    {content}
                  </Pressable>
                ) : (
                  <View key={rowKey(shift)} style={styles.shiftCard}>
                    {content}
                  </View>
                );
              })}
            </View>
          );
        })}
        {branchId && pagination.showPagination && !noWaste ? (
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
    gap: 10,
    shadowColor: '#0A1224',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 1,
  },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  heroIconChip: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#DCE8FC',
  },
  heroLabel: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 14 },
  heroValue: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 22, lineHeight: 28 },
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
  shiftTrail: { alignItems: 'flex-end', gap: 2, flexShrink: 0, minWidth: 44 },
  amount: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 17 },
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
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 12,
  },
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
