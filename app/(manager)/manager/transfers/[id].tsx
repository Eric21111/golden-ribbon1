import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { Screen } from '@/components/Screen';
import { ListRowCard } from '@/components/dashboard/ListRowCard';
import { ManagerBadge } from '@/components/dashboard/ManagerBadge';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { SummaryCard } from '@/components/dashboard/SummaryCard';
import { transferStatusBadgeLabel, transferStatusTone } from '@/components/dashboard/statusTone';
import { managerColors } from '@/components/dashboard/theme';
import { useTransfer } from '@/hooks/useTransfers';
import { getErrorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';

export default function ManagerTransferDetailsScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : '';
  const query = useTransfer(id);

  if (query.isLoading) {
    return (
      <Screen backgroundColor="#FFFFFF" edges={['top']} contentContainerStyle={styles.screenContent}>
        <ManagerScreenHeader title="Transfer Details" showBack />
        <LoadingState label="Loading transfer…" />
      </Screen>
    );
  }
  if (query.error || !query.data) {
    return (
      <Screen backgroundColor="#FFFFFF" edges={['top']} contentContainerStyle={styles.screenContent}>
        <ManagerScreenHeader title="Transfer Details" showBack />
        <ErrorState message={getErrorMessage(query.error)} onRetry={() => void query.refetch()} />
      </Screen>
    );
  }

  const transfer = query.data;
  const notesByItemId = new Map(transfer.discrepancies.map((disc) => [disc.stock_transfer_item_id, disc.notes]));

  return (
    <Screen backgroundColor="#FFFFFF" edges={['top']} contentContainerStyle={styles.screenContent}>
      <ManagerScreenHeader
        title={transfer.transfer_number}
        subtitle={`${transfer.from_branch?.name ?? 'Sending branch'} → ${transfer.to_branch?.name ?? 'Receiving branch'}`}
        badge={<ManagerBadge label={transferStatusBadgeLabel(transfer.status)} tone={transferStatusTone(transfer.status)} />}
        showBack
      />
      <ConstrainedWidth style={styles.column}>
        <SummaryCard
          rows={[
            { label: 'From', value: transfer.from_branch?.name ?? 'Sending branch' },
            { label: 'To', value: transfer.to_branch?.name ?? 'Receiving branch' },
            { label: 'Created by', value: transfer.created_by_profile?.full_name ?? 'Staff details unavailable' },
            { label: 'Sent by', value: transfer.sent_by_profile?.full_name ?? 'Pending' },
            { label: 'Sent', value: formatDate(transfer.sent_at) },
            { label: 'Received by', value: transfer.received_by_profile?.full_name ?? 'Pending' },
            { label: 'Received', value: formatDate(transfer.received_at) },
            ...(transfer.notes ? [{ label: 'Notes', value: transfer.notes }] : []),
          ]}
        />

        <Text style={styles.sectionTitle}>PRODUCTS</Text>
        {transfer.items.map((item) => {
          const difference = item.quantity_received === null ? null : item.quantity_sent - item.quantity_received;
          const note = notesByItemId.get(item.id);
          const baseSubtitle = `Sent ${item.quantity_sent} · Received ${item.quantity_received === null ? 'Pending' : item.quantity_received}`;
          return (
            <ListRowCard
              key={item.id}
              title={item.product?.name ?? `Unavailable product (${item.product_id})`}
              subtitle={baseSubtitle}
              meta={note ? `Note: ${note}` : undefined}
              trailing={
                difference === null ? undefined : (
                  <ManagerBadge
                    label={
                      difference === 0
                        ? 'Complete'
                        : difference > 0
                          ? `${difference} missing`
                          : `${Math.abs(difference)} excess`
                    }
                    tone={difference === 0 ? 'success' : 'warning'}
                  />
                )
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
