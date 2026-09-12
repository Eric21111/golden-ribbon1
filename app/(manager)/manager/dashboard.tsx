import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { DashboardCard } from '@/components/DashboardCard';
import { ErrorState } from '@/components/Feedback';
import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';
import { colors, spacing } from '@/constants/theme';
import { useAuth } from '@/features/auth/AuthProvider';
import { isMainBranchManager } from '@/features/auth/roles';
import { useManagerDashboardMetrics } from '@/hooks/useSales';
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

export default function ManagerDashboard() {
  const { profile } = useAuth();
  const metricsQuery = useManagerDashboardMetrics();
  const metrics = metricsQuery.data;
  const isMain = isMainBranchManager(profile);

  const attentionItems = (
    isMain
      ? [
          {
            title: 'Returns awaiting receipt',
            value: metrics?.returns_in_transit_count,
            description: 'Physically count and receive stock back at Main',
            href: '/manager/returns',
          },
        ]
      : [
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
        ]
  ).filter((item) => typeof item.value === 'number' && item.value > 0);

  const refresh = () => {
    void metricsQuery.refetch();
  };

  return (
    <Screen refreshing={metricsQuery.isRefetching} onRefresh={refresh}>
      <ConstrainedWidth style={styles.column}>
        <PageHeader
          title={`Hello, ${profile?.full_name ?? 'Manager'}`}
          subtitle={profile?.branch?.name ?? 'Assigned branch unavailable'}
        />
        <Text style={styles.role}>{isMain ? 'MAIN BRANCH MANAGER' : 'BRANCH MANAGER'}</Text>

        {metricsQuery.error ? (
          <ErrorState message={getErrorMessage(metricsQuery.error)} onRetry={refresh} />
        ) : (
          <View style={styles.content}>
            {isMain ? (
              <>
                <Section title="OPERATIONS">
                  <Row>
                    <DashboardCard
                      style={styles.half}
                      title="Products"
                      description="Create, edit, and price the catalog"
                      onPress={() => router.push('/manager/products')}
                    />
                    <DashboardCard
                      style={styles.half}
                      title="Branches"
                      description="Create and maintain selling branches"
                      onPress={() => router.push('/manager/branches' as never)}
                    />
                  </Row>
                  <Row>
                    <DashboardCard
                      style={styles.half}
                      title="Main Inventory"
                      description="Opening stock and Main Branch balances"
                      onPress={() => router.push('/manager/inventory')}
                    />
                    <DashboardCard
                      style={styles.half}
                      title="Transfers"
                      description="Send stock and view transfer history"
                      onPress={() => router.push('/manager/transfers' as never)}
                    />
                  </Row>
                  <DashboardCard
                    title="Returns"
                    description="Receive returns and view return history"
                    onPress={() => router.push('/manager/returns')}
                  />
                </Section>
                <Section title="SNAPSHOT">
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
                      title="Returns in transit"
                      value={metrics?.returns_in_transit_count ?? '—'}
                      description="Awaiting Main Branch receipt"
                      onPress={() => router.push('/manager/returns')}
                    />
                  </Row>
                </Section>
              </>
            ) : (
              <>
                <Section title="BRANCH SNAPSHOT">
                  <Row>
                    <DashboardCard
                      style={styles.half}
                      title="Today's Sales"
                      value={metrics ? formatMoney(metrics.today_sales) : '—'}
                      description="Revenue today (PH)"
                      onPress={() => router.push('/manager/reports/product-sales')}
                    />
                    <DashboardCard
                      style={styles.half}
                      title="Orders Today"
                      value={metrics?.today_transactions ?? '—'}
                      description="Completed transactions (PH)"
                      onPress={() => router.push('/manager/reports/product-sales')}
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
                <Section title="OPERATIONS">
                  <Row>
                    <DashboardCard
                      style={styles.half}
                      title="Transfer History"
                      description="Transfers sent to this branch"
                      onPress={() => router.push('/manager/transfers' as never)}
                    />
                    <DashboardCard
                      style={styles.half}
                      title="Stock returns"
                      description="Return unsold stock to Main"
                      onPress={() => router.push('/manager/returns')}
                    />
                  </Row>
                  <DashboardCard
                    title="Branch Product Sales"
                    description="Units sold and revenue for this branch"
                    onPress={() => router.push('/manager/reports/product-sales')}
                  />
                </Section>
              </>
            )}

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
});
