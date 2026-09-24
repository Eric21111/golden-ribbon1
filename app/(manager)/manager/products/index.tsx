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
import { ProductForm, type BranchCatalogDraft } from '@/features/products/ProductForm';
import {
  PRODUCT_FILTER_CHOICES,
  matchesProductFilter,
  productFilterEmptyMessage,
  type ProductFilter,
} from '@/features/products/productFilters';
import type { ProductFormValues } from '@/features/products/productSchema';
import { useBranches } from '@/hooks/useBranches';
import { useBranchProducts, useConfigureBranchProducts } from '@/hooks/useBranchProducts';
import { useInventory } from '@/hooks/useInventory';
import { useConfigureProductVariants, useCreateProduct, useProducts, useUpdateProduct } from '@/hooks/useProducts';
import { alertNotice } from '@/lib/confirmAction';
import { getErrorMessage } from '@/lib/errors';
import type { Product } from '@/types/models';

export default function ManagerProductListScreen() {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<ProductFilter>('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [createKey, setCreateKey] = useState(0);
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [editBranchId, setEditBranchId] = useState('');
  const [createFollowupError, setCreateFollowupError] = useState<string | undefined>();
  const branches = useBranches();
  const sellingBranches = useMemo(
    () => (branches.data ?? []).filter((branch) => branch.is_active && !branch.is_main_branch),
    [branches.data],
  );
  const mainBranch = useMemo(
    () => (branches.data ?? []).find((branch) => branch.is_main_branch) ?? null,
    [branches.data],
  );
  const mainInventory = useInventory(mainBranch, false);
  const query = useProducts(search);
  const createMutation = useCreateProduct();
  const updateMutation = useUpdateProduct(editProduct?.id ?? '');
  const configureVariantsMutation = useConfigureProductVariants();
  const editCatalog = useBranchProducts(editBranchId, false);
  const configureBranchMutation = useConfigureBranchProducts(editBranchId);

  const filtered = useMemo(
    () => (query.data ?? []).filter((product) => matchesProductFilter(product.is_active, filter)),
    [query.data, filter],
  );

  const existingSkus = useMemo(() => (query.data ?? []).map((product) => product.sku), [query.data]);
  const branchOptions = useMemo(
    () => sellingBranches.map((branch) => ({ id: branch.id, name: branch.name })),
    [sellingBranches],
  );

  const empty =
    filter === 'all' && !search.trim()
      ? productFilterEmptyMessage('all', false, true)
      : productFilterEmptyMessage(filter, Boolean(search.trim()), true);

  async function configureBranchProductsFor(
    branchId: string,
    items: Array<{ product_id: string; selling_price: number; is_active: boolean }>,
  ) {
    const { configureBranchProducts } = await import('@/services/branchProductService');
    await configureBranchProducts(branchId, items);
  }

  async function configureBranchVariantsFor(
    branchId: string,
    productId: string,
    variants: Array<{ name: string; selling_price: number; is_active: boolean }>,
  ) {
    const { configureBranchProductVariants } = await import('@/services/branchProductService');
    await configureBranchProductVariants(branchId, productId, variants);
  }

  const submitCreate = (values: ProductFormValues, catalogDrafts: BranchCatalogDraft[]) => {
    setCreateFollowupError(undefined);
    const fallbackPrice = Number(values.selling_price || catalogDrafts[0]?.selling_price || 0);
    void createMutation
      .mutateAsync({
        name: values.name.trim(),
        sku: values.sku.trim(),
        description: values.description?.trim() ? values.description.trim() : null,
        selling_price: fallbackPrice,
        is_active: false,
      })
      .then(async (product) => {
        try {
          if (values.pricingType === 'variants') {
            await configureVariantsMutation.mutateAsync({
              productId: product.id,
              variants: values.variants.map((variant) => ({
                name: variant.name.trim(),
                default_price: Number(variant.default_price),
                is_active: variant.is_active,
              })),
            });
          }
          for (const draft of catalogDrafts) {
            if (!Number.isFinite(draft.selling_price) || draft.selling_price < 0) continue;
            await configureBranchProductsFor(draft.branchId, [
              {
                product_id: product.id,
                selling_price: draft.selling_price,
                is_active: true,
              },
            ]);
            if (values.pricingType === 'variants') {
              await configureBranchVariantsFor(
                draft.branchId,
                product.id,
                values.variants.map((variant) => ({
                  name: variant.name.trim(),
                  selling_price: Number(variant.default_price),
                  is_active: variant.is_active,
                })),
              );
            }
          }
          setCreateOpen(false);
        } catch (error) {
          setCreateFollowupError(getErrorMessage(error));
        }
      });
  };

  const submitEdit = (values: ProductFormValues) => {
    updateMutation.mutate(
      {
        name: values.name,
        sku: values.sku,
        description: values.description?.trim() || null,
        selling_price: Number(values.selling_price || editProduct?.selling_price || 0),
        is_active: values.is_active,
      },
      { onSuccess: () => setEditProduct(null) },
    );
  };

  const confirmEditBranchPrice = (draft: { branchId: string; selling_price: number }) => {
    if (!editProduct || !Number.isFinite(draft.selling_price) || draft.selling_price < 0) {
      alertNotice('Invalid price', 'Enter a valid branch selling price.');
      return;
    }
    setEditBranchId(draft.branchId);
    const existing = editCatalog.data?.find((row) => row.product_id === editProduct.id);
    void configureBranchProductsFor(draft.branchId, [
      {
        product_id: editProduct.id,
        selling_price: draft.selling_price,
        is_active: existing?.is_active ?? true,
      },
    ])
      .then(() => {
        alertNotice('Branch price saved', 'The selected branch price was updated.');
        void editCatalog.refetch();
      })
      .catch((error) => alertNotice('Unable to save branch price', getErrorMessage(error)));
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
                  meta={item.is_active ? item.sku : `${item.sku} · Inactive until opening stock`}
                  trailing={
                    <ManagerBadge
                      label={item.is_active ? 'Active' : 'Inactive'}
                      tone={item.is_active ? 'success' : 'neutral'}
                    />
                  }
                  onPress={() => {
                    setEditBranchId(sellingBranches[0]?.id ?? '');
                    setEditProduct(item);
                  }}
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
                configureVariantsMutation.reset();
                setCreateFollowupError(undefined);
                setCreateKey((key) => key + 1);
                setCreateOpen(true);
              }}
            />
            <ManagerActionButton
              label="View branch catalogs"
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
            allowVariants
            showActiveToggle={false}
            existingSkus={existingSkus}
            branchOptions={branchOptions}
            resolveBranchPrice={() => undefined}
            submitLabel="Create product"
            loading={createMutation.isPending || configureVariantsMutation.isPending}
            error={
              createFollowupError
                ?? (createMutation.error
                  ? getErrorMessage(createMutation.error)
                  : configureVariantsMutation.error
                    ? getErrorMessage(configureVariantsMutation.error)
                    : undefined)
            }
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
              showActiveToggle
              canActivate={Boolean(
                mainInventory.data?.some(
                  (row) => row.product.id === editProduct.id && (row.quantity_on_hand > 0 || row.updated_at != null),
                ),
              )}
              branchOptions={branchOptions}
              onBranchChange={setEditBranchId}
              resolveBranchPrice={(branchId) => {
                if (branchId !== editBranchId) return editProduct.selling_price.toFixed(2);
                const entry = editCatalog.data?.find((row) => row.product_id === editProduct.id);
                return (entry?.selling_price ?? editProduct.selling_price).toFixed(2);
              }}
              onConfirmBranchPrice={confirmEditBranchPrice}
              branchPriceLoading={configureBranchMutation.isPending}
              branchPriceError={
                configureBranchMutation.error ? getErrorMessage(configureBranchMutation.error) : undefined
              }
              defaultValues={{
                name: editProduct.name,
                sku: editProduct.sku,
                description: editProduct.description ?? '',
                selling_price: editProduct.selling_price.toFixed(2),
                is_active: editProduct.is_active,
                pricingType: 'single',
                variants: [],
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
