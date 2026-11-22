import { paymentLabel, type PaymentMethod } from '@/features/sales/paymentMethods';
import Ionicons from '@react-native-vector-icons/ionicons';
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
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { Screen } from '@/components/Screen';
import { SignOutButton } from '@/components/SignOutButton';
import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { SummaryCard } from '@/components/dashboard/SummaryCard';
import { ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { managerColors } from '@/components/dashboard/theme';
import { spacing } from '@/constants/theme';
import { useAuth } from '@/features/auth/AuthProvider';
import { OrderSummary } from '@/features/pos/OrderSummary';
import { authoritativePosBranchId } from '@/features/pos/posInventory';
import { buildStockContext, findShortages } from '@/features/pos/posAvailability';
import {
  PRICING_PROGRAM_OPTIONS,
  previewOrderTotals,
  pricingProgramLabel,
  type SalePricingProgram,
  type SalePricingProgramSetting,
} from '@/features/pos/pricingPrograms';
import { useActiveShift } from '@/hooks/useShifts';
import { confirmAction } from '@/lib/confirmAction';
import { getErrorMessage, getInventoryErrorMessage } from '@/lib/errors';
import { formatMoney, makeIdempotencyKey } from '@/lib/format';
import { useLayout } from '@/lib/layout';
import { centsDecimal } from '@/lib/money';
import { invalidateCompletedSaleQueries } from '@/lib/queryClient';
import { queryKeys } from '@/lib/queryKeys';
import { listCashierPosInventory } from '@/services/inventoryService';
import { getCashierLineSellingPrices } from '@/services/productService';
import { listCashierProductCategories } from '@/services/inventoryService';
import { listSalePricingProgramSettings } from '@/services/saleService';
import { useCartStore } from '@/stores/cartStore';
import { useCheckoutStore } from '@/stores/checkoutStore';

const PAYMENT_CHOICES: Array<{ value: PaymentMethod; label: string; icon: 'cash-outline' | 'phone-portrait-outline' }> = [
  { value: 'cash', label: 'Cash', icon: 'cash-outline' },
  { value: 'gcash', label: 'GCash', icon: 'phone-portrait-outline' },
];

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
  // A saved (retryable) request is resent unchanged, so the screen must show the program it carries.
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [pricingProgram, setPricingProgram] = useState<SalePricingProgram>(
    checkout.request?.pricingProgram ?? 'standard',
  );
  const [pricingSettings, setPricingSettings] = useState<Partial<
    Record<SalePricingProgram, SalePricingProgramSetting>
  > | null>(null);
  const [pricingProgramsUnavailable, setPricingProgramsUnavailable] = useState(false);
  const savedProgram = checkout.request?.pricingProgram;
  // The request stays in the store after a sale is confirmed (it is what Done clears), so "a saved checkout waiting for a retry" is
  // request WITHOUT sale. Everything on the screen behind the confirmation uses this, never `checkout.request` alone.
  const awaitingRetry = Boolean(checkout.request) && !checkout.sale;
  useEffect(() => {
    if (savedProgram) setPricingProgram(savedProgram);
  }, [savedProgram]);

  // the same read-only category lookup the POS uses, for the icon on each line (without it the lines just show the plain icon)
  const categories = useQuery({ queryKey: ['cashier-product-categories'], queryFn: listCashierProductCategories, staleTime: 5 * 60 * 1000 });

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
      // Counts shared ingredient stock across every line (Egg, Rice, ...). Products without a recipe are checked
      // against their own stock exactly as before. confirm_sale remains the final authority.
      const over = findShortages(buildStockContext(rows), useCartStore.getState().items).map(
        (shortage) => `${shortage.name} (need ${shortage.needed}, available ${shortage.available})`,
      );
      if (over.length > 0) {
        setValidation(
          `Stock changed. Return to the order and reduce quantities:\n${over.join('\n')}`,
        );
        return false;
      }
      return true;
    } catch (error) {
      setValidation(getInventoryErrorMessage(error));
      return false;
    } finally {
      setStockChecking(false);
    }
  };

  useEffect(() => {
    if (checkout.sale || checkout.request) return;
    let cancelled = false;
    setPricesReady(false);
    setPriceError('');
    void (async () => {
      try {
        const lines = useCartStore.getState().items.map((item) => ({
          product_id: item.product_id,
          variant_id: item.variant_id,
        }));
        const prices = await getCashierLineSellingPrices(lines);
        let settings = null;
        let programsUnavailable = false;
        try {
          settings = await listSalePricingProgramSettings();
        } catch (error) {
          settings = null;
          const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
          const message = error instanceof Error ? error.message : '';
          programsUnavailable = code === 'PGRST205' || /could not find the table|sale_pricing_program_settings/i.test(message);
        }
        if (cancelled) return;
        setPricingProgramsUnavailable(programsUnavailable);
        if (programsUnavailable) setPricingProgram('standard');
        setPricingSettings(settings);
        const result = useCartStore.getState().applyLivePrices(prices);
        if (result.changed) {
          setPriceNotice(
            `Order total updated from ${formatMoney(result.previousTotalCents / 100)} to ${formatMoney(result.nextTotalCents / 100)}.`,
          );
        }
        setPricesReady(true);
      } catch (error) {
        if (!cancelled) {
          const mapped = getErrorMessage(error);
          const raw = error instanceof Error ? error.message.trim() : '';
          setPriceError(
            mapped !== 'Something went wrong. Please try again.'
              ? mapped
              : raw && raw.length < 240
                ? raw
                : 'Unable to refresh current product prices. Retry before confirming.',
          );
          setPricesReady(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [checkout.sale, checkout.request, priceRefreshKey]);

  useEffect(() => {
    if (!checkout.sale) return;
    void invalidateCompletedSaleQueries(client);
  }, [checkout.sale, client]);

  const runSubmit = () => {
    if (checkout.pending || stockChecking || checkout.sale) return;
    if (checkout.request) {
      void checkout.submit(checkout.request);
      return;
    }
    if (!shift.data || !pricesReady) return;
    if (pricingProgram === 'back_office_guard' && (!categories.data || categories.error)) {
      setValidation('Reloading product categories. Check the discount and try again.');
      void categories.refetch();
      return;
    }
    const liveItems = useCartStore.getState().items;
    if (liveItems.length === 0) {
      setValidation('Cart is empty after stock adjustment. Return to POS and rebuild the order.');
      return;
    }
    const charged = previewOrderTotals(liveItems, pricingProgram, pricingSettings, categories.data).chargedTotal;
    setValidation('');
    void checkout.submit({
      shiftId: shift.data.id,
      paymentMethod,
      amountPaid: centsDecimal(Math.round(charged * 100)),
      key: makeIdempotencyKey('sale'),
      pricingProgram,
      // a meal sold with a drink carries the drink chosen; every other line is sent exactly as before
      items: liveItems.map(({ product_id, variant_id, quantity, drink_product_id }) => ({
        product_id,
        variant_id,
        quantity,
        ...(drink_product_id ? { drink_product_id } : {}),
      })),
    }, liveItems);
  };

  const submit = () => {
    if (checkout.pending || stockChecking || checkout.sale) return;
    if (checkout.request) {
      runSubmit();
      return;
    }
    if (!shift.data || !pricesReady) return;
    if (pricingProgram === 'back_office_guard' && (!categories.data || categories.error)) {
      setValidation('Reloading product categories. Check the discount and try again.');
      void categories.refetch();
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
        categories.data,
      );
      const programName = pricingProgramLabel(pricingProgram);
      confirmAction(
        'Checkout order?',
        `${paymentLabel(paymentMethod)} · ${programName}\nCharge ${formatMoney(liveTotals.chargedTotal)}. Stock will be deducted.`,
        runSubmit,
        { confirm: 'Checkout', tone: 'info' },
      );
    })();
  };

  const done = (viewSale = false) => {
    const saleId = checkout.sale?.id;
    if (!checkout.reset()) return;
    useCartStore.getState().clearCart();
    void invalidateCompletedSaleQueries(client);
    router.replace(viewSale && saleId ? `/cashier/sales/${saleId}` : '/cashier/pos');
  };

  if (checkout.recoveryError) return (
    <Screen>
      <ErrorState message={checkout.error} onRetry={() => checkout.activateUser(profile?.id ?? null)} />
      <SignOutButton />
    </Screen>
  );
  if (shift.isLoading && !checkout.request && !checkout.sale) return <LoadingState />;
  if (shift.error && !checkout.request && !checkout.sale) {
    return (
      <Screen backgroundColor="#FFFFFF">
        <ErrorState message="Unable to verify your shift." onRetry={() => void shift.refetch()} />
      </Screen>
    );
  }
  if (!shift.data && !checkout.sale && !checkout.request) return <Redirect href="/cashier/dashboard" />;
  if (!items.length && !checkout.sale && !checkout.request) {
    return <Redirect href="/cashier/pos" />;
  }

  // the program of the saved sale; if the record does not say, the one on the saved request (never today's screen choice)
  const confirmedProgram = checkout.sale?.pricing_program ?? checkout.request?.pricingProgram ?? 'standard';
  const canConfirm = !checkout.sale && (Boolean(checkout.request) || (pricesReady && !priceError && !stockChecking));

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
            {!pricesReady && !priceError && !checkout.sale && !checkout.request ? (
              <LoadingState label="Refreshing current prices…" />
            ) : null}
            {priceError && !checkout.sale && !checkout.request ? (
              <ErrorState
                message={priceError}
                onRetry={() => setPriceRefreshKey((key) => key + 1)}
              />
            ) : null}
            {awaitingRetry && checkout.request ? (
              <View>
                <Text style={styles.cardLine}>Saved checkout · {checkout.request.items.reduce((total, item) => total + item.quantity, 0)} items</Text>
                <Text style={styles.cardLine}>Method: {paymentLabel(checkout.request.paymentMethod)}</Text>
                <Text style={styles.cardLine}>Original payment: {formatMoney(Number(checkout.request.amountPaid))}</Text>
                {checkout.items.map((item, index) => (
                  <Text key={index} style={styles.cardLineMuted}>
                    {item.quantity} × {item.product_name}{item.variant_name ? ` · ${item.variant_name}` : ''}{item.drink_name ? ` · ${item.drink_name}` : ''}
                  </Text>
                ))}
                <Text style={styles.cardLineMuted}>Retry checks this same order with its original quantities and payment.</Text>
              </View>
            ) : <OrderSummary items={items} program={pricingProgram} settings={pricingSettings} categoryByProductId={categories.data} />}
            {!checkout.request && !checkout.sale ? <View style={{gap:8}}>
              <Text style={styles.sectionHeading}>PAYMENT METHOD</Text>
              <View style={styles.methodRow}>
                {PAYMENT_CHOICES.map((choice) => {
                  const selected = choice.value === paymentMethod;
                  return (
                    <Pressable
                      key={choice.value}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      accessibilityLabel={choice.label}
                      onPress={() => setPaymentMethod(choice.value)}
                      style={({ pressed }) => [styles.methodCard, selected && styles.methodCardSelected, pressed && styles.pressed]}
                    >
                      <View style={[styles.methodIcon, selected && styles.methodIconSelected]}>
                        <Ionicons name={choice.icon} size={20} color={selected ? '#FFFFFF' : managerColors.royalBlue} />
                      </View>
                      <Text style={[styles.methodLabel, selected && styles.methodLabelSelected]}>{choice.label}</Text>
                      {selected ? (
                        <View style={styles.methodCheck}>
                          <Ionicons name="checkmark" size={13} color="#FFFFFF" />
                        </View>
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            </View> : null}

            {!checkout.sale ? (
              <View style={styles.programBlock}>
                <Text style={styles.sectionHeading}>PRICING</Text>
                <View style={styles.programList}>
                  {PRICING_PROGRAM_OPTIONS.map((option) => {
                    const selected = option.value === pricingProgram;
                    const unavailable = pricingProgramsUnavailable && option.value !== 'standard';
                    return (
                      <Pressable
                        key={option.value}
                        accessibilityRole="button"
                        accessibilityState={{ selected, disabled: unavailable || Boolean(checkout.request) }}
                        accessibilityLabel={option.label}
                        disabled={unavailable || Boolean(checkout.request)}
                        onPress={() => setPricingProgram(option.value)}
                        style={({ pressed }) => [
                          styles.programPill,
                          selected && styles.programPillSelected,
                          (unavailable || Boolean(checkout.request)) && !selected && styles.programPillOff,
                          pressed && styles.pressed,
                        ]}
                      >
                        <Text style={[styles.programLabel, selected && styles.programLabelSelected]}>{option.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                {pricingProgramsUnavailable ? (
                  <Text style={styles.programNote}>
                    Discounts are unavailable until the pending database update is applied. Standard price still checks out.
                  </Text>
                ) : null}
              </View>
            ) : null}

            {priceNotice ? (
              <Text accessibilityRole="alert" style={styles.notice}>
                {priceNotice}
              </Text>
            ) : null}
            {!checkout.sale && (validation || checkout.error) ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {validation || checkout.error}
              </Text>
            ) : null}
            {awaitingRetry && checkout.error && !checkout.pending ? (
              <View>
                <Text style={styles.cardLineMuted}>Signing out keeps this checkout saved for this account.</Text>
                <SignOutButton />
              </View>
            ) : null}
            {validation && !checkout.request && !checkout.sale ? <ManagerActionButton label="View branch inventory" variant="secondary" onPress={() => router.push('/cashier/inventory' as never)} /> : null}
          </ScrollView>

          <View style={styles.footer}>
            <View style={styles.footerButton}>
              <ManagerActionButton
                label="Back"
                variant="secondary"
                disabled={checkout.pending || awaitingRetry}
                onPress={() => router.replace('/cashier/pos')}
              />
            </View>
            <View style={styles.footerButton}>
              <ManagerActionButton
                label={awaitingRetry ? 'Retry' : 'Checkout'}
                icon="card-outline"
                loading={checkout.pending || stockChecking}
                disabled={!canConfirm}
                onPress={submit}
              />
            </View>
          </View>
        </View>
      </ConstrainedWidth>

      <Modal visible={Boolean(checkout.sale)} transparent animationType="fade" onRequestClose={() => {}}>
        <View style={styles.overlay}>
          <View style={styles.card}>
            <View style={styles.successBadge}>
              <Ionicons name="checkmark" size={28} color="#15803D" />
            </View>
            <Text style={styles.title}>Order confirmed</Text>
            <Text style={styles.confirmedTotal}>{formatMoney(checkout.sale?.total_amount ?? 0)}</Text>
            {/* what the saved sale record says: its number, its payment method and its pricing program */}
            <View style={styles.confirmedDetails}>
              <SummaryCard
                rows={[
                  { label: 'Sale', value: checkout.sale?.sale_number ?? '—', icon: 'receipt-outline' },
                  { label: 'Payment', value: paymentLabel(checkout.sale?.payment_method), icon: 'wallet-outline' },
                  { label: 'Pricing', value: pricingProgramLabel(confirmedProgram), icon: 'pricetag-outline' },
                ]}
              />
            </View>
            {checkout.error ? <Text style={styles.cardLine}>{checkout.error}</Text> : null}
            <View style={styles.confirmedAction}>
              <View style={styles.confirmedButton}>
                <ManagerActionButton label="View sale" variant="secondary" onPress={() => done(true)} />
              </View>
              <View style={styles.confirmedButton}>
                <ManagerActionButton label="Done" onPress={() => done()} />
              </View>
            </View>
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
    flexDirection: 'row',
    gap: 10,
  },
  footerButton: { flex: 1 },
  // Cash / GCash: two equal compact cards, the icon beside the name; the chosen one is outlined in blue with a check
  methodRow: { flexDirection: 'row', gap: 10 },
  methodCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 56,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1.5,
    borderColor: managerColors.cardBorder,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
  },
  methodCardSelected: { borderColor: managerColors.royalBlue, backgroundColor: '#F3F7FE' },
  methodIcon: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: '#EAF0FB' },
  methodIconSelected: { backgroundColor: managerColors.royalBlue },
  methodLabel: { flex: 1, minWidth: 0, color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  methodLabelSelected: { color: managerColors.royalBlue, fontFamily: 'Inter_700Bold' },
  methodCheck: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: managerColors.royalBlue,
  },
  programBlock: { gap: 10 },
  // small gray capitals on the left, like the section headings of the report screens
  sectionHeading: { color: managerColors.subtext, fontFamily: 'Inter_600SemiBold', fontSize: 12, letterSpacing: 0.8 },
  // pricing: two equal columns of selectable cards (like Cash / GCash above)
  programList: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  programPill: {
    flexGrow: 1,
    flexBasis: '47%',
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: managerColors.cardBorder,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
  },
  programPillSelected: { borderColor: managerColors.royalBlue, backgroundColor: '#F3F7FE' },
  programPillOff: { opacity: 0.5 },
  programLabel: { textAlign: 'center', color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  programLabelSelected: { color: managerColors.royalBlue },
  programNote: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18 },
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
    borderRadius: 24,
    paddingHorizontal: 22,
    paddingTop: 24,
    paddingBottom: 20,
    gap: 8,
    width: '100%',
    maxWidth: 400,
    alignSelf: 'center',
    alignItems: 'center',
  },
  title: { fontFamily: 'Inter_700Bold', fontSize: 18, color: managerColors.ink, textAlign: 'center' },
  successBadge: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#DCFCE7', alignItems: 'center', justifyContent: 'center' },
  confirmedTotal: { fontFamily: 'Inter_700Bold', fontSize: 30, color: managerColors.royalBlue, textAlign: 'center' },
  cardLine: { fontFamily: 'Inter_500Medium', fontSize: 14, color: managerColors.subtext, textAlign: 'center' },
  cardLineMuted: { fontFamily: 'Inter_500Medium', fontSize: 13, color: managerColors.subtext, textAlign: 'center' },
  confirmedDetails: { alignSelf: 'stretch', marginTop: 4 },
  confirmedAction: { alignSelf: 'stretch', flexDirection: 'row', gap: 10, marginTop: 8 },
  confirmedButton: { flex: 1, minWidth: 0 },
});
