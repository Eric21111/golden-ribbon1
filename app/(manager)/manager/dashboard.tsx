import Ionicons from '@react-native-vector-icons/ionicons';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { HamburgerButton } from '@/components/dashboard/HamburgerButton';
import { NavTile } from '@/components/dashboard/NavTile';
import { RecentSaleRow } from '@/components/dashboard/RecentSaleRow';
import { StatTile } from '@/components/dashboard/StatTile';
import { managerColors } from '@/components/dashboard/theme';
import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { ErrorState } from '@/components/Feedback';
import { Screen } from '@/components/Screen';
import { spacing } from '@/constants/theme';
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

  const managerName = profile?.full_name ?? 'Manager';

  return (
    <Screen
      backgroundColor="#FFFFFF"
      edges={['top']}
      refreshing={refreshing}
      onRefresh={refresh}
      contentContainerStyle={styles.screenContent}
    >
      <View style={styles.header}>
        <View style={styles.topRow}>
          <HamburgerButton />
        </View>
        <View style={styles.identity}>
          <Text style={styles.greeting} numberOfLines={1}>
            Hi, {managerName}
          </Text>
          <View style={styles.pillRow}>
            <View style={styles.rolePill}>
              <View style={styles.roleDot} />
              <Text style={styles.rolePillText}>BRANCH MANAGER</Text>
            </View>
            <View style={styles.branchPill}>
              <Ionicons name="storefront-outline" size={12} color={managerColors.subtext} />
              <Text style={styles.branchPillText} numberOfLines={1}>
                {profile?.branch?.name ?? 'Unassigned'}
              </Text>
            </View>
          </View>
        </View>
      </View>

      <ConstrainedWidth style={styles.column}>
        {metricsQuery.error ? (
          <ErrorState
            message={getErrorMessage(metricsQuery.error)}
            onRetry={refresh}
            titleStyle={styles.errorTitle}
            messageStyle={styles.errorMessage}
            retryLabelStyle={styles.errorRetryLabel}
          />
        ) : (
          <View style={styles.content}>
            <Section title="BRANCH SNAPSHOT">
              <Row>
                <StatTile
                  style={styles.half}
                  emphasis
                  icon="cash-outline"
                  label="Today's Sales"
                  value={metrics ? formatMoney(metrics.today_sales) : '—'}
                  onPress={() => router.push('/manager/sales' as never)}
                />
                <StatTile
                  style={styles.half}
                  icon="receipt-outline"
                  label="Orders Today"
                  value={metrics?.today_transactions ?? '—'}
                  onPress={() => router.push('/manager/sales' as never)}
                />
              </Row>
              <Row>
                <StatTile
                  style={styles.half}
                  icon="cube-outline"
                  label="Products in stock"
                  value={metrics?.current_inventory_count ?? '—'}
                  onPress={() => router.push('/manager/inventory')}
                />
                <StatTile
                  style={styles.half}
                  icon="download-outline"
                  label="Pending incoming"
                  value={metrics?.pending_incoming_transfers_count ?? '—'}
                  onPress={() => router.push('/manager/incoming')}
                />
              </Row>
            </Section>

            <Section title="SALES">
              <Row>
                <NavTile
                  layout="tile"
                  icon="bar-chart-outline"
                  accent="blue"
                  title="Branch Product Sales"
                  onPress={() => router.push('/manager/reports/product-sales' as never)}
                />
                <NavTile
                  layout="tile"
                  icon="time-outline"
                  accent="gold"
                  title="Sales History"
                  onPress={() => router.push('/manager/sales' as never)}
                />
                <NavTile
                  layout="tile"
                  icon="people-outline"
                  accent="teal"
                  title="Shift History"
                  onPress={() => router.push('/manager/shifts' as never)}
                />
              </Row>

              {recentSales.length > 0 ? (
                <>
                  <View style={styles.recentHeader}>
                    <Text style={styles.recentTitle}>Recent Sales</Text>
                    <Pressable
                      accessibilityRole="button"
                      hitSlop={8}
                      onPress={() => router.push('/manager/sales' as never)}
                    >
                      <Text style={styles.viewAll}>View all</Text>
                    </Pressable>
                  </View>
                  {recentSales.map((sale) => (
                    <RecentSaleRow
                      key={sale.id}
                      saleNumber={sale.sale_number}
                      amount={formatMoney(sale.total_amount)}
                      cashierName={sale.cashier_name ?? 'Cashier'}
                      date={formatDate(sale.sold_at)}
                    />
                  ))}
                </>
              ) : null}
            </Section>

            <Section title="NEEDS ATTENTION">
              {attentionItems.length === 0 ? (
                <View style={styles.quietCard}>
                  <Text style={styles.quiet}>Nothing needs attention</Text>
                </View>
              ) : (
                attentionItems.map((item) => (
                  <NavTile
                    key={item.title}
                    variant="alert"
                    icon="alert-circle-outline"
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
                <NavTile
                  layout="tile"
                  icon="return-up-back-outline"
                  accent="lilac"
                  title="Stock returns"
                  onPress={() => router.push('/manager/returns')}
                />
                <NavTile
                  layout="tile"
                  icon="swap-vertical-outline"
                  accent="blue"
                  title="Inventory history"
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
  screenContent: { flexGrow: 1, padding: 0, gap: 0 },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    gap: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: managerColors.cardBorder,
  },
  topRow: { flexDirection: 'row', alignItems: 'center' },
  identity: { gap: spacing.sm },
  greeting: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 24 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  rolePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#EAF0FB',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  roleDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: managerColors.gold },
  rolePillText: { color: managerColors.royalBlue, fontFamily: 'Inter_600SemiBold', fontSize: 11, letterSpacing: 0.6 },
  branchPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: managerColors.cardSurface,
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    maxWidth: 200,
  },
  branchPillText: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 12 },
  column: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.xl },
  content: { gap: spacing.lg },
  section: { gap: spacing.sm },
  sectionTitle: {
    color: managerColors.subtext,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    letterSpacing: 0.8,
  },
  row: { flexDirection: 'row', gap: spacing.sm },
  half: { flex: 1 },
  quietCard: {
    backgroundColor: managerColors.cardSurface,
    borderRadius: 16,
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  quiet: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 14 },
  recentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.xs,
    marginBottom: 2,
  },
  recentTitle: {
    color: managerColors.subtext,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  viewAll: { color: managerColors.royalBlue, fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  errorTitle: { fontFamily: 'Inter_700Bold' },
  errorMessage: { fontFamily: 'Inter_400Regular' },
  errorRetryLabel: { fontFamily: 'Inter_700Bold' },
});
