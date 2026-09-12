import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { DashboardCard } from '@/components/DashboardCard';
import { ErrorState, LoadingState } from '@/components/Feedback';
import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';
import { colors, radius, spacing } from '@/constants/theme';
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

function Row({ children }: { title?: string; children: ReactNode }) {
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

  const refresh = () => {
    void metricsQuery.refetch();
    void summaryQuery.refetch();
    void archiveQuery.refetch();
  };

  return (
    <Screen refreshing={refreshing} onRefresh={refresh} constrain>
      <PageHeader title={`Hello, ${profile?.full_name ?? 'Owner'}`} subtitle="Company-wide analytics" />
      <Text style={styles.role}>OWNER</Text>

      {metricsQuery.error || summaryQuery.error ? (
        <ErrorState
          message={getErrorMessage(metricsQuery.error ?? summaryQuery.error)}
          onRetry={refresh}
        />
      ) : (
        <View style={styles.content}>
          {archive?.reminder_visible ? (
            <View style={styles.reminder}>
              <Text style={styles.reminderTitle}>Data Archive Due</Text>
              <Text style={styles.reminderBody}>
                You have detailed transaction data older than {archive.retention_days} days. Export and
                verify the archive before cleaning old records.
              </Text>
              <View style={styles.reminderActions}>
                <AppButton
                  label="Export & Review"
                  onPress={() => router.push('/owner/data-archive' as never)}
                />
                <AppButton
                  label="Remind Me Later"
                  variant="secondary"
                  loading={dismissReminder.isPending}
                  onPress={() => void dismissReminder.mutateAsync()}
                />
              </View>
            </View>
          ) : null}

          <Section title="TODAY">
            <Row>
              <DashboardCard
                style={styles.half}
                title="Today's Revenue"
                value={metrics ? formatMoney(metrics.today_sales) : '—'}
                description="Completed sales (PH)"
                onPress={() => router.push('/owner/reports/sales-by-branch')}
              />
              <DashboardCard
                style={styles.half}
                title="Today's Transactions"
                value={metrics?.today_transactions ?? '—'}
                description="Completed orders (PH)"
                onPress={() => router.push('/owner/reports/sales-by-branch')}
              />
            </Row>
            <DashboardCard
              title="Units Sold"
              value={metrics?.today_units_sold ?? '—'}
              description="Completed sale quantities today (PH)"
              onPress={() => router.push('/owner/reports/product-sales')}
            />
          </Section>

          <Section title="TODAY'S PRODUCT PERFORMANCE">
            {summaryQuery.isLoading && summary.length === 0 ? (
              <LoadingState label="Loading daily product summary…" />
            ) : summary.length === 0 ? (
              <Text style={styles.quiet}>No completed sales or declared returns today.</Text>
            ) : (
              <View style={styles.table}>
                <View style={[styles.tableRow, styles.tableHeader]}>
                  <Text style={[styles.cellProduct, styles.headerCell]}>Product</Text>
                  <Text style={[styles.cellQty, styles.headerCell]}>Sold</Text>
                  <Text style={[styles.cellQty, styles.headerCell]}>Returned</Text>
                  <Text style={[styles.cellMoney, styles.headerCell]}>Revenue</Text>
                </View>
                {summary.map((row) => (
                  <View key={row.product_id} style={styles.tableRow}>
                    <Text style={styles.cellProduct}>{row.product_name}</Text>
                    <Text style={styles.cellQty}>{row.quantity_sold}</Text>
                    <Text style={styles.cellQty}>{row.quantity_returned}</Text>
                    <Text style={styles.cellMoney}>{formatMoney(row.revenue)}</Text>
                  </View>
                ))}
              </View>
            )}
          </Section>

          <Section title="REPORTS">
            <Row>
              <DashboardCard
                style={styles.half}
                title="Sales by Branch"
                description="Revenue and volume by branch"
                onPress={() => router.push('/owner/reports/sales-by-branch')}
              />
              <DashboardCard
                style={styles.half}
                title="Product Sales"
                description="Units sold and historical revenue"
                onPress={() => router.push('/owner/reports/product-sales')}
              />
            </Row>
            <Row>
              <DashboardCard
                style={styles.half}
                title="Branch Performance"
                description="Sales and discrepancy comparison"
                onPress={() => router.push('/owner/reports/branch-performance' as never)}
              />
              <DashboardCard
                style={styles.half}
                title="Inventory Summary"
                description="Read-only balances across branches"
                onPress={() => router.push('/owner/inventory-by-branch')}
              />
            </Row>
            <Row>
              <DashboardCard
                style={styles.half}
                title="Reconciliation"
                description="Physical stock vs movement ledger"
                onPress={() => router.push('/owner/reports/inventory-reconciliation')}
              />
              <DashboardCard
                style={styles.half}
                title="Discrepancy Analytics"
                description="Missing and excess transfer/return qty"
                onPress={() => router.push('/owner/reports/discrepancies' as never)}
              />
            </Row>
          </Section>

          <Section title="ADMINISTRATION">
            <DashboardCard
              title="Employees"
              description="Create managers and cashiers, assign branches, and manage access"
              onPress={() => router.push('/owner/employees' as never)}
            />
            <DashboardCard
              title="Data Archive"
              description="Export old detailed sales, verify the copy, then confirm cleanup"
              onPress={() => router.push('/owner/data-archive' as never)}
            />
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
  table: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  tableHeader: {
    borderTopWidth: 0,
    backgroundColor: colors.background,
  },
  headerCell: { color: colors.muted, fontWeight: '800', fontSize: 11 },
  cellProduct: { flex: 1.4, color: colors.text, fontSize: 13, fontWeight: '700' },
  cellQty: { width: 64, color: colors.text, fontSize: 13, fontWeight: '700', textAlign: 'right' },
  cellMoney: { width: 84, color: colors.primary, fontSize: 13, fontWeight: '800', textAlign: 'right' },
  reminder: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.accent,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  reminderTitle: { color: colors.text, fontSize: 17, fontWeight: '800' },
  reminderBody: { color: colors.text, fontSize: 14, lineHeight: 20 },
  reminderActions: { gap: spacing.sm },
});
