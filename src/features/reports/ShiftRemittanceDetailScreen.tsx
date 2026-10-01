import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { Screen } from '@/components/Screen';
import { EmptyState, ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { StatTile } from '@/components/dashboard/StatTile';
import { managerColors } from '@/components/dashboard/theme';
import { spacing } from '@/constants/theme';
import {
  closingDispositionLabel,
  formatPcsQty,
  formatPersistedInventoryResult,
  formatRemittanceCashResult,
} from '@/features/reports/reportDisplay';
import { useShiftCloseReportDetail } from '@/hooks/useShifts';
import { getErrorMessage } from '@/lib/errors';
import { formatDate, formatMoney } from '@/lib/format';

export function ShiftRemittanceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useShiftCloseReportDetail(id ?? '');
  const detail = query.data;

  return (
    <Screen backgroundColor="#FFFFFF" edges={['top']} contentContainerStyle={styles.screen}>
      <ManagerScreenHeader title="Shift remittance detail" showBack />
      <ConstrainedWidth style={styles.column}>
        {query.isLoading ? <LoadingState label="Loading shift remittance…" /> : null}
        {query.error ? (
          <ErrorState message={getErrorMessage(query.error)} onRetry={() => void query.refetch()} />
        ) : null}
        {!query.isLoading && !query.error && !detail ? (
          <EmptyState title="Shift not found" message="This remittance record is unavailable." />
        ) : null}

        {detail ? (
          <>
            <Text style={styles.title}>
              {detail.branch_name} — {detail.cashier_name}
            </Text>
            <Text style={styles.meta}>
              Started {formatDate(detail.started_at)}
              {detail.ended_at ? ` · Ended ${formatDate(detail.ended_at)}` : ''}
            </Text>
            {detail.sales_cutoff_at ? (
              <Text style={styles.meta}>Sales cutoff {formatDate(detail.sales_cutoff_at)}</Text>
            ) : null}

            <Text style={styles.section}>Cash</Text>
            <View style={styles.stats}>
              <StatTile
                style={styles.half}
                icon="cash-outline"
                label="Expected Cash"
                value={formatMoney(detail.expected_cash)}
              />
              <StatTile
                style={styles.half}
                icon="wallet-outline"
                label="Actual Cash"
                value={detail.actual_cash == null ? '—' : formatMoney(detail.actual_cash)}
              />
            </View>
            <Text style={styles.result}>
              {formatRemittanceCashResult(detail.cash_status, detail.cash_result, detail.difference)}
            </Text>
            {detail.cash_status === 'pending' ? (
              <Text style={styles.note}>
                Remittance is still pending. Actual cash and inventory results are not available yet.
              </Text>
            ) : null}

            <Text style={styles.section}>Inventory close</Text>
            {detail.cash_status === 'pending' ? (
              <Text style={styles.note}>Finish remittance before inventory results appear.</Text>
            ) : detail.products.length === 0 ? (
              <Text style={styles.note}>
                {detail.inventory_reconciliation_required
                  ? 'No product reconciliation rows were stored for this shift.'
                  : 'Cash reconciliation only — inventory close was not required for this historical shift.'}
              </Text>
            ) : (
              detail.products.map((product) => (
                <View key={product.id} style={styles.productCard}>
                  <Text style={styles.productName}>{product.product_name_snapshot}</Text>
                  {product.sku_snapshot ? <Text style={styles.sku}>SKU {product.sku_snapshot}</Text> : null}
                  <Text style={styles.line}>Opening: {formatPcsQty(product.opening_quantity)}</Text>
                  <Text style={styles.line}>Received: {formatPcsQty(product.received_quantity)}</Text>
                  <Text style={styles.line}>Outgoing: {formatPcsQty(product.outgoing_quantity)}</Text>
                  <Text style={styles.line}>Sold: {formatPcsQty(product.sold_quantity)}</Text>
                  <Text style={styles.line}>Adjustment: {formatPcsQty(product.adjustment_quantity)}</Text>
                  <Text style={styles.line}>Waste: {formatPcsQty(product.waste_quantity)}</Text>
                  <Text style={styles.line}>
                    Expected remaining: {formatPcsQty(product.expected_remaining)}
                  </Text>
                  <Text style={styles.line}>
                    Actual remaining: {formatPcsQty(product.actual_remaining)}
                  </Text>
                  <Text style={styles.result}>
                    {formatPersistedInventoryResult(product.result, product.discrepancy)}
                  </Text>
                  <Text style={styles.line}>Unsold: {formatPcsQty(product.unsold_quantity)}</Text>
                  <Text style={styles.line}>Carried: {formatPcsQty(product.carried_quantity)}</Text>
                  <Text style={styles.disposition}>{closingDispositionLabel(product)}</Text>
                </View>
              ))
            )}
          </>
        ) : null}
      </ConstrainedWidth>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { flexGrow: 1 },
  column: { gap: spacing.md, paddingBottom: 28 },
  title: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 18 },
  meta: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 13 },
  section: {
    color: managerColors.subtext,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    letterSpacing: 0.6,
    marginTop: 4,
  },
  stats: { flexDirection: 'row', gap: 8 },
  half: { flex: 1 },
  result: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 15 },
  note: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18 },
  productCard: {
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 12,
    padding: 12,
    gap: 4,
    backgroundColor: managerColors.cardSurface,
  },
  productName: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 15 },
  sku: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12 },
  line: { color: managerColors.ink, fontFamily: 'Inter_500Medium', fontSize: 13 },
  disposition: { color: managerColors.royalBlue, fontFamily: 'Inter_600SemiBold', fontSize: 13, marginTop: 4 },
});
