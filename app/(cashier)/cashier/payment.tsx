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

import { AppButton } from '@/components/AppButton';
import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { ErrorState, LoadingState } from '@/components/Feedback';
import { FormField } from '@/components/FormField';
import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';
import { colors, radius, spacing } from '@/constants/theme';
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
      <Screen>
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
    <Screen scroll={false} contentContainerStyle={styles.screen}>
      <ConstrainedWidth maxWidth={paymentMaxWidth} fill>
        <View style={styles.layout}>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            <PageHeader title="Checkout" subtitle="Review the order and collect payment." />
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
            <AppButton
              label={checkout.request ? 'RETRY CONFIRMATION' : 'CONFIRM SALE'}
              loading={checkout.pending}
              disabled={!canConfirm}
              onPress={submit}
            />
            <AppButton
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
            <Text>Sale: {checkout.sale?.sale_number}</Text>
            <Text>Total: {formatMoney(checkout.sale?.total_amount ?? 0)}</Text>
            <Text>Money Given: {formatMoney(checkout.sale?.amount_paid ?? 0)}</Text>
            <Text style={styles.title}>CHANGE</Text>
            <Text style={styles.change}>{formatMoney(checkout.sale?.change_amount ?? 0)}</Text>
            <AppButton label="DONE" onPress={done} />
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
    padding: spacing.md,
    gap: spacing.md,
    flexGrow: 1,
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  error: { color: colors.danger, fontSize: 14, lineHeight: 20 },
  hint: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  notice: {
    color: '#92400E',
    backgroundColor: colors.warningSurface,
    borderRadius: radius.sm,
    padding: spacing.sm,
    fontSize: 14,
    lineHeight: 20,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
  },
  title: { fontSize: 20, fontWeight: '800', color: colors.primary },
  change: { fontSize: 44, fontWeight: '900', color: colors.success },
});
