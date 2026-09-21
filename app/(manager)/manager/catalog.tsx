import { useEffect, useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { FormField } from '@/components/FormField';
import { Screen } from '@/components/Screen';
import { SwitchField } from '@/components/SwitchField';
import { FilterChipRow } from '@/components/dashboard/FilterChipRow';
import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { EmptyState, ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { SearchInput } from '@/components/dashboard/SearchInput';
import { managerColors } from '@/components/dashboard/theme';
import { MainBranchGuard } from '@/features/auth/MainBranchGuard';
import { useBranches } from '@/hooks/useBranches';
import {
  useBranchProducts,
  useConfigureBranchProducts,
} from '@/hooks/useBranchProducts';
import { useProducts } from '@/hooks/useProducts';
import { getErrorMessage } from '@/lib/errors';
import { formatMoney } from '@/lib/format';

type CatalogDraft = Record<string, { is_active: boolean; selling_price: string }>;

const PRICE_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;

export default function BranchCatalogScreen() {
  const branches = useBranches();
  const products = useProducts();
  const sellingBranches = useMemo(
    () => (branches.data ?? []).filter((branch) => branch.is_active && !branch.is_main_branch),
    [branches.data],
  );
  const [branchId, setBranchId] = useState('');
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<CatalogDraft>({});
  const [validation, setValidation] = useState('');
  const catalog = useBranchProducts(branchId);
  const mutation = useConfigureBranchProducts(branchId);

  useEffect(() => {
    if (!branchId && sellingBranches[0]) setBranchId(sellingBranches[0].id);
  }, [branchId, sellingBranches]);

  useEffect(() => {
    if (!branchId || !products.data || !catalog.data) return;
    const entries = new Map(catalog.data.map((entry) => [entry.product_id, entry]));
    setDraft(
      Object.fromEntries(
        products.data.map((product) => {
          const entry = entries.get(product.id);
          return [
            product.id,
            {
              // A product never carried by this branch before defaults to
              // ON (available in this branch); an existing saved row keeps
              // whatever state the Main Branch Manager last set.
              is_active: entry?.is_active ?? true,
              selling_price: (entry?.selling_price ?? product.selling_price).toFixed(2),
            },
          ];
        }),
      ),
    );
    setValidation('');
  }, [branchId, catalog.data, products.data]);

  const visibleProducts = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return products.data ?? [];
    return (products.data ?? []).filter((product) =>
      `${product.name} ${product.sku}`.toLowerCase().includes(term),
    );
  }, [products.data, search]);

  const totalProducts = products.data?.length ?? 0;
  const notCarriedCount = (products.data ?? []).filter((product) => !draft[product.id]?.is_active).length;

  const selectBranch = (nextBranchId: string) => {
    mutation.reset();
    setBranchId(nextBranchId);
    setDraft({});
    setValidation('');
  };

  const save = () => {
    if (!products.data?.length || !branchId) return;
    const invalid = products.data.find((product) => {
      const item = draft[product.id];
      return !item || !PRICE_PATTERN.test(item.selling_price.trim());
    });
    if (invalid) {
      setValidation(`Enter a valid price with at most two decimals for ${invalid.name}.`);
      return;
    }

    setValidation('');
    mutation.mutate(
      products.data.map((product) => ({
        product_id: product.id,
        selling_price: Number(draft[product.id].selling_price),
        is_active: draft[product.id].is_active,
      })),
    );
  };

  const loading =
    branches.isLoading ||
    products.isLoading ||
    (Boolean(branchId) && catalog.isLoading);
  const loadError = branches.error ?? products.error ?? catalog.error;

  return (
    <MainBranchGuard>
      <Screen
        backgroundColor="#FFFFFF"
        edges={['top']}
        scroll={false}
        contentContainerStyle={styles.screen}
      >
        <ManagerScreenHeader title="Branch Catalogs" showBack />

        <ConstrainedWidth style={styles.column}>
          {sellingBranches.length > 0 ? (
            <View style={styles.filters}>
              <SearchInput
                value={search}
                onChangeText={setSearch}
                placeholder="Search product name or SKU"
              />
              <FilterChipRow
                options={sellingBranches.map((branch) => ({
                  label: branch.name,
                  value: branch.id,
                }))}
                value={branchId}
                onChange={selectBranch}
              />
            </View>
          ) : null}

          {sellingBranches.length > 0 && !loading && !loadError ? (
            <Text style={styles.summary}>
              {totalProducts} {totalProducts === 1 ? 'product' : 'products'} · {notCarriedCount} not carried
            </Text>
          ) : null}

          {loadError ? (
            <ErrorState
              message={getErrorMessage(loadError)}
              onRetry={() => {
                void branches.refetch();
                void products.refetch();
                void catalog.refetch();
              }}
            />
          ) : loading ? (
            <LoadingState label="Loading branch catalog…" />
          ) : sellingBranches.length === 0 ? (
            <EmptyState
              title="No active selling branches"
              message="Create or activate a selling branch before configuring its catalog."
            />
          ) : (
            <FlatList
              data={visibleProducts}
              keyExtractor={(product) => product.id}
              contentContainerStyle={styles.list}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
              ListEmptyComponent={
                <EmptyState
                  title="No products found"
                  message={search.trim() ? 'Try another name or SKU.' : 'Create a product first.'}
                />
              }
              renderItem={({ item: product }) => {
                const item = draft[product.id];
                if (!item) return null;
                const priceInvalid = !PRICE_PATTERN.test(item.selling_price.trim());
                return (
                  <View style={styles.card}>
                    <View style={styles.productHeader}>
                      <View style={styles.productCopy}>
                        <Text style={styles.productName}>{product.name}</Text>
                        <Text style={styles.productMeta}>
                          {product.sku} · Base {formatMoney(product.selling_price)}
                          {!product.is_active ? ' · Globally inactive' : ''}
                        </Text>
                      </View>
                    </View>
                    <SwitchField
                      label="Available in this branch"
                      description={
                        item.is_active
                          ? 'Visible in this branch POS when globally active.'
                          : 'Hidden from POS and blocked from new transfers.'
                      }
                      value={item.is_active}
                      onValueChange={(is_active) =>
                        setDraft((current) => ({
                          ...current,
                          [product.id]: { ...current[product.id], is_active },
                        }))
                      }
                      activeTrackColor={managerColors.royalBlue}
                      labelStyle={styles.fieldLabel}
                    />
                    <FormField
                      label="Branch selling price (PHP)"
                      value={item.selling_price}
                      onChangeText={(selling_price) =>
                        setDraft((current) => ({
                          ...current,
                          [product.id]: { ...current[product.id], selling_price },
                        }))
                      }
                      keyboardType="decimal-pad"
                      error={priceInvalid ? 'Use 0 to 9,999,999,999.99.' : undefined}
                      labelStyle={styles.fieldLabel}
                      errorStyle={styles.fieldError}
                      accentColor={managerColors.royalBlue}
                      style={styles.fieldInput}
                    />
                  </View>
                );
              }}
            />
          )}

          {sellingBranches.length > 0 && !loadError ? (
            <View style={styles.footer}>
              {validation || mutation.error ? (
                <Text accessibilityRole="alert" style={styles.error}>
                  {validation || getErrorMessage(mutation.error)}
                </Text>
              ) : mutation.isSuccess ? (
                <Text accessibilityRole="alert" style={styles.success}>
                  Branch catalog saved.
                </Text>
              ) : null}
              <ManagerActionButton
                label="Save branch catalog"
                icon="checkmark-circle-outline"
                loading={mutation.isPending}
                disabled={loading || !products.data?.length}
                onPress={save}
              />
            </View>
          ) : null}
        </ConstrainedWidth>
      </Screen>
    </MainBranchGuard>
  );
}

