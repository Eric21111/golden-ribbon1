import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { EmptyState, ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { Screen } from '@/components/Screen';
import { ListRowCard } from '@/components/dashboard/ListRowCard';
import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { ManagerBadge } from '@/components/dashboard/ManagerBadge';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { shiftStatusTone } from '@/components/dashboard/statusTone';
import { managerColors } from '@/components/dashboard/theme';
import { useAuth } from '@/features/auth/AuthProvider';
import { useShiftHistory } from '@/hooks/useShifts';
import { getErrorMessage } from '@/lib/errors';
import { formatDate, formatMoney } from '@/lib/format';

export default function ManagerShiftHistoryScreen() {
  const { profile } = useAuth();
  const [page, setPage] = useState(0);
  const shiftQuery = useShiftHistory({}, page);
  const shifts = shiftQuery.data ?? [];

  return (
    <Screen backgroundColor="#FFFFFF" edges={['top']} scroll={false} contentContainerStyle={styles.screenContent}>
      <ManagerScreenHeader title="Shift History" subtitle={`${profile?.branch?.name ?? 'Branch'} shifts`} />

      <ConstrainedWidth style={styles.column}>
        {shiftQuery.error ? (
          <ErrorState message={getErrorMessage(shiftQuery.error)} onRetry={() => void shiftQuery.refetch()} />
        ) : shiftQuery.isLoading && !shiftQuery.data ? (
          <LoadingState label="Loading shift history…" />
        ) : (
          <FlatList
            data={shifts}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            refreshControl={
              <RefreshControl
                refreshing={shiftQuery.isRefetching}
                onRefresh={() => void shiftQuery.refetch()}
                tintColor={managerColors.royalBlue}
              />
            }
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            ListEmptyComponent={
              <EmptyState title="No shifts found" message="Completed cashier shifts will appear here." />
            }
            ListFooterComponent={
              <View style={styles.pager}>
                <View style={styles.pagerButton}>
                  <ManagerActionButton
                    label="Previous"
                    variant="secondary"
                    disabled={page === 0 || shiftQuery.isLoading}
                    onPress={() => setPage((p) => Math.max(0, p - 1))}
                  />
                </View>
                <View style={styles.pagerButton}>
                  <ManagerActionButton
                    label="Next"
                    variant="secondary"
                    disabled={shifts.length < 50 || shiftQuery.isLoading}
                    onPress={() => setPage((p) => p + 1)}
                  />
                </View>
              </View>
            }
            renderItem={({ item }) => (
              <ListRowCard
                icon="people-outline"
                iconColor="teal"
                title={item.cashier_name}
                subtitle={`${item.branch_name} · ${formatDate(item.started_at)}`}
                meta={`${item.completed_transaction_count} orders · ${formatMoney(item.total_sales)}`}
                trailing={
                  <ManagerBadge
                    label={item.status === 'open' ? 'Open' : 'Closed'}
                    tone={shiftStatusTone(item.status)}
                  />
                }
                onPress={() => router.push({ pathname: '/manager/shifts/[id]', params: { id: item.id } })}
              />
            )}
          />
        )}
      </ConstrainedWidth>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenContent: { flexGrow: 1, padding: 0, gap: 0 },
  column: { flex: 1, paddingHorizontal: 20, paddingTop: 16 },
  listContent: { paddingBottom: 16, flexGrow: 1 },
  separator: { height: 10 },
  pager: { flexDirection: 'row', gap: 10, paddingTop: 12 },
  pagerButton: { flex: 1 },
});
