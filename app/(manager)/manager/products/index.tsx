import { useMemo, useRef, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
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
import {
  CreateProductWizard,
  type BranchPricingDraft,
  type CreateProductValues,
} from '@/features/products/CreateProductWizard';
import { ProductForm } from '@/features/products/ProductForm';
import {
  PRODUCT_FILTER_CHOICES,
  matchesProductFilter,
  productFilterEmptyMessage,
  type ProductFilter,
} from '@/features/products/productFilters';
import { PRICE_PATTERN, type ProductFormValues } from '@/features/products/productSchema';
import { useBranches } from '@/hooks/useBranches';
import { useBranchProductVariants, useBranchProducts, useConfigureBranchProducts } from '@/hooks/useBranchProducts';
import { useInventory } from '@/hooks/useInventory';
import {
  useCreateCompleteProduct,
  useProductSkus,
  useProductVariants,
  useProducts,
  useUpdateBranchProductVariantPrice,
  useUpdateProduct,
  useUpdateProductVariant,
} from '@/hooks/useProducts';
import { alertNotice } from '@/lib/confirmAction';
import { getErrorMessage, getProductErrorMessage } from '@/lib/errors';
import { endSubmit, tryBeginSubmit } from '@/lib/submitLock';
import { configureBranchProducts } from '@/services/branchProductService';
import type { Product } from '@/types/models';

export default function ManagerProductListScreen() {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<ProductFilter>('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [createKey, setCreateKey] = useState(0);
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [editBranchId, setEditBranchId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);
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
  const skuQuery = useProductSkus();
  const createMutation = useCreateCompleteProduct();
  const updateMutation = useUpdateProduct(editProduct?.id ?? '');
  const updateVariantMutation = useUpdateProductVariant();
  const updateBranchVariantMutation = useUpdateBranchProductVariantPrice();
  const editVariants = useProductVariants(editProduct?.id ?? '');
  const editCatalog = useBranchProducts(editBranchId, false);
  const editBranchVariants = useBranchProductVariants(editBranchId, editProduct?.id ?? '');
  const configureBranchMutation = useConfigureBranchProducts(editBranchId);

  const filtered = useMemo(
    () => (query.data ?? []).filter((product) => matchesProductFilter(product.is_active, filter)),
    [query.data, filter],
  );

  const existingSkus = skuQuery.data ?? [];
  const branchOptions = useMemo(
    () => sellingBranches.map((branch) => ({ id: branch.id, name: branch.name })),
    [sellingBranches],
  );

  const empty =
    filter === 'all' && !search.trim()
      ? productFilterEmptyMessage('all', false, true)
      : productFilterEmptyMessage(filter, Boolean(search.trim()), true);

  const submitCreate = (values: CreateProductValues, catalogDrafts: BranchPricingDraft[]) => {
    if (!tryBeginSubmit(submittingRef)) return;
    setIsSubmitting(true);
    const hasVariants = values.variants.length > 0;
    void createMutation
      .mutateAsync({
        name: values.name,
        sku: values.sku,
        description: values.description ? values.description : null,
        variants: values.variants.map((variant) => ({
          name: variant.name,
          default_price: variant.default_price,
        })),
        branches: catalogDrafts.map((draft) =>
          hasVariants
            ? { branch_id: draft.branchId, variants: draft.variants ?? [] }
            : { branch_id: draft.branchId, selling_price: draft.selling_price },
        ),
        selling_price: hasVariants ? null : values.default_price,
      })
      .then(() => setCreateOpen(false))
      .finally(() => {
        endSubmit(submittingRef);
        setIsSubmitting(false);
      });
  };

  const submitEdit = (values: ProductFormValues) => {
    if (!editProduct) return;
    const defaultVariant = values.variants[0];
    updateMutation.mutate(
      {
        name: values.name,
        sku: values.sku,
        description: values.description?.trim() || null,
        selling_price: PRICE_PATTERN.test((defaultVariant?.default_price || values.selling_price).trim())
          ? Number(defaultVariant?.default_price || values.selling_price)
          : editProduct.selling_price,
        is_active: values.is_active,
      },
      {
        onSuccess: () => {
          const existing = editVariants.data ?? [];
          void (async () => {
            try {
              for (const variant of values.variants) {
                if (!variant.id) continue;
                await updateVariantMutation.mutateAsync({
                  variantId: variant.id,
                  name: variant.name,
                  defaultPrice: variant.default_price,
                });
              }
              if (existing.length === 0) setEditProduct(null);
              else setEditProduct(null);
            } catch (error) {
              alertNotice('Unable to save variants', getProductErrorMessage(error));
            }
          })();
        },
      },
    );
  };

  const confirmEditBranchPrice = (draft: { branchId: string; selling_price: number }) => {
    if (!editProduct || !Number.isFinite(draft.selling_price) || draft.selling_price < 0) {
      alertNotice('Invalid price', 'Enter a valid branch selling price.');
      return;
    }
    if (!PRICE_PATTERN.test(String(draft.selling_price))) {
      alertNotice('Invalid price', 'Enter a valid branch selling price.');
      return;
    }
    setEditBranchId(draft.branchId);
    const existing = editCatalog.data?.find((row) => row.product_id === editProduct.id);
    void configureBranchProducts(draft.branchId, [
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
      .catch((error) => alertNotice('Unable to save branch price', getProductErrorMessage(error)));
  };

  const confirmEditBranchVariantPrice = (payload: { branchVariantId: string; selling_price: string }) => {
    if (!PRICE_PATTERN.test(payload.selling_price.trim())) {
      alertNotice('Invalid price', 'Enter a valid non-negative price.');
      return;
    }
    void updateBranchVariantMutation
      .mutateAsync({
        branchVariantId: payload.branchVariantId,
        sellingPrice: payload.selling_price.trim(),
      })
      .then(() => {
        alertNotice('Branch variant price saved', 'The selected variant price was updated.');
        void editBranchVariants.refetch();
        void editCatalog.refetch();
      })
      .catch((error) => alertNotice('Unable to save branch price', getProductErrorMessage(error)));
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
          <CreateProductWizard
            key={createKey}
            existingSkus={existingSkus}
            branchOptions={branchOptions}
            loading={isSubmitting}
            error={createMutation.error ? getProductErrorMessage(createMutation.error) : undefined}
            onSubmit={submitCreate}
          />
        </BottomSheet>

        <BottomSheet
          visible={editProduct != null}
          title="Edit product"
          scroll
          onClose={() => setEditProduct(null)}
        >
          {editProduct && editVariants.isLoading ? (
            <LoadingState label="Loading product…" />
          ) : editProduct ? (
            <ProductForm
              key={`${editProduct.id}-${(editVariants.data ?? []).map((row) => row.id).join(',')}`}
              showActiveToggle
              allowVariants={(editVariants.data ?? []).length > 0}
              lockVariantSet
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
              branchVariantOptions={(editBranchVariants.data ?? []).map((row) => ({
                id: row.id,
                name: row.name,
                selling_price: row.selling_price.toFixed(2),
              }))}
              onConfirmBranchVariantPrice={confirmEditBranchVariantPrice}
              branchPriceLoading={configureBranchMutation.isPending || updateBranchVariantMutation.isPending}
              branchPriceError={
                configureBranchMutation.error
                  ? getProductErrorMessage(configureBranchMutation.error)
                  : updateBranchVariantMutation.error
                    ? getProductErrorMessage(updateBranchVariantMutation.error)
                    : undefined
              }
              defaultValues={{
                name: editProduct.name,
                sku: editProduct.sku,
                description: editProduct.description ?? '',
                selling_price: (editVariants.data?.[0]?.default_price ?? editProduct.selling_price).toFixed(2),
                is_active: editProduct.is_active,
                pricingType: (editVariants.data ?? []).length > 0 ? 'variants' : 'single',
                variants: (editVariants.data ?? []).map((variant) => ({
                  id: variant.id,
                  name: variant.name,
                  default_price: variant.default_price.toFixed(2),
                  is_active: variant.is_active,
                })),
              }}
              submitLabel="Save changes"
              loading={updateMutation.isPending || updateVariantMutation.isPending}
              error={
                updateMutation.error
                  ? getProductErrorMessage(updateMutation.error)
                  : updateVariantMutation.error
                    ? getProductErrorMessage(updateVariantMutation.error)
                    : undefined
              }
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
