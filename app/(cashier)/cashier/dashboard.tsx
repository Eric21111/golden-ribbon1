import Ionicons from '@react-native-vector-icons/ionicons';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { useState } from 'react';
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
import { useCashierPosInventory } from '@/hooks/useInventory';
import { useActiveShift, useEndShift, useShiftSummary, useStartShift } from '@/hooks/useShifts';
import { alertNotice, confirmAction } from '@/lib/confirmAction';
import { getInventoryErrorMessage, getShiftErrorMessage } from '@/lib/errors';
import { formatDate, formatMoney } from '@/lib/format';
import { queryKeys } from '@/lib/queryKeys';
import { listCashierPosInventory } from '@/services/inventoryService';
import { useCartStore } from '@/stores/cartStore';
import type { InventoryItem } from '@/types/models';

function Row({ children }: { children: ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

export default function CashierDashboard() {
  const { profile, retryProfile } = useAuth();
  const queryClient = useQueryClient();
  const cashierId = profile?.id ?? '';
  const shiftQuery = useActiveShift(cashierId);
  const summaryQuery = useShiftSummary(shiftQuery.data?.id ?? '');
  const startMutation = useStartShift(cashierId);
  const endMutation = useEndShift(cashierId);
  const posBranchId = authoritativePosBranchId(shiftQuery.data, profile);
  const inventory = useCashierPosInventory(posBranchId);
  const cartItems = useCartStore((state) => state.items);
  const clearCart = useCartStore((state) => state.clearCart);
  const [checkingStock, setCheckingStock] = useState(false);

  const ensureStockAllowsPos = async (onAllowed: () => void) => {
    setCheckingStock(true);
    try {
      const [shiftResult, profileResult] = await Promise.all([shiftQuery.refetch(), retryProfile()]);
      const branchId = authoritativePosBranchId(shiftResult.data, profileResult.data ?? profile);
      if (!branchId) {
        alertNotice('Cannot open POS', 'No branch is assigned to this cashier.');
        return;
      }

      await queryClient.invalidateQueries({ queryKey: queryKeys.cashierPosInventory(branchId) });
      const rows: InventoryItem[] = await queryClient.fetchQuery({
        queryKey: queryKeys.cashierPosInventory(branchId),
        queryFn: listCashierPosInventory,
        staleTime: 0,
      });

      if (rows.length === 0 || !hasSellableStock(rows)) {
        alertNotice(
          'Cannot open POS',
          rows.length === 0
            ? 'This branch has no active products. Ask a manager to add stock first.'
            : 'All products are out of stock. Restock this branch before starting or opening POS.',
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
    void ensureStockAllowsPos(() =>
      startMutation.mutate(undefined, {
        onSuccess: () => router.replace('/cashier/pos'),
      }),
    );

  const openPos = () => void ensureStockAllowsPos(() => router.push('/cashier/pos'));

  const requestEndShift = () => {
    const shiftId = shiftQuery.data?.id;
    if (!shiftId) return;
    if (cartItems.length > 0) {
      alertNotice('Unfinished cart', 'Remove every item from the cart before ending the shift.');
      return;
    }
    confirmAction('End shift?', 'The end time will be recorded and this shift cannot be reopened.', () =>
      endMutation.mutate(shiftId, {
        onSuccess: (summary) => {
          clearCart();
          alertNotice(
            'Shift Ended',
            `Completed Orders: ${summary.completed_transaction_count}\nTotal Sales: ${formatMoney(summary.total_sales)}`,
          );
        },
      }),
    );
  };

  const refreshing =
    shiftQuery.isRefetching ||
    inventory.isRefetching ||
    (Boolean(shiftQuery.data) && summaryQuery.isRefetching);

  const onRefresh = () => {
    void Promise.all([
      shiftQuery.refetch(),
      inventory.refetch(),
      shiftQuery.data ? summaryQuery.refetch() : Promise.resolve(),
    ]);
  };

  const orders = summaryQuery.data?.completed_transaction_count;
  const salesTotal = summaryQuery.data?.total_sales;
  const cashierName = profile?.full_name ?? 'Cashier';

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
            <Text style={styles.noticeTitle}>No Active Shift</Text>
            <Text style={styles.noticeText}>Start a shift before opening the POS.</Text>
            {startMutation.error ? (
              <Text style={styles.error}>{getShiftErrorMessage(startMutation.error)}</Text>
            ) : null}
            <ManagerActionButton
              label="Start shift"
              icon="play-outline"
              loading={startMutation.isPending || checkingStock}
              onPress={startShift}
            />
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

            <View style={styles.endShiftSection}>
              <ManagerActionButton
                label="End shift"
                icon="stop-circle-outline"
                variant="secondary"
                loading={endMutation.isPending}
                onPress={requestEndShift}
              />
            </View>
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
            {endMutation.error ? (
              <Text style={styles.error}>{getShiftErrorMessage(endMutation.error)}</Text>
            ) : null}

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
            </Row>
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
  },
});
