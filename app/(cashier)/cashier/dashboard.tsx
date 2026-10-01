import Ionicons from '@react-native-vector-icons/ionicons';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { Screen } from '@/components/Screen';
import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { NavTile } from '@/components/dashboard/NavTile';
import { StatTile } from '@/components/dashboard/StatTile';
import { managerColors } from '@/components/dashboard/theme';
import { spacing } from '@/constants/theme';
import { useQueryClient } from '@tanstack/react-query';

import { useAuth } from '@/features/auth/AuthProvider';
import {
  authoritativePosBranchId,
  formatOutOfStockWarning,
  hasSellableStock,
  outOfStockProductNames,
} from '@/features/pos/posInventory';
import { CashierShiftCloseForm } from '@/features/shifts/CashierShiftCloseForm';
import {
  BEGIN_CLOSE_CONFIRM_MESSAGE,
  FINALIZE_CONFIRM_MESSAGE,
  formatCloseSuccessSummary,
  isNetworkishError,
} from '@/features/shifts/closeDisplay';
import { useCashierPosInventory } from '@/hooks/useInventory';
import {
  useActiveShift,
  useBeginCashierShiftClose,
  useFinalizeCashierShiftReconciliation,
  useMyFinalizedCloseToday,
  usePendingShiftReconciliation,
  useReconcileClosedShift,
  useShiftSummary,
  useStartShift,
} from '@/hooks/useShifts';
import { alertNotice, confirmAction } from '@/lib/confirmAction';
import { getInventoryErrorMessage, getShiftErrorMessage } from '@/lib/errors';
import { formatDate, formatMoney } from '@/lib/format';
import { queryKeys } from '@/lib/queryKeys';
import { listCashierPosInventory } from '@/services/inventoryService';
import { useCartStore } from '@/stores/cartStore';
import type {
  InventoryItem,
  ShiftCloseFinalizeProduct,
  ShiftClosePreview,
  ShiftCloseResult,
} from '@/types/models';

type RemittancePath = 'legacy' | 'pcs';

type RemittanceAttempt = {
  shiftId: string;
  actualCash: string;
  products: ShiftCloseFinalizeProduct[];
  path: RemittancePath;
};

function isLegacyCashOnlyPreview(preview: ShiftClosePreview): boolean {
  return preview.mode === 'legacy_cash_only' || !preview.inventory_reconciliation_required;
}

