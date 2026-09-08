import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { DashboardCard } from '@/components/DashboardCard';
import { ErrorState } from '@/components/Feedback';
import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';
import { colors, radius, spacing } from '@/constants/theme';
import { useAuth } from '@/features/auth/AuthProvider';
import { useManagerDashboardMetrics, useManagerRecentSales } from '@/hooks/useSales';
import { getErrorMessage } from '@/lib/errors';
import { formatDate, formatMoney } from '@/lib/format';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

export default function ManagerDashboard() {
  const { profile } = useAuth();
  const metricsQuery = useManagerDashboardMetrics();
  const recentSalesQuery = useManagerRecentSales(5);

  const metrics = metricsQuery.data;
  const recentSales = recentSalesQuery.data ?? [];
  const refreshing = metricsQuery.isRefetching || recentSalesQuery.isRefetching;

  const attentionItems = [
    {
      title: 'Pending incoming',
      value: metrics?.pending_incoming_transfers_count,
      description: 'Count and receive stock sent to this branch',
      href: '/manager/incoming',
    },
    {
      title: 'Returns in transit',
      value: metrics?.returns_in_transit_count,
      description: 'Unsold stock returning to Main Branch',
      href: '/manager/returns',
    },
  ].filter((item) => typeof item.value === 'number' && item.value > 0);

  const refresh = () => {
    void metricsQuery.refetch();
    void recentSalesQuery.refetch();
  };

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <ConstrainedWidth style={styles.column}>
        <PageHeader
          title={`Hello, ${profile?.full_name ?? 'Manager'}`}
          subtitle={profile?.branch?.name ?? 'Assigned branch unavailable'}
        />
        <Text style={styles.role}>BRANCH MANAGER</Text>

        {metricsQuery.error ? (
          <ErrorState message={getErrorMessage(metricsQuery.error)} onRetry={refresh} />
        ) : (
          <View style={styles.content}>
            <Section title="BRANCH SNAPSHOT">
              <Row>
                <DashboardCard
                  style={styles.half}
                  title="Today's Sales"
                  value={metrics ? formatMoney(metrics.today_sales) : '—'}
                  description="Revenue today (PH)"
                  onPress={() => router.push('/manager/sales' as never)}
                />
                <DashboardCard
                  style={styles.half}
                  title="Orders Today"
                  value={metrics?.today_transactions ?? '—'}
                  description="Completed transactions (PH)"
                  onPress={() => router.push('/manager/sales' as never)}
                />
              </Row>
              <Row>
                <DashboardCard
                  style={styles.half}
                  title="Products in stock"
                  value={metrics?.current_inventory_count ?? '—'}
                  description="SKUs with quantity on hand"
                  onPress={() => router.push('/manager/inventory')}
                />
                <DashboardCard
                  style={styles.half}
                  title="Pending incoming"
                  value={metrics?.pending_incoming_transfers_count ?? '—'}
                  description="Transfers awaiting receipt"
                  onPress={() => router.push('/manager/incoming')}
                />
              </Row>
            </Section>

            <Section title="SALES">
              <Row>
                <DashboardCard
                  style={styles.half}
                  title="Branch Product Sales"
                  description="Units sold and revenue"
                  onPress={() => router.push('/manager/reports/product-sales' as never)}
                />
                <DashboardCard
                  style={styles.half}
                  title="Sales History"
                  description="Completed branch orders"
                  onPress={() => router.push('/manager/sales' as never)}
                />
              </Row>
              <DashboardCard
                title="Shift History"
                description="Cashier shifts and shift totals"
                onPress={() => router.push('/manager/shifts' as never)}
              />

              {recentSales.length > 0 ? (
                <View style={styles.recentSection}>
                  <View style={styles.recentHeader}>
                    <Text style={styles.recentTitle}>Recent Sales</Text>
                    <AppButton
                      label="View all"
                      variant="secondary"
                      onPress={() => router.push('/manager/sales' as never)}
                    />
                  </View>
                  {recentSales.map((sale) => (
                    <View key={sale.id} style={styles.recentCard}>
                      <View style={styles.recentRow}>
                        <Text style={styles.saleNumber}>{sale.sale_number}</Text>
                        <Text style={styles.saleAmount}>{formatMoney(sale.total_amount)}</Text>
                      </View>
                      <Text style={styles.saleMeta}>
                        {sale.cashier_name ?? 'Cashier'} · {formatDate(sale.sold_at)}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </Section>

            <Section title="NEEDS ATTENTION">
              {attentionItems.length === 0 ? (
                <Text style={styles.quiet}>Nothing needs attention</Text>
              ) : (
                attentionItems.map((item) => (
                  <DashboardCard
                    key={item.title}
                    variant="alert"
                    title={item.title}
                    value={item.value}
                    description={item.description}
                    onPress={() => router.push(item.href as never)}
                  />
                ))
              )}
            </Section>

            <Section title="INVENTORY">
              <Row>
                <DashboardCard
                  style={styles.half}
                  title="Stock returns"
                  description="Return unsold stock to Main"
                  onPress={() => router.push('/manager/returns')}
                />
                <DashboardCard
                  style={styles.half}
                  title="Inventory history"
                  description="Signed stock movements"
                  onPress={() => router.push('/manager/movements')}
                />
              </Row>
            </Section>
          </View>
        )}
      </ConstrainedWidth>
    </Screen>
  );
}

const styles = StyleSheet.create({
  column: { gap: spacing.md },
  role: { color: colors.primary, fontSize: 12, fontWeight: '800', letterSpacing: 1.2 },
  content: { gap: spacing.lg },
  section: { gap: spacing.sm },
  sectionTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  row: { flexDirection: 'row', gap: spacing.sm },
  half: { flex: 1 },
  quiet: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    paddingVertical: spacing.sm,
  },
  recentSection: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  recentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  recentTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
  },
  recentCard: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.xs,
    gap: 2,
  },
  recentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  saleNumber: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  saleAmount: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '800',
  },
  saleMeta: {
    color: colors.muted,
    fontSize: 12,
  },
});
