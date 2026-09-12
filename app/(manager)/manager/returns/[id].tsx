import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { Screen } from '@/components/Screen';
import { ListRowCard } from '@/components/dashboard/ListRowCard';
import { ManagerBadge } from '@/components/dashboard/ManagerBadge';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { SummaryCard } from '@/components/dashboard/SummaryCard';
import { returnStatusTone } from '@/components/dashboard/statusTone';
import { managerColors } from '@/components/dashboard/theme';
import { useAuth } from '@/features/auth/AuthProvider';
import { getErrorMessage } from '@/lib/errors';
import { formatDate, formatReturnStatus } from '@/lib/format';
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
      <Screen backgroundColor="#FFFFFF" edges={['top']}>
        <ManagerScreenHeader title="Return Details" showBack />
        <LoadingState label="Loading return details…" />
      </Screen>
    );
  }
  if (query.error || !query.data) {
    return (
      <Screen backgroundColor="#FFFFFF" edges={['top']}>
        <ManagerScreenHeader title="Return Details" showBack />
        <ErrorState message={getErrorMessage(query.error)} onRetry={() => void query.refetch()} />
      </Screen>
    );
  }

  const row = query.data;
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
    <Screen backgroundColor="#FFFFFF" edges={['top']}>
      <ManagerScreenHeader title={row.return_number} subtitle={`${row.from_branch_name} → ${row.to_branch_name}`} showBack />
      <ConstrainedWidth style={styles.column}>
        <View style={styles.statusRow}>
          <ManagerBadge label={formatReturnStatus(row.status)} tone={returnStatusTone(row.status)} />
        </View>

        <SummaryCard rows={summaryRows} />

        <Text style={styles.sectionTitle}>RETURNED PRODUCTS</Text>
        {row.items.map((item) => {
          const isReceived = item.quantity_received !== null;
          const diff = isReceived ? item.quantity_returned - item.quantity_received! : null;
          return (
            <ListRowCard
              key={item.id}
              icon="cube-outline"
              iconColor="lilac"
              title={item.product_name}
              subtitle={item.product_sku}
              meta={`Expected ${item.quantity_returned} · Received ${isReceived ? item.quantity_received : 'Pending'}`}
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

        {row.discrepancies && row.discrepancies.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>DISCREPANCIES</Text>
            {row.discrepancies.map((disc) => (
              <ListRowCard
                key={disc.id}
                icon="alert-circle-outline"
                iconColor="gold"
                title={disc.product?.name ?? `Product (${disc.product_id})`}
                subtitle={`Returned: ${disc.quantity_expected} · Received: ${disc.quantity_received}`}
                meta={disc.notes ?? undefined}
                trailing={
                  <ManagerBadge
                    label={
                      disc.discrepancy_type === 'missing'
                        ? `${disc.difference} missing`
                        : `${Math.abs(disc.difference)} excess`
                    }
                    tone="warning"
                  />
                }
              />
            ))}
          </>
        ) : null}
      </ConstrainedWidth>
    </Screen>
  );
}

const styles = StyleSheet.create({
  column: { padding: 20, gap: 12 },
  statusRow: { flexDirection: 'row' },
  sectionTitle: {
    color: managerColors.subtext,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    letterSpacing: 0.8,
    marginTop: 8,
  },
});
