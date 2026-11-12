import { PinField } from '@/components/PinField';
import { beginCashierShiftClose } from '@/services/shiftService';
import Ionicons from '@react-native-vector-icons/ionicons';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { FormField } from '@/components/FormField';
import { Screen } from '@/components/Screen';
import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { NavTile } from '@/components/dashboard/NavTile';
import { StatTile } from '@/components/dashboard/StatTile';
import { managerColors } from '@/components/dashboard/theme';
import { spacing } from '@/constants/theme';
import { useAuth } from '@/features/auth/AuthProvider';
import {
  authoritativePosBranchId,
  formatOutOfStockWarning,
  hasSellableStock,
  outOfStockProductNames,
} from '@/features/pos/posInventory';
import { SelectedReturnCloseForm } from '@/features/shifts/SelectedReturnCloseForm';
import { CashierShiftCloseForm } from '@/features/shifts/CashierShiftCloseForm';
import {
  BEGIN_CLOSE_CONFIRM_MESSAGE,
  FINALIZE_CONFIRM_MESSAGE,
  formatCloseSuccessSummary,
  isNetworkishError,
} from '@/features/shifts/closeDisplay';
import { useCashierPosInventory } from '@/hooks/useInventory';
import { hasSelectedReturnClose, reopenCashierShift } from '@/services/shiftService';
import {
  assertShiftCloseAllowed,
  invalidateAfterShiftClose,
  useActiveShift,
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
import { endSubmit, tryBeginSubmit } from '@/lib/submitLock';
import { listCashierPosInventory } from '@/services/inventoryService';
import { useCartStore } from '@/stores/cartStore';
import type {
  InventoryItem,
  ShiftReturnSelection,
  ShiftCloseFinalizeProduct,
  ShiftClosePreview,
  ShiftCloseResult,
} from '@/types/models';

type RemittancePath = 'legacy' | 'pcs';

type RemittanceAttempt = {
  shiftId: string;
  actualCash: string;
  actualGcash?: string;
  products: ShiftCloseFinalizeProduct[];
  selection?: ShiftReturnSelection;
  path: RemittancePath;
};

function isLegacyCashOnlyPreview(preview: ShiftClosePreview): boolean {
  // Route on server mode only — do not infer legacy from inventory_reconciliation_required.
  return preview.mode === 'legacy_cash_only';
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
  const [pinPrompt,setPinPrompt] = useState(false);
  const [credential,setCredential] = useState('');
  const [legacyClose,setLegacyClose]=useState(false);
  const [verifying,setVerifying] = useState(false);
  const verificationLock = useRef(false);
  const finalizeMutation = useFinalizeCashierShiftReconciliation(cashierId);
  const reconcileMutation = useReconcileClosedShift(cashierId);
  const [closePreview, setClosePreview] = useState<ShiftClosePreview | null>(null);
  const [awaitingFinalizeRetry, setAwaitingFinalizeRetry] = useState(false);
  const lastFinalizeRef = useRef<RemittanceAttempt | null>(null);
  const remittanceSubmitLock = useRef(false);
  const remittancePending = finalizeMutation.isPending || reconcileMutation.isPending;
  const remittanceError = finalizeMutation.error ?? reconcileMutation.error;
  const posBranchId = authoritativePosBranchId(shiftQuery.data, profile);
  const inventory = useCashierPosInventory(posBranchId);
  const pendingShift = usePendingShiftReconciliation(cashierId, !shiftQuery.data);
  const finalizedToday = useMyFinalizedCloseToday(cashierId, branchId, !shiftQuery.data);
  const cartItems = useCartStore((state) => state.items);
  const clearCart = useCartStore((state) => state.clearCart);
  const [checkingStock, setCheckingStock] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState('');
  const [reopenError, setReopenError] = useState('');
  const [reopenBusy, setReopenBusy] = useState(false);

  const ensureStockAllowsPos = async (onAllowed: () => void) => {
    setCheckingStock(true);
    try {
      const [shiftResult, profileResult] = await Promise.all([shiftQuery.refetch(), retryProfile()]);
      const resolvedBranchId = authoritativePosBranchId(shiftResult.data, profileResult.data ?? profile);
      if (!resolvedBranchId) {
        alertNotice('Cannot open POS', 'No branch is assigned to this cashier.', 'danger');
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
            ? 'No active products at this branch. Ask a manager to add stock.'
            : 'Everything is out of stock. Confirm a shipment or ask Main to restock.',
          'warning',
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
        `These have no stock:\n${formatOutOfStockWarning(oosNames)}`,
        onAllowed,
        { confirm: 'Continue', tone: 'warning' },
      );
    } catch (error) {
      alertNotice('Stock unavailable', getInventoryErrorMessage(error), 'danger');
    } finally {
      setCheckingStock(false);
    }
  };

  const startShift = () =>
    startMutation.mutate(undefined, {
      onSuccess: () => {
        void pendingShift.refetch();
        void finalizedToday.refetch();
        router.replace('/cashier/incoming' as never);
      },
      onError: async (error) => {
        const message = getShiftErrorMessage(error);
        const pendingResult = await pendingShift.refetch();
        const raw =
          typeof error === 'object' && error && 'message' in error
            ? String((error as { message: unknown }).message).toLowerCase()
            : '';
        if (
          (raw.includes('pending inventory') || raw.includes('complete pending inventory'))
          && !pendingResult.data
        ) {
          alertNotice(
            'Cannot start shift',
            'Unfinished remittance. Ask a manager to finish it first.',
            'warning',
          );
          return;
        }
        alertNotice('Cannot start shift', message, 'danger');
      },
    });

  const openPos = () => void ensureStockAllowsPos(() => router.push('/cashier/pos'));

  const submitReopen = () => {
    const reason = reopenReason.trim();
    if (reason.length < 8 || reopenBusy) {
      setReopenError('Enter a reason of at least 8 characters.');
      return;
    }
    setReopenBusy(true);
    setReopenError('');
    void reopenCashierShift(reason)
      .then(async () => {
        setReopenOpen(false);
        setReopenReason('');
        await Promise.all([shiftQuery.refetch(), finalizedToday.refetch(), pendingShift.refetch()]);
        await queryClient.invalidateQueries({ queryKey: ['shifts'] });
        router.push('/cashier/pos');
      })
      .catch((error: unknown) => setReopenError(getShiftErrorMessage(error)))
      .finally(() => setReopenBusy(false));
  };

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
  const leftoverReturnTile = (
    <NavTile
      layout="tile"
      icon="return-down-back-outline"
      accent="teal"
      title="Leftover return"
      onPress={() => router.push('/cashier/returns/create')}
    />
  );

  const requestEndShift = () => {
    const shiftId = shiftQuery.data?.id;
    if (!shiftId) return;
    if (cartItems.length > 0) {
      alertNotice('Unfinished cart', 'Remove every item from the cart before ending the shift.', 'warning');
      return;
    }
    setCredential(''); setLegacyClose(false); setPinPrompt(true);
  };
  const confirmEndShift = async () => {
    const shiftId = shiftQuery.data?.id;
    if (!shiftId || cartItems.length || !(legacyClose ? credential.length : /^[0-9]{6}$/.test(credential)) || verificationLock.current) return;
    verificationLock.current=true; setVerifying(true);
    try {
      assertShiftCloseAllowed();
      const result = await beginCashierShiftClose(shiftId,credential);
      setPinPrompt(false);
      void invalidateAfterShiftClose(queryClient,cashierId);

      clearCart();
      if (result.status === 'reconciled') {
        setClosePreview(null);
        setAwaitingFinalizeRetry(false);
        lastFinalizeRef.current = null;
        alertNotice(
          'End Shift Complete',
          result.message ?? "This shift remittance is already complete.",
          'success',
        );
        void finalizedToday.refetch();
        void pendingShift.refetch();
        void shiftQuery.refetch();
        return;
      }
      setClosePreview(result);
      setAwaitingFinalizeRetry(false);
      lastFinalizeRef.current = null;
    } catch (error) {
      await Promise.allSettled([pendingShift.refetch(),shiftQuery.refetch(),finalizedToday.refetch()]);
      alertNotice('Cannot begin End Shift',error instanceof Error ? error.message : 'Check shift status before retrying.','danger');
    } finally {
      setCredential(''); setVerifying(false); verificationLock.current=false;
    }
  };

  const onRemittanceSuccess = (result: ShiftCloseResult) => {
    // the products of the shift that was just remitted: the open close preview, or the pending shift being completed
    const names = Object.fromEntries(
      (closePreview?.products ?? pendingShift.data?.products ?? []).map((product) => [product.product_id, product.product_name_snapshot]),
    );
    lastFinalizeRef.current = null;
    setAwaitingFinalizeRetry(false);
    setClosePreview(null);
    const summary = formatCloseSuccessSummary(result, names);
    const dispatch = result.return_number
      ? `Return ${result.return_number} sent to Main Branch for counting.`
      : 'Stock kept at the branch.';
    alertNotice('End Shift Complete', result.selected_return_close ? `${summary}\n${dispatch}` : summary, 'success');
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
      const attempt = lastFinalizeRef.current;
      const confirmed = attempt?.selection
        ? await hasSelectedReturnClose(attempt.shiftId).catch(() => false)
        : !pendingResult.error && !pendingResult.data && closedResult.data;
      if (confirmed) {
        lastFinalizeRef.current = null;
        setAwaitingFinalizeRetry(false);
        setClosePreview(null);
        alertNotice(
          'End Shift Complete',
          "Connection dropped after save. Today's remittance is already finalized.",
          'success',
        );
        return;
      }
      alertNotice(
        'Connection problem',
        'Could not confirm. Retry with the same counts unless a number was wrong.',
        'danger',
      );
      return;
    }
    setAwaitingFinalizeRetry(false);
    alertNotice('Remittance not saved', getShiftErrorMessage(error), 'danger');
  };

  const runFinalize = (attempt: RemittanceAttempt) => {
    if (remittancePending || !tryBeginSubmit(remittanceSubmitLock)) return;
    lastFinalizeRef.current = attempt;
    const handlers = {
      onSuccess: (result: ShiftCloseResult) => {
        endSubmit(remittanceSubmitLock);
        onRemittanceSuccess(result);
      },
      onError: async (error: Error) => {
        endSubmit(remittanceSubmitLock);
        await onRemittanceError(error);
      },
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
        actualGcash: attempt.actualGcash,
        products: attempt.products,
        selection: attempt.selection,
      },
      handlers,
    );
  };

  const requestFinalize = (
    preview: ShiftClosePreview,
    actualCash: string,
    products: ShiftCloseFinalizeProduct[],
    actualGcash?: string,
    selection?: ShiftReturnSelection,
  ) => {
    if (remittancePending || remittanceSubmitLock.current) return;
    const path: RemittancePath = isLegacyCashOnlyPreview(preview) && actualGcash === undefined ? 'legacy' : 'pcs';
    confirmAction(
      'Finalize End Shift?',
      selection ? (selection.productIds.length ? `Send ${selection.productIds.length} selected stock items to Main Branch and save the remittance?` : 'Keep the remaining stock at this branch and save the remittance?') : FINALIZE_CONFIRM_MESSAGE,
      () =>
        runFinalize({
          shiftId: preview.shift_id,
          actualCash,
          actualGcash,
          selection,
          products: path === 'legacy' ? [] : products,
          path,
        }),
      { cancel: 'Cancel', confirm: 'Finalize', tone: 'danger' },
    );
  };

  const retryLastFinalize = () => {
    const attempt = lastFinalizeRef.current;
    if (!attempt || remittancePending || remittanceSubmitLock.current) return;
    runFinalize(attempt);
  };

  const pendingPreview =
    pendingShift.data?.status === 'pending'
      ? pendingShift.data
      : closePreview?.status === 'pending'
        ? closePreview
        : null;

  const sameDayClosedHint = Boolean(finalizedToday.data) && !pendingPreview && !shiftQuery.data;
  const busy = verifying || remittancePending;

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
  // No shift to greet into when a remittance is blocking everything else — the page is the task.
  // While a remittance is open the page IS the task (count the stock, count the cash, finish): a full-height count with its own
  // header and a pinned progress + submit bar, not a card inside the dashboard.
  if (pendingPreview && !(shiftQuery.isLoading && !shiftQuery.data) && !shiftQuery.error) {
    const showRetry = awaitingFinalizeRetry && Boolean(lastFinalizeRef.current);
    const showError = Boolean(remittanceError) && !isNetworkishError(remittanceError);
    const retryFooter = showRetry || showError ? (
      <>
        {showRetry ? (
          <ManagerActionButton
            label="Retry same remittance"
            loading={remittancePending}
            disabled={remittancePending}
            onPress={retryLastFinalize}
          />
        ) : null}
        {showError ? <Text style={styles.error}>{getShiftErrorMessage(remittanceError)}</Text> : null}
      </>
    ) : undefined;
    return (
      <Screen backgroundColor="#FFFFFF" edges={['top']} scroll={false} contentContainerStyle={styles.screenContent}>
        <ManagerScreenHeader title={shiftQuery.data ? 'End Shift' : 'Pending Remittance'} showBack hideMenu />
        <ConstrainedWidth fill>
          {pendingPreview.supports_selected_returns && pendingPreview.mode === 'pcs_inventory_cash' ? (
            <SelectedReturnCloseForm key={pendingPreview.shift_id} preview={pendingPreview} operator={cashierName}
              loading={remittancePending} footerExtra={retryFooter}
              onSubmit={(cash, gcash, selection) => requestFinalize(pendingPreview, cash, [], gcash, selection)} />
          ) : (
            <CashierShiftCloseForm
              preview={pendingPreview}
              branchName={profile?.branch?.name}
              title={shiftQuery.data ? 'End Shift' : 'Complete Pending Remittance'}
              submitLabel="Complete End Shift"
              loading={remittancePending}
              onSubmit={(actualCash, products, actualGcash) => requestFinalize(pendingPreview, actualCash, products, actualGcash)}
              footerExtra={retryFooter}
            />
          )}
        </ConstrainedWidth>
      </Screen>
    );
  }

  return (
    <Screen
      backgroundColor="#FFFFFF"
      edges={['top']}
      refreshing={refreshing}
      onRefresh={onRefresh}
      contentContainerStyle={styles.screenContent}
    >
      {(
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
      )}

      <ConstrainedWidth style={styles.column}>
        {shiftQuery.isLoading && !shiftQuery.data ? (
          <LoadingState label="Checking active shift…" />
        ) : shiftQuery.error ? (
          <ErrorState
            message={getShiftErrorMessage(shiftQuery.error)}
            onRetry={() => void shiftQuery.refetch()}
          />
        ) : !shiftQuery.data ? (
          <View style={styles.content}>
            <View style={styles.noticeCard}>
              {sameDayClosedHint ? (
                <>
                  <View style={styles.closedHead}>
                    <View style={styles.closedBadge}>
                      <Ionicons name="checkmark" size={30} color="#15803D" />
                    </View>
                    <Text style={styles.closedTitle}>Shift closed for today</Text>
                    <Text style={styles.closedText}>End Shift is complete. Start again next business day.</Text>
                  </View>
                  {reopenOpen ? (
                    <View style={styles.reopenForm}>
                      <FormField
                        label="Reason"
                        value={reopenReason}
                        onChangeText={setReopenReason}
                        placeholder="Why POS needs to reopen"
                        accentColor={managerColors.royalBlue}
                      />
                      <Text style={styles.note}>The system decides whether a new shift can start.</Text>
                      {reopenError ? <Text style={styles.error}>{reopenError}</Text> : null}
                      <View style={styles.closedActions}>
                        <View style={styles.closedAction}>
                          <ManagerActionButton
                            label="Cancel"
                            variant="secondary"
                            disabled={reopenBusy}
                            onPress={() => {
                              setReopenOpen(false);
                              setReopenError('');
                            }}
                          />
                        </View>
                        <View style={styles.closedAction}>
                          <ManagerActionButton label="Confirm" loading={reopenBusy} disabled={reopenBusy} onPress={submitReopen} />
                        </View>
                      </View>
                    </View>
                  ) : (
                    <View style={styles.reopenRow}>
                      <Text style={styles.reopenQuestion}>Need to sell more today?</Text>
                      <Pressable
                        accessibilityRole="button"
                        hitSlop={10}
                        onPress={() => {
                          setReopenError('');
                          setReopenOpen(true);
                        }}
                      >
                        <Text style={styles.reopenLink}>Reopen POS</Text>
                      </Pressable>
                    </View>
                  )}
                </>
              ) : (
                <>
                  <Text style={styles.noticeTitle}>No Active Shift</Text>
                  <Text style={styles.noticeText}>
                    Start a shift to begin selling and receiving stock.
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
              {showIncomingTile && !sameDayClosedHint ? (
                <>
                  <Text style={styles.sectionTitle}>BRANCH ACTIONS</Text>
                  <Row>{incomingTile}</Row>
                </>
              ) : null}
            </View>
            <ManagerActionButton label="Branch inventory" variant="secondary" onPress={() => router.push('/cashier/inventory' as never)} />
            {sameDayClosedHint && finalizedToday.data !== 'selected' ? <Row>{leftoverReturnTile}</Row> : null}
          </View>
        ) : (
          <View style={styles.content}>
            <View style={styles.row}>
              <StatTile
                style={styles.half}
                emphasis
                icon="cash-outline"
                label="Total sales"
                onPress={() => router.push('/cashier/payment-totals' as never)}
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

            {(
              <View style={styles.endShiftSection}>
                <ManagerActionButton
                  label="End Shift / Remit"
                  icon="stop-circle-outline"
                  variant="secondary"
                  loading={verifying}
                  disabled={busy || pinPrompt}
                  onPress={requestEndShift}
                />
                {pinPrompt && <View style={{gap:12}}>
                  <Text>{BEGIN_CLOSE_CONFIRM_MESSAGE}</Text>
                  <PinField label="Confirm with your PIN" value={credential} onChangeText={setCredential} allowPassword onLegacyChange={setLegacyClose} />
                  <ManagerActionButton label="Confirm End Shift" disabled={legacyClose ? !credential : !/^[0-9]{6}$/.test(credential)} loading={verifying} onPress={() => void confirmEndShift()} />
                  <ManagerActionButton label="Cancel" disabled={verifying} variant="secondary" onPress={() => {setPinPrompt(false);setCredential('');}} />
                </View>}
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
                    icon="basket-outline"
                    accent="gold"
                    title="Branch inventory"
                    onPress={() => router.push('/cashier/inventory' as never)}
                  />
                  {leftoverReturnTile}
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
  closedHead: { alignItems: 'center', gap: 8, paddingTop: 4 },
  closedBadge: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#DCFCE7', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  closedTitle: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 19, textAlign: 'center' },
  closedText: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20, textAlign: 'center' },
  reopenRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderTopWidth: 1,
    borderTopColor: managerColors.cardBorder,
    paddingTop: spacing.md,
  },
  reopenQuestion: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 14 },
  reopenLink: { color: managerColors.royalBlue, fontFamily: 'Inter_700Bold', fontSize: 14 },
  reopenForm: { gap: 10, borderTopWidth: 1, borderTopColor: managerColors.cardBorder, paddingTop: spacing.md },
  closedActions: { flexDirection: 'row', gap: 10 },
  closedAction: { flex: 1 },
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
