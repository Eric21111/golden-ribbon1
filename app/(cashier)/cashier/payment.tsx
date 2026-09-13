import { Redirect, router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useQueryClient } from '@tanstack/react-query';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { FormField } from '@/components/FormField';
import { Screen } from '@/components/Screen';
import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { managerColors } from '@/components/dashboard/theme';
import { spacing } from '@/constants/theme';
import { useAuth } from '@/features/auth/AuthProvider';
import { OrderSummary } from '@/features/pos/OrderSummary';
import { useActiveShift } from '@/hooks/useShifts';
import { confirmAction } from '@/lib/confirmAction';
import { formatMoney, makeIdempotencyKey } from '@/lib/format';
import { useLayout } from '@/lib/layout';
import { cartTotalCents, centsDecimal, toCents } from '@/lib/money';
import { invalidateCompletedSaleQueries } from '@/lib/queryClient';
import { getProductSellingPrices } from '@/services/productService';
import { useCartStore } from '@/stores/cartStore';
import { useCheckoutStore } from '@/stores/checkoutStore';

export default function PaymentScreen() {
  const { profile } = useAuth();
  const { paymentMaxWidth } = useLayout();
  const shift = useActiveShift(profile?.id ?? '');
  const items = useCartStore((state) => state.items);
  const checkout = useCheckoutStore();
  const client = useQueryClient();
  const [paid, setPaid] = useState('');
  const [validation, setValidation] = useState('');
  const [priceNotice, setPriceNotice] = useState('');
  const [pricesReady, setPricesReady] = useState(false);
  const [priceError, setPriceError] = useState('');
  const [priceRefreshKey, setPriceRefreshKey] = useState(0);
  const total = cartTotalCents(items);

  useEffect(() => {
    if (checkout.sale) return;
    let cancelled = false;
    setPricesReady(false);
    setPriceError('');
    void (async () => {
      try {
        const ids = useCartStore.getState().items.map((item) => item.product_id);
        const prices = await getProductSellingPrices(ids);
        if (cancelled) return;
        const result = useCartStore.getState().applyLivePrices(prices);
        if (result.changed) {
          setPriceNotice(
            `Order total updated from ${formatMoney(result.previousTotalCents / 100)} to ${formatMoney(result.nextTotalCents / 100)}. Collect the new amount before confirming.`,
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
    if (!shift.data || checkout.pending || !pricesReady) return;
    if (checkout.request) {
      void checkout.submit(checkout.request);
      return;
    }
    try {
      const cents = toCents(paid);
      if (cents < total) {
        setValidation(`Insufficient payment. Remaining: ${formatMoney((total - cents) / 100)}`);
        return;
      }
      setValidation('');
      void checkout.submit({
        shiftId: shift.data.id,
        amountPaid: centsDecimal(cents),
        key: makeIdempotencyKey('sale'),
        items: items.map(({ product_id, quantity }) => ({ product_id, quantity })),
      });
    } catch (error) {
      setValidation(error instanceof Error ? error.message : 'Enter a valid payment.');
    }
  };

  const submit = () => {
    if (!shift.data || checkout.pending || !pricesReady) return;
    if (checkout.request) {
      runSubmit();
      return;
    }
    try {
      const cents = toCents(paid);
      if (cents < total) {
        setValidation(`Insufficient payment. Remaining: ${formatMoney((total - cents) / 100)}`);
        return;
      }
      setValidation('');
      const change = cents - total;
      confirmAction(
        'Confirm sale?',
        `Total ${formatMoney(total / 100)} · Money given ${formatMoney(cents / 100)} · Change ${formatMoney(change / 100)}. Stock will be deducted.`,
        runSubmit,
      );
    } catch (error) {
      setValidation(error instanceof Error ? error.message : 'Enter a valid payment.');
    }
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

  const canConfirm = pricesReady && !priceError;

  return (
    <Screen backgroundColor="#FFFFFF" scroll={false} contentContainerStyle={styles.screen}>
      <ConstrainedWidth maxWidth={paymentMaxWidth} fill>
        <View style={styles.layout}>
          <ManagerScreenHeader title="Checkout" showBack />
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
            {priceNotice ? (
              <Text accessibilityRole="alert" style={styles.notice}>
                {priceNotice}
              </Text>
            ) : null}
            <FormField
              label="Money Given"
              keyboardType="decimal-pad"
              value={checkout.request?.amountPaid ?? paid}
              editable={!checkout.request && !checkout.pending && pricesReady}
              onChangeText={setPaid}
              labelStyle={styles.fieldLabel}
              style={styles.fieldInput}
              accentColor={managerColors.royalBlue}
            />
            <Text style={styles.hint}>
              Final prices and available stock are checked when you confirm. Displayed prices are
              refreshed from the server before payment.
            </Text>
            {validation || checkout.error ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {validation || checkout.error}
              </Text>
            ) : null}
          </ScrollView>

          <View style={styles.footer}>
            <ManagerActionButton
              label={checkout.request ? 'Retry confirmation' : 'Confirm sale'}
              icon="checkmark-circle-outline"
              loading={checkout.pending}
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
            <Text style={styles.title}>SALE SUCCESSFUL</Text>
            <Text style={styles.cardLine}>Sale: {checkout.sale?.sale_number}</Text>
            <Text style={styles.cardLine}>Total: {formatMoney(checkout.sale?.total_amount ?? 0)}</Text>
            <Text style={styles.cardLine}>Money Given: {formatMoney(checkout.sale?.amount_paid ?? 0)}</Text>
            <Text style={styles.changeLabel}>CHANGE</Text>
            <Text style={styles.change}>{formatMoney(checkout.sale?.change_amount ?? 0)}</Text>
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
  error: { color: '#B91C1C', fontFamily: 'Inter_500Medium', fontSize: 14, lineHeight: 20 },
  hint: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19 },
  notice: {
    color: '#92400E',
    backgroundColor: '#FEF3C7',
    borderRadius: 12,
    padding: spacing.sm,
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    lineHeight: 20,
  },
  fieldLabel: { fontFamily: 'Inter_600SemiBold', color: managerColors.ink },
  fieldInput: { fontFamily: 'Inter_400Regular' },
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
  changeLabel: {
    fontFamily: 'Inter_700Bold',
    fontSize: 13,
    color: managerColors.subtext,
    letterSpacing: 0.8,
    marginTop: 6,
  },
  change: { fontFamily: 'Inter_700Bold', fontSize: 40, color: managerColors.royalBlue },
});
