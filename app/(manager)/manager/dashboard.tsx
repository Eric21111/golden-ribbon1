import Ionicons from '@react-native-vector-icons/ionicons';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { HamburgerButton } from '@/components/dashboard/HamburgerButton';
import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { NavTile } from '@/components/dashboard/NavTile';
import { StatTile } from '@/components/dashboard/StatTile';
import { managerColors } from '@/components/dashboard/theme';
import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { Screen } from '@/components/Screen';
import { spacing } from '@/constants/theme';
import { useAuth } from '@/features/auth/AuthProvider';
import { isMainBranchManager } from '@/features/auth/roles';
import { buildAttentionItems } from '@/features/reports/managerAttention';
import { useManagerAttention } from '@/hooks/useManagerAttention';
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
  const isMain = isMainBranchManager(profile);
  const metricsQuery = useManagerDashboardMetrics();

  const attention = useManagerAttention(isMain ? (profile?.branch_id ?? null) : null);

  const metrics = metricsQuery.data;
  const refreshing = metricsQuery.isRefetching || attention.isRefetching;

  const attentionItems = buildAttentionItems({
    pendingIncoming: metrics?.pending_incoming_transfers_count,
    pendingOutgoing: attention.pendingOutgoing,
    returnsInTransit: metrics?.returns_in_transit_count,
    transferDiscrepancies: attention.transferDiscrepancies,
    returnDiscrepancies: attention.returnDiscrepancies,
  });

  const refresh = () => {
    void metricsQuery.refetch();
    attention.refetch();
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
        {isMain ? (
          <View style={styles.topRow}>
            <HamburgerButton />
          </View>
        ) : null}
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
          <ErrorState message={getErrorMessage(metricsQuery.error)} onRetry={refresh} />
        ) : metricsQuery.isLoading && !metrics ? (
          <LoadingState label="Loading dashboard…" />
        ) : (
          <View style={styles.content}>
            <Section title="Dashboard">
              <Row>
                <StatTile
                  style={styles.half}
                  emphasis
                  icon="cash-outline"
                  label="Today's Sales"
                  value={metrics ? formatMoney(metrics.today_sales) : '—'}
                />
                <StatTile
                  style={styles.half}
                  icon="cube-outline"
                  label="Products in stock"
                  value={metrics?.current_inventory_count ?? '—'}
                />
              </Row>
              <Row>
                <StatTile
                  style={styles.half}
                  icon="download-outline"
                  label="Pending incoming"
                  value={metrics?.pending_incoming_transfers_count ?? '—'}
                />
                <StatTile
                  style={styles.half}
                  icon="return-up-back-outline"
                  label="Returns in transit"
                  value={metrics?.returns_in_transit_count ?? '—'}
                />
              </Row>
            </Section>

            <Section title="NEEDS ATTENTION">
              {attentionItems.map((item) => (
                <NavTile
                  key={item.title}
                  variant="alert"
                  icon="alert-circle-outline"
                  title={item.title}
                  value={item.value}
                  description={item.description}
                  onPress={() => router.push(item.href as never)}
                />
              ))}
              {attention.error ? (
                <View style={styles.inlineErrorCard} accessibilityLiveRegion="polite">
                  <Text style={styles.inlineErrorTitle}>Couldn't check transfers and discrepancies.</Text>
                  <Text style={styles.inlineErrorBody}>{getErrorMessage(attention.error)}</Text>
                  <ManagerActionButton
                    label="Retry"
                    icon="refresh-outline"
                    variant="secondary"
                    loading={attention.retrying}
                    onPress={attention.retry}
                  />
                </View>
              ) : attention.loading ? (
                <View style={styles.quietCard}>
                  <Text style={styles.quiet}>Checking transfers and discrepancies…</Text>
                </View>
              ) : attentionItems.length === 0 ? (
                <View style={styles.quietCard}>
                  <Text style={styles.quiet}>Nothing needs attention</Text>
                </View>
              ) : null}
            </Section>

            {isMain ? (
              <Section title="REPORTS">
                <Row>
                  <NavTile
                    layout="tile"
                    icon="cash-outline"
                    accent="pink"
                    title="Shift remittances"
                    onPress={() => router.push('/manager/reports/shift-remittances' as never)}
                  />
                  <NavTile
                    layout="tile"
                    icon="leaf-outline"
                    accent="green"
                    title="Waste History"
                    onPress={() => router.push('/manager/reports/waste-history' as never)}
                  />
                </Row>
              </Section>
            ) : null}
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
  inlineErrorCard: {
    backgroundColor: managerColors.cardSurface,
    borderRadius: 16,
    padding: spacing.md,
    gap: spacing.sm,
  },
  inlineErrorTitle: { color: '#B91C1C', fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  inlineErrorBody: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18 },
});
