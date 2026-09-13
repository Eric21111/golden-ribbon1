import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { Screen } from '@/components/Screen';
import { ListRowCard } from '@/components/dashboard/ListRowCard';
import { ManagerBadge } from '@/components/dashboard/ManagerBadge';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { SummaryCard } from '@/components/dashboard/SummaryCard';
import { returnStatusBadgeLabel, returnStatusTone } from '@/components/dashboard/statusTone';
import { managerColors } from '@/components/dashboard/theme';
import { useAuth } from '@/features/auth/AuthProvider';
import { getErrorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { getReturn } from '@/services/returnService';

export default function ManagerReturnDetailsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const returnId = typeof id === 'string' ? id : '';
  const { profile } = useAuth();

  const query = useQuery({
    queryKey: ['stock-returns', profile?.id, returnId],
    queryFn: () => getReturn(returnId),
    enabled: Boolean(returnId),
  });

  if (query.isLoading) {
    return (
      <Screen backgroundColor="#FFFFFF" edges={['top']} contentContainerStyle={styles.screenContent}>
        <ManagerScreenHeader title="Return Details" showBack />
        <LoadingState label="Loading return details…" />
      </Screen>
    );
  }
  if (query.error || !query.data) {
    return (
      <Screen backgroundColor="#FFFFFF" edges={['top']} contentContainerStyle={styles.screenContent}>
        <ManagerScreenHeader title="Return Details" showBack />
        <ErrorState message={getErrorMessage(query.error)} onRetry={() => void query.refetch()} />
      </Screen>
    );
  }

  const row = query.data;
  const notesByItemId = new Map(row.discrepancies?.map((disc) => [disc.stock_return_item_id, disc.notes]) ?? []);
  const summaryRows = [
    { label: 'From branch', value: row.from_branch_name },
    { label: 'To branch', value: row.to_branch_name },
    { label: 'Returned by', value: row.returned_by_name },
    { label: 'Returned at', value: formatDate(row.returned_at) },
    ...(row.received_by_name ? [{ label: 'Received by', value: row.received_by_name }] : []),
    ...(row.received_at ? [{ label: 'Received at', value: formatDate(row.received_at) }] : []),
    ...(row.notes ? [{ label: 'Notes', value: row.notes }] : []),
  ];

  return (
    <Screen backgroundColor="#FFFFFF" edges={['top']} contentContainerStyle={styles.screenContent}>
      <ManagerScreenHeader
        title={row.return_number}
        subtitle={`${row.from_branch_name} → ${row.to_branch_name}`}
        badge={<ManagerBadge label={returnStatusBadgeLabel(row.status)} tone={returnStatusTone(row.status)} />}
        showBack
      />
      <ConstrainedWidth style={styles.column}>
        <SummaryCard rows={summaryRows} />

        <Text style={styles.sectionTitle}>RETURNED PRODUCTS</Text>
        {row.items.map((item) => {
          const isReceived = item.quantity_received !== null;
          const diff = isReceived ? item.quantity_returned - item.quantity_received! : null;
          const note = notesByItemId.get(item.id);
          const baseMeta = `Expected ${item.quantity_returned} · Received ${isReceived ? item.quantity_received : 'Pending'}`;
          return (
            <ListRowCard
              key={item.id}
              title={item.product_name}
              subtitle={item.product_sku}
              meta={note ? `${baseMeta} · Note: ${note}` : baseMeta}
              trailing={
                diff !== null ? (
                  <ManagerBadge
                    label={diff === 0 ? 'Exact match' : diff > 0 ? `${diff} missing` : `${Math.abs(diff)} excess`}
                    tone={diff === 0 ? 'success' : 'warning'}
                  />
                ) : undefined
              }
            />
          );
        })}
      </ConstrainedWidth>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenContent: { flexGrow: 1, padding: 0, gap: 0 },
  column: { padding: 20, gap: 12 },
  sectionTitle: {
    color: managerColors.subtext,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    letterSpacing: 0.8,
    marginTop: 8,
  },
});
