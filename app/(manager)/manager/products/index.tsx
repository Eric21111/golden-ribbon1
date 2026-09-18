import { useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { Screen } from '@/components/Screen';
import { FilterChipRow } from '@/components/dashboard/FilterChipRow';
import { ListRowCard } from '@/components/dashboard/ListRowCard';
import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { ManagerBadge } from '@/components/dashboard/ManagerBadge';
import { ManagerBottomSheet as BottomSheet } from '@/components/dashboard/ManagerBottomSheet';
import { EmptyState, ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { SearchInput } from '@/components/dashboard/SearchInput';
import { managerColors } from '@/components/dashboard/theme';
import { MainBranchGuard } from '@/features/auth/MainBranchGuard';
import { ProductForm } from '@/features/products/ProductForm';
import {
  PRODUCT_FILTER_CHOICES,
  matchesProductFilter,
  productFilterEmptyMessage,
  type ProductFilter,
} from '@/features/products/productFilters';
import type { ProductFormValues } from '@/features/products/productSchema';
import { useCreateProduct, useProducts, useUpdateProduct } from '@/hooks/useProducts';
import { getErrorMessage } from '@/lib/errors';
import { formatMoney } from '@/lib/format';
import type { Product } from '@/types/models';

export default function ManagerProductListScreen() {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<ProductFilter>('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [createKey, setCreateKey] = useState(0);
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const query = useProducts(search);
  const createMutation = useCreateProduct();
  const updateMutation = useUpdateProduct(editProduct?.id ?? '');

  const filtered = useMemo(
    () => (query.data ?? []).filter((product) => matchesProductFilter(product.is_active, filter)),
    [query.data, filter],
  );

  const existingSkus = useMemo(() => (query.data ?? []).map((product) => product.sku), [query.data]);

  const empty =
    filter === 'all' && !search.trim()
      ? productFilterEmptyMessage('all', false, true)
      : productFilterEmptyMessage(filter, Boolean(search.trim()), true);

  const submitCreate = (values: ProductFormValues) => {
    createMutation.mutate(
      {
        name: values.name.trim(),
        sku: values.sku.trim(),
        description: values.description?.trim() ? values.description.trim() : null,
        selling_price: Number(values.selling_price),
        is_active: values.is_active,
      },
      { onSuccess: () => setCreateOpen(false) },
    );
  };

  const submitEdit = (values: ProductFormValues) => {
    updateMutation.mutate(
      {
        name: values.name,
        sku: values.sku,
        description: values.description?.trim() || null,
        selling_price: Number(values.selling_price),
        is_active: values.is_active,
      },
      { onSuccess: () => setEditProduct(null) },
    );
  };

  return (
    <MainBranchGuard>
      <Screen backgroundColor="#FFFFFF" edges={['top']} scroll={false} contentContainerStyle={styles.screenContent}>
        <ManagerScreenHeader title="Products" />

        <ConstrainedWidth style={styles.column}>
          <View style={styles.filters}>
            <SearchInput value={search} onChangeText={setSearch} placeholder="Search name or SKU" />
            <FilterChipRow options={PRODUCT_FILTER_CHOICES} value={filter} onChange={setFilter} />
          </View>

          {query.error ? (
            <ErrorState message={getErrorMessage(query.error)} onRetry={() => void query.refetch()} />
          ) : query.isLoading && !query.data ? (
            <LoadingState label="Loading products…" />
          ) : (
            <FlatList
              data={filtered}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.listContent}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
              ListEmptyComponent={<EmptyState title={empty.title} message={empty.message} />}
              renderItem={({ item }) => (
                <ListRowCard
                  title={item.name}
                  meta={
                    <>
                      {item.sku} · Base <Text style={styles.price}>{formatMoney(item.selling_price)}</Text>
                    </>
                  }
                  trailing={
                    <ManagerBadge
                      label={item.is_active ? 'Active' : 'Inactive'}
                      tone={item.is_active ? 'success' : 'neutral'}
                    />
                  }
                  onPress={() => setEditProduct(item)}
                />
              )}
            />
          )}

          <View style={styles.footer}>
            <ManagerActionButton
              label="Create product"
              icon="add-circle-outline"
              onPress={() => {
                createMutation.reset();
                setCreateKey((key) => key + 1);
                setCreateOpen(true);
              }}
            />
            <ManagerActionButton
              label="Manage branch catalogs"
              icon="pricetags-outline"
              variant="secondary"
              onPress={() => router.push('/manager/catalog' as never)}
            />
          </View>
        </ConstrainedWidth>

        <BottomSheet visible={createOpen} title="Create product" scroll onClose={() => setCreateOpen(false)}>
          <ProductForm
            key={createKey}
            autoGenerateSku
            existingSkus={existingSkus}
            submitLabel="Create product"
            loading={createMutation.isPending}
            error={createMutation.error ? getErrorMessage(createMutation.error) : undefined}
            onSubmit={submitCreate}
          />
        </BottomSheet>

        <BottomSheet
          visible={editProduct != null}
          title="Edit product"
          scroll
          onClose={() => setEditProduct(null)}
        >
          {editProduct ? (
            <ProductForm
              key={editProduct.id}
              defaultValues={{
                name: editProduct.name,
                sku: editProduct.sku,
                description: editProduct.description ?? '',
                selling_price: editProduct.selling_price.toFixed(2),
                is_active: editProduct.is_active,
              }}
              submitLabel="Save changes"
              loading={updateMutation.isPending}
              error={updateMutation.error ? getErrorMessage(updateMutation.error) : undefined}
              onSubmit={submitEdit}
            />
          ) : null}
        </BottomSheet>
      </Screen>
    </MainBranchGuard>
  );
}

const styles = StyleSheet.create({
  screenContent: { flexGrow: 1, padding: 0, gap: 0 },
  column: { flex: 1, paddingHorizontal: 20, paddingTop: 16 },
  filters: { gap: 12, marginBottom: 14 },
  price: { color: managerColors.royalBlue, fontFamily: 'Inter_700Bold', fontSize: 12.5 },
  listContent: { paddingBottom: 12, flexGrow: 1 },
  separator: { height: 12 },
  footer: {
    marginHorizontal: -20,
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 16,
    borderTopWidth: 1,
    borderTopColor: managerColors.cardBorder,
    backgroundColor: '#FFFFFF',
    gap: 10,
    shadowColor: '#0A1224',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 4,
  },
});
