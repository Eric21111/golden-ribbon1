import { Redirect, router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, TextInput } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { EmptyState, ErrorState, LoadingState } from '@/components/Feedback';
import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';
import { colors, radius, spacing } from '@/constants/theme';
import { useAuth } from '@/features/auth/AuthProvider';
import { OrderSummary } from '@/features/pos/OrderSummary';
import { PosProductCard } from '@/features/pos/PosProductCard';
import { useInventory } from '@/hooks/useInventory';
import { useActiveShift, useEndShift } from '@/hooks/useShifts';
import { getInventoryErrorMessage, getShiftErrorMessage } from '@/lib/errors';
import { useCartStore } from '@/stores/cartStore';
import { confirmAction } from '@/lib/confirmAction';

export default function CashierPosScreen() {
  const { profile } = useAuth();
  const cashierId = profile?.id ?? '';
  const [search, setSearch] = useState('');
  const shiftQuery = useActiveShift(cashierId);
  const shiftBranch = useMemo(() => {
    if (!shiftQuery.data) return null;
    if (profile?.branch?.id === shiftQuery.data.branch_id) return profile.branch;
    if (!profile?.branch) return null;
    return { ...profile.branch, id: shiftQuery.data.branch_id };
  }, [profile?.branch, shiftQuery.data]);
  const inventory = useInventory(shiftBranch, true);
  const endMutation = useEndShift(cashierId);
  const items = useCartStore((state) => state.items);
  const beginShift = useCartStore((state) => state.beginShift);
  const addProduct = useCartStore((state) => state.addProduct);
  const decreaseProduct = useCartStore((state) => state.decreaseProduct);
  const clearCart = useCartStore((state) => state.clearCart);

  useEffect(() => {
    if (shiftQuery.data) beginShift(shiftQuery.data.id);
  }, [beginShift, shiftQuery.data]);


  const filteredInventory = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return inventory.data ?? [];
    return inventory.data?.filter((item) =>
      item.product.name.toLowerCase().includes(term) || item.product.sku.toLowerCase().includes(term),
    ) ?? [];
  }, [inventory.data, search]);

  const quantities = useMemo(() => new Map(items.map((item) => [item.product_id, item.quantity])), [items]);

  const requestEndShift = () => {
    const shiftId = shiftQuery.data?.id;
    if (!shiftId) return;
    if (items.length > 0) {
      Alert.alert('Unfinished cart', 'Remove every item from the cart before ending the shift.');
      return;
    }
    confirmAction('End shift?', 'The end time will be recorded and this shift cannot be reopened.',
      () => endMutation.mutate(shiftId, {
          onSuccess: () => {
            clearCart();
            router.replace('/cashier/dashboard');
          },
        }));
  };

  if (shiftQuery.isLoading || inventory.isLoading) return <LoadingState label="Opening POS…" />;
  if (shiftQuery.error) return <Screen><ErrorState message={getShiftErrorMessage(shiftQuery.error)} onRetry={() => void shiftQuery.refetch()} /></Screen>;
  if (!shiftQuery.data) return <Redirect href="/cashier/dashboard" />;
  if (inventory.error || !profile?.branch) return <Screen><ErrorState message={getInventoryErrorMessage(inventory.error)} onRetry={() => void inventory.refetch()} /></Screen>;

  return (
    <Screen>
      <PageHeader title="Point of Sale" subtitle={`${shiftBranch?.name ?? profile.branch.name} · Build the current order`} />
      <TextInput
        accessibilityLabel="Search products by name or SKU"
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={setSearch}
        placeholder="Search product name or SKU"
        placeholderTextColor={colors.muted}
        style={styles.search}
        value={search}
      />
      {filteredInventory.length === 0 ? <EmptyState title="No products found" message={search ? 'Try another product name or SKU.' : 'No active products are available for this branch.'} /> : null}
      {filteredInventory.map((item) => (
        <PosProductCard
          key={item.product.id}
          item={item}
          quantity={quantities.get(item.product.id) ?? 0}
          onIncrease={() => addProduct(item)}
          onDecrease={() => decreaseProduct(item.product.id)}
        />
      ))}
      <OrderSummary items={items} />
      {items.length > 0 ? <AppButton label="Clear order" variant="secondary" onPress={() => confirmAction('Clear order?', 'Remove all products from this unfinished order.', clearCart)} /> : null}
      <Text style={styles.notice}>Stock is deducted when you confirm the sale at checkout.</Text>
      <AppButton label="CHECKOUT" disabled={items.length === 0} onPress={() => router.push('/cashier/payment')} />
      {items.length > 0 ? <Text style={styles.endHint}>Clear the unfinished cart before ending the shift.</Text> : null}
      {endMutation.error ? <Text style={styles.error}>{getShiftErrorMessage(endMutation.error)}</Text> : null}
      <AppButton label="END SHIFT" variant="danger" loading={endMutation.isPending} onPress={requestEndShift} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  search: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface, color: colors.text, paddingHorizontal: spacing.md, fontSize: 16 },
  notice: { color: colors.muted, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  endHint: { color: '#92400E', backgroundColor: colors.warningSurface, borderRadius: radius.sm, padding: spacing.sm, textAlign: 'center', fontSize: 13 },
  error: { color: colors.danger, fontSize: 14, lineHeight: 20, textAlign: 'center' },
});
