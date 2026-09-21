import { useEffect, useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { Screen } from '@/components/Screen';
import { FilterChipRow } from '@/components/dashboard/FilterChipRow';
import { ManagerBadge } from '@/components/dashboard/ManagerBadge';
import { EmptyState, ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { SearchInput } from '@/components/dashboard/SearchInput';
import { managerColors } from '@/components/dashboard/theme';
import { MainBranchGuard } from '@/features/auth/MainBranchGuard';
import { useBranches } from '@/hooks/useBranches';
import { useBranchProducts } from '@/hooks/useBranchProducts';
import { useProducts } from '@/hooks/useProducts';
import { getErrorMessage } from '@/lib/errors';
import { formatMoney } from '@/lib/format';

export default function BranchCatalogScreen() {
  const branches = useBranches();
  const products = useProducts();
  const sellingBranches = useMemo(
    () => (branches.data ?? []).filter((branch) => branch.is_active && !branch.is_main_branch),
    [branches.data],
  );
  const [branchId, setBranchId] = useState('');
  const [search, setSearch] = useState('');
  const catalog = useBranchProducts(branchId, false);

  useEffect(() => {
    if (!branchId && sellingBranches[0]) setBranchId(sellingBranches[0].id);
  }, [branchId, sellingBranches]);

  const visibleRows = useMemo(() => {
    const byId = new Map((catalog.data ?? []).map((row) => [row.product_id, row]));
    const term = search.trim().toLowerCase();
    return (products.data ?? [])
      .filter((product) => {
        const entry = byId.get(product.id);
        if (!entry?.is_active) return false;
        if (!term) return true;
        return `${product.name} ${product.sku}`.toLowerCase().includes(term);
      })
      .map((product) => ({
        product,
        entry: byId.get(product.id)!,
      }));
  }, [catalog.data, products.data, search]);

  const loading =
    branches.isLoading || products.isLoading || (Boolean(branchId) && catalog.isLoading);
  const loadError = branches.error ?? products.error ?? catalog.error;

  return (
    <MainBranchGuard>
      <Screen backgroundColor="#FFFFFF" edges={['top']} scroll={false} contentContainerStyle={styles.screen}>
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
                onChange={setBranchId}
              />
            </View>
          ) : null}

          {sellingBranches.length > 0 && !loading && !loadError ? (
            <Text style={styles.summary}>
              {visibleRows.length} available {visibleRows.length === 1 ? 'product' : 'products'} · view only
            </Text>
          ) : null}

          <Text style={styles.hint}>
            Price and availability are read-only here. Edit them from Products (branch price confirm).
          </Text>

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
              message="Create or activate a selling branch before viewing its catalog."
            />
          ) : (
            <FlatList
              data={visibleRows}
              keyExtractor={(row) => row.product.id}
              contentContainerStyle={styles.list}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
              ListEmptyComponent={
                <EmptyState
                  title="No available products"
                  message={
                    search.trim()
                      ? 'Try another name or SKU.'
                      : 'Send stock or set a branch price from Products to make items available here.'
                  }
                />
              }
              renderItem={({ item }) => (
                <View style={styles.card}>
                  <View style={styles.row}>
                    <View style={styles.copy}>
                      <Text style={styles.name}>{item.product.name}</Text>
                      <Text style={styles.meta}>{item.product.sku}</Text>
                    </View>
                    <ManagerBadge label="Available" tone="success" />
                  </View>
                  <Text style={styles.priceLabel}>Branch price</Text>
                  <Text style={styles.priceValue}>{formatMoney(item.entry.selling_price)}</Text>
                </View>
              )}
            />
          )}
        </ConstrainedWidth>
      </Screen>
    </MainBranchGuard>
  );
}

const styles = StyleSheet.create({
  screen: { flexGrow: 1, padding: 0, gap: 0 },
  column: { flex: 1, paddingHorizontal: 20, paddingTop: 16, gap: 12 },
  filters: { gap: 12 },
  summary: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 13 },
  hint: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18 },
  list: { paddingBottom: 24, flexGrow: 1 },
  separator: { height: 10 },
  card: {
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 16,
    padding: 14,
    gap: 8,
    backgroundColor: managerColors.cardSurface,
  },
  row: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  copy: { flex: 1, gap: 4 },
  name: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 15 },
  meta: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 13 },
  priceLabel: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 12 },
  priceValue: { color: managerColors.royalBlue, fontFamily: 'Inter_700Bold', fontSize: 16 },
});
