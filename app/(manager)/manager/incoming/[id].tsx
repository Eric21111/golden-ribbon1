import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import {
  DetailProductListSection,
  type DetailLineStatus,
} from '@/components/dashboard/DetailProductListSection';
import { ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { Screen } from '@/components/Screen';
import { ListRowCard } from '@/components/dashboard/ListRowCard';
import { ManagerBadge } from '@/components/dashboard/ManagerBadge';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { RouteBanner } from '@/components/dashboard/RouteBanner';
import { SummaryCard } from '@/components/dashboard/SummaryCard';
import { transferStatusBadgeLabel, transferStatusTone } from '@/components/dashboard/statusTone';
import { categoryRowProps } from '@/features/products/productCategoryIndicator';
import { useTransfer } from '@/hooks/useTransfers';
import { getErrorMessage } from '@/lib/errors';
import {
  formatDate,
  formatSnapshottedQuantity,
  formatTransferReceivedQuantity,
  isKgMeal,
} from '@/lib/format';

export default function IncomingTransferDetailsScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : '';
  const query = useTransfer(id);

  if (query.isLoading) {
    return (
      <Screen backgroundColor="#FFFFFF" edges={['top']} contentContainerStyle={styles.screenContent}>
        <ManagerScreenHeader title="Incoming transfer" showBack />
        <LoadingState label="Loading transfer…" />
      </Screen>
    );
  }
  if (query.error || !query.data) {
    return (
      <Screen backgroundColor="#FFFFFF" edges={['top']} contentContainerStyle={styles.screenContent}>
        <ManagerScreenHeader title="Incoming transfer" showBack />
        <ErrorState message={getErrorMessage(query.error)} onRetry={() => void query.refetch()} />
      </Screen>
    );
  }

  const transfer = query.data;
  const notesByItemId = new Map(transfer.discrepancies.map((disc) => [disc.stock_transfer_item_id, disc.notes]));
  const discrepancyIdByItemId = new Map(
    transfer.discrepancies.map((disc) => [disc.stock_transfer_item_id, disc.id]),
  );
  const pendingCashierConfirm = transfer.status === 'pending_receipt';

  const lineItems = transfer.items.map((item) => {
    const kgMeal = isKgMeal(item.inventory_mode);
    const difference = kgMeal || item.quantity_received === null ? null : item.quantity_sent - item.quantity_received;
    const lineStatus: DetailLineStatus =
      difference === null ? 'pending' : difference === 0 ? 'match' : difference > 0 ? 'missing' : 'excess';
    return {
      id: item.id,
      name: item.product?.name ?? `Unavailable product (${item.product_id})`,
      sku: item.product?.sku ?? '',
      category: item.product?.product_category ?? null,
      lineStatus,
      item,
      difference,
      note: notesByItemId.get(item.id),
      discrepancyId: discrepancyIdByItemId.get(item.id),
    };
  });

  return (
    <Screen backgroundColor="#FFFFFF" edges={['top']} contentContainerStyle={styles.screenContent}>
      <ManagerScreenHeader
        title={transfer.transfer_number}
        subtitle={`${transfer.from_branch?.name ?? 'Sending branch'} → ${transfer.to_branch?.name ?? 'Receiving branch'}`}
        badge={<ManagerBadge label={transferStatusBadgeLabel(transfer.status)} tone={transferStatusTone(transfer.status)} />}
        showBack
      />
      <ConstrainedWidth style={styles.column}>
        {pendingCashierConfirm ? (
          <ErrorState message="The cashier confirms this shipment from Incoming." />
        ) : null}
        <RouteBanner
          from={{ label: transfer.from_branch?.name ?? 'Sending branch', isMain: true }}
          to={{ label: transfer.to_branch?.name ?? 'Receiving branch', isMain: false }}
          connectorIcon="paper-plane"
        />
        <SummaryCard
          rows={[
            { label: 'Created by', value: transfer.created_by_profile?.full_name ?? 'Staff details unavailable', icon: 'person-outline' },
            { label: 'Sent by', value: transfer.sent_by_profile?.full_name ?? 'Pending', icon: 'paper-plane-outline' },
            { label: 'Sent', value: formatDate(transfer.sent_at), icon: 'time-outline' },
            { label: 'Received by', value: transfer.received_by_profile?.full_name ?? 'Pending', icon: 'person-outline' },
            { label: 'Received', value: formatDate(transfer.received_at), icon: 'time-outline' },
            ...(transfer.notes ? [{ label: 'Notes', value: transfer.notes, icon: 'document-text-outline' as const }] : []),
          ]}
        />

        <DetailProductListSection
          title="PRODUCTS"
          matchLabel="Complete"
          items={lineItems}
          renderItem={(row) => (
            <ListRowCard
              {...categoryRowProps(row.category)}
              title={row.name}
              subtitle={`Sent ${formatSnapshottedQuantity(
                row.item.quantity_sent,
                row.item.inventory_mode,
                row.item.stock_unit_code,
              )}`}
              meta={[
                `Received ${formatTransferReceivedQuantity(
                  transfer.status,
                  row.item.quantity_received,
                  row.item.inventory_mode,
                  row.item.stock_unit_code,
                )}`,
                row.note ? `Note: ${row.note}` : null,
              ]
                .filter(Boolean)
                .join('\n')}
              trailing={
                row.difference === null ? undefined : (
                  <ManagerBadge
                    label={
                      row.difference === 0
                        ? 'Complete'
                        : row.difference > 0
                          ? `${row.difference} missing`
                          : `${Math.abs(row.difference)} excess`
                    }
                    tone={row.difference === 0 ? 'success' : 'warning'}
                  />
                )
              }
              onPress={
                row.discrepancyId
                  ? () => router.push(`/manager/discrepancies/transfer/${row.discrepancyId}` as never)
                  : undefined
              }
            />
          )}
        />
      </ConstrainedWidth>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenContent: { flexGrow: 1, padding: 0, gap: 0 },
  column: { padding: 20, gap: 12 },
});
