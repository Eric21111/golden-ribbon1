import { Redirect, router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Pagination } from '@/components/Pagination';
import { Screen } from '@/components/Screen';
import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { EmptyState, ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { SearchInput } from '@/components/dashboard/SearchInput';
import { managerColors } from '@/components/dashboard/theme';
import { spacing } from '@/constants/theme';
import { useAuth } from '@/features/auth/AuthProvider';
import { PosItemSheet } from '@/features/pos/PosItemSheet';
import { PosOrderPane } from '@/features/pos/PosOrderPane';
import { PosProductRow } from '@/features/pos/PosProductRow';
import { PosViewOrderSheet } from '@/features/pos/PosViewOrderSheet';
import { filterPosInventory } from '@/features/pos/posInventory';
import { useClientPagination } from '@/hooks/useClientPagination';
import { useCashierPosInventory } from '@/hooks/useInventory';
import { useActiveShift } from '@/hooks/useShifts';
import { getInventoryErrorMessage, getShiftErrorMessage } from '@/lib/errors';
import { formatMoney } from '@/lib/format';
import { useLayout } from '@/lib/layout';
import { cartTotalCents } from '@/lib/money';
import { useCartStore } from '@/stores/cartStore';
import type { InventoryItem, PosVariant } from '@/types/models';

const POS_PAGE_SIZE = 10;

export default function CashierPosScreen() {
  const { profile } = useAuth();
  const { posSplit } = useLayout();
  const cashierId = profile?.id ?? '';
  const [search, setSearch] = useState('');
  const [sheetItem, setSheetItem] = useState<InventoryItem | null>(null);
  const [orderSheetOpen, setOrderSheetOpen] = useState(false);
  const shiftQuery = useActiveShift(cashierId);
  const posBranchId = shiftQuery.data?.branch_id ?? null;
  const inventory = useCashierPosInventory(posBranchId);
  const shiftBranchName = inventory.data?.[0]?.branch.name ?? profile?.branch?.name;
  const items = useCartStore((state) => state.items);
  const beginShift = useCartStore((state) => state.beginShift);
  const addProduct = useCartStore((state) => state.addProduct);
  const decreaseProduct = useCartStore((state) => state.decreaseProduct);
  const setProductQuantity = useCartStore((state) => state.setProductQuantity);
  const clearCart = useCartStore((state) => state.clearCart);

  useEffect(() => {
    if (shiftQuery.data) beginShift(shiftQuery.data.id);
  }, [beginShift, shiftQuery.data]);

  const filteredInventory = useMemo(
    () => filterPosInventory(inventory.data ?? [], search),
    [inventory.data, search],
  );

  const pagination = useClientPagination(filteredInventory, search, POS_PAGE_SIZE);

  const quantitiesByProduct = useMemo(() => {
    const map = new Map<string, Map<string | null, number>>();
    for (const item of items) {
      if (!map.has(item.product_id)) map.set(item.product_id, new Map());
      map.get(item.product_id)!.set(item.variant_id, item.quantity);
    }
    return map;
  }, [items]);

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

  const increaseFromCart = (productId: string, variantId: string | null) => {
    const row = inventoryById.get(productId);
    if (!row) return;
    const variant = variantId ? row.variants?.find((candidate) => candidate.id === variantId) ?? null : null;
    addProduct(row, variant);
  };

  const activeSheetItem = sheetItem ? inventoryById.get(sheetItem.product.id) ?? sheetItem : null;

  const addFromSheet = (variant: PosVariant | null, quantity: number) => {
    if (!activeSheetItem || quantity <= 0) return;
    const variantId = variant?.id ?? null;
    const current = quantitiesByProduct.get(activeSheetItem.product.id)?.get(variantId) ?? 0;
    setProductQuantity(activeSheetItem, current + quantity, variant);
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
      data={pagination.pageItems}
      keyExtractor={(item) => item.product.id}
      style={styles.list}
      contentContainerStyle={styles.listContent}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      ItemSeparatorComponent={() => <View style={styles.separator} />}
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
      ListFooterComponent={
        pagination.showPagination ? (
          <View style={styles.pager}>
            <Pagination
              page={pagination.page}
              totalPages={pagination.totalPages}
              onPageChange={pagination.setPage}
            />
          </View>
        ) : null
      }
      renderItem={({ item }) => (
        <PosProductRow
          item={item}
          cartQuantity={[...(quantitiesByProduct.get(item.product.id) ?? new Map()).values()].reduce(
            (sum, qty) => sum + qty,
            0,
          )}
          onPress={() => setSheetItem(item)}
        />
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

  const changeCartQuantity = (productId: string, variantId: string | null, quantity: number) => {
    const row = inventoryById.get(productId);
    if (!row) return;
    const variant = variantId ? row.variants?.find((candidate) => candidate.id === variantId) ?? null : null;
    setProductQuantity(row, quantity, variant);
  };

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
      <ManagerActionButton
        label="View Order"
        icon="receipt-outline"
        disabled={items.length === 0}
        onPress={() => setOrderSheetOpen(true)}
      />
    </View>
  );

  return (
    <Screen backgroundColor="#FFFFFF" edges={['top']} scroll={false} contentContainerStyle={styles.screen}>
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
              onQuantityChange={changeCartQuantity}
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
      <PosItemSheet
        item={activeSheetItem}
        quantityByVariant={sheetItem ? quantitiesByProduct.get(sheetItem.product.id) ?? new Map() : new Map()}
        onAdd={addFromSheet}
        onClose={() => setSheetItem(null)}
      />
      {posSplit ? null : (
        <PosViewOrderSheet
          visible={orderSheetOpen}
          items={items}
          stockByProductId={stockByProductId}
          onIncrease={increaseFromCart}
          onDecrease={decreaseProduct}
          onQuantityChange={changeCartQuantity}
          onClear={clearCart}
          onConfirm={() => {
            setOrderSheetOpen(false);
            router.push('/cashier/payment');
          }}
          onClose={() => setOrderSheetOpen(false)}
        />
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
  separator: { height: spacing.sm },
  pager: { alignItems: 'center', gap: 8, paddingTop: spacing.sm },
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
});
