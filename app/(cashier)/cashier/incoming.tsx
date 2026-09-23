import { useRef, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';

import { FormField } from '@/components/FormField';
import { Screen } from '@/components/Screen';
import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { EmptyState, ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { managerColors } from '@/components/dashboard/theme';
import { spacing } from '@/constants/theme';
import { useAuth } from '@/features/auth/AuthProvider';
import {
  useCashierPendingTransfers,
  useConfirmShipmentArrival,
  useReportShipmentIssue,
} from '@/hooks/useTransfers';
import { confirmAction } from '@/lib/confirmAction';
import { getInventoryErrorMessage } from '@/lib/errors';
import { formatDate, makeIdempotencyKey } from '@/lib/format';
import type { CashierPendingTransfer } from '@/types/models';

export default function CashierIncomingShipments() {
  const { session } = useAuth();
  const pending = useCashierPendingTransfers(session?.user.id ?? '');
  const arrival = useConfirmShipmentArrival();
  const issue = useReportShipmentIssue();
  const keysRef = useRef<Map<string, string>>(new Map());
  const [reportingId, setReportingId] = useState<string | null>(null);
  const [receivedByItem, setReceivedByItem] = useState<Record<string, string>>({});
  const [issueNotes, setIssueNotes] = useState('');

  const keyFor = (transferId: string) => {
    const existing = keysRef.current.get(transferId);
    if (existing) return existing;
    const key = makeIdempotencyKey('shipment');
    keysRef.current.set(transferId, key);
    return key;
  };

  const beginReport = (transfer: CashierPendingTransfer) => {
    setReportingId(transfer.id);
    setIssueNotes('');
    setReceivedByItem(
      Object.fromEntries(transfer.items.map((line) => [line.stock_transfer_item_id, ''])),
    );
    arrival.reset();
    issue.reset();
  };

  const cancelReport = () => {
    setReportingId(null);
    setIssueNotes('');
    setReceivedByItem({});
  };

  const confirmArrival = (transfer: CashierPendingTransfer) => {
    const transferId = String(transfer.id ?? '').trim();
    const idempotencyKey = keyFor(transferId);
    confirmAction(
      'Shipment arrived?',
      `Confirm all ${transfer.items.length} product${transfer.items.length === 1 ? '' : 's'} from ${transfer.from_branch_name} arrived as sent. Stock will be added immediately.`,
      () => {
        arrival.reset();
        arrival.mutate(
          { transferId, idempotencyKey },
          {
            onSuccess: () => keysRef.current.delete(transferId),
            onError: () => {
              keysRef.current.delete(transferId);
            },
          },
        );
      },
    );
  };

  const confirmIssue = (transfer: CashierPendingTransfer) => {
    const items = transfer.items.map((line) => ({
      stock_transfer_item_id: line.stock_transfer_item_id,
      quantity_received: Number(receivedByItem[line.stock_transfer_item_id] ?? ''),
    }));
    if (items.some((item) => !Number.isInteger(item.quantity_received) || item.quantity_received < 0)) {
      return;
    }
    if (!items.some((item, index) => item.quantity_received !== transfer.items[index]!.quantity_sent)) {
      return;
    }
    if (issueNotes.trim().length < 3) {
      return;
    }
    const transferId = String(transfer.id ?? '').trim();
    const idempotencyKey = keyFor(transferId);
    confirmAction(
      'Report shipment issue?',
      'Admin will see the discrepancy. Only the counted quantity will be added to this branch.',
      () => {
        issue.reset();
        issue.mutate(
          {
            transferId,
            items,
            notes: issueNotes.trim(),
            idempotencyKey,
          },
          {
            onSuccess: () => {
              keysRef.current.delete(transferId);
              cancelReport();
            },
            onError: () => {
              keysRef.current.delete(transferId);
            },
          },
        );
      },
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
          keyboardShouldPersistTaps="handled"
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
          renderItem={({ item }) => {
            const reporting = reportingId === item.id;
            const countsReady = item.items.every((line) => /^\d+$/.test(receivedByItem[line.stock_transfer_item_id] ?? ''));
            const hasDifference = item.items.some(
              (line) => Number(receivedByItem[line.stock_transfer_item_id] ?? '') !== line.quantity_sent,
            );
            const notesReady = issueNotes.trim().length >= 3;
            const busy =
              (arrival.isPending && arrival.variables?.transferId === item.id) ||
              (issue.isPending && issue.variables?.transferId === item.id);
            const otherBusy =
              (arrival.isPending && arrival.variables?.transferId !== item.id) ||
              (issue.isPending && issue.variables?.transferId !== item.id);
            const actionError =
              (arrival.error && arrival.variables?.transferId === item.id
                ? getInventoryErrorMessage(arrival.error)
                : null) ||
              (issue.error && issue.variables?.transferId === item.id
                ? getInventoryErrorMessage(issue.error)
                : null);

            return (
              <View style={styles.card}>
                <View style={styles.cardTop}>
                  <Text style={styles.transferNumber}>{item.transfer_number}</Text>
                  <Text style={styles.meta}>From {item.from_branch_name} · Sent {formatDate(item.sent_at)}</Text>
                </View>
                {item.items.map((line) => (
                  <View key={line.stock_transfer_item_id} style={styles.itemRow}>
                    <View style={styles.itemCopy}>
                      <Text style={styles.itemName} numberOfLines={1}>{line.product_name}</Text>
                      <Text style={styles.itemSku}>Sent {line.quantity_sent}</Text>
                    </View>
                    {reporting ? (
                      <TextInput
                        accessibilityLabel={`Actual received quantity for ${line.product_name}`}
                        keyboardType="number-pad"
                        value={receivedByItem[line.stock_transfer_item_id] ?? ''}
                        onChangeText={(value) => {
                          if (value === '' || /^\d{1,6}$/.test(value)) {
                            setReceivedByItem((current) => ({
                              ...current,
                              [line.stock_transfer_item_id]: value,
                            }));
                          }
                        }}
                        placeholder="0"
                        placeholderTextColor={managerColors.subtext}
                        maxLength={6}
                        style={styles.qtyInput}
                      />
                    ) : (
                      <Text style={styles.itemQty}>{line.quantity_sent}</Text>
                    )}
                  </View>
                ))}
                {reporting ? (
                  <FormField
                    label="What is wrong"
                    value={issueNotes}
                    onChangeText={setIssueNotes}
                    multiline
                    placeholder="Short, damaged, missing items…"
                    maxLength={1000}
                    accentColor={managerColors.royalBlue}
                    labelStyle={styles.fieldLabel}
                    style={styles.fieldInput}
                  />
                ) : null}
                {actionError ? <Text style={styles.error}>{actionError}</Text> : null}
                {reporting ? (
                  <>
                    <ManagerActionButton
                      label="Confirm issue"
                      icon="alert-circle-outline"
                      loading={issue.isPending && issue.variables?.transferId === item.id}
                      disabled={!countsReady || !hasDifference || !notesReady || otherBusy}
                      onPress={() => confirmIssue(item)}
                    />
                    <ManagerActionButton
                      label="Cancel"
                      variant="secondary"
                      disabled={busy}
                      onPress={cancelReport}
                    />
                  </>
                ) : (
                  <>
                    <ManagerActionButton
                      label="Shipment Arrived"
                      icon="checkmark-circle-outline"
                      loading={arrival.isPending && arrival.variables?.transferId === item.id}
                      disabled={otherBusy || reportingId != null}
                      onPress={() => confirmArrival(item)}
                    />
                    <ManagerActionButton
                      label="Report issue"
                      variant="secondary"
                      disabled={busy || otherBusy || reportingId != null}
                      onPress={() => beginReport(item)}
                    />
                  </>
                )}
              </View>
            );
          }}
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
  itemCopy: { flex: 1, minWidth: 0 },
  itemName: { color: managerColors.ink, fontFamily: 'Inter_500Medium', fontSize: 13.5 },
  itemSku: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 2 },
  itemQty: { color: managerColors.royalBlue, fontFamily: 'Inter_700Bold', fontSize: 14 },
  qtyInput: {
    width: 64,
    height: 40,
    borderWidth: 1.5,
    borderColor: managerColors.cardBorder,
    borderRadius: 10,
    backgroundColor: managerColors.cardSurface,
    color: managerColors.ink,
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
    textAlign: 'center',
    paddingVertical: 0,
  },
  fieldLabel: { fontFamily: 'Inter_600SemiBold', color: managerColors.ink },
  fieldInput: { fontFamily: 'Inter_400Regular' },
  error: { color: '#B91C1C', fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 18 },
});
