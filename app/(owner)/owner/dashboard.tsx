import Ionicons from '@react-native-vector-icons/ionicons';
import { router } from 'expo-router';
import { useMemo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { Screen } from '@/components/Screen';
import { HamburgerButton } from '@/components/dashboard/HamburgerButton';
import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { StatTile } from '@/components/dashboard/StatTile';
import { StatTilePair } from '@/components/dashboard/StatTilePair';
import { managerColors } from '@/components/dashboard/theme';
import { spacing } from '@/constants/theme';
import { useAuth } from '@/features/auth/AuthProvider';
import { sortActivitiesNewestFirst } from '@/features/reports/todayLog';
import { TodayLogList } from '@/features/reports/TodayLogList';
import { buildTodayQuickview, todayQuickviewStatus } from '@/features/reports/todayQuickview';
import { useArchiveStatus, useDismissArchiveReminder } from '@/hooks/useArchive';
import { useManilaDayRefresh } from '@/hooks/useManilaDayRefresh';
import { useOwnerTodayActivityLog } from '@/hooks/useOwnerTodayLog';
import {
  useOwnerDashboardMetrics,
  useOwnerTodayBranchSales,
} from '@/hooks/useSales';
import { getErrorMessage } from '@/lib/errors';
import { formatMoney } from '@/lib/format';

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <View style={styles.section}>
      {action ? (
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{title}</Text>
          {action}
        </View>
      ) : (
        <Text style={styles.sectionTitle}>{title}</Text>
      )}
      {children}
    </View>
  );
}

function chunkPairs<T>(items: readonly T[]): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += 2) rows.push(items.slice(i, i + 2));
  return rows;
}

const TODAY_LOG_PREVIEW = 5;

const issueCount = (count: number) => `${count} issue${count === 1 ? '' : 's'}`;

function InlineError({
  title,
  message,
  retrying,
  onRetry,
}: {
  title: string;
  message: string;
  retrying: boolean;
  onRetry: () => void;
}) {
  return (
    <View style={styles.inlineErrorCard} accessibilityLiveRegion="polite">
      <Text style={styles.inlineErrorTitle}>{title}</Text>
      <Text style={styles.inlineErrorBody}>{message}</Text>
      <ManagerActionButton label="Retry" icon="refresh-outline" variant="secondary" loading={retrying} onPress={onRetry} />
    </View>
  );
}

