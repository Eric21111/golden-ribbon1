import { useRef } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { EmptyState, ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { managerColors } from '@/components/dashboard/theme';
import { spacing } from '@/constants/theme';
import { useCashierPendingTransfers, useConfirmShipmentArrival } from '@/hooks/useTransfers';
import { confirmAction } from '@/lib/confirmAction';
import { getInventoryErrorMessage } from '@/lib/errors';
import { formatDate, makeIdempotencyKey } from '@/lib/format';
import type { CashierPendingTransfer } from '@/types/models';

export default function CashierIncomingShipments() {
  const pending = useCashierPendingTransfers();
  const mutation = useConfirmShipmentArrival();
  const keysRef = useRef<Map<string, string>>(new Map());

  const keyFor = (transferId: string) => {
    const existing = keysRef.current.get(transferId);
    if (existing) return existing;
    const key = makeIdempotencyKey('shipment');
    keysRef.current.set(transferId, key);
    return key;
  };

  const confirmArrival = (transfer: CashierPendingTransfer) => {
    confirmAction(
      'Shipment arrived?',
      `Confirm all ${transfer.items.length} product${transfer.items.length === 1 ? '' : 's'} from ${transfer.from_branch_name} arrived as sent. Stock will be added immediately.`,
      () =>
        mutation.mutate(
          { transferId: transfer.id, idempotencyKey: keyFor(transfer.id) },
          { onSuccess: () => keysRef.current.delete(transfer.id) },
        ),
    );
  };

  if (pending.isLoading) return <LoadingState label="Loading incoming shipments…" />;
  if (pending.error) {
    return (
      <Screen backgroundColor="#FFFFFF">
        <ErrorState
          message={getInventoryErrorMessage(pending.error)}
          onRetry={() => void pending.refetch()}
        />
      </Screen>
    );
  }

  return (
    <Screen backgroundColor="#FFFFFF" edges={['top']} scroll={false} contentContainerStyle={styles.screen}>
      <View style={styles.layout}>
        <ManagerScreenHeader title="Incoming Shipments" hideMenu />
        <FlatList
          data={pending.data ?? []}
          keyExtractor={(item) => item.id}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={pending.isRefetching} onRefresh={() => void pending.refetch()} tintColor={managerColors.royalBlue} />
          }
          ListEmptyComponent={
            <EmptyState
              title="No incoming shipments"
              message="Transfers sent to this branch that need shipment confirmation appear here."
            />
          }
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardTop}>
                <Text style={styles.transferNumber}>{item.transfer_number}</Text>
                <Text style={styles.meta}>From {item.from_branch_name} · Sent {formatDate(item.sent_at)}</Text>
              </View>
              {item.items.map((line) => (
                <View key={line.product_id} style={styles.itemRow}>
                  <Text style={styles.itemName} numberOfLines={1}>{line.product_name}</Text>
                  <Text style={styles.itemQty}>{line.quantity_sent}</Text>
                </View>
              ))}
              {mutation.error && mutation.variables?.transferId === item.id ? (
                <Text style={styles.error}>{getInventoryErrorMessage(mutation.error)}</Text>
              ) : null}
              <ManagerActionButton
                label="Shipment Arrived"
                icon="checkmark-circle-outline"
                loading={mutation.isPending && mutation.variables?.transferId === item.id}
                disabled={mutation.isPending && mutation.variables?.transferId !== item.id}
                onPress={() => confirmArrival(item)}
              />
            </View>
          )}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { flexGrow: 1, padding: 0, gap: 0 },
  layout: { flex: 1, minHeight: 0 },
  list: { flex: 1, minHeight: 0 },
  listContent: { paddingHorizontal: 20, paddingVertical: spacing.sm, flexGrow: 1 },
  separator: { height: spacing.sm },
  card: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 16,
    padding: 14,
    gap: 10,
    shadowColor: '#0A1224',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 1,
  },
  cardTop: { gap: 2 },
  transferNumber: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 15 },
  meta: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12.5 },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: managerColors.cardBorder,
    paddingTop: 8,
  },
  itemName: { flex: 1, color: managerColors.ink, fontFamily: 'Inter_500Medium', fontSize: 13.5 },
  itemQty: { color: managerColors.royalBlue, fontFamily: 'Inter_700Bold', fontSize: 14 },
  error: { color: '#B91C1C', fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 18 },
});