const styles = StyleSheet.create({
  screen: { flexGrow: 1, padding: 0, gap: 0 },
  column: { flex: 1, paddingHorizontal: 20, paddingTop: 16 },
  filters: { gap: 12, marginBottom: 14 },
  summary: {
    color: managerColors.subtext,
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    marginBottom: 10,
  },
  list: { paddingBottom: 16, flexGrow: 1 },
  separator: { height: 12 },
  card: {
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 16,
    padding: 16,
    gap: 12,
    backgroundColor: '#FFFFFF',
  },
  productHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  productCopy: { flex: 1, gap: 3 },
  productName: {
    color: managerColors.ink,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
  },
  productMeta: {
    color: managerColors.subtext,
    fontFamily: 'Inter_400Regular',
    fontSize: 12.5,
  },
  fieldLabel: { fontFamily: 'Inter_600SemiBold', color: managerColors.ink },
  fieldInput: { fontFamily: 'Inter_400Regular' },
  fieldError: { fontFamily: 'Inter_500Medium' },
  error: {
    color: '#B91C1C',
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    lineHeight: 18,
  },
  success: {
    color: managerColors.green,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
  },
  footer: {
    marginHorizontal: -20,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
    borderTopWidth: 1,
    borderTopColor: managerColors.cardBorder,
    backgroundColor: '#FFFFFF',
    gap: 10,
  },
});
