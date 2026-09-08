import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { DashboardCard } from '@/components/DashboardCard';
import { ErrorState } from '@/components/Feedback';
import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';
import { colors, spacing } from '@/constants/theme';
import { useAuth } from '@/features/auth/AuthProvider';
import { useBranches } from '@/hooks/useBranches';
import { useOwnerDashboardMetrics } from '@/hooks/useSales';
import { getErrorMessage } from '@/lib/errors';
import { formatMoney } from '@/lib/format';

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

export default function OwnerDashboard() {
  const { profile } = useAuth();
  const branches = useBranches();
  const metricsQuery = useOwnerDashboardMetrics();

  const metrics = metricsQuery.data;
  const activeBranchCount = branches.data?.filter((branch) => branch.is_active).length;
  const refreshing = branches.isRefetching || metricsQuery.isRefetching;

  const attentionItems = [
    {
      title: 'Pending Transfers',
      value: metrics?.pending_transfers_count,
      description: 'Stock awaiting branch receipt',
      href: '/owner/transfers',
    },
    {
      title: 'Pending Return Receipts',
      value: metrics?.in_transit_returns_count,
      description: 'Returns awaiting Main Branch receipt',
      href: '/owner/returns',
    },
    {
      title: 'Transfer Discrepancies',
      value: metrics?.transfer_discrepancies_count,
      description: 'Missing or excess items on transfer receive',
      href: '/owner/reports/transfer-discrepancies',
    },
    {
      title: 'Return Discrepancies',
      value: metrics?.return_discrepancies_count,
      description: 'Missing or excess items on return receive',
      href: '/owner/reports/return-discrepancies',
    },
  ].filter((item) => typeof item.value === 'number' && item.value > 0);

  const refresh = () => {
    void branches.refetch();
    void metricsQuery.refetch();
  };

  return (
    <Screen refreshing={refreshing} onRefresh={refresh} constrain>
      <PageHeader title={`Hello, ${profile?.full_name ?? 'Owner'}`} subtitle="Company-wide administration" />
      <Text style={styles.role}>OWNER</Text>

      {branches.error || metricsQuery.error ? (
        <ErrorState
          message={getErrorMessage(branches.error ?? metricsQuery.error)}
          onRetry={refresh}
        />
      ) : (
        <View style={styles.content}>
          <Section title="BUSINESS SNAPSHOT">
            <Row>
              <DashboardCard
                style={styles.half}
                title="Today's Sales"
                value={metrics ? formatMoney(metrics.today_sales) : '—'}
                description="Revenue today (PH)"
                onPress={() => router.push('/owner/sales' as any)}
              />
              <DashboardCard
                style={styles.half}
                title="Orders Today"
                value={metrics?.today_transactions ?? '—'}
                description="Completed orders (PH)"
                onPress={() => router.push('/owner/sales' as any)}
              />
            </Row>
            <Row>
              <DashboardCard
                style={styles.half}
                title="Active Branches"
                value={activeBranchCount ?? '—'}
                description="Selling locations"
                onPress={() => router.push('/owner/branches')}
              />
              <DashboardCard
                style={styles.half}
                title="Active Products"
                value={metrics?.active_products_count ?? '—'}
                description="Catalog items for sale"
                onPress={() => router.push('/owner/products')}
              />
            </Row>
          </Section>

          <Section title="SALES & PERFORMANCE">
            <Row>
              <DashboardCard
                style={styles.half}
                title="Sales by Branch"
                description="Revenue and volume by branch"
                onPress={() => router.push('/owner/reports/sales-by-branch' as any)}
              />
              <DashboardCard
                style={styles.half}
                title="Product Sales Summary"
                description="Units sold and revenue per product"
                onPress={() => router.push('/owner/reports/product-sales' as any)}
              />
            </Row>
            <Row>
              <DashboardCard
                style={styles.half}
                title="Branch Performance"
                description="Sales and discrepancy comparison"
                onPress={() => router.push('/owner/reports/branch-performance' as any)}
              />
              <DashboardCard
                style={styles.half}
                title="Sales History"
                description="Search company-wide sales"
                onPress={() => router.push('/owner/sales' as any)}
              />
            </Row>
            <DashboardCard
              title="Shift History"
              description="Review all cashier shift sessions and sales totals"
              onPress={() => router.push('/owner/shifts' as any)}
            />
            <DashboardCard
              title="Audit History"
              description="Company-wide activity and change trail"
              onPress={() => router.push('/owner/audit' as any)}
            />
          </Section>

          <Section title="INVENTORY">
            <Row>
              <DashboardCard
                style={styles.half}
                title="Inventory by Branch"
                description="Read-only balances across branches"
                onPress={() => router.push('/owner/inventory-by-branch')}
              />
              <DashboardCard
                style={styles.half}
                title="Inventory Reconciliation"
                description="Physical stock vs movement ledger"
                onPress={() => router.push('/owner/reports/inventory-reconciliation' as any)}
              />
            </Row>
            <Row>
              <DashboardCard
                style={styles.half}
                title="Inventory History"
                description="Signed inventory movements"
                onPress={() => router.push('/owner/movements')}
              />
              <DashboardCard
                style={styles.half}
                title="Stock Returns"
                description="All branch stock returns"
                onPress={() => router.push('/owner/returns')}
              />
            </Row>
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
                  onPress={() => router.push(item.href as any)}
                />
              ))
            )}
          </Section>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
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
});