export default function OwnerDashboard() {
  const { profile } = useAuth();
  const metricsQuery = useOwnerDashboardMetrics();
  const branchSalesQuery = useOwnerTodayBranchSales();
  const todayLogQuery = useOwnerTodayActivityLog();
  const archiveQuery = useArchiveStatus();
  const dismissReminder = useDismissArchiveReminder();
  const [showFullLog, setShowFullLog] = useState(false);

  const metrics = metricsQuery.data;
  const transferIssues = metrics?.transfer_discrepancies_count ?? 0;
  const returnIssues = metrics?.return_discrepancies_count ?? 0;
  const discrepancySplit =
    transferIssues > 0 && returnIssues > 0
      ? `${transferIssues} transfer · ${returnIssues} return`
      : transferIssues > 0
        ? 'From transfers'
        : 'From returns';
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
      <InlineError
        title="Couldn't load today's branch revenue."
        message={getErrorMessage(branchSalesQuery.error)}
        retrying={branchSalesQuery.isFetching}
        onRetry={retryQuickview}
      />
    ) : null;
  const todayLogStatus = todayQuickviewStatus(todayLogQuery);
  const todayLog = useMemo(
    () => sortActivitiesNewestFirst(todayLogQuery.data?.activities ?? []),
    [todayLogQuery.data],
  );
  const visibleLog = showFullLog ? todayLog : todayLog.slice(0, TODAY_LOG_PREVIEW);
  const refreshing =
    metricsQuery.isRefetching ||
    branchSalesQuery.isRefetching ||
    todayLogQuery.isRefetching ||
    archiveQuery.isRefetching;
  const ownerName = profile?.full_name ?? 'Owner';

  const refresh = () => {
    void metricsQuery.refetch();
    void branchSalesQuery.refetch();
    void todayLogQuery.refetch();
    void archiveQuery.refetch();
  };

  useManilaDayRefresh(() => {
    void metricsQuery.refetch();
    void branchSalesQuery.refetch();
    void todayLogQuery.refetch();
  });

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
        {metricsQuery.error ? (
          <ErrorState
            message={getErrorMessage(metricsQuery.error)}
            onRetry={refresh}
          />
        ) : (
          <View style={styles.content}>
            {transferIssues + returnIssues > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Quantity discrepancies, ${issueCount(transferIssues + returnIssues)}, ${discrepancySplit}`}
                accessibilityHint="Opens the discrepancies report"
                onPress={() => router.push('/owner/reports/discrepancies' as never)}
                style={({ pressed }) => [styles.alertCard, pressed && styles.alertPressed]}
              >
                <Ionicons name="alert-circle-outline" size={26} color="#B91C1C" />
                <View style={styles.alertText}>
                  <Text style={styles.alertTitle}>Quantity discrepancies</Text>
                  <View style={styles.alertSubRow}>
                    <Text style={styles.alertBody}>{discrepancySplit}</Text>
                    <View style={styles.alertPill}>
                      <Text style={styles.alertPillLabel}>{issueCount(transferIssues + returnIssues)}</Text>
                    </View>
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#B91C1C" />
              </Pressable>
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
                onPress={() => router.push('/owner/reports/sales-overview' as never)}
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
                chunkPairs(quickview.branches).map((pair) => {
                  const [first, second] = pair.map((branch) => ({
                    icon: 'storefront-outline' as const,
                    label: branch.isActive ? branch.branchName : `Inactive · ${branch.branchName}`,
                    value: formatMoney(branch.revenue),
                    onPress: () => router.push(`/owner/reports/branch/${branch.branchId}?range=today` as never),
                  }));
                  return <StatTilePair key={pair.map((branch) => branch.branchId).join(':')} left={first} right={second} />;
                })
              )}
            </Section>

            <Section
              title="Today Log"
              action={
                todayLogStatus === 'ready' && todayLog.length > TODAY_LOG_PREVIEW ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={showFullLog ? 'Show fewer activities' : `Show all ${todayLog.length} activities`}
                    hitSlop={10}
                    onPress={() => setShowFullLog((value) => !value)}
                    style={({ pressed }) => pressed && styles.pressed}
                  >
                    <Text style={styles.sectionLink}>{showFullLog ? 'Show fewer' : `Show all ${todayLog.length}`}</Text>
                  </Pressable>
                ) : null
              }
            >
              {todayLogStatus === 'loading' ? (
                <LoadingState label="Loading today's activity…" />
              ) : todayLogStatus === 'error' ? (
                <InlineError
                  title="Couldn't load today's activity."
                  message={getErrorMessage(todayLogQuery.error)}
                  retrying={todayLogQuery.isFetching}
                  onRetry={() => void todayLogQuery.refetch()}
                />
              ) : todayLog.length === 0 ? (
                <View style={styles.quietCard}>
                  <Text style={styles.quiet}>No employee activity yet today.</Text>
                </View>
              ) : (
                <>
                  <TodayLogList activities={visibleLog} />
                  {todayLogQuery.data?.truncated ? (
                    <Text style={styles.quiet}>
                      Showing the latest {todayLog.length} of {todayLogQuery.data.total_count} activities.
                    </Text>
                  ) : null}
                </>
              )}
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
  quietCard: {
    backgroundColor: managerColors.cardSurface,
    borderRadius: 16,
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  quiet: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 14 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  sectionLink: { color: managerColors.royalBlue, fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  pressed: { opacity: 0.6 },
  // the discrepancy alert: the whole card is the tap target (icon, title + split + count pill, chevron), no button
  alertCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
    borderWidth: 1,
    borderLeftWidth: 3,
    borderLeftColor: '#B91C1C',
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  alertPressed: { opacity: 0.85 },
  alertText: { flex: 1, minWidth: 0, gap: 4 },
  alertTitle: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 16, lineHeight: 21 },
  alertSubRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  alertBody: { flex: 1, minWidth: 0, color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18 },
  alertPill: { flexShrink: 0, backgroundColor: '#FBDBD8', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  alertPillLabel: { color: '#B91C1C', fontFamily: 'Inter_700Bold', fontSize: 12.5 },
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
