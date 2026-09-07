import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { EmptyState, ErrorState, LoadingState } from '@/components/Feedback';
import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';
import { colors, radius, spacing } from '@/constants/theme';
import { useAuth } from '@/features/auth/AuthProvider';
import { useShiftHistory, useShiftSummary } from '@/hooks/useShifts';
import { getErrorMessage } from '@/lib/errors';
import { formatDate, formatMoney } from '@/lib/format';
import { listShiftSales } from '@/services/saleService';
import type { ShiftStatus } from '@/types/models';

function ShiftStatusBadge({ status }: { status: ShiftStatus }) {
  const isOpen = status === 'open';
  return (
    <Text style={[styles.badge, isOpen ? styles.openBadge : styles.closedBadge]}>
      {isOpen ? 'OPEN' : 'CLOSED'}
    </Text>
  );
}

export function ShiftHistoryScreen({ role }: { role: 'owner' | 'manager' | 'cashier' }) {
  const { profile } = useAuth();
  const [page, setPage] = useState(0);

  const shiftQuery = useShiftHistory({}, page);
  const shifts = shiftQuery.data ?? [];

  return (
    <Screen>
      <PageHeader
        title="Shift History"
        subtitle={
          role === 'owner'
            ? 'Cashier shifts across all branches.'
            : role === 'manager'
            ? `${profile?.branch?.name ?? 'Branch'} shifts.`
            : 'Your shift sessions.'
        }
      />

      {shiftQuery.isLoading && <LoadingState label="Loading shift history…" />}
      {shiftQuery.error && (
        <ErrorState
          message={getErrorMessage(shiftQuery.error)}
          onRetry={() => void shiftQuery.refetch()}
        />
      )}

      {shifts.length === 0 && !shiftQuery.isLoading && (
        <EmptyState title="No shifts found" message="Completed cashier shifts will appear here." />
      )}

      {shifts.map((shift) => (
        <View key={shift.id} style={styles.card}>
          <View style={styles.headerRow}>
            <Text style={styles.title}>{shift.cashier_name}</Text>
            <ShiftStatusBadge status={shift.status} />
          </View>

          <View style={styles.auditRow}>
            <Text style={styles.label}>Branch:</Text>
            <Text style={styles.value}>{shift.branch_name}</Text>
          </View>

          <View style={styles.auditRow}>
            <Text style={styles.label}>Started:</Text>
            <Text style={styles.value}>{formatDate(shift.started_at)}</Text>
          </View>

          <View style={styles.auditRow}>
            <Text style={styles.label}>Ended:</Text>
            <Text style={styles.value}>{shift.ended_at ? formatDate(shift.ended_at) : 'Active / In Progress'}</Text>
          </View>

          <View style={styles.auditRow}>
            <Text style={styles.label}>Completed Orders:</Text>
            <Text style={styles.value}>{shift.completed_transaction_count}</Text>
          </View>

          <View style={styles.auditRow}>
            <Text style={styles.label}>Total Sales:</Text>
            <Text style={styles.totalValue}>{formatMoney(shift.total_sales)}</Text>
          </View>

          <AppButton
            label="View shift details"
            variant="secondary"
            onPress={() => {
              const route =
                role === 'owner'
                  ? `/owner/shifts/${shift.id}`
                  : role === 'manager'
                  ? `/manager/shifts/${shift.id}`
                  : `/cashier/shifts/${shift.id}`;
              router.push(route as any);
            }}
          />
        </View>
      ))}

      {/* Pagination Controls */}
      <View style={styles.paginationRow}>
        <AppButton
          label="Previous"
          variant="secondary"
          disabled={page === 0 || shiftQuery.isLoading}
          onPress={() => setPage((p) => Math.max(0, p - 1))}
        />
        <Text style={styles.pageIndicator}>Page {page + 1}</Text>
        <AppButton
          label="Next"
          variant="secondary"
          disabled={shifts.length < 50 || shiftQuery.isLoading}
          onPress={() => setPage((p) => p + 1)}
        />
      </View>
    </Screen>
  );
}

