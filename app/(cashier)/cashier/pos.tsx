import { Redirect, router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Screen } from '@/components/Screen';
import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { EmptyState, ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { SearchInput } from '@/components/dashboard/SearchInput';
import { managerColors } from '@/components/dashboard/theme';
import { spacing } from '@/constants/theme';
import { useAuth } from '@/features/auth/AuthProvider';
import { PosOrderPane } from '@/features/pos/PosOrderPane';
import { PosProductCard } from '@/features/pos/PosProductCard';
import { filterPosInventory } from '@/features/pos/posInventory';
import { useCashierPosInventory } from '@/hooks/useInventory';
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
  const { posSplit, posColumns } = useLayout();
  const cashierId = profile?.id ?? '';
  const [search, setSearch] = useState('');
  const shiftQuery = useActiveShift(cashierId);
  const posBranchId = shiftQuery.data?.branch_id ?? null;
  const inventory = useCashierPosInventory(posBranchId);
  const shiftBranchName = inventory.data?.[0]?.branch.name ?? profile?.branch?.name;
  const items = useCartStore((state) => state.items);
  const beginShift = useCartStore((state) => state.beginShift);
  const addProduct = useCartStore((state) => state.addProduct);
  const decreaseProduct = useCartStore((state) => state.decreaseProduct);
  const clearCart = useCartStore((state) => state.clearCart);

  useEffect(() => {
    if (shiftQuery.data) beginShift(shiftQuery.data.id);
  }, [beginShift, shiftQuery.data]);

  const filteredInventory = useMemo(
    () => filterPosInventory(inventory.data ?? [], search),
    [inventory.data, search],
  );

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
      <Screen backgroundColor="#FFFFFF">
        <ErrorState
          message={getShiftErrorMessage(shiftQuery.error)}
          onRetry={() => void shiftQuery.refetch()}
        />
      </Screen>
    );
  }
  if (!shiftQuery.data) return <Redirect href="/cashier/dashboard" />;
  if (inventory.error) {
    return (
      <Screen backgroundColor="#FFFFFF">
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
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={managerColors.royalBlue} />
      }
      ListEmptyComponent={
        <EmptyState
          title={search.trim() ? 'No products found' : 'No products in stock'}
          message={
            search.trim()
              ? 'Try another product name or SKU.'
              : 'In-stock items appear here. Search by name or SKU to find out-of-stock products.'
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

  const searchField = (
    <SearchInput
      value={search}
      onChangeText={setSearch}
      placeholder="Search product name or SKU"
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
        <ManagerActionButton
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
      <ManagerActionButton
        label="Checkout"
        icon="card-outline"
        disabled={items.length === 0}
        onPress={() => router.push('/cashier/payment')}
      />
    </View>
  );

  return (
    <Screen backgroundColor="#FFFFFF" scroll={false} contentContainerStyle={styles.screen}>
      {posSplit ? (
        <View style={styles.split}>
          <View style={styles.catalog}>
            <View style={styles.top}>
              <ManagerScreenHeader
                title="Point of Sale"
                subtitle={shiftBranchName ?? 'Assigned branch'}
                hideMenu
              />
              <View style={styles.searchWrap}>{searchField}</View>
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
            <ManagerScreenHeader
              title="Point of Sale"
              subtitle={shiftBranchName ?? 'Assigned branch'}
              hideMenu
            />
            <View style={styles.searchWrap}>{searchField}</View>
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
  top: { gap: spacing.sm },
  searchWrap: { paddingHorizontal: 20, paddingBottom: spacing.sm },
  list: { flex: 1, minHeight: 0 },
  listContent: {
    paddingHorizontal: 20,
    paddingVertical: spacing.sm,
    flexGrow: 1,
    gap: spacing.sm,
  },
  columnWrapper: { gap: spacing.sm },
  gridCell: { flex: 1 },
  separator: { height: spacing.sm },
  footer: {
    borderTopWidth: 1,
    borderTopColor: managerColors.cardBorder,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
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
  totalMeta: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 14, flex: 1 },
  totalAmount: { color: managerColors.royalBlue, fontFamily: 'Inter_700Bold', fontSize: 22 },
  notice: {
    color: managerColors.subtext,
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
});
