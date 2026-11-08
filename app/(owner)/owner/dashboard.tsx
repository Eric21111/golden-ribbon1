import { router } from 'expo-router';
import { useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { Screen } from '@/components/Screen';
import { HamburgerButton } from '@/components/dashboard/HamburgerButton';
import { ListRowCard } from '@/components/dashboard/ListRowCard';
import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { ManagerBottomSheet } from '@/components/dashboard/ManagerBottomSheet';
import { ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { NavTile } from '@/components/dashboard/NavTile';
import { StatTile } from '@/components/dashboard/StatTile';
import { managerColors } from '@/components/dashboard/theme';
import { spacing } from '@/constants/theme';
import { useAuth } from '@/features/auth/AuthProvider';
import { buildTodayQuickview, todayQuickviewStatus } from '@/features/reports/todayQuickview';
import { useArchiveStatus, useDismissArchiveReminder } from '@/hooks/useArchive';
import { useManilaDayRefresh } from '@/hooks/useManilaDayRefresh';
import {
  useOwnerDailyProductSummary,
  useOwnerDashboardMetrics,
  useOwnerTodayBranchSales,
} from '@/hooks/useSales';
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

function chunkPairs<T>(items: readonly T[]): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += 2) rows.push(items.slice(i, i + 2));
  return rows;
}

function QuickviewError({ message, retrying, onRetry }: { message: string; retrying: boolean; onRetry: () => void }) {
  return (
    <View style={styles.inlineErrorCard} accessibilityLiveRegion="polite">
      <Text style={styles.inlineErrorTitle}>Couldn&apos;t load today&apos;s branch revenue.</Text>
      <Text style={styles.inlineErrorBody}>{message}</Text>
      <ManagerActionButton label="Retry" icon="refresh-outline" variant="secondary" loading={retrying} onPress={onRetry} />
    </View>
  );
}

export default function OwnerDashboard() {
  const { profile } = useAuth();
  const metricsQuery = useOwnerDashboardMetrics();
  const summaryQuery = useOwnerDailyProductSummary();
  const branchSalesQuery = useOwnerTodayBranchSales();
  const archiveQuery = useArchiveStatus();
  const dismissReminder = useDismissArchiveReminder();
  const [detailsOpen, setDetailsOpen] = useState(false);

  const metrics = metricsQuery.data;
  const summary = summaryQuery.data ?? [];
  const archive = archiveQuery.data;
  const quickview = useMemo(
    () => buildTodayQuickview(branchSalesQuery.data?.branches),
    [branchSalesQuery.data],
  );
  const quickviewStatus = todayQuickviewStatus(branchSalesQuery);
  const quickviewReady = quickviewStatus === 'ready';
  const retryQuickview = () => void branchSalesQuery.refetch();
  const quickviewError =
    quickviewStatus === 'error' ? (
      <QuickviewError
        message={getErrorMessage(branchSalesQuery.error)}
        retrying={branchSalesQuery.isFetching}
        onRetry={retryQuickview}
      />
    ) : null;
  const refreshing =
    metricsQuery.isRefetching ||
    summaryQuery.isRefetching ||
    branchSalesQuery.isRefetching ||
    archiveQuery.isRefetching;
  const ownerName = profile?.full_name ?? 'Owner';

  const refresh = () => {
    void metricsQuery.refetch();
    void summaryQuery.refetch();
    void branchSalesQuery.refetch();
    void archiveQuery.refetch();
  };

  useManilaDayRefresh(() => {
    void metricsQuery.refetch();
    void summaryQuery.refetch();
    void branchSalesQuery.refetch();
  });

  const openReport = (path: '/owner/reports/sales-by-branch' | '/owner/reports/product-sales') => {
    setDetailsOpen(false);
    router.push(path);
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
                  . Transfer issues credit counted PCS only; return issues do not restock Main.
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

            <Section title="Today Quickview">
              <StatTile
                emphasis
                layout="wide"
                icon="cash-outline"
                label="Total · selling branches"
                value={quickviewReady ? formatMoney(quickview.totalRevenue) : '—'}
                onPress={() => setDetailsOpen(true)}
              />
              {quickviewStatus === 'loading' ? (
                <LoadingState label="Loading branch revenue…" />
              ) : quickviewStatus === 'error' ? (
                quickviewError
              ) : quickview.branches.length === 0 ? (
                <View style={styles.quietCard}>
                  <Text style={styles.quiet}>No active selling branches.</Text>
                </View>
              ) : (
                chunkPairs(quickview.branches).map((pair) => (
                  <Row key={pair.map((branch) => branch.branchId).join(':')}>
                    {pair.map((branch) => (
                      <StatTile
                        key={branch.branchId}
                        style={styles.half}
                        compact
                        icon="storefront-outline"
                        label={branch.isActive ? branch.branchName : `Inactive · ${branch.branchName}`}
                        value={formatMoney(branch.revenue)}
                        onPress={() => router.push('/owner/reports/sales-by-branch')}
                      />
                    ))}
                    {pair.length === 1 ? <View style={styles.half} /> : null}
                  </Row>
                ))
              )}
              <ManagerActionButton
                label="Transactions & items sold"
                icon="receipt-outline"
                variant="secondary"
                onPress={() => setDetailsOpen(true)}
              />
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

      <ManagerBottomSheet
        visible={detailsOpen}
        title="Today's sales details"
        onClose={() => setDetailsOpen(false)}
        scroll
      >
        <Row>
          <StatTile
            style={styles.half}
            compact
            icon="receipt-outline"
            label="Transactions"
            value={quickviewReady ? quickview.totalTransactions : '—'}
          />
          <StatTile
            style={styles.half}
            compact
            icon="cube-outline"
            label="Items sold"
            value={metrics?.today_units_sold ?? '—'}
          />
        </Row>
        {quickviewError}
        {(quickviewReady ? quickview.branches : []).map((branch) => (
          <ListRowCard
            key={branch.branchId}
            icon="storefront-outline"
            title={branch.isActive ? branch.branchName : `Inactive · ${branch.branchName}`}
            meta={`${branch.transactions} transaction${branch.transactions === 1 ? '' : 's'}`}
            trailing={<Text style={styles.revenue}>{formatMoney(branch.revenue)}</Text>}
          />
        ))}
        <Text style={styles.quiet}>
          Completed sales for today (Asia/Manila). Sales revenue, not cash remitted.
        </Text>
        <ManagerActionButton
          label="Sales by Branch"
          icon="stats-chart-outline"
          onPress={() => openReport('/owner/reports/sales-by-branch')}
        />
        <ManagerActionButton
          label="Product Sales"
          icon="pricetag-outline"
          variant="secondary"
          onPress={() => openReport('/owner/reports/product-sales')}
        />
      </ManagerBottomSheet>
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
  inlineErrorCard: {
    backgroundColor: managerColors.cardSurface,
    borderRadius: 16,
    padding: spacing.md,
    gap: spacing.sm,
  },
  inlineErrorTitle: { color: '#B91C1C', fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  inlineErrorBody: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18 },
});
