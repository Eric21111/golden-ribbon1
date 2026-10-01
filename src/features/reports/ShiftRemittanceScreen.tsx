import { router } from 'expo-router';
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
import { formatRemittanceCashResult } from '@/features/reports/reportDisplay';
import { useAuth } from '@/features/auth/AuthProvider';
import { useShiftRemittances } from '@/hooks/useShifts';
import { getErrorMessage } from '@/lib/errors';
import { formatDate, formatManilaDate, formatMoney } from '@/lib/format';

function formatKnownMoney(value: number | null | undefined) {
  if (value == null) return '—';
  return formatMoney(value);
}

export function ShiftRemittanceScreen() {
  const { profile } = useAuth();
  const [rangeType, setRangeType] = useState<DateFilterType>('today');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const { rpcRangeType, startIso, endIso } = resolveReportRange(rangeType, customStart, customEnd);
  const query = useShiftRemittances(rpcRangeType, startIso, endIso);
  const days = query.data?.days ?? [];
  const detailBase =
    profile?.role === 'manager' ? '/manager/reports/shift-remittances' : '/owner/reports/shift-remittances';

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
                meta={`${formatDate(row.started_at)} – ${formatDate(row.ended_at)} · ${formatRemittanceCashResult(row.status, row.result, row.difference)}`}
                onPress={() => router.push(`${detailBase}/${row.shift_id}` as never)}
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
  screen: { flexGrow: 1 },
  column: { gap: 12, paddingBottom: 24 },
  dayBlock: { gap: 10 },
  section: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 16 },
  stats: { flexDirection: 'row', gap: 8 },
  half: { flex: 1 },
  amount: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 14 },
});
