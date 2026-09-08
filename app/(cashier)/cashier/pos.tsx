import { Redirect, router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { AppButton } from '@/components/AppButton';
import { EmptyState, ErrorState, LoadingState } from '@/components/Feedback';
import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';
import { colors, radius, spacing } from '@/constants/theme';
import { useAuth } from '@/features/auth/AuthProvider';
import { PosOrderPane } from '@/features/pos/PosOrderPane';
import { PosProductCard } from '@/features/pos/PosProductCard';
import { useInventory } from '@/hooks/useInventory';
import { useActiveShift } from '@/hooks/useShifts';
import { confirmAction } from '@/lib/confirmAction';
import { getInventoryErrorMessage, getShiftErrorMessage } from '@/lib/errors';
import { formatMoney } from '@/lib/format';
import { useLayout } from '@/lib/layout';
import { cartTotalCents } from '@/lib/money';
import { useCartStore } from '@/stores/cartStore';
import type { InventoryItem } from '@/types/models';

export default function CashierPosScreen() {
  const { profile } = useAuth();
  const { isTablet, posColumns } = useLayout();
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
    return (
      inventory.data?.filter(
        (item) =>
          item.product.name.toLowerCase().includes(term) ||
          item.product.sku.toLowerCase().includes(term),
      ) ?? []
    );
  }, [inventory.data, search]);

  const quantities = useMemo(
    () => new Map(items.map((item) => [item.product_id, item.quantity])),
    [items],
  );

  const inventoryById = useMemo(() => {
    const map = new Map<string, InventoryItem>();
    for (const item of inventory.data ?? []) map.set(item.product.id, item);
    return map;
  }, [inventory.data]);

  const stockByProductId = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of inventory.data ?? []) {
      map.set(item.product.id, item.quantity_on_hand);
    }
    return map;
  }, [inventory.data]);

  const itemCount = useMemo(
    () => items.reduce((sum, item) => sum + item.quantity, 0),
    [items],
  );
  const totalCents = cartTotalCents(items);
  const refreshing = inventory.isRefetching || shiftQuery.isRefetching;

  const onRefresh = () => {
    void Promise.all([inventory.refetch(), shiftQuery.refetch()]);
  };

  const increaseFromCart = (productId: string) => {
    const row = inventoryById.get(productId);
    if (row) addProduct(row);
  };

  if (shiftQuery.isLoading || inventory.isLoading) {
    return <LoadingState label="Opening POS…" />;
  }
  if (shiftQuery.error) {
    return (
      <Screen>
        <ErrorState
          message={getShiftErrorMessage(shiftQuery.error)}
          onRetry={() => void shiftQuery.refetch()}
        />
      </Screen>
    );
  }
  if (!shiftQuery.data) return <Redirect href="/cashier/dashboard" />;
  if (inventory.error || !profile?.branch) {
    return (
      <Screen>
        <ErrorState
          message={getInventoryErrorMessage(inventory.error)}
          onRetry={() => void inventory.refetch()}
        />
      </Screen>
    );
  }

  const productList = (
    <FlatList
      key={`pos-cols-${posColumns}`}
      data={filteredInventory}
      keyExtractor={(item) => item.product.id}
      numColumns={posColumns}
      style={styles.list}
      contentContainerStyle={styles.listContent}
      columnWrapperStyle={posColumns > 1 ? styles.columnWrapper : undefined}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      ItemSeparatorComponent={posColumns === 1 ? () => <View style={styles.separator} /> : undefined}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
      }
      ListEmptyComponent={
        <EmptyState
          title="No products found"
          message={
            search
              ? 'Try another product name or SKU.'
              : 'No active products are available for this branch.'
          }
        />
      }
      renderItem={({ item }) => (
        <View style={posColumns > 1 ? styles.gridCell : undefined}>
          <PosProductCard
            item={item}
            compact={posColumns > 1}
            quantity={quantities.get(item.product.id) ?? 0}
            onIncrease={() => addProduct(item)}
            onDecrease={() => decreaseProduct(item.product.id)}
          />
        </View>
      )}
    />
  );

  const mobileFooter = (
    <View style={styles.footer}>
      <View style={styles.totalRow}>
        <Text style={styles.totalMeta}>
          {itemCount === 0
            ? 'No items in order'
            : `${itemCount} item${itemCount === 1 ? '' : 's'} in order`}
        </Text>
        <Text style={styles.totalAmount}>{formatMoney(totalCents / 100)}</Text>
      </View>
      <Text style={styles.notice}>
        Stock is deducted when you confirm the sale at checkout.
      </Text>
      {items.length > 0 ? (
        <AppButton
          label="Clear order"
          variant="secondary"
          onPress={() =>
            confirmAction(
              'Clear order?',
              'Remove all products from this unfinished order.',
              clearCart,
            )
          }
        />
      ) : null}
      <AppButton
        label="CHECKOUT"
        disabled={items.length === 0}
        onPress={() => router.push('/cashier/payment')}
      />
    </View>
  );

  return (
    <Screen scroll={false} contentContainerStyle={styles.screen}>
      {isTablet ? (
        <View style={styles.split}>
          <View style={styles.catalog}>
            <View style={styles.top}>
              <PageHeader
                title="Point of Sale"
                subtitle={`${shiftBranch?.name ?? profile.branch.name} · Build the current order`}
              />
              <TextInput
                accessibilityLabel="Search products by name or SKU"
                autoCapitalize="none"
                autoCorrect={false}
                clearButtonMode="while-editing"
                onChangeText={setSearch}
                placeholder="Search product name or SKU"
                placeholderTextColor={colors.muted}
                style={styles.search}
                value={search}
              />
            </View>
            {productList}
          </View>
          <View style={styles.orderPane}>
            <PosOrderPane
              items={items}
              stockByProductId={stockByProductId}
              onIncrease={increaseFromCart}
              onDecrease={decreaseProduct}
              onClear={clearCart}
              onCheckout={() => router.push('/cashier/payment')}
            />
          </View>
        </View>
      ) : (
        <View style={styles.layout}>
          <View style={styles.top}>
            <PageHeader
              title="Point of Sale"
              subtitle={`${shiftBranch?.name ?? profile.branch.name} · Build the current order`}
            />
            <TextInput
              accessibilityLabel="Search products by name or SKU"
              autoCapitalize="none"
              autoCorrect={false}
              clearButtonMode="while-editing"
              onChangeText={setSearch}
              placeholder="Search product name or SKU"
              placeholderTextColor={colors.muted}
              style={styles.search}
              value={search}
            />
          </View>
          {productList}
          {mobileFooter}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { flexGrow: 1, padding: 0, gap: 0 },
  layout: { flex: 1, minHeight: 0 },
  split: { flex: 1, minHeight: 0, flexDirection: 'row' },
  catalog: { flex: 1.65, minWidth: 0, minHeight: 0 },
  orderPane: { flex: 1, minWidth: 280, maxWidth: 420, minHeight: 0 },
  top: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    gap: spacing.sm,
  },
  search: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    color: colors.text,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
  },
  list: { flex: 1, minHeight: 0 },
  listContent: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexGrow: 1,
    gap: spacing.sm,
  },
  columnWrapper: { gap: spacing.sm },
  gridCell: { flex: 1 },
  separator: { height: spacing.sm },
  footer: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  totalMeta: { color: colors.muted, fontSize: 14, fontWeight: '600', flex: 1 },
  totalAmount: { color: colors.primary, fontSize: 22, fontWeight: '900' },
  notice: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
});
