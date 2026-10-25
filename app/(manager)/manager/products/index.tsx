import Ionicons from '@react-native-vector-icons/ionicons';
import { useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { Pagination } from '@/components/Pagination';
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
import {
  EditProductWizard,
  type BranchPricingDraft as EditBranchPricingDraft,
  type EditProductValues,
} from '@/features/products/EditProductWizard';
import {
  PRODUCT_FILTER_CHOICES,
  matchesProductFilter,
  productFilterEmptyMessage,
  type ProductFilter,
} from '@/features/products/productFilters';
import { useBranches } from '@/hooks/useBranches';
import { useProductBranchPrices, useProductBranchVariantPrices } from '@/hooks/useBranchProducts';
import { useClientPagination } from '@/hooks/useClientPagination';
import {
  useCreateCompleteProduct,
  useCreateInventoryProduct,
  useProductDrinkChoices,
  useProductSkus,
  useProductStockUses,
  useProductVariants,
  useProducts,
  useUpdateCompleteProduct,
  useUpdateInventoryProduct,
} from '@/hooks/useProducts';
import { getErrorMessage, getProductErrorMessage } from '@/lib/errors';
import { confirmAction } from '@/lib/confirmAction';
import { closingStockBehaviorLabel } from '@/lib/format';
import { endSubmit, tryBeginSubmit } from '@/lib/submitLock';
import { DISCARD_DIALOG, decideClose } from '@/features/products/wizardGuards';
import { setProductCategory, setProductNonReturnable, setProductSellInPos, setProductStatus } from '@/services/productService';
import type { Product } from '@/types/models';

function compareSellingPrice(a: Product, b: Product): number {
  if (a.selling_price == null && b.selling_price == null) return 0;
  if (a.selling_price == null) return 1;
  if (b.selling_price == null) return -1;
  return a.selling_price - b.selling_price;
}

type SortOption = 'name-asc' | 'name-desc' | 'price-asc' | 'price-desc';

const SORT_OPTIONS: Array<{ label: string; value: SortOption }> = [
  { label: 'Name (A–Z)', value: 'name-asc' },
  { label: 'Name (Z–A)', value: 'name-desc' },
  { label: 'Price (Low to High)', value: 'price-asc' },
  { label: 'Price (High to Low)', value: 'price-desc' },
];

export default function ManagerProductListScreen() {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<ProductFilter>('all');
  const [sort, setSort] = useState<SortOption>('name-asc');
  const [sortOpen, setSortOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createKey, setCreateKey] = useState(0);
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isEditSubmitting, setIsEditSubmitting] = useState(false);
  const [modeError, setModeError] = useState('');
  const [createNotice, setCreateNotice] = useState('');
  const submittingRef = useRef(false);
  const editSubmittingRef = useRef(false);
  // Whether the open wizard has unsaved edits (reported by the wizard). Refs: read only when closing.
  const createDirtyRef = useRef(false);
  const editDirtyRef = useRef(false);
  const branches = useBranches();
  const sellingBranches = useMemo(
    () => (branches.data ?? []).filter((branch) => branch.is_active && !branch.is_main_branch),
    [branches.data],
  );
  const query = useProducts(search);
  const skuQuery = useProductSkus();
  const createMutation = useCreateCompleteProduct();
  const createInventoryMutation = useCreateInventoryProduct();
  const updateCompleteMutation = useUpdateCompleteProduct();
  const updateInventoryMutation = useUpdateInventoryProduct();
  const editVariants = useProductVariants(editProduct?.id ?? '');
  // Saved Stock Used Per Order. The edit form needs it up front: saving without it could wipe the saved recipes.
  const editStockUses = useProductStockUses(editProduct?.id ?? '');
  const editDrinkChoices = useProductDrinkChoices(editProduct?.id ?? '');
  // Every product can be a stock item, whatever the search box currently filters the list to.
  const allProducts = useProducts('');
  const ingredientProducts = useMemo(
    () =>
      (allProducts.data ?? []).map((product) => ({
        id: product.id,
        name: product.name,
        sellInPos: product.sell_in_pos !== false,
        category: product.product_category ?? null,
      })),
    [allProducts.data],
  );
  const editBranchPrices = useProductBranchPrices(editProduct?.id ?? '');
  const editBranchVariantPrices = useProductBranchVariantPrices(editProduct?.id ?? '');

  const filtered = useMemo(() => {
    const rows = (query.data ?? []).filter((product) => matchesProductFilter(product.is_active, filter));
    return [...rows].sort((a, b) => {
      switch (sort) {
        case 'name-desc':
          return b.name.localeCompare(a.name);
        case 'price-asc':
          return compareSellingPrice(a, b);
        case 'price-desc':
          return compareSellingPrice(b, a);
        default:
          return a.name.localeCompare(b.name);
      }
    });
  }, [query.data, filter, sort]);

  const pagination = useClientPagination(filtered, `${search}|${filter}|${sort}`, 10);

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
    const save = values.sellInPos
      ? createMutation.mutateAsync({
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
        closingStockBehavior: values.closingStockBehavior,
        stockUses: values.stockUses,
        drinkChoices: values.drinkChoices,
      })
      : createInventoryMutation.mutateAsync({
          name: values.name,
          sku: values.sku,
          description: values.description ? values.description : null,
          closingStockBehavior: values.closingStockBehavior,
        });
    void save
      .then(async (product) => {
        let notice = '';
        if (values.isNonReturnable) {
          try {
            await setProductNonReturnable(product.id, true);
          } catch {
            notice = 'Created. Non-returnable was not saved. Edit the product to retry.';
          }
        }
        if (values.productCategory !== 'unset') {
          try {
            await setProductCategory(product.id, values.productCategory);
          } catch {
            notice = 'Created. Category was not saved, so it may not show under Drinks.';
          }
        }
        let active = product.is_active;
        if (values.isActive !== product.is_active) {
          try {
            const updated = await setProductStatus(product.id, values.isActive);
            active = updated.is_active;
          } catch {
            notice = notice
              ? `${notice} Product Status was not saved.`
              : 'Created. Product Status was not saved, so it stays disabled.';
          }
        }
        setCreateNotice(notice);
        setFilter(active ? 'all' : 'inactive');
        setSearch('');
        createDirtyRef.current = false;
        setCreateOpen(false);
      })
      .catch((error: unknown) => {
        const message = getProductErrorMessage(error);
        if (message.toLowerCase().includes('sku')) {
          setFilter('all');
          setSearch(values.sku);
        }
        void message;
      })
      .finally(() => {
        endSubmit(submittingRef);
        setIsSubmitting(false);
      });
  };

  const submitEdit = (values: EditProductValues, catalogDrafts: EditBranchPricingDraft[]) => {
    if (!editProduct) return;
    if (!tryBeginSubmit(editSubmittingRef)) return;
    setIsEditSubmitting(true);
    const hasVariants = values.variants.length > 0;
    setModeError('');
    const productId = editProduct.id;
    const priorNonReturnable = Boolean(editProduct.is_non_returnable);
    const wasSellable = editProduct.sell_in_pos !== false;
    const save = values.sellInPos
      ? updateCompleteMutation.mutateAsync({
        productId,
        name: values.name,
        sku: values.sku,
        description: values.description ? values.description : null,
        isActive: values.isActive,
        closingStockBehavior: values.closingStockBehavior,
        variants: values.variants,
        deletedVariantIds: values.deletedVariantIds,
        branches: catalogDrafts.map((draft) =>
          hasVariants
            ? { branch_id: draft.branchId, variants: draft.variants ?? [] }
            : { branch_id: draft.branchId, selling_price: draft.selling_price },
        ),
        selling_price: hasVariants ? null : values.default_price,
        // undefined when the recipes were not changed: the saved ones are then left exactly as they are
        stockUses: values.stockUses,
        drinkChoices: values.drinkChoices,
      })
      : updateInventoryMutation.mutateAsync({
          productId,
          name: values.name,
          sku: values.sku,
          description: values.description ? values.description : null,
          isActive: values.isActive,
          closingStockBehavior: values.closingStockBehavior,
        });
    void save
      .then(async () => {
        if (values.sellInPos && !wasSellable) {
          await setProductSellInPos(productId, true);
        }
        if (values.isNonReturnable !== priorNonReturnable) {
          await setProductNonReturnable(productId, values.isNonReturnable);
        }
        if (values.productCategory !== 'unset') {
          try {
            await setProductCategory(productId, values.productCategory);
          } catch {
            setCreateNotice('Saved. Category was not saved, so it may not show under Drinks.');
          }
        }
        editDirtyRef.current = false;
        setEditProduct(null);
      })
      .catch((error: unknown) => setModeError(getProductErrorMessage(error)))
      .finally(() => {
        endSubmit(editSubmittingRef);
        setIsEditSubmitting(false);
      });
  };

  // Every way of dismissing a sheet (Close, backdrop, Android back / Escape) calls the sheet's onClose, so they
  // all go through these. Nothing changed: close at once. Unsaved edits: ask first. A save in flight and a
  // successful save are never interrupted (a save closes the sheet directly).
  const requestCloseCreate = () => {
    const closeNow = () => {
      createDirtyRef.current = false;
      setCreateOpen(false);
    };
    if (decideClose({ dirty: createDirtyRef.current, submitting: isSubmitting }) === 'close') {
      closeNow();
      return;
    }
    confirmAction(DISCARD_DIALOG.title, DISCARD_DIALOG.message, closeNow, {
      cancel: DISCARD_DIALOG.cancel,
      confirm: DISCARD_DIALOG.confirm,
    });
  };

  const requestCloseEdit = () => {
    const closeNow = () => {
      editDirtyRef.current = false;
      setEditProduct(null);
    };
    if (decideClose({ dirty: editDirtyRef.current, submitting: isEditSubmitting }) === 'close') {
      closeNow();
      return;
    }
    confirmAction(DISCARD_DIALOG.title, DISCARD_DIALOG.message, closeNow, {
      cancel: DISCARD_DIALOG.cancel,
      confirm: DISCARD_DIALOG.confirm,
    });
  };

  return (
    <MainBranchGuard>
      <Screen backgroundColor="#FFFFFF" edges={['top']} scroll={false} contentContainerStyle={styles.screenContent}>
        <ManagerScreenHeader title="Products" />

        <ConstrainedWidth style={styles.column}>
          <View style={styles.filters}>
            <View style={styles.searchRow}>
              <View style={styles.searchField}>
                <SearchInput value={search} onChangeText={setSearch} placeholder="Search name or SKU" />
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Sort: ${SORT_OPTIONS.find((option) => option.value === sort)?.label}`}
                onPress={() => setSortOpen(true)}
                style={({ pressed }) => [styles.sortButton, pressed && styles.pressed]}
              >
                <Ionicons name="options-outline" size={20} color={managerColors.ink} />
              </Pressable>
            </View>
            <FilterChipRow options={PRODUCT_FILTER_CHOICES} value={filter} onChange={setFilter} />
            {createNotice ? <Text style={styles.createNotice}>{createNotice}</Text> : null}
          </View>

          {query.error ? (
            <ErrorState message={getErrorMessage(query.error)} onRetry={() => void query.refetch()} />
          ) : query.isLoading && !query.data ? (
            <LoadingState label="Loading products…" />
          ) : (
            <FlatList
              data={pagination.pageItems}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.listContent}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
              ListEmptyComponent={<EmptyState title={empty.title} message={empty.message} />}
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
                <ListRowCard
                  title={item.name}
                  meta={
                    [
                      item.sku,
                      item.sell_in_pos === false ? 'Stock only' : null,
                      closingStockBehaviorLabel(item.closing_stock_behavior),
                    ]
                      .filter(Boolean)
                      .join(' · ')
                  }
                  trailing={
                    <ManagerBadge
                      label={item.is_active ? 'Enabled' : 'Disabled'}
                      tone={item.is_active ? 'success' : 'neutral'}
                    />
                  }
                  onPress={() => {
                    editDirtyRef.current = false;
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
                createDirtyRef.current = false;
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

        <BottomSheet visible={createOpen} title="Create product" scroll onClose={requestCloseCreate}>
          <CreateProductWizard
            key={createKey}
            existingSkus={existingSkus}
            branchOptions={branchOptions}
            ingredientProducts={ingredientProducts}
            loading={isSubmitting}
            error={
              createMutation.error
                ? getProductErrorMessage(createMutation.error)
                : createInventoryMutation.error
                  ? getProductErrorMessage(createInventoryMutation.error)
                  : undefined
            }
            onSubmit={submitCreate}
            onDirtyChange={(dirty) => {
              createDirtyRef.current = dirty;
            }}
          />
        </BottomSheet>

        <BottomSheet
          visible={editProduct != null}
          title="Edit product"
          scroll
          onClose={requestCloseEdit}
        >
          {editProduct && (editVariants.isLoading || editBranchPrices.isLoading || editBranchVariantPrices.isLoading || editStockUses.isLoading || editDrinkChoices.isLoading) ? (
            <LoadingState label="Loading product…" />
          ) : editProduct && (editStockUses.error || !editStockUses.data || editDrinkChoices.error || !editDrinkChoices.data) ? (
            // Never open the form without the saved recipes and drink choices: saving would replace them with nothing.
            <ErrorState
              message="Couldn't load stock and drink choices. Retry before editing."
              onRetry={() => {
                void editStockUses.refetch();
                void editDrinkChoices.refetch();
              }}
            />
          ) : editProduct ? (
            <EditProductWizard
              key={editProduct.id}
              product={{
                id: editProduct.id,
                name: editProduct.name,
                sku: editProduct.sku,
                description: editProduct.description,
                is_active: editProduct.is_active,
                sell_in_pos: editProduct.sell_in_pos !== false,
                product_category: editProduct.product_category ?? null,
                closing_stock_behavior: editProduct.closing_stock_behavior,
                is_non_returnable: Boolean(editProduct.is_non_returnable),
              }}
              sourceVariants={(editVariants.data ?? []).map((variant) => ({
                id: variant.id,
                name: variant.name,
                default_price: variant.default_price,
              }))}
              sourceBranchPrices={(editBranchPrices.data ?? []).map((row) => ({
                branch_id: row.branch_id,
                selling_price: row.selling_price,
              }))}
              sourceBranchVariantPrices={(editBranchVariantPrices.data ?? []).map((row) => ({
                branch_id: row.branch_id,
                name: row.name,
                selling_price: row.selling_price,
              }))}
              sourceStockUses={(editStockUses.data ?? []).map((row) => ({
                variant_id: row.variant_id,
                ingredient_product_id: row.ingredient_product_id,
                quantity: row.quantity,
              }))}
              sourceDrinkChoices={(editDrinkChoices.data ?? []).map((row) => ({
                variant_id: row.variant_id,
                drink_product_id: row.drink_product_id,
              }))}
              ingredientProducts={ingredientProducts}
              branchOptions={branchOptions}
              loading={isEditSubmitting}
              error={
                modeError
                || (updateCompleteMutation.error ? getProductErrorMessage(updateCompleteMutation.error) : undefined)
              }
              onSubmit={submitEdit}
              onDirtyChange={(dirty) => {
                editDirtyRef.current = dirty;
              }}
            />
          ) : null}
        </BottomSheet>

        <BottomSheet visible={sortOpen} title="Sort" onClose={() => setSortOpen(false)}>
          <View style={styles.sortList}>
            {SORT_OPTIONS.map((option) => {
              const isSelected = option.value === sort;
              return (
                <Pressable
                  key={option.value}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  onPress={() => {
                    setSort(option.value);
                    setSortOpen(false);
                  }}
                  style={({ pressed }) => [
                    styles.sortRow,
                    isSelected && styles.sortRowSelected,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={[styles.sortRowLabel, isSelected && styles.sortRowLabelSelected]}>
                    {option.label}
                  </Text>
                  {isSelected ? (
                    <Ionicons name="checkmark" size={20} color={managerColors.royalBlue} />
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        </BottomSheet>
      </Screen>
    </MainBranchGuard>
  );
}

const styles = StyleSheet.create({
  screenContent: { flexGrow: 1, padding: 0, gap: 0 },
  column: { flex: 1, paddingHorizontal: 20, paddingTop: 16 },
  filters: { gap: 12, marginBottom: 14 },
  createNotice: { color: '#92400E', fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 18 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  searchField: { flex: 1 },
  sortButton: {
    width: 46,
    height: 46,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    backgroundColor: managerColors.cardSurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.75 },
  sortList: { gap: 8, paddingBottom: 8 },
  sortRow: {
    minHeight: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  sortRowSelected: { borderColor: managerColors.royalBlue, backgroundColor: '#EAF0FB' },
  sortRowLabel: { color: managerColors.ink, fontFamily: 'Inter_500Medium', fontSize: 15, flex: 1 },
  sortRowLabelSelected: { color: managerColors.royalBlue, fontFamily: 'Inter_700Bold' },
  listContent: { paddingBottom: 12, flexGrow: 1 },
  separator: { height: 12 },
  pager: { alignItems: 'center', gap: 4, paddingTop: 8 },
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
