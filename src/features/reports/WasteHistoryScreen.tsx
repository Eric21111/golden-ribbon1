import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { Screen } from '@/components/Screen';
import { ListRowCard } from '@/components/dashboard/ListRowCard';
import { EmptyState, ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { StatTile } from '@/components/dashboard/StatTile';
import { managerColors } from '@/components/dashboard/theme';
import { DateRangeFilter, resolveReportRange, type DateFilterType } from '@/features/reports/DateRangeFilter';
import { useShiftWaste } from '@/hooks/useShifts';
import { getErrorMessage } from '@/lib/errors';
import { formatDate, formatManilaDate } from '@/lib/format';
import type { ShiftWasteStatus } from '@/types/models';

function wasteStatusLabel(status: ShiftWasteStatus) {
  if (status === 'waste_recorded') return 'Waste recorded';
  if (status === 'no_waste') return 'No waste recorded';
  return 'Waste pending';
}

export function WasteHistoryScreen() {
  const [rangeType, setRangeType] = useState<DateFilterType>('today');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const { rpcRangeType, startIso, endIso } = resolveReportRange(rangeType, customStart, customEnd);
  const query = useShiftWaste(rpcRangeType, startIso, endIso);
  const days = query.data?.days ?? [];

  return (
    <Screen backgroundColor="#FFFFFF" edges={['top']} contentContainerStyle={styles.screen}>
      <ManagerScreenHeader title="Waste History" showBack />
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
        {days.map((day) => (
          <View key={day.business_date} style={styles.dayBlock}>
            <Text style={styles.section}>{formatManilaDate(day.business_date)}</Text>
            <View style={styles.stats}>
              <StatTile style={styles.half} icon="alert-circle-outline" label="Waste occurrences" value={String(day.occurrence_count)} />
              <StatTile style={styles.half} icon="nutrition-outline" label="Distinct products with waste" value={String(day.distinct_product_count)} />
            </View>
            {day.shifts.map((shift) => (
              <View key={shift.shift_id} style={styles.shiftBlock}>
                <ListRowCard
                  title={`${shift.branch_name} — ${shift.cashier_name}`}
                  meta={`${formatDate(shift.started_at)} – ${formatDate(shift.ended_at)} · ${wasteStatusLabel(shift.waste_status)}`}
                />
                {shift.waste_status === 'waste_recorded'
                  ? shift.occurrences.map((item) => (
                      <ListRowCard
                        key={`${shift.shift_id}-${item.product_id}`}
                        title={item.product_name}
                        meta={item.note ? `Waste recorded · ${item.note}` : 'Waste recorded'}
                      />
                    ))
                  : null}
              </View>
            ))}
          </View>
        ))}
      </ConstrainedWidth>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { flexGrow: 1, padding: 0, gap: 0 },
  column: { padding: 20, gap: 12 },
  dayBlock: { gap: 12 },
  shiftBlock: { gap: 8 },
  stats: { flexDirection: 'row', gap: 12 },
  half: { flex: 1 },
  section: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 16, marginTop: 8 },
});
