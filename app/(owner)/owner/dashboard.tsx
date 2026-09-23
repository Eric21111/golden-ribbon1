import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { Screen } from '@/components/Screen';
import { HamburgerButton } from '@/components/dashboard/HamburgerButton';
import { ListRowCard } from '@/components/dashboard/ListRowCard';
import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { NavTile } from '@/components/dashboard/NavTile';
import { StatTile } from '@/components/dashboard/StatTile';
import { managerColors } from '@/components/dashboard/theme';
import { spacing } from '@/constants/theme';
import { useAuth } from '@/features/auth/AuthProvider';
import { useArchiveStatus, useDismissArchiveReminder } from '@/hooks/useArchive';
import { useOwnerDailyProductSummary, useOwnerDashboardMetrics } from '@/hooks/useSales';
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
  const metricsQuery = useOwnerDashboardMetrics();
  const summaryQuery = useOwnerDailyProductSummary();
  const archiveQuery = useArchiveStatus();
  const dismissReminder = useDismissArchiveReminder();

  const metrics = metricsQuery.data;
  const summary = summaryQuery.data ?? [];
  const archive = archiveQuery.data;
  const refreshing = metricsQuery.isRefetching || summaryQuery.isRefetching || archiveQuery.isRefetching;
  const ownerName = profile?.full_name ?? 'Owner';

  const refresh = () => {
    void metricsQuery.refetch();
    void summaryQuery.refetch();
    void archiveQuery.refetch();
  };

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
        <Text style={styles.greeting} numberOfLines={1}>
          Hi, {ownerName}
        </Text>
        <View style={styles.rolePill}>
          <View style={styles.roleDot} />
          <Text style={styles.rolePillText}>OWNER · COMPANY-WIDE</Text>
        </View>
      </View>

      <ConstrainedWidth style={styles.column}>
        {metricsQuery.error || summaryQuery.error ? (
          <ErrorState
            message={getErrorMessage(metricsQuery.error ?? summaryQuery.error)}
            onRetry={refresh}
          />
        ) : (
          <View style={styles.content}>
            {metrics && (metrics.transfer_discrepancies_count > 0 || metrics.return_discrepancies_count > 0) ? (
              <View style={styles.alertCard}>
                <Text style={styles.alertTitle}>Quantity discrepancy reported</Text>
                <Text style={styles.alertBody}>
                  {[
                    metrics.transfer_discrepancies_count > 0
                      ? `${metrics.transfer_discrepancies_count} transfer issue${metrics.transfer_discrepancies_count === 1 ? '' : 's'}`
                      : null,
                    metrics.return_discrepancies_count > 0
                      ? `${metrics.return_discrepancies_count} return issue${metrics.return_discrepancies_count === 1 ? '' : 's'}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  . Only the counted quantity was added to inventory.
                </Text>
                <ManagerActionButton
                  label="Review discrepancies"
                  icon="alert-circle-outline"
                  onPress={() =>
                    router.push(
                      (metrics.transfer_discrepancies_count > 0 && metrics.return_discrepancies_count > 0
                        ? '/owner/reports/discrepancies'
                        : metrics.transfer_discrepancies_count > 0
                          ? '/owner/reports/transfer-discrepancies'
                          : '/owner/reports/return-discrepancies') as never,
                    )
                  }
                />
              </View>
            ) : null}

            {archive?.reminder_visible ? (
              <View style={styles.reminderCard}>
                <Text style={styles.reminderTitle}>Data Archive Due</Text>
                <Text style={styles.reminderBody}>
                  You have detailed transaction data older than {archive.retention_days} days. Export
                  and verify the archive before cleaning old records.
                </Text>
                <View style={styles.reminderActions}>
                  <ManagerActionButton
                    label="Export & review"
                    icon="archive-outline"
                    onPress={() => router.push('/owner/data-archive' as never)}
                  />
                  <ManagerActionButton
                    label="Remind me later"
                    variant="secondary"
                    loading={dismissReminder.isPending}
                    onPress={() => void dismissReminder.mutateAsync()}
                  />
                </View>
              </View>
            ) : null}

            <Section title="TODAY">
              <Row>
                <StatTile
                  style={styles.half}
                  emphasis
                  icon="cash-outline"
                  label="Today's revenue"
                  value={metrics ? formatMoney(metrics.today_sales) : '—'}
                  onPress={() => router.push('/owner/reports/sales-by-branch')}
                />
              </Row>
              <Row>
                <StatTile
                  style={styles.half}
                  icon="receipt-outline"
                  label="Transactions"
                  value={metrics?.today_transactions ?? '—'}
                  onPress={() => router.push('/owner/reports/sales-by-branch')}
                />
                <StatTile
                  style={styles.half}
                  icon="cube-outline"
                  label="Units sold"
                  value={metrics?.today_units_sold ?? '—'}
                  onPress={() => router.push('/owner/reports/product-sales')}
                />
              </Row>
            </Section>

            <Section title="TODAY'S PRODUCT PERFORMANCE">
              {summaryQuery.isLoading && summary.length === 0 ? (
                <LoadingState label="Loading daily product summary…" />
              ) : summary.length === 0 ? (
                <View style={styles.quietCard}>
                  <Text style={styles.quiet}>No completed sales or declared returns today.</Text>
                </View>
              ) : (
                summary.map((row) => (
                  <ListRowCard
                    key={row.product_id}
                    title={row.product_name}
                    meta={`Sold ${row.quantity_sold} · Returned ${row.quantity_returned}`}
                    trailing={<Text style={styles.revenue}>{formatMoney(row.revenue)}</Text>}
                  />
                ))
              )}
            </Section>

            <Section title="REPORTS">
              <Row>
                <NavTile
                  layout="tile"
                  icon="stats-chart-outline"
                  accent="blue"
                  title="Sales by Branch"
                  onPress={() => router.push('/owner/reports/sales-by-branch')}
                />
                <NavTile
                  layout="tile"
                  icon="pricetag-outline"
                  accent="gold"
                  title="Product Sales"
                  onPress={() => router.push('/owner/reports/product-sales')}
                />
              </Row>
              <Row>
                <NavTile
                  layout="tile"
                  icon="git-branch-outline"
                  accent="teal"
                  title="Branch Performance"
                  onPress={() => router.push('/owner/reports/branch-performance' as never)}
                />
                <NavTile
                  layout="tile"
                  icon="cube-outline"
                  accent="lilac"
                  title="Inventory Summary"
                  onPress={() => router.push('/owner/inventory-by-branch')}
                />
              </Row>
              <Row>
                <NavTile
                  layout="tile"
                  icon="checkmark-done-outline"
                  accent="green"
                  title="Reconciliation"
                  onPress={() => router.push('/owner/reports/inventory-reconciliation')}
                />
                <NavTile
                  layout="tile"
                  icon="alert-circle-outline"
                  accent="red"
                  title="Discrepancy Analytics"
                  onPress={() => router.push('/owner/reports/discrepancies' as never)}
                />
              </Row>
            </Section>

            <Section title="ADMINISTRATION">
              <Row>
                <NavTile
                  layout="tile"
                  icon="people-outline"
                  accent="blue"
                  title="Employees"
                  onPress={() => router.push('/owner/employees' as never)}
                />
                <NavTile
                  layout="tile"
                  icon="archive-outline"
                  accent="gray"
                  title="Data Archive"
                  onPress={() => router.push('/owner/data-archive' as never)}
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
    gap: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: managerColors.cardBorder,
  },
  topRow: { flexDirection: 'row', alignItems: 'center' },
  greeting: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 24 },
  rolePill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    backgroundColor: '#EAF0FB',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  roleDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: managerColors.gold },
  rolePillText: { color: managerColors.royalBlue, fontFamily: 'Inter_600SemiBold', fontSize: 11, letterSpacing: 0.6 },
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
  revenue: { color: managerColors.royalBlue, fontFamily: 'Inter_700Bold', fontSize: 15 },
  alertCard: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
    borderLeftWidth: 3,
    borderLeftColor: '#B91C1C',
    borderRadius: 16,
    padding: spacing.md,
    gap: spacing.sm,
  },
  alertTitle: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 17 },
  alertBody: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20 },
  reminderCard: {
    backgroundColor: '#FFFBEF',
    borderColor: '#F1DFA8',
    borderLeftWidth: 3,
    borderLeftColor: managerColors.gold,
    borderRadius: 16,
    padding: spacing.md,
    gap: spacing.sm,
  },
  reminderTitle: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 17 },
  reminderBody: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20 },
  reminderActions: { gap: spacing.sm },
});
