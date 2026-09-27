import { useQuery } from '@tanstack/react-query';
import { StyleSheet, Text, View } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { Screen } from '@/components/Screen';
import { ListRowCard } from '@/components/dashboard/ListRowCard';
import { EmptyState, ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { StatTile } from '@/components/dashboard/StatTile';
import { managerColors } from '@/components/dashboard/theme';
import { getErrorMessage } from '@/lib/errors';
import { formatDate, formatMoney } from '@/lib/format';
import { listShiftRemittances } from '@/services/shiftService';

export function ShiftRemittanceScreen() {
  const query = useQuery({
    queryKey: ['shifts', 'remittances'],
    queryFn: () => listShiftRemittances(null),
  });
  const rows = query.data ?? [];
  const pending = rows.filter((row) => row.status === 'pending');
  const reconciled = rows.filter((row) => row.status === 'reconciled');
  const pendingExpected = pending.reduce((sum, row) => sum + Number(row.expected_cash), 0);
  const reconciledActual = reconciled.reduce((sum, row) => sum + Number(row.actual_cash ?? 0), 0);

  return (
    <Screen backgroundColor="#FFFFFF" edges={['top']} contentContainerStyle={styles.screen}>
      <ManagerScreenHeader title="Shift remittances" showBack />
      <ConstrainedWidth style={styles.column}>
        {query.isLoading ? <LoadingState label="Loading remittances…" /> : null}
        {query.error ? <ErrorState message={getErrorMessage(query.error)} onRetry={() => void query.refetch()} /> : null}
        {!query.isLoading && !query.error ? (
          <>
            <View style={styles.stats}>
              <StatTile style={styles.half} icon="time-outline" label="Pending expected" value={formatMoney(pendingExpected)} />
              <StatTile style={styles.half} icon="cash-outline" label="Reconciled actual" value={formatMoney(reconciledActual)} />
            </View>
            <Text style={styles.section}>Pending reconciliation</Text>
            <Text style={styles.note}>
              Pending shifts contribute expected sales only. Actual cash is unknown until the original cashier reconciles.
            </Text>
            {pending.length === 0 ? <EmptyState title="No pending shifts" message="Every closed shift has a remittance." /> : null}
            {pending.map((row) => (
              <ListRowCard
                key={row.shift_id}
                title={row.branch_name}
                meta={`${formatDate(row.ended_at)} · Pending reconciliation`}
                trailing={<Text style={styles.amount}>{formatMoney(Number(row.expected_cash))}</Text>}
              />
            ))}
            <Text style={styles.section}>Completed reconciliations</Text>
            {reconciled.length === 0 ? <EmptyState title="No completed remittances" message="Closed shifts appear here after cash is recorded." /> : null}
            {reconciled.map((row) => (
              <ListRowCard
                key={row.shift_id}
                title={row.branch_name}
                meta={`${formatDate(row.ended_at)} · ${row.result ?? 'reconciled'}`}
                trailing={<Text style={styles.amount}>{formatMoney(Number(row.actual_cash ?? 0))}</Text>}
              />
            ))}
          </>
        ) : null}
      </ConstrainedWidth>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { flexGrow: 1, padding: 0, gap: 0 },
  column: { padding: 20, gap: 12 },
  stats: { flexDirection: 'row', gap: 12 },
  half: { flex: 1 },
  section: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 16, marginTop: 8 },
  note: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18 },
  amount: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 14 },
});
