import { Redirect, router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useQueryClient } from '@tanstack/react-query';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { Screen } from '@/components/Screen';
import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { managerColors } from '@/components/dashboard/theme';
import { spacing } from '@/constants/theme';
import { useAuth } from '@/features/auth/AuthProvider';
import { OrderSummary } from '@/features/pos/OrderSummary';
import { authoritativePosBranchId } from '@/features/pos/posInventory';
import {
  PRICING_PROGRAM_OPTIONS,
  previewOrderTotals,
  pricingProgramLabel,
  type SalePricingProgram,
  type SalePricingProgramSetting,
} from '@/features/pos/pricingPrograms';
import { useActiveShift } from '@/hooks/useShifts';
import { confirmAction } from '@/lib/confirmAction';
import { formatMoney, makeIdempotencyKey } from '@/lib/format';
import { useLayout } from '@/lib/layout';
import { centsDecimal } from '@/lib/money';
import { invalidateCompletedSaleQueries } from '@/lib/queryClient';
import { queryKeys } from '@/lib/queryKeys';
import { listCashierPosInventory } from '@/services/inventoryService';
import { getCashierLineSellingPrices } from '@/services/productService';
import { listSalePricingProgramSettings } from '@/services/saleService';
import { useCartStore } from '@/stores/cartStore';
import { useCheckoutStore } from '@/stores/checkoutStore';

