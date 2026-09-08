import { useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, TextInput, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { BottomSheet } from '@/components/BottomSheet';
import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { EmptyState, ErrorState, LoadingState } from '@/components/Feedback';
import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';
import { colors, radius, spacing } from '@/constants/theme';
import { ChoiceChips } from '@/features/employees/ChoiceChips';
import { useCreateProduct } from '@/hooks/useProducts';
import { getErrorMessage } from '@/lib/errors';
import { useLayout } from '@/lib/layout';
import type { Product } from '@/types/models';

import { ProductForm } from './ProductForm';
import { ProductListItem } from './ProductListItem';
import {
  PRODUCT_FILTER_CHOICES,
  matchesProductFilter,
  productFilterEmptyMessage,
  type ProductFilter,
} from './productFilters';
import type { ProductFormValues } from './productSchema';

type ProductHubProps = {
  title?: string;
  subtitle: string;
  products: Product[] | undefined;
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
  onRefresh: () => void;
  isRefreshing?: boolean;
  search: string;
  onSearchChange: (value: string) => void;
  showActivityFilters?: boolean;
  canCreate?: boolean;
  onPressProduct?: (product: Product) => void;
};

export function ProductHub({
  title = 'Products',
  subtitle,
  products,
  isLoading,
  error,
  onRetry,
  onRefresh,
  isRefreshing = false,
  search,
  onSearchChange,
  showActivityFilters = false,
  canCreate = false,
  onPressProduct,
}: ProductHubProps) {
  const { isTablet, productColumns, catalogMaxWidth } = useLayout();
  const [filter, setFilter] = useState<ProductFilter>('all');
  const [createOpen, setCreateOpen] = useState(false);
  const createMutation = useCreateProduct();

  const filtered = useMemo(() => {
    return (products ?? []).filter((product) => matchesProductFilter(product.is_active, filter));
  }, [products, filter]);

  const empty =
    filter === 'all' && !search.trim()
      ? productFilterEmptyMessage('all', false, canCreate)
      : productFilterEmptyMessage(filter, Boolean(search.trim()), canCreate);

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

  const columns = isTablet ? productColumns : 1;

  return (
    <Screen scroll={false} contentContainerStyle={styles.screen}>
      <ConstrainedWidth maxWidth={catalogMaxWidth} fill enabled={isTablet}>
        <View style={styles.layout}>
          <View style={styles.top}>
            <PageHeader title={title} subtitle={subtitle} />

            <TextInput
              accessibilityLabel="Search products"
              placeholder="Search name or SKU"
              placeholderTextColor={colors.muted}
              value={search}
              onChangeText={onSearchChange}
              autoCorrect={false}
              autoCapitalize="none"
              clearButtonMode="while-editing"
              style={styles.search}
            />

            {showActivityFilters ? (
              <ChoiceChips choices={PRODUCT_FILTER_CHOICES} value={filter} onChange={setFilter} />
            ) : null}
          </View>

          {isLoading && !products ? <LoadingState label="Loading products…" /> : null}
          {error ? <ErrorState message={error} onRetry={onRetry} /> : null}

          {!error && (products || !isLoading) ? (
            <FlatList
              key={`product-cols-${columns}`}
              data={filtered}
              keyExtractor={(item) => item.id}
              numColumns={columns}
              contentContainerStyle={styles.listContent}
              columnWrapperStyle={columns > 1 ? styles.columnWrapper : undefined}
              style={styles.list}
              refreshControl={
                <RefreshControl
                  refreshing={isRefreshing}
                  onRefresh={onRefresh}
                  tintColor={colors.primary}
                />
              }
              ItemSeparatorComponent={
                columns === 1 ? () => <View style={styles.separator} /> : undefined
              }
              ListEmptyComponent={
                isLoading ? (
                  <LoadingState label="Loading products…" />
                ) : (
                  <EmptyState title={empty.title} message={empty.message} />
                )
              }
              renderItem={({ item }) => (
                <View style={columns > 1 ? styles.gridCell : undefined}>
                  <ProductListItem
                    product={item}
                    onPress={onPressProduct ? () => onPressProduct(item) : undefined}
                  />
                </View>
              )}
            />
          ) : null}

          {canCreate ? (
            <View style={styles.footer}>
              <AppButton
                label="Create product"
                onPress={() => {
                  createMutation.reset();
                  setCreateOpen(true);
                }}
              />
            </View>
          ) : null}
        </View>
      </ConstrainedWidth>

      {canCreate ? (
        <BottomSheet
          visible={createOpen}
          title="Create product"
          scroll
          onClose={() => setCreateOpen(false)}
        >
          <ProductForm
            submitLabel="Create product"
            loading={createMutation.isPending}
            error={createMutation.error ? getErrorMessage(createMutation.error) : undefined}
            onSubmit={submitCreate}
          />
        </BottomSheet>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { flexGrow: 1, padding: 0, gap: 0 },
  layout: { flex: 1, minHeight: 0 },
  top: { paddingHorizontal: spacing.md, paddingTop: spacing.md, gap: spacing.sm },
  search: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: colors.text,
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
  },
});
