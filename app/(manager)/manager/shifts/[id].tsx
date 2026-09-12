import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { EmptyState, ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { Screen } from '@/components/Screen';
import { ListRowCard } from '@/components/dashboard/ListRowCard';
import { ManagerBadge } from '@/components/dashboard/ManagerBadge';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { SummaryCard } from '@/components/dashboard/SummaryCard';
import { shiftStatusTone } from '@/components/dashboard/statusTone';
import { managerColors } from '@/components/dashboard/theme';
import { useShiftSummary } from '@/hooks/useShifts';
import { getErrorMessage } from '@/lib/errors';
import { formatDate, formatMoney } from '@/lib/format';
import { listShiftSales } from '@/services/saleService';

export default function ManagerShiftDetailsScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : '';

  const summaryQuery = useShiftSummary(id);
  const salesQuery = useQuery({
    queryKey: ['shift-sales', id],
    queryFn: () => listShiftSales(id),
    enabled: Boolean(id),
  });

  if (summaryQuery.isLoading) {
    return (
      <Screen backgroundColor="#FFFFFF" edges={['top']}>
        <ManagerScreenHeader title="Shift Details" showBack />
        <LoadingState label="Loading shift summary…" />
      </Screen>
    );
  }
  if (summaryQuery.error || !summaryQuery.data) {
    return (
      <Screen backgroundColor="#FFFFFF" edges={['top']}>
        <ManagerScreenHeader title="Shift Details" showBack />
        <ErrorState message="Unable to load shift summary." onRetry={() => void summaryQuery.refetch()} />
      </Screen>
    );
  }

  const shift = summaryQuery.data;
  const sales = salesQuery.data ?? [];

  return (
    <Screen backgroundColor="#FFFFFF" edges={['top']}>
      <ManagerScreenHeader
        title={shift.cashier_name}
        subtitle={`${shift.branch_name} · ${shift.status === 'open' ? 'Active shift' : 'Closed shift'}`}
        showBack
      />
      <ConstrainedWidth style={styles.column}>
        <View style={styles.statusRow}>
          <ManagerBadge label={shift.status === 'open' ? 'Open' : 'Closed'} tone={shiftStatusTone(shift.status)} />
        </View>

        <SummaryCard
          title="Shift Performance"
          rows={[
            { label: 'Started at', value: formatDate(shift.started_at) },
            { label: 'Ended at', value: shift.ended_at ? formatDate(shift.ended_at) : 'Still open' },
            { label: 'Completed orders', value: String(shift.completed_transaction_count) },
            { label: 'Total sales', value: formatMoney(shift.total_sales), emphasis: true },
          ]}
        />

        <Text style={styles.sectionTitle}>SHIFT SALES</Text>
        {salesQuery.error ? (
          <ErrorState message={getErrorMessage(salesQuery.error)} onRetry={() => void salesQuery.refetch()} />
        ) : salesQuery.isLoading ? (
          <LoadingState label="Loading shift sales…" />
        ) : sales.length === 0 ? (
          <EmptyState title="No sales in this shift" message="Any orders confirmed during this shift will appear here." />
        ) : (
          sales.map((sale) => (
            <ListRowCard
              key={sale.id}
              icon="receipt-outline"
              iconColor="gold"
              title={sale.sale_number}
              subtitle={formatDate(sale.sold_at)}
              meta={formatMoney(sale.total_amount)}
              onPress={() => router.push({ pathname: '/manager/sales/[id]', params: { id: sale.id } })}
            />
          ))
        )}
      </ConstrainedWidth>
    </Screen>
  );
}

const styles = StyleSheet.create({
  column: { padding: 20, gap: 12 },
  statusRow: { flexDirection: 'row' },
  sectionTitle: {
    color: managerColors.subtext,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    letterSpacing: 0.8,
    marginTop: 8,
  },
});