export function ShiftDetailsScreen({ role }: { role: 'owner' | 'manager' | 'cashier' }) {
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : '';

  const summaryQuery = useShiftSummary(id);
  const salesQuery = useQuery({
    queryKey: ['shift-sales', id],
    queryFn: () => listShiftSales(id),
    enabled: Boolean(id),
  });

  if (summaryQuery.isLoading) return <LoadingState label="Loading shift summary…" />;
  if (summaryQuery.error || !summaryQuery.data) {
    return (
      <Screen>
        <ErrorState
          message="Unable to load shift summary."
          onRetry={() => void summaryQuery.refetch()}
        />
      </Screen>
    );
  }

  const shift = summaryQuery.data;
  const sales = salesQuery.data ?? [];

  return (
    <Screen>
      <View style={styles.headerRow}>
        <PageHeader
          title={shift.cashier_name}
          subtitle={`${shift.branch_name} · ${shift.status === 'open' ? 'Active Shift' : 'Closed Shift'}`}
        />
        <ShiftStatusBadge status={shift.status} />
      </View>

      <View style={styles.summaryCard}>
        <Text style={styles.summaryTitle}>Shift Performance</Text>
        <View style={styles.auditRow}>
          <Text style={styles.label}>Started At:</Text>
          <Text style={styles.value}>{formatDate(shift.started_at)}</Text>
        </View>
        <View style={styles.auditRow}>
          <Text style={styles.label}>Ended At:</Text>
          <Text style={styles.value}>{shift.ended_at ? formatDate(shift.ended_at) : 'Still Open'}</Text>
        </View>
        <View style={styles.auditRow}>
          <Text style={styles.label}>Completed Orders:</Text>
          <Text style={styles.statValue}>{shift.completed_transaction_count}</Text>
        </View>
        <View style={styles.auditRow}>
          <Text style={styles.label}>Total Sales:</Text>
          <Text style={styles.statSales}>{formatMoney(shift.total_sales)}</Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>Shift Sales</Text>
      {salesQuery.isLoading && <LoadingState label="Loading shift sales…" />}
      {salesQuery.error && (
        <ErrorState
          message={getErrorMessage(salesQuery.error)}
          onRetry={() => void salesQuery.refetch()}
        />
      )}

      {sales.length === 0 && !salesQuery.isLoading && (
        <EmptyState
          title="No sales in this shift"
          message="Any orders confirmed during this shift will appear here."
        />
      )}

      {sales.map((sale) => (
        <View key={sale.id} style={styles.card}>
          <View style={styles.headerRow}>
            <Text style={styles.title}>{sale.sale_number}</Text>
            <Text style={styles.totalValue}>{formatMoney(sale.total_amount)}</Text>
          </View>
          <Text style={styles.metaText}>{formatDate(sale.sold_at)}</Text>
          <AppButton
            label="View sale details"
            variant="secondary"
            onPress={() => {
              const route =
                role === 'owner'
                  ? `/owner/sales/${sale.id}`
                  : role === 'manager'
                  ? `/manager/sales/${sale.id}`
                  : `/cashier/sales/${sale.id}`;
              router.push(route as any);
            }}
          />
        </View>
      ))}
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
  summaryCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  summaryTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
    marginBottom: spacing.xs,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  title: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
  },
  metaText: {
    color: colors.muted,
    fontSize: 13,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.sm,
    fontSize: 11,
    fontWeight: '800',
    overflow: 'hidden',
  },
  openBadge: {
    color: '#166534',
    backgroundColor: '#DCFCE7',
  },
  closedBadge: {
    color: '#57534E',
    backgroundColor: '#E7E5E4',
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
  statValue: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
  },
  statSales: {
    color: colors.primary,
    fontSize: 17,
    fontWeight: '900',
  },
  totalValue: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: '800',
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
    marginTop: spacing.sm,
  },
  paginationRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.md,
  },
  pageIndicator: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: '600',
  },
});
