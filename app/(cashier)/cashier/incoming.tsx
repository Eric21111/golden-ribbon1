import Ionicons from '@react-native-vector-icons/ionicons';
import { useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';

import { FormField } from '@/components/FormField';
import { Screen } from '@/components/Screen';
import {
  DetailProductListSection,
  type DetailLineStatus,
} from '@/components/dashboard/DetailProductListSection';
import { ListRowCard } from '@/components/dashboard/ListRowCard';
import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { EmptyState, ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { managerColors } from '@/components/dashboard/theme';
import { useAuth } from '@/features/auth/AuthProvider';
import { categoryOf } from '@/features/products/productFilters';
import { categoryRowProps } from '@/features/products/productCategoryIndicator';
import {
  useCashierPendingTransfers,
  useConfirmShipmentArrival,
  useReportShipmentIssue,
} from '@/hooks/useTransfers';
import { useMarkNotificationsReviewed } from '@/hooks/useNotifications';
import { useProducts } from '@/hooks/useProducts';
import { alertNotice, confirmAction } from '@/lib/confirmAction';
import { getInventoryErrorMessage } from '@/lib/errors';
import {
  QUANTITY_BOX_MAX_FONT_SCALE,
  formatDate,
  formatSnapshottedQuantity,
  makeIdempotencyKey,
  quantityBoxWidth,
} from '@/lib/format';
import type { CashierPendingTransfer, CashierPendingTransferItem } from '@/types/models';

type LineItem = {
  id: string;
  name: string;
  sku: string;
  category: string | null;
  lineStatus: DetailLineStatus;
  line: CashierPendingTransferItem;
};

function lineStatusFor(
  line: CashierPendingTransferItem,
  reporting: boolean,
  receivedByItem: Record<string, string>,
): DetailLineStatus {
  if (!reporting) return 'pending';
  const raw = receivedByItem[line.stock_transfer_item_id] ?? '';
  if (!/^\d+$/.test(raw)) return 'pending';
  const received = Number(raw);
  const sent = Number(line.quantity_sent);
  if (received === sent) return 'match';
  if (received < sent) return 'missing';
  return 'excess';
}

export default function CashierIncomingShipments() {
  const { session } = useAuth();
  const { fontScale } = useWindowDimensions();
  const pending = useCashierPendingTransfers(session?.user.id ?? '');
  const products = useProducts();
  useMarkNotificationsReviewed('transfer_pending', null, pending.isSuccess ? pending.dataUpdatedAt : 0);
  const arrival = useConfirmShipmentArrival();
  const issue = useReportShipmentIssue();
  const keysRef = useRef<Map<string, string>>(new Map());
  const [reportingId, setReportingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [receivedByItem, setReceivedByItem] = useState<Record<string, string>>({});
  const [issueNotes, setIssueNotes] = useState('');

  const categoryByProductId = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const product of products.data ?? []) {
      map.set(product.id, categoryOf(product));
    }
    return map;
  }, [products.data]);

  const transfers = pending.data ?? [];
  const footerTransfer = useMemo(() => {
    const activeId = reportingId ?? expandedId;
    if (!activeId) return null;
    return transfers.find((transfer) => transfer.id === activeId) ?? null;
  }, [reportingId, expandedId, transfers]);

  const keyFor = (transferId: string) => {
    const existing = keysRef.current.get(transferId);
    if (existing) return existing;
    const key = makeIdempotencyKey('shipment');
    keysRef.current.set(transferId, key);
    return key;
  };

  const beginReport = (transfer: CashierPendingTransfer) => {
    setReportingId(transfer.id);
    setExpandedId(transfer.id);
    setIssueNotes('');
    setReceivedByItem(
      Object.fromEntries(
        transfer.items.map((line) => [line.stock_transfer_item_id, String(line.quantity_sent)]),
      ),
    );
    arrival.reset();
    issue.reset();
  };

  const cancelReport = () => {
    setReportingId(null);
    setIssueNotes('');
    setReceivedByItem({});
  };

  const toggleExpanded = (transferId: string) => {
    if (reportingId === transferId) return;
    setExpandedId((current) => (current === transferId ? null : transferId));
  };

  const confirmArrival = (transfer: CashierPendingTransfer) => {
    const transferId = String(transfer.id ?? '').trim();
    const idempotencyKey = keyFor(transferId);
    confirmAction(
      'Shipment arrived?',
      `Everything from ${transfer.from_branch_name} is received as sent.`,
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
      { confirm: 'Arrived', tone: 'info' },
    );
  };

  const confirmIssue = (transfer: CashierPendingTransfer) => {
    const items = transfer.items.map((line) => ({
      stock_transfer_item_id: line.stock_transfer_item_id,
      quantity_received: Number(receivedByItem[line.stock_transfer_item_id] ?? ''),
    }));
    if (items.some((item) => !Number.isInteger(item.quantity_received) || item.quantity_received < 0)) {
      alertNotice('Check quantities', 'Enter a whole PCS quantity of zero or greater for every line.', 'warning');
      return;
    }
    if (
      !items.some(
        (item) =>
          item.quantity_received
          !== Number(
            transfer.items.find((line) => line.stock_transfer_item_id === item.stock_transfer_item_id)!.quantity_sent,
          ),
      )
    ) {
      alertNotice(
        'No difference entered',
        'Change a counted quantity, or tap Arrived if it matches.',
        'warning',
      );
      return;
    }
    if (issueNotes.trim().length < 3) {
      alertNotice('Notes required', 'Describe what is wrong in at least 3 characters.', 'warning');
      return;
    }
    const transferId = String(transfer.id ?? '').trim();
    const idempotencyKey = keyFor(transferId);
    confirmAction(
      'Report shipment issue?',
      'Report the counted quantities that differ from what was sent.',
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

  function actionState(transfer: CashierPendingTransfer) {
    const reporting = reportingId === transfer.id;
    const countsReady = transfer.items.every((line) =>
      /^\d+$/.test(receivedByItem[line.stock_transfer_item_id] ?? ''),
    );
    const hasDifference = transfer.items.some(
      (line) => Number(receivedByItem[line.stock_transfer_item_id] ?? '') !== Number(line.quantity_sent),
    );
    const notesReady = issueNotes.trim().length >= 3;
    const busy =
      (arrival.isPending && arrival.variables?.transferId === transfer.id) ||
      (issue.isPending && issue.variables?.transferId === transfer.id);
    const otherBusy =
      (arrival.isPending && arrival.variables?.transferId !== transfer.id) ||
      (issue.isPending && issue.variables?.transferId !== transfer.id);
    const actionError =
      (arrival.error && arrival.variables?.transferId === transfer.id
        ? getInventoryErrorMessage(arrival.error)
        : null) ||
      (issue.error && issue.variables?.transferId === transfer.id
        ? getInventoryErrorMessage(issue.error)
        : null);
    return { reporting, countsReady, hasDifference, notesReady, busy, otherBusy, actionError };
  }

  function renderActions(transfer: CashierPendingTransfer) {
    const { reporting, countsReady, hasDifference, notesReady, busy, otherBusy } = actionState(transfer);
    if (reporting) {
      return (
        <View style={styles.buttonRow}>
          <View style={styles.buttonHalf}>
            <ManagerActionButton label="Cancel" variant="secondary" disabled={busy} onPress={cancelReport} />
          </View>
          <View style={styles.buttonHalf}>
            <ManagerActionButton
              label="Confirm issue"
              icon="alert-circle-outline"
              loading={issue.isPending && issue.variables?.transferId === transfer.id}
              disabled={!countsReady || !hasDifference || !notesReady || otherBusy}
              onPress={() => confirmIssue(transfer)}
            />
          </View>
        </View>
      );
    }
    return (
      <View style={styles.buttonRow}>
        <View style={styles.buttonHalf}>
          <ManagerActionButton
            label="Report issue"
            variant="secondary"
            disabled={busy || otherBusy || reportingId != null}
            onPress={() => beginReport(transfer)}
          />
        </View>
        <View style={styles.buttonHalf}>
          <ManagerActionButton
            label="Arrived"
            icon="checkmark-circle-outline"
            loading={arrival.isPending && arrival.variables?.transferId === transfer.id}
            disabled={otherBusy || reportingId != null}
            onPress={() => confirmArrival(transfer)}
          />
        </View>
      </View>
    );
  }

  function renderTransfer(transfer: CashierPendingTransfer, stickyActions: boolean) {
    const { reporting, actionError } = actionState(transfer);
    const expanded = reporting || expandedId === transfer.id;
    const lineItems: LineItem[] = transfer.items.map((line) => ({
      id: line.stock_transfer_item_id,
      name: line.product_name,
      sku: line.product_sku,
      category: categoryByProductId.get(line.product_id) ?? null,
      lineStatus: lineStatusFor(line, reporting, receivedByItem),
      line,
    }));

    return (
      <View style={styles.transferBlock}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          accessibilityLabel={`${transfer.transfer_number}, ${expanded ? 'collapse' : 'expand'} products`}
          onPress={() => toggleExpanded(transfer.id)}
          style={({ pressed }) => [
            styles.headerCard,
            reporting && styles.headerCardReporting,
            pressed && styles.pressed,
          ]}
        >
          <View style={styles.cardTopIconChip}>
            <Ionicons name="cube-outline" size={18} color={managerColors.royalBlue} />
          </View>
          <View style={styles.cardTopCopy}>
            <Text style={styles.transferNumber}>{transfer.transfer_number}</Text>
            <Text style={styles.meta}>
              From {transfer.from_branch_name} · Sent {formatDate(transfer.sent_at)}
            </Text>
            <Text style={styles.itemCount}>
              {transfer.items.length} {transfer.items.length === 1 ? 'product' : 'products'}
            </Text>
          </View>
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={20}
            color={managerColors.subtext}
          />
        </Pressable>

        {expanded ? (
          <>
            <DetailProductListSection
              title="PRODUCTS"
              matchLabel="Complete"
              showFilters={false}
              showGroupHeadings={false}
              items={lineItems}
              renderItem={(row) => {
                const sentLabel = formatSnapshottedQuantity(
                  row.line.quantity_sent,
                  row.line.inventory_mode,
                  row.line.stock_unit_code,
                );
                return (
                  <ListRowCard
                    {...categoryRowProps(row.category)}
                    title={row.name}
                    subtitle={reporting ? `Sent ${sentLabel}` : row.sku || undefined}
                    meta={reporting ? (row.sku || undefined) : undefined}
                    trailing={
                      reporting ? (
                        <TextInput
                          accessibilityLabel={`Actual received quantity for ${row.name}`}
                          keyboardType="number-pad"
                          value={receivedByItem[row.line.stock_transfer_item_id] ?? ''}
                          onChangeText={(value) => {
                            if (value === '' || /^\d{1,6}$/.test(value)) {
                              setReceivedByItem((current) => ({
                                ...current,
                                [row.line.stock_transfer_item_id]: value,
                              }));
                            }
                          }}
                          placeholder="0"
                          placeholderTextColor={managerColors.subtext}
                          maxLength={6}
                          selectTextOnFocus
                          maxFontSizeMultiplier={QUANTITY_BOX_MAX_FONT_SCALE}
                          style={[
                            styles.qtyInput,
                            {
                              width: quantityBoxWidth(receivedByItem[row.line.stock_transfer_item_id], {
                                min: 64,
                                fontSize: 15,
                                fontScale,
                              }),
                            },
                          ]}
                        />
                      ) : (
                        <Text style={styles.itemQty}>{sentLabel}</Text>
                      )
                    }
                  />
                );
              }}
            />

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
            {!stickyActions ? <View style={styles.inlineActions}>{renderActions(transfer)}</View> : null}
          </>
        ) : null}
      </View>
    );
  }

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

  const stickyFooter = footerTransfer != null;

  return (
    <Screen backgroundColor="#FFFFFF" edges={['top']} scroll={false} contentContainerStyle={styles.screen}>
      <View style={styles.layout}>
        <ManagerScreenHeader title="Incoming Shipments" showBack />
        <FlatList
          data={transfers}
          keyExtractor={(item) => item.id}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={pending.isRefetching}
              onRefresh={() => void pending.refetch()}
              tintColor={managerColors.royalBlue}
            />
          }
          ListEmptyComponent={
            <EmptyState
              title="No incoming shipments"
              message="Shipments waiting for your count appear here."
            />
          }
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          renderItem={({ item }) => renderTransfer(item, stickyFooter && footerTransfer?.id === item.id)}
        />
        {stickyFooter && footerTransfer ? (
          <View style={styles.footer}>{renderActions(footerTransfer)}</View>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { flexGrow: 1, padding: 0, gap: 0 },
  layout: { flex: 1, minHeight: 0 },
  list: { flex: 1, minHeight: 0 },
  listContent: { paddingHorizontal: 20, paddingVertical: 16, flexGrow: 1, gap: 0 },
  separator: { height: 20 },
  transferBlock: { gap: 14 },
  headerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 16,
    padding: 16,
    shadowColor: '#0A1224',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 1,
  },
  headerCardReporting: { borderColor: managerColors.royalBlue, backgroundColor: '#F8FAFE' },
  pressed: { opacity: 0.75 },
  cardTopIconChip: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#DCE8FC',
  },
  cardTopCopy: { flex: 1, minWidth: 0, gap: 2 },
  transferNumber: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 15 },
  meta: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12.5 },
  itemCount: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 12 },
  itemQty: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 15 },
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
  buttonRow: { flexDirection: 'row', gap: 10 },
  buttonHalf: { flex: 1 },
  inlineActions: { paddingTop: 4 },
  footer: {
    marginHorizontal: 0,
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 16,
    borderTopWidth: 1,
    borderTopColor: managerColors.cardBorder,
    backgroundColor: '#FFFFFF',
    shadowColor: '#0A1224',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 4,
  },
});
