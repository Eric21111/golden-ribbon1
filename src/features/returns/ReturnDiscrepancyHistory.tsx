import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { EmptyState, ErrorState, LoadingState } from '@/components/Feedback';
import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';
import { colors, radius, spacing } from '@/constants/theme';
import { useReturnDiscrepancies } from '@/hooks/useReturns';
import { getErrorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';

export function ReturnDiscrepancyHistory({ role }: { role: 'owner' | 'manager' }) {
  const query = useReturnDiscrepancies();

  return (
    <Screen>
      <PageHeader
        title="Return discrepancies"
        subtitle="Audited differences between branch returned stock and Main Branch receipts."
      />

      {query.isLoading && <LoadingState label="Loading return discrepancies…" />}
      {query.error && (
        <ErrorState
          message={getErrorMessage(query.error)}
          onRetry={() => void query.refetch()}
        />
      )}

      {query.data?.length === 0 && (
        <EmptyState
          title="No return discrepancies"
          message="All return receipts matched the physical quantities returned."
        />
      )}

      {query.data?.map((item) => {
        const isMissing = item.discrepancy_type === 'missing';
        const returnId = item.stock_return_id;

        return (
          <View key={item.id} style={[styles.card, styles.discrepancyCard]}>
            <View style={styles.headerRow}>
              <Text style={styles.productName}>
                {item.product?.name ?? `Product (${item.product_id})`}
              </Text>
              <Text style={isMissing ? styles.missingBadge : styles.excessBadge}>
                {isMissing ? `${item.difference} missing` : `${Math.abs(item.difference)} excess`}
              </Text>
            </View>

            {item.stock_return && (
              <Text style={styles.meta}>
                {item.stock_return.return_number} · {item.stock_return.from_branch_name} → {item.stock_return.to_branch_name}
              </Text>
            )}

            <View style={styles.auditRow}>
              <Text style={styles.label}>Expected (returned):</Text>
              <Text style={styles.value}>{item.quantity_expected}</Text>
            </View>

            <View style={styles.auditRow}>
              <Text style={styles.label}>Actual received:</Text>
              <Text style={styles.value}>{item.quantity_received}</Text>
            </View>

            <View style={styles.auditRow}>
              <Text style={styles.label}>Recorded:</Text>
              <Text style={styles.value}>{formatDate(item.created_at)}</Text>
            </View>

            {item.notes ? (
              <View style={styles.auditRow}>
                <Text style={styles.label}>Notes:</Text>
                <Text style={styles.value}>{item.notes}</Text>
              </View>
            ) : null}

            <AppButton
              label="View return"
              variant="secondary"
              onPress={() => {
                const target = role === 'owner' ? `/owner/returns/${returnId}` : `/manager/returns/${returnId}`;
                router.push(target as any);
              }}
            />
          </View>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  discrepancyCard: {
    borderColor: '#FCA5A5',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  productName: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
    flex: 1,
  },
  missingBadge: {
    color: '#B91C1C',
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.sm,
    fontSize: 12,
    fontWeight: '800',
    overflow: 'hidden',
  },
  excessBadge: {
    color: '#1E40AF',
    backgroundColor: '#DBEAFE',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.sm,
    fontSize: 12,
    fontWeight: '800',
    overflow: 'hidden',
  },
  meta: {
    color: colors.muted,
    fontSize: 13,
    marginBottom: spacing.xs,
  },
  auditRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
  },
  label: {
    color: colors.muted,
    fontSize: 13,
  },
  value: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
});
