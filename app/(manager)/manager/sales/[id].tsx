import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { Screen } from '@/components/Screen';
import { ListRowCard } from '@/components/dashboard/ListRowCard';
import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { ManagerBadge } from '@/components/dashboard/ManagerBadge';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { SummaryCard } from '@/components/dashboard/SummaryCard';
import { saleStatusTone } from '@/components/dashboard/statusTone';
import { managerColors } from '@/components/dashboard/theme';
import { useSale } from '@/hooks/useSales';
import { formatDate, formatMoney } from '@/lib/format';

export default function ManagerSaleDetailsScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : '';
  const query = useSale(id);

  if (query.isLoading) {
    return (
      <Screen backgroundColor="#FFFFFF" edges={['top']}>
        <ManagerScreenHeader title="Sale Details" showBack />
        <LoadingState label="Loading sale details…" />
      </Screen>
    );
  }
  if (query.error || !query.data) {
    return (
      <Screen backgroundColor="#FFFFFF" edges={['top']}>
        <ManagerScreenHeader title="Sale Details" showBack />
        <ErrorState message="Unable to load sale details." onRetry={() => void query.refetch()} />
      </Screen>
    );
  }

  const sale = query.data;

  return (
    <Screen backgroundColor="#FFFFFF" edges={['top']}>
      <ManagerScreenHeader title={sale.sale_number} subtitle={`Sold ${formatDate(sale.sold_at)}`} showBack />
      <ConstrainedWidth style={styles.column}>
        <View style={styles.statusRow}>
          <ManagerBadge
            label={sale.status === 'completed' ? 'Completed' : 'Voided'}
            tone={saleStatusTone(sale.status)}
          />
        </View>

        <SummaryCard
          rows={[
            { label: 'Branch', value: sale.branch?.name ?? 'Branch' },
            { label: 'Cashier', value: sale.cashier?.full_name ?? 'Cashier' },
            { label: 'Shift session', value: sale.shift ? formatDate(sale.shift.started_at) : 'Shift session' },
            { label: 'Date / time', value: formatDate(sale.sold_at) },
          ]}
        />

        <Text style={styles.sectionTitle}>ITEMS ORDERED</Text>
        {sale.items.map((item) => (
          <ListRowCard
            key={item.id}
            icon="fast-food-outline"
            iconColor="blue"
            title={item.product?.name ?? `Product (${item.product_id})`}
            subtitle={`Quantity: ${item.quantity} · Historical price: ${formatMoney(item.unit_price)}`}
            meta={formatMoney(item.subtotal)}
          />
        ))}

        <Text style={styles.sectionTitle}>PAYMENT SUMMARY</Text>
        <SummaryCard
          rows={[
            { label: 'Subtotal', value: formatMoney(sale.subtotal) },
            { label: 'Total amount', value: formatMoney(sale.total_amount), emphasis: true },
            { label: 'Amount paid', value: formatMoney(sale.amount_paid) },
            { label: 'Change given', value: formatMoney(sale.change_amount) },
          ]}
        />

        {sale.shift_id ? (
          <ManagerActionButton
            label="View shift details"
            variant="secondary"
            onPress={() => router.push({ pathname: '/manager/shifts/[id]', params: { id: sale.shift_id! } })}
          />
        ) : null}
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
