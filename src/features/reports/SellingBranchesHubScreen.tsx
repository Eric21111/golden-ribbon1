import { router } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { Screen } from '@/components/Screen';
import { ListRowCard } from '@/components/dashboard/ListRowCard';
import { EmptyState, ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { managerColors } from '@/components/dashboard/theme';
import { useBranches } from '@/hooks/useBranches';
import { getErrorMessage } from '@/lib/errors';
import { accentForName } from '@/lib/nameAccent';

/** Owner branch-first hub (same pattern as Shift remittances): active selling branches only. */
export function SellingBranchesHubScreen({
  title,
  emptyTitle = 'No selling branches',
  emptyMessage = 'Create or activate a selling branch to continue.',
  hrefForBranch,
  accessibilityHint,
}: {
  title: string;
  emptyTitle?: string;
  emptyMessage?: string;
  hrefForBranch: (branchId: string) => string;
  accessibilityHint: string;
}) {
  const branchesQuery = useBranches();

  const rows = useMemo(
    () =>
      (branchesQuery.data ?? [])
        .filter((branch) => !branch.is_main_branch && branch.is_active)
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name)),
    [branchesQuery.data],
  );

  return (
    <Screen
      refreshing={branchesQuery.isRefetching}
      onRefresh={() => void branchesQuery.refetch()}
      backgroundColor="#FFFFFF"
      edges={['top']}
      contentContainerStyle={styles.screen}
    >
      <ManagerScreenHeader title={title} showBack />
      <ConstrainedWidth style={styles.column}>
        {branchesQuery.error ? (
          <ErrorState
            message={getErrorMessage(branchesQuery.error)}
            onRetry={() => void branchesQuery.refetch()}
          />
        ) : null}
        {branchesQuery.isLoading ? <LoadingState label="Loading branches…" /> : null}

        {!branchesQuery.isLoading && !branchesQuery.error && rows.length === 0 ? (
          <EmptyState title={emptyTitle} message={emptyMessage} />
        ) : null}

        {!branchesQuery.isLoading && rows.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>BRANCHES</Text>
            {rows.map((branch) => (
              <ListRowCard
                key={branch.id}
                icon="storefront-outline"
                iconColor={accentForName(branch.name)}
                title={branch.name}
                onPress={() => router.push(hrefForBranch(branch.id) as never)}
                accessibilityLabel={`${branch.name} ${title}`}
                accessibilityHint={accessibilityHint}
              />
            ))}
          </View>
        ) : null}
      </ConstrainedWidth>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { flexGrow: 1, padding: 0, gap: 0 },
  column: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 24, gap: 12 },
  section: { gap: 10, marginTop: 4 },
  sectionTitle: {
    color: managerColors.subtext,
    fontFamily: 'Inter_700Bold',
    fontSize: 12,
    letterSpacing: 0.6,
  },
});
