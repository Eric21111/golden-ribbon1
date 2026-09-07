import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { AppButton } from '@/components/AppButton';
import { FormField } from '@/components/FormField';
import { LoadingState, ErrorState } from '@/components/Feedback';
import { Screen } from '@/components/Screen';
import { PageHeader } from '@/components/PageHeader';
import { useAuth } from '@/features/auth/AuthProvider';
import { OrderSummary } from '@/features/pos/OrderSummary';
import { useActiveShift } from '@/hooks/useShifts';
import { useCartStore } from '@/stores/cartStore';
import { useCheckoutStore } from '@/stores/checkoutStore';
import { cartTotalCents, centsDecimal, toCents } from '@/lib/money';
import { formatMoney, makeIdempotencyKey } from '@/lib/format';
import { colors, spacing, radius } from '@/constants/theme';

export default function PaymentScreen() {
  const { profile } = useAuth();
  const shift = useActiveShift(profile?.id ?? '');
  const items = useCartStore((state) => state.items);
  const checkout = useCheckoutStore();
  const client = useQueryClient();
  const [paid, setPaid] = useState('');
  const [validation, setValidation] = useState('');
  const total = cartTotalCents(items);
  const submit = () => {
    if (!shift.data || checkout.pending) return;
    if (checkout.request) { void checkout.submit(checkout.request); return; }
    try {
      const cents = toCents(paid);
      if (cents < total) { setValidation(`Insufficient payment. Remaining: ${formatMoney((total-cents)/100)}`); return; }
      setValidation('');
      void checkout.submit({ shiftId: shift.data.id, amountPaid: centsDecimal(cents),
        key: makeIdempotencyKey('sale'), items: items.map(({ product_id, quantity }) => ({ product_id, quantity })) });
    } catch (error) { setValidation(error instanceof Error ? error.message : 'Enter a valid payment.'); }
  };
  const done = () => {
    useCartStore.getState().clearCart();
    checkout.reset();
    void client.invalidateQueries({ queryKey: ['inventory'] });
    void client.invalidateQueries({ queryKey: ['inventory-movements'] });
    void client.invalidateQueries({ queryKey: ['shift-sales'] });
    router.replace('/cashier/pos');
  };
  if (shift.isLoading) return <LoadingState />;
  if (shift.error) return <Screen><ErrorState message="Unable to verify your shift." onRetry={() => void shift.refetch()} /></Screen>;
  if (!shift.data && !checkout.sale) return <Redirect href="/cashier/dashboard" />;
  if (!items.length && !checkout.sale && !checkout.request) return <Redirect href="/cashier/pos" />;
  return <Screen>
    <PageHeader title="Checkout" subtitle="Review the order and collect payment." />
    <OrderSummary items={items} />
    <FormField label="Money Given" keyboardType="decimal-pad" value={checkout.request?.amountPaid ?? paid}
      editable={!checkout.request && !checkout.pending} onChangeText={setPaid} />
    <Text>Final prices and available stock are checked when you confirm.</Text>
    {validation || checkout.error ? <Text accessibilityRole="alert" style={styles.error}>{validation || checkout.error}</Text> : null}
    <AppButton label={checkout.request ? 'RETRY CONFIRMATION' : 'CONFIRM SALE'} loading={checkout.pending} onPress={submit} />
    <AppButton label="Back to order" variant="secondary" disabled={checkout.pending || !!checkout.request} onPress={() => router.replace('/cashier/pos')} />
    <Modal visible={!!checkout.sale} transparent animationType="fade" onRequestClose={() => {}}>
      <View style={styles.overlay}><View style={styles.card}>
        <Text style={styles.title}>SALE SUCCESSFUL</Text>
        <Text>Sale: {checkout.sale?.sale_number}</Text>
        <Text>Total: {formatMoney(checkout.sale?.total_amount ?? 0)}</Text>
        <Text>Money Given: {formatMoney(checkout.sale?.amount_paid ?? 0)}</Text>
        <Text style={styles.title}>CHANGE</Text>
        <Text style={styles.change}>{formatMoney(checkout.sale?.change_amount ?? 0)}</Text>
        <AppButton label="DONE" onPress={done} />
      </View></View>
    </Modal>
  </Screen>;
}
const styles = StyleSheet.create({
  error: { color: colors.danger },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: spacing.lg },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md, width: '100%', maxWidth: 440, alignSelf: 'center' },
  title: { fontSize: 20, fontWeight: '800', color: colors.primary },
  change: { fontSize: 44, fontWeight: '900', color: colors.success },
});
