import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { ErrorState, LoadingState } from '@/components/Feedback';
import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';
import { colors, radius, spacing } from '@/constants/theme';
import { useSale } from '@/hooks/useSales';
import { formatDate, formatMoney } from '@/lib/format';
import type { SaleStatus } from '@/types/models';

function SaleStatusBadge({ status }: { status: SaleStatus }) {
  const isCompleted = status === 'completed';
  return (
    <Text
      style={[
        styles.badge,
        isCompleted ? styles.completedBadge : styles.voidedBadge,
      ]}
    >
      {isCompleted ? 'COMPLETED' : 'VOIDED'}
    </Text>
  );
}

type SaleDetailsBodyProps = {
  saleId: string;
};

/** Sale detail body reusable for full-page and tablet master–detail. */
export function SaleDetailsBody({ saleId }: SaleDetailsBodyProps) {
  const query = useSale(saleId);

  if (query.isLoading) return <LoadingState label="Loading sale details…" />;
  if (query.error || !query.data) {
    return (
      <ErrorState
        message="Unable to load sale details."
        onRetry={() => void query.refetch()}
      />
    );
  }

  const sale = query.data;

  return (
    <View style={styles.detailsBody}>
      <View style={styles.headerRow}>
        <View style={styles.detailsHeaderCopy}>
          <PageHeader title={sale.sale_number} subtitle={`Sold ${formatDate(sale.sold_at)}`} />
        </View>
        <SaleStatusBadge status={sale.status} />
      </View>

      <View style={styles.card}>
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>Branch:</Text>
          <Text style={styles.metaValue}>{sale.branch?.name ?? 'Branch'}</Text>
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>Cashier:</Text>
          <Text style={styles.metaValue}>{sale.cashier?.full_name ?? 'Cashier'}</Text>
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>Shift Session:</Text>
          <Text style={styles.metaValue}>
            {sale.shift ? formatDate(sale.shift.started_at) : 'Shift session'}
          </Text>
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>Date / Time:</Text>
          <Text style={styles.metaValue}>{formatDate(sale.sold_at)}</Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>Items Ordered</Text>
      {sale.items.map((item) => (
        <View key={item.id} style={styles.card}>
          <View style={styles.headerRow}>
            <Text style={styles.productName}>
              {item.product?.name ?? `Product (${item.product_id})`}
            </Text>
            <Text style={styles.itemSubtotal}>{formatMoney(item.subtotal)}</Text>
          </View>
          <Text style={styles.itemMeta}>
            Quantity: {item.quantity} · Historical Price: {formatMoney(item.unit_price)}
          </Text>
        </View>
      ))}

      <Text style={styles.sectionTitle}>Payment Summary</Text>
      <View style={styles.card}>
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>Subtotal:</Text>
          <Text style={styles.metaValue}>{formatMoney(sale.subtotal)}</Text>
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.totalLabel}>Total Amount:</Text>
          <Text style={styles.totalAmount}>{formatMoney(sale.total_amount)}</Text>
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>Amount Paid:</Text>
          <Text style={styles.metaValue}>{formatMoney(sale.amount_paid)}</Text>
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>Change Given:</Text>
          <Text style={styles.metaValue}>{formatMoney(sale.change_amount)}</Text>
        </View>
      </View>
    </View>
  );
}

export function SaleDetailsScreen({ role: _role }: { role: 'cashier' }) {
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : '';

  return (
    <Screen constrain>
      <SaleDetailsBody saleId={id} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  detailsBody: { gap: spacing.md },
  detailsHeaderCopy: { flex: 1, minWidth: 0 },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.sm,
    fontSize: 11,
    fontWeight: '800',
    overflow: 'hidden',
  },
  completedBadge: {
    color: '#166534',
    backgroundColor: '#DCFCE7',
  },
  voidedBadge: {
    color: '#991B1B',
    backgroundColor: '#FEE2E2',
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
  },
  metaLabel: {
    color: colors.muted,
    fontSize: 13,
  },
  metaValue: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
    marginTop: spacing.sm,
  },
  productName: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
    flex: 1,
  },
  itemSubtotal: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
  },
  itemMeta: {
    color: colors.muted,
    fontSize: 13,
  },
  totalLabel: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
  },
  totalAmount: {
    color: colors.primary,
    fontSize: 18,
    fontWeight: '900',
  },
});
