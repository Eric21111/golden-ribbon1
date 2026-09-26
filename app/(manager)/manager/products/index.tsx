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
import { useInventory } from '@/hooks/useInventory';
import {
  useCreateCompleteProduct,
  useProductSkus,
  useProductVariants,
  useProducts,
  useUpdateCompleteProduct,
} from '@/hooks/useProducts';
import { getErrorMessage, getProductErrorMessage } from '@/lib/errors';
import { endSubmit, tryBeginSubmit } from '@/lib/submitLock';
import type { Product } from '@/types/models';

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
  const submittingRef = useRef(false);
  const editSubmittingRef = useRef(false);
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
  const updateCompleteMutation = useUpdateCompleteProduct();
  const editVariants = useProductVariants(editProduct?.id ?? '');
  const editBranchPrices = useProductBranchPrices(editProduct?.id ?? '');
  const editBranchVariantPrices = useProductBranchVariantPrices(editProduct?.id ?? '');

  const filtered = useMemo(() => {
    const rows = (query.data ?? []).filter((product) => matchesProductFilter(product.is_active, filter));
    return [...rows].sort((a, b) => {
      switch (sort) {
        case 'name-desc':
          return b.name.localeCompare(a.name);
        case 'price-asc':
          return a.selling_price - b.selling_price;
        case 'price-desc':
          return b.selling_price - a.selling_price;
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

  const submitEdit = (values: EditProductValues, catalogDrafts: EditBranchPricingDraft[]) => {
    if (!editProduct) return;
    if (!tryBeginSubmit(editSubmittingRef)) return;
    setIsEditSubmitting(true);
    const hasVariants = values.variants.length > 0;
    void updateCompleteMutation
      .mutateAsync({
        productId: editProduct.id,
        name: values.name,
        sku: values.sku,
        description: values.description ? values.description : null,
        isActive: values.isActive,
        variants: values.variants,
        deletedVariantIds: values.deletedVariantIds,
        branches: catalogDrafts.map((draft) =>
          hasVariants
            ? { branch_id: draft.branchId, variants: draft.variants ?? [] }
            : { branch_id: draft.branchId, selling_price: draft.selling_price },
        ),
        selling_price: hasVariants ? null : values.default_price,
      })
      .then(() => setEditProduct(null))
      .finally(() => {
        endSubmit(editSubmittingRef);
        setIsEditSubmitting(false);
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
                  meta={item.is_active ? item.sku : `${item.sku} · Inactive until opening stock`}
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
          {editProduct && (editVariants.isLoading || editBranchPrices.isLoading || editBranchVariantPrices.isLoading) ? (
            <LoadingState label="Loading product…" />
          ) : editProduct ? (
            <EditProductWizard
              key={editProduct.id}
              product={{
                name: editProduct.name,
                sku: editProduct.sku,
                description: editProduct.description,
                is_active: editProduct.is_active,
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
              branchOptions={branchOptions}
              canActivate={Boolean(
                mainInventory.data?.some(
                  (row) => row.product.id === editProduct.id && (row.quantity_on_hand > 0 || row.updated_at != null),
                ),
              )}
              loading={isEditSubmitting}
              error={updateCompleteMutation.error ? getProductErrorMessage(updateCompleteMutation.error) : undefined}
              onSubmit={submitEdit}
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
