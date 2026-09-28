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
import { useShiftRemittances } from '@/hooks/useShifts';
import { getErrorMessage } from '@/lib/errors';
import { formatDate, formatManilaDate, formatMoney } from '@/lib/format';
import type { CashReconciliationResult } from '@/types/models';

function formatKnownMoney(value: number | null | undefined) {
  if (value == null) return '—';
  return formatMoney(value);
}

function resultLabel(result: CashReconciliationResult | null, status: 'pending' | 'reconciled') {
  if (status === 'pending') return 'Pending reconciliation';
  if (result === 'shortage') return 'Shortage';
  if (result === 'excess') return 'Excess';
  if (result === 'exact') return 'Exact';
  return 'Reconciled';
}

export function ShiftRemittanceScreen() {
  const [rangeType, setRangeType] = useState<DateFilterType>('today');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const { rpcRangeType, startIso, endIso } = resolveReportRange(rangeType, customStart, customEnd);
  const query = useShiftRemittances(rpcRangeType, startIso, endIso);
  const days = query.data?.days ?? [];

  return (
    <Screen backgroundColor="#FFFFFF" edges={['top']} contentContainerStyle={styles.screen}>
      <ManagerScreenHeader title="Shift remittances" showBack />
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
        {days.map((day) => (
          <View key={day.business_date} style={styles.dayBlock}>
            <Text style={styles.section}>{formatManilaDate(day.business_date)}</Text>
            <View style={styles.stats}>
              <StatTile style={styles.half} icon="cash-outline" label="Expected Cash" value={formatMoney(Number(day.expected_cash))} />
              <StatTile
                style={styles.half}
                icon="wallet-outline"
                label="Actual Remitted"
                value={formatKnownMoney(day.actual_remitted == null ? null : Number(day.actual_remitted))}
              />
            </View>
            <View style={styles.stats}>
              <StatTile style={styles.half} icon="remove-circle-outline" label="Total Shortage" value={formatMoney(Number(day.total_shortage))} />
              <StatTile style={styles.half} icon="add-circle-outline" label="Total Excess" value={formatMoney(Number(day.total_excess))} />
            </View>
            <View style={styles.stats}>
              <StatTile style={styles.half} icon="checkmark-done-outline" label="Reconciled Shifts" value={String(day.reconciled_shift_count)} />
              <StatTile style={styles.half} icon="time-outline" label="Pending Shift Count" value={String(day.pending_shift_count)} />
            </View>
            <StatTile icon="hourglass-outline" label="Pending Expected Cash" value={formatMoney(Number(day.pending_expected_cash))} />
            {day.shifts.map((row) => (
              <ListRowCard
                key={row.shift_id}
                title={`${row.branch_name} — ${row.cashier_name}`}
                meta={`${formatDate(row.started_at)} – ${formatDate(row.ended_at)} · ${resultLabel(row.result, row.status)}`}
                trailing={
                  <Text style={styles.amount}>
                    {row.status === 'pending'
                      ? formatMoney(Number(row.expected_cash))
                      : formatKnownMoney(row.actual_cash == null ? null : Number(row.actual_cash))}
                  </Text>
                }
              />
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
  stats: { flexDirection: 'row', gap: 12 },
  half: { flex: 1 },
  section: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 16, marginTop: 8 },
  amount: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 14 },
});