export default function PaymentScreen() {
  const { profile } = useAuth();
  const { paymentMaxWidth } = useLayout();
  const shift = useActiveShift(profile?.id ?? '');
  const items = useCartStore((state) => state.items);
  const checkout = useCheckoutStore();
  const client = useQueryClient();
  const [validation, setValidation] = useState('');
  const [priceNotice, setPriceNotice] = useState('');
  const [pricesReady, setPricesReady] = useState(false);
  const [priceError, setPriceError] = useState('');
  const [priceRefreshKey, setPriceRefreshKey] = useState(0);
  const [stockChecking, setStockChecking] = useState(false);
  const [pricingProgram, setPricingProgram] = useState<SalePricingProgram>('standard');
  const [pricingSettings, setPricingSettings] = useState<Partial<
    Record<SalePricingProgram, SalePricingProgramSetting>
  > | null>(null);

  const totals = useMemo(
    () => previewOrderTotals(items, pricingProgram, pricingSettings),
    [items, pricingProgram, pricingSettings],
  );
  const selectedProgram = PRICING_PROGRAM_OPTIONS.find((option) => option.value === pricingProgram);

  const ensureLiveStockAllowsCheckout = async (): Promise<boolean> => {
    const branchId = authoritativePosBranchId(shift.data, profile);
    if (!branchId) {
      setValidation('No branch is assigned to this cashier.');
      return false;
    }
    setStockChecking(true);
    try {
      await client.invalidateQueries({ queryKey: queryKeys.cashierPosInventory(branchId) });
      const rows = await client.fetchQuery({
        queryKey: queryKeys.cashierPosInventory(branchId),
        queryFn: listCashierPosInventory,
        staleTime: 0,
      });
      const stockByProduct = new Map(rows.map((row) => [row.product.id, Number(row.quantity_on_hand)]));
      const needed = new Map<string, { name: string; qty: number }>();
      for (const line of useCartStore.getState().items) {
        const current = needed.get(line.product_id) ?? { name: line.product_name, qty: 0 };
        current.qty += line.quantity;
        needed.set(line.product_id, current);
      }
      const over: string[] = [];
      for (const [productId, info] of needed) {
        const available = stockByProduct.get(productId) ?? 0;
        if (info.qty > available) {
          over.push(`${info.name} (need ${info.qty}, available ${available})`);
        }
      }
      if (over.length > 0) {
        setValidation(
          `Stock changed. Return to the order and reduce quantities:\n${over.join('\n')}`,
        );
        return false;
      }
      return true;
    } catch {
      setValidation('Unable to refresh live stock. Retry before confirming.');
      return false;
    } finally {
      setStockChecking(false);
    }
  };

  useEffect(() => {
    if (checkout.sale) return;
    let cancelled = false;
    setPricesReady(false);
    setPriceError('');
    void (async () => {
      try {
        const lines = useCartStore.getState().items.map((item) => ({
          product_id: item.product_id,
          variant_id: item.variant_id,
        }));
        const [prices, settings] = await Promise.all([
          getCashierLineSellingPrices(lines),
          listSalePricingProgramSettings(),
        ]);
        if (cancelled) return;
        setPricingSettings(settings);
        const result = useCartStore.getState().applyLivePrices(prices);
        if (result.changed) {
          setPriceNotice(
            `Order total updated from ${formatMoney(result.previousTotalCents / 100)} to ${formatMoney(result.nextTotalCents / 100)}.`,
          );
        }
        setPricesReady(true);
      } catch {
        if (!cancelled) {
          setPriceError('Unable to refresh current product prices. Retry before confirming.');
          setPricesReady(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [checkout.sale, priceRefreshKey]);

  useEffect(() => {
    if (!checkout.sale) return;
    void invalidateCompletedSaleQueries(client);
  }, [checkout.sale, client]);

  const runSubmit = () => {
    if (!shift.data || checkout.pending || !pricesReady || stockChecking) return;
    if (checkout.request) {
      void checkout.submit(checkout.request);
      return;
    }
    const liveItems = useCartStore.getState().items;
    if (liveItems.length === 0) {
      setValidation('Cart is empty after stock adjustment. Return to POS and rebuild the order.');
      return;
    }
    const charged = previewOrderTotals(liveItems, pricingProgram, pricingSettings).chargedTotal;
    setValidation('');
    void checkout.submit({
      shiftId: shift.data.id,
      amountPaid: centsDecimal(Math.round(charged * 100)),
      key: makeIdempotencyKey('sale'),
      pricingProgram,
      items: liveItems.map(({ product_id, variant_id, quantity }) => ({ product_id, variant_id, quantity })),
    });
  };

  const submit = () => {
    if (!shift.data || checkout.pending || !pricesReady || stockChecking) return;
    if (checkout.request) {
      runSubmit();
      return;
    }
    setValidation('');
    void (async () => {
      const stockOk = await ensureLiveStockAllowsCheckout();
      if (!stockOk) return;
      const liveTotals = previewOrderTotals(
        useCartStore.getState().items,
        pricingProgram,
        pricingSettings,
      );
      const programName = pricingProgramLabel(pricingProgram);
      confirmAction(
        'Checkout order?',
        `${programName}\nCharge ${formatMoney(liveTotals.chargedTotal)}. Stock will be deducted.`,
        runSubmit,
      );
    })();
  };

  const done = () => {
    useCartStore.getState().clearCart();
    checkout.reset();
    void invalidateCompletedSaleQueries(client);
    router.replace('/cashier/pos');
  };

  if (shift.isLoading) return <LoadingState />;
  if (shift.error) {
    return (
      <Screen backgroundColor="#FFFFFF">
        <ErrorState message="Unable to verify your shift." onRetry={() => void shift.refetch()} />
      </Screen>
    );
  }
  if (!shift.data && !checkout.sale) return <Redirect href="/cashier/dashboard" />;
  if (!items.length && !checkout.sale && !checkout.request) {
    return <Redirect href="/cashier/pos" />;
  }

  const canConfirm = pricesReady && !priceError && !stockChecking;

  return (
    <Screen backgroundColor="#FFFFFF" edges={['top']} scroll={false} contentContainerStyle={styles.screen}>
      <ConstrainedWidth maxWidth={paymentMaxWidth} fill>
        <View style={styles.layout}>
          <ManagerScreenHeader title="Order Summary" showBack />
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            {!pricesReady && !priceError && !checkout.sale ? (
              <LoadingState label="Refreshing current prices…" />
            ) : null}
            {priceError && !checkout.sale ? (
              <ErrorState
                message={priceError}
                onRetry={() => setPriceRefreshKey((key) => key + 1)}
              />
            ) : null}
            <OrderSummary items={items} />

            {!checkout.sale ? (
              <View style={styles.programBlock}>
                <Text style={styles.programTitle}>Pricing</Text>
                <View style={styles.programList}>
                  {PRICING_PROGRAM_OPTIONS.map((option) => {
                    const selected = option.value === pricingProgram;
                    return (
                      <Pressable
                        key={option.value}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        accessibilityLabel={option.label}
                        disabled={Boolean(checkout.request)}
                        onPress={() => setPricingProgram(option.value)}
                        style={({ pressed }) => [
                          styles.programOption,
                          selected && styles.programOptionSelected,
                          pressed && styles.pressed,
                        ]}
                      >
                        <Text style={[styles.programLabel, selected && styles.programLabelSelected]}>
                          {option.label}
                        </Text>
                        <Text style={styles.programHint}>{option.hint}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                {selectedProgram ? (
                  <Text style={styles.programNote}>{selectedProgram.hint}</Text>
                ) : null}
              </View>
            ) : null}

            <View style={styles.totalsCard}>
              <View style={styles.totalsRow}>
                <Text style={styles.totalsLabel}>Catalog</Text>
                <Text style={styles.totalsValue}>{formatMoney(totals.catalogSubtotal)}</Text>
              </View>
              {totals.discountAmount > 0 || pricingProgram === 'employee_meal' ? (
                <View style={styles.totalsRow}>
                  <Text style={styles.totalsLabel}>
                    {pricingProgram === 'employee_meal' ? 'Employee meal' : 'Discount'}
                  </Text>
                  <Text style={styles.totalsValue}>
                    −{formatMoney(
                      pricingProgram === 'employee_meal'
                        ? totals.catalogSubtotal
                        : totals.discountAmount,
                    )}
                  </Text>
                </View>
              ) : null}
              <View style={styles.totalsRow}>
                <Text style={styles.totalsChargeLabel}>Charge</Text>
                <Text style={styles.totalsCharge}>{formatMoney(totals.chargedTotal)}</Text>
              </View>
            </View>

            {priceNotice ? (
              <Text accessibilityRole="alert" style={styles.notice}>
                {priceNotice}
              </Text>
            ) : null}
            {validation || checkout.error ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {validation || checkout.error}
              </Text>
            ) : null}
          </ScrollView>

          <View style={styles.footer}>
            <ManagerActionButton
              label={checkout.request ? 'Retry checkout' : 'Checkout'}
              icon="card-outline"
              loading={checkout.pending || stockChecking}
              disabled={!canConfirm}
              onPress={submit}
            />
            <ManagerActionButton
              label="Back to order"
              variant="secondary"
              disabled={checkout.pending || Boolean(checkout.request)}
              onPress={() => router.replace('/cashier/pos')}
            />
          </View>
        </View>
      </ConstrainedWidth>

      <Modal visible={Boolean(checkout.sale)} transparent animationType="fade" onRequestClose={() => {}}>
        <View style={styles.overlay}>
          <View style={styles.card}>
            <Text style={styles.title}>ORDER CONFIRMED</Text>
            <Text style={styles.cardLine}>Sale: {checkout.sale?.sale_number}</Text>
            <Text style={styles.cardLine}>
              Pricing: {pricingProgramLabel(checkout.sale?.pricing_program ?? pricingProgram)}
            </Text>
            <Text style={styles.cardLine}>Total: {formatMoney(checkout.sale?.total_amount ?? 0)}</Text>
            <ManagerActionButton label="Done" onPress={done} />
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { flexGrow: 1, padding: 0, gap: 0 },
  layout: { flex: 1, minHeight: 0 },
  scroll: { flex: 1, minHeight: 0 },
  scrollContent: {
    padding: 20,
    gap: spacing.md,
    flexGrow: 1,
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: managerColors.cardBorder,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  programBlock: { gap: 10 },
  programTitle: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 15 },
  programList: { gap: 8 },
  programOption: {
    borderWidth: 1.5,
    borderColor: managerColors.cardBorder,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 4,
    backgroundColor: '#FFFFFF',
  },
  programOptionSelected: { borderColor: managerColors.royalBlue, backgroundColor: '#F7F9FD' },
  programLabel: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  programLabelSelected: { color: managerColors.royalBlue },
  programHint: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 17 },
  programNote: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 17 },
  totalsCard: {
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 14,
    padding: 14,
    gap: 8,
    backgroundColor: managerColors.cardSurface,
  },
  totalsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  totalsLabel: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 14 },
  totalsValue: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  totalsChargeLabel: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 15 },
  totalsCharge: { color: managerColors.royalBlue, fontFamily: 'Inter_700Bold', fontSize: 20 },
  error: { color: '#B91C1C', fontFamily: 'Inter_500Medium', fontSize: 14, lineHeight: 20 },
  notice: {
    color: '#92400E',
    backgroundColor: '#FEF3C7',
    borderRadius: 12,
    padding: spacing.sm,
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    lineHeight: 20,
  },
  pressed: { opacity: 0.75 },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(10, 18, 36, 0.6)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: spacing.lg,
    gap: 10,
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
  },
  title: { fontFamily: 'Inter_700Bold', fontSize: 18, color: managerColors.royalBlue, letterSpacing: 0.4 },
  cardLine: { fontFamily: 'Inter_500Medium', fontSize: 15, color: managerColors.ink },
});
