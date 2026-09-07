import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { DashboardCard } from '@/components/DashboardCard';
import { ErrorState } from '@/components/Feedback';
import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';
import { SignOutButton } from '@/components/SignOutButton';
import { colors, radius, spacing } from '@/constants/theme';
import { useAuth } from '@/features/auth/AuthProvider';
import { useManagerDashboardMetrics, useManagerRecentSales } from '@/hooks/useSales';
import { getErrorMessage } from '@/lib/errors';
import { formatDate, formatMoney } from '@/lib/format';

export default function ManagerDashboard() {
  const { profile } = useAuth();
  const isMainBranch = Boolean(profile?.branch?.is_main_branch);

  const metricsQuery = useManagerDashboardMetrics();
  const recentSalesQuery = useManagerRecentSales(5);

  const metrics = metricsQuery.data;
  const recentSales = recentSalesQuery.data ?? [];

  return (
    <Screen>
      <PageHeader
        title={`Hello, ${profile?.full_name ?? 'Manager'}`}
        subtitle={profile?.branch?.name ?? 'Assigned branch unavailable'}
      />
      <Text style={styles.role}>BRANCH MANAGER</Text>

      {metricsQuery.error ? (
        <ErrorState
          message={getErrorMessage(metricsQuery.error)}
          onRetry={() => {
            void metricsQuery.refetch();
            void recentSalesQuery.refetch();
          }}
        />
      ) : (
        <View style={styles.grid}>
          {/* Sales Overview */}
          <DashboardCard
            title="Today's Sales"
            value={metrics ? formatMoney(metrics.today_sales) : '—'}
            description={`${metrics?.today_transactions ?? '—'} completed transactions today (PH)`}
            onPress={() => router.push('/manager/sales' as any)}
          />
          <DashboardCard
            title="Branch Product Sales"
            description="View units sold and revenue for this branch"
            onPress={() => router.push('/manager/reports/product-sales' as any)}
          />
          <DashboardCard
            title="Branch Sales History"
            description="Browse all completed orders for this branch"
            onPress={() => router.push('/manager/sales' as any)}
          />
          <DashboardCard
            title="Branch Shift History"
            description="Review cashier shifts and shift totals"
            onPress={() => router.push('/manager/shifts' as any)}
          />

          {/* Recent Sales Preview */}
          {recentSales.length > 0 && (
            <View style={styles.recentSection}>
              <View style={styles.recentHeader}>
                <Text style={styles.sectionTitle}>Recent Sales</Text>
                <AppButton
                  label="View all"
                  variant="secondary"
                  onPress={() => router.push('/manager/sales' as any)}
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
          )}

          {/* Inventory & Transfer Metrics */}
          <DashboardCard
            title="Pending incoming"
            value={metrics?.pending_incoming_transfers_count ?? '—'}
            description="Count and receive stock sent to this branch"
            onPress={() => router.push('/manager/incoming')}
          />
          <DashboardCard
            title="Products in inventory"
            value={metrics?.current_inventory_count ?? '—'}
            description="View current physical stock balances"
            onPress={() => router.push('/manager/inventory')}
          />
          <DashboardCard
            title="Stock returns"
            value={metrics?.returns_in_transit_count ?? '—'}
            description={
              isMainBranch
                ? 'Verify and receive unsold stock arriving from branches'
                : 'Send unsold stock back to Main Branch'
            }
            onPress={() => router.push('/manager/returns')}
          />
          <DashboardCard
            title="Products"
            description="View active product master data"
            onPress={() => router.push('/manager/products')}
          />
          <DashboardCard
            title="Inventory history"
            description="Review signed stock movements"
            onPress={() => router.push('/manager/movements')}
          />
          <DashboardCard
            title="Profile"
            description="View your account and assigned branch"
            onPress={() => router.push('/manager/profile')}
          />
        </View>
      )}
      <SignOutButton />
    </Screen>
  );
}

const styles = StyleSheet.create({
  role: { color: colors.primary, fontSize: 12, fontWeight: '800', letterSpacing: 1.2 },
  grid: { gap: spacing.md },
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
  sectionTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
  },
  recentCard: {
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
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