function Row({ children }: { children: ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

export default function CashierDashboard() {
  const { profile, retryProfile } = useAuth();
  const queryClient = useQueryClient();
  const cashierId = profile?.id ?? '';
  const branchId = profile?.branch_id ?? profile?.branch?.id ?? null;
  const shiftQuery = useActiveShift(cashierId);
  const summaryQuery = useShiftSummary(shiftQuery.data?.id ?? '');
  const startMutation = useStartShift(cashierId);
  const beginCloseMutation = useBeginCashierShiftClose(cashierId);
  const finalizeMutation = useFinalizeCashierShiftReconciliation(cashierId);
  const reconcileMutation = useReconcileClosedShift(cashierId);
  const [closePreview, setClosePreview] = useState<ShiftClosePreview | null>(null);
  const [awaitingFinalizeRetry, setAwaitingFinalizeRetry] = useState(false);
  const lastFinalizeRef = useRef<RemittanceAttempt | null>(null);
  const remittancePending = finalizeMutation.isPending || reconcileMutation.isPending;
  const remittanceError = finalizeMutation.error ?? reconcileMutation.error;
  const posBranchId = authoritativePosBranchId(shiftQuery.data, profile);
  const inventory = useCashierPosInventory(posBranchId);
  const pendingShift = usePendingShiftReconciliation(cashierId, !shiftQuery.data);
  const finalizedToday = useMyFinalizedCloseToday(cashierId, branchId, !shiftQuery.data);
  const cartItems = useCartStore((state) => state.items);
  const clearCart = useCartStore((state) => state.clearCart);
  const [checkingStock, setCheckingStock] = useState(false);

  const ensureStockAllowsPos = async (onAllowed: () => void) => {
    setCheckingStock(true);
    try {
      const [shiftResult, profileResult] = await Promise.all([shiftQuery.refetch(), retryProfile()]);
      const resolvedBranchId = authoritativePosBranchId(shiftResult.data, profileResult.data ?? profile);
      if (!resolvedBranchId) {
        alertNotice('Cannot open POS', 'No branch is assigned to this cashier.');
        return;
      }

      await queryClient.invalidateQueries({ queryKey: queryKeys.cashierPosInventory(resolvedBranchId) });
      const rows: InventoryItem[] = await queryClient.fetchQuery({
        queryKey: queryKeys.cashierPosInventory(resolvedBranchId),
        queryFn: listCashierPosInventory,
        staleTime: 0,
      });

      if (rows.length === 0 || !hasSellableStock(rows)) {
        alertNotice(
          'Cannot open POS',
          rows.length === 0
            ? 'This branch has no active products. Ask a manager to add stock first.'
            : 'All products are out of stock. Confirm incoming shipments or ask Main to restock before opening POS.',
        );
        return;
      }

      const oosNames = outOfStockProductNames(rows);
      if (oosNames.length === 0) {
        onAllowed();
        return;
      }

      confirmAction(
        'Some products are out of stock',
        `You can continue, but these products have no stock:\n\n${formatOutOfStockWarning(oosNames)}`,
        onAllowed,
        { confirm: 'Continue' },
      );
    } catch (error) {
      alertNotice('Stock unavailable', getInventoryErrorMessage(error));
    } finally {
      setCheckingStock(false);
    }
  };

  const startShift = () =>
    startMutation.mutate(undefined, {
      onSuccess: () => router.replace('/cashier/pos'),
      onError: (error) => {
        alertNotice('Cannot start shift', getShiftErrorMessage(error));
      },
    });

  const openPos = () => void ensureStockAllowsPos(() => router.push('/cashier/pos'));

  const showIncomingTile = profile?.branch?.receiving_mode === 'cashier_confirm';
  const incomingTile = showIncomingTile ? (
    <NavTile
      layout="tile"
      icon="cube-outline"
      accent="gold"
      title="Incoming shipments"
      onPress={() => router.push('/cashier/incoming' as never)}
    />
  ) : null;

  const requestEndShift = () => {
    const shiftId = shiftQuery.data?.id;
    if (!shiftId) return;
    if (cartItems.length > 0) {
      alertNotice('Unfinished cart', 'Remove every item from the cart before ending the shift.');
      return;
    }
    if (beginCloseMutation.isPending) return;

    confirmAction(
      'End Shift for today?',
      BEGIN_CLOSE_CONFIRM_MESSAGE,
      () => {
        beginCloseMutation.mutate(shiftId, {
          onSuccess: (result) => {
            clearCart();
            if (result.status === 'reconciled') {
              setClosePreview(null);
              setAwaitingFinalizeRetry(false);
              lastFinalizeRef.current = null;
              alertNotice(
                'End Shift Complete',
                result.message ?? "This shift remittance is already complete.",
              );
              void finalizedToday.refetch();
              void pendingShift.refetch();
              void shiftQuery.refetch();
              return;
            }
            setClosePreview(result);
            setAwaitingFinalizeRetry(false);
            lastFinalizeRef.current = null;
          },
          onError: (error) => {
            alertNotice('Cannot begin End Shift', getShiftErrorMessage(error));
          },
        });
      },
      { cancel: 'Cancel', confirm: 'Start End Shift' },
    );
  };

  const onRemittanceSuccess = (result: ShiftCloseResult) => {
    lastFinalizeRef.current = null;
    setAwaitingFinalizeRetry(false);
    setClosePreview(null);
    alertNotice('End Shift Complete', formatCloseSuccessSummary(result));
    void finalizedToday.refetch();
    void pendingShift.refetch();
    void shiftQuery.refetch();
  };

  const onRemittanceError = async (error: Error) => {
    if (isNetworkishError(error)) {
      setAwaitingFinalizeRetry(true);
      const [pendingResult, closedResult] = await Promise.all([
        pendingShift.refetch(),
        finalizedToday.refetch(),
      ]);
      if (!pendingResult.data && closedResult.data) {
        lastFinalizeRef.current = null;
        setAwaitingFinalizeRetry(false);
        setClosePreview(null);
        alertNotice(
          'End Shift Complete',
          "Connection dropped after save. Today's remittance is already finalized.",
        );
        return;
      }
      alertNotice(
        'Connection problem',
        'Could not confirm the remittance. Retry with the same counts — do not re-enter unless the values need changing.',
      );
      return;
    }
    setAwaitingFinalizeRetry(false);
    alertNotice('Remittance not saved', getShiftErrorMessage(error));
  };

  const runFinalize = (attempt: RemittanceAttempt) => {
    if (remittancePending) return;
    lastFinalizeRef.current = attempt;
    const handlers = {
      onSuccess: onRemittanceSuccess,
      onError: onRemittanceError,
    };
    // Path is sticky on the attempt so network retry cannot switch RPCs.
    if (attempt.path === 'legacy') {
      reconcileMutation.mutate(
        { shiftId: attempt.shiftId, actualCash: attempt.actualCash },
        handlers,
      );
      return;
    }
    finalizeMutation.mutate(
      {
        shiftId: attempt.shiftId,
        actualCash: attempt.actualCash,
        products: attempt.products,
      },
      handlers,
    );
  };

  const requestFinalize = (
    preview: ShiftClosePreview,
    actualCash: string,
    products: ShiftCloseFinalizeProduct[],
  ) => {
    if (remittancePending) return;
    const path: RemittancePath = isLegacyCashOnlyPreview(preview) ? 'legacy' : 'pcs';
    confirmAction(
      'Finalize End Shift?',
      FINALIZE_CONFIRM_MESSAGE,
      () =>
        runFinalize({
          shiftId: preview.shift_id,
          actualCash,
          products: path === 'legacy' ? [] : products,
          path,
        }),
      { cancel: 'Cancel', confirm: 'Finalize' },
    );
  };

  const retryLastFinalize = () => {
    const attempt = lastFinalizeRef.current;
    if (!attempt || remittancePending) return;
    runFinalize(attempt);
  };

  const pendingPreview =
    pendingShift.data?.status === 'pending'
      ? pendingShift.data
      : closePreview?.status === 'pending'
        ? closePreview
        : null;

  const sameDayClosedHint = Boolean(finalizedToday.data) && !pendingPreview && !shiftQuery.data;
  const busy = beginCloseMutation.isPending || remittancePending;

  const refreshing =
    shiftQuery.isRefetching ||
    inventory.isRefetching ||
    finalizedToday.isRefetching ||
    (Boolean(shiftQuery.data) && summaryQuery.isRefetching) ||
    (!shiftQuery.data && pendingShift.isRefetching);

  const onRefresh = () => {
    void Promise.all([
      shiftQuery.refetch(),
      inventory.refetch(),
      shiftQuery.data ? summaryQuery.refetch() : Promise.resolve(),
      !shiftQuery.data ? pendingShift.refetch() : Promise.resolve(),
      !shiftQuery.data ? finalizedToday.refetch() : Promise.resolve(),
    ]);
  };

  const orders = summaryQuery.data?.completed_transaction_count;
  const salesTotal = summaryQuery.data?.total_sales;
  const cashierName = profile?.full_name ?? 'Cashier';

  const remittanceForm = pendingPreview ? (
    <View style={styles.remittanceBlock}>
      <CashierShiftCloseForm
        preview={pendingPreview}
        branchName={profile?.branch?.name}
        title={shiftQuery.data ? 'End Shift' : 'Complete Pending Remittance'}
        submitLabel="Complete End Shift"
        loading={remittancePending}
        onSubmit={(actualCash, products) => requestFinalize(pendingPreview, actualCash, products)}
      />
      {awaitingFinalizeRetry && lastFinalizeRef.current ? (
        <ManagerActionButton
          label="Retry same remittance"
          loading={remittancePending}
          disabled={remittancePending}
          onPress={retryLastFinalize}
        />
      ) : null}
      {remittanceError && !isNetworkishError(remittanceError) ? (
        <Text style={styles.error}>{getShiftErrorMessage(remittanceError)}</Text>
      ) : null}
    </View>
  ) : null;

  return (
    <Screen
      backgroundColor="#FFFFFF"
      edges={['top']}
      refreshing={refreshing}
      onRefresh={onRefresh}
      contentContainerStyle={styles.screenContent}
    >
      <View style={styles.header}>
        <Text style={styles.greeting} numberOfLines={1}>
          Hi, {cashierName}
        </Text>
        <View style={styles.pillRow}>
          <View style={styles.rolePill}>
            <View style={styles.roleDot} />
            <Text style={styles.rolePillText}>CASHIER</Text>
          </View>
          <View style={styles.branchPill}>
            <Ionicons name="storefront-outline" size={12} color={managerColors.subtext} />
            <Text style={styles.branchPillText} numberOfLines={1}>
              {profile?.branch?.name ?? 'Unassigned'}
            </Text>
          </View>
        </View>
      </View>

      <ConstrainedWidth style={styles.column}>
        {shiftQuery.isLoading && !shiftQuery.data ? (
          <LoadingState label="Checking active shift…" />
        ) : shiftQuery.error ? (
          <ErrorState
            message={getShiftErrorMessage(shiftQuery.error)}
            onRetry={() => void shiftQuery.refetch()}
          />
        ) : !shiftQuery.data ? (
          <View style={styles.noticeCard}>
            {pendingPreview ? (
              <>
                <Text style={styles.noticeTitle}>Pending remittance</Text>
                <Text style={styles.noticeText}>
                  Sales are closed for this booth. Finish the stock and cash count to complete End Shift.
                </Text>
                {remittanceForm}
              </>
            ) : sameDayClosedHint ? (
              <>
                <Text style={styles.noticeTitle}>Shift closed for today</Text>
                <Text style={styles.noticeText}>
                  Today&apos;s End Shift is complete. Start again next business day.
                </Text>
                <Text style={styles.note}>
                  If this looks wrong, pull to refresh. The server decides whether a new shift can start.
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.noticeTitle}>No Active Shift</Text>
                <Text style={styles.noticeText}>
                  Start a shift to sell. You can confirm incoming shipments anytime. Ending a shift stops sales
                  and stock transactions for today, then you count remaining stock and cash.
                </Text>
                {startMutation.error ? (
                  <Text style={styles.error}>{getShiftErrorMessage(startMutation.error)}</Text>
                ) : null}
                <ManagerActionButton
                  label="Start shift"
                  icon="play-outline"
                  loading={startMutation.isPending}
                  disabled={startMutation.isPending}
                  onPress={startShift}
                />
              </>
            )}
            {showIncomingTile ? (
              <>
                <Text style={styles.sectionTitle}>BRANCH ACTIONS</Text>
                <Row>{incomingTile}</Row>
              </>
            ) : null}
          </View>
        ) : (
          <View style={styles.content}>
            <View style={styles.row}>
              <StatTile
                style={styles.half}
                emphasis
                icon="cash-outline"
                label="Total sales"
                value={
                  summaryQuery.isLoading && salesTotal === undefined
                    ? '—'
                    : formatMoney(salesTotal ?? 0)
                }
              />
              <StatTile
                style={styles.half}
                icon="receipt-outline"
                label="Orders"
                value={summaryQuery.isLoading && orders === undefined ? '—' : String(orders ?? 0)}
              />
            </View>

            <View style={styles.shiftCard}>
              <View style={styles.titleRow}>
                <View style={styles.liveDot} />
                <Text style={styles.shiftTitle}>Active Shift</Text>
              </View>
              <View style={styles.startedRow}>
                <Ionicons name="time-outline" size={14} color={managerColors.subtext} />
                <Text style={styles.startedText}>Started {formatDate(shiftQuery.data.started_at)}</Text>
              </View>
            </View>

            {pendingPreview ? (
              remittanceForm
            ) : (
              <View style={styles.endShiftSection}>
                <ManagerActionButton
                  label="End Shift / Remit"
                  icon="stop-circle-outline"
                  variant="secondary"
                  loading={beginCloseMutation.isPending}
                  disabled={busy}
                  onPress={requestEndShift}
                />
                {beginCloseMutation.error ? (
                  <Text style={styles.error}>{getShiftErrorMessage(beginCloseMutation.error)}</Text>
                ) : null}
              </View>
            )}

            {summaryQuery.error ? (
              <Text style={styles.error}>Unable to load shift totals. Pull to refresh.</Text>
            ) : null}

            {cartItems.length > 0 ? (
              <View style={styles.warningCard}>
                <Text style={styles.warningText}>
                  The cart has {cartItems.length} unfinished product
                  {cartItems.length === 1 ? '' : 's'}.
                </Text>
              </View>
            ) : null}

            {!pendingPreview ? (
              <>
                <Text style={styles.sectionTitle}>QUICK ACTIONS</Text>
                <Row>
                  <NavTile
                    layout="tile"
                    icon="cart-outline"
                    accent="blue"
                    title="Open POS"
                    onPress={checkingStock ? () => {} : openPos}
                    style={checkingStock && styles.tileBusy}
                  />
                  <NavTile
                    layout="tile"
                    icon="receipt-outline"
                    accent="teal"
                    title="Current shift sales"
                    onPress={() => router.push('/cashier/sales')}
                  />
                  {incomingTile}
                </Row>
              </>
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
    gap: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: managerColors.cardBorder,
  },
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
  content: { gap: spacing.md },
  remittanceBlock: { gap: spacing.sm },
  sectionTitle: {
    color: managerColors.subtext,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    letterSpacing: 0.8,
  },
  noticeCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 16,
    padding: spacing.lg,
    gap: spacing.md,
    shadowColor: '#0A1224',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 1,
  },
  noticeTitle: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 19 },
  noticeText: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20 },
  note: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18 },
  shiftCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 16,
    padding: spacing.md,
    gap: spacing.sm,
    shadowColor: '#0A1224',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 1,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: managerColors.green },
  shiftTitle: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 17 },
  startedRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  startedText: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 13 },
  row: { flexDirection: 'row', gap: spacing.sm },
  half: { flex: 1 },
  warningCard: {
    backgroundColor: '#FEF3C7',
    borderRadius: 12,
    padding: spacing.sm,
  },
  warningText: { color: '#92400E', fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 19 },
  error: { color: '#B91C1C', fontFamily: 'Inter_500Medium', fontSize: 14, lineHeight: 20 },
  tileBusy: { opacity: 0.6 },
  endShiftSection: {
    borderTopWidth: 1,
    borderTopColor: managerColors.cardBorder,
    paddingTop: spacing.md,
    marginTop: 4,
    gap: spacing.sm,
  },
});
