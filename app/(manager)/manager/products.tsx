import { useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { EmptyState, ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { Screen } from '@/components/Screen';
import { ListRowCard } from '@/components/dashboard/ListRowCard';
import { ManagerBadge } from '@/components/dashboard/ManagerBadge';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { SearchInput } from '@/components/dashboard/SearchInput';
import { managerColors } from '@/components/dashboard/theme';
import { useProducts } from '@/hooks/useProducts';
import { getErrorMessage } from '@/lib/errors';
import { formatMoney } from '@/lib/format';

export default function ManagerProductsScreen() {
  const [search, setSearch] = useState('');
  const query = useProducts(search, true);

  const products = query.data ?? [];

  return (
    <Screen backgroundColor="#FFFFFF" edges={['top']} scroll={false} contentContainerStyle={styles.screenContent}>
      <ManagerScreenHeader title="Products" subtitle="Active catalog reference" />

      <ConstrainedWidth style={styles.column}>
        <View style={styles.searchBlock}>
          <SearchInput value={search} onChangeText={setSearch} placeholder="Search name or SKU" />
        </View>

        {query.error ? (
          <ErrorState message={getErrorMessage(query.error)} onRetry={() => void query.refetch()} />
        ) : query.isLoading && !query.data ? (
          <LoadingState label="Loading products…" />
        ) : (
          <FlatList
            data={products}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            refreshControl={
              <RefreshControl
                refreshing={query.isRefetching}
                onRefresh={() => void query.refetch()}
                tintColor={managerColors.royalBlue}
              />
            }
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            ListEmptyComponent={
              <EmptyState
                title="No products found"
                message={search.trim() ? 'Try another name or SKU.' : 'Products created by the owner will appear here.'}
              />
            }
            renderItem={({ item }) => (
              <ListRowCard
                icon="fast-food-outline"
                iconColor="gold"
                title={item.name}
                subtitle={item.sku}
                meta={formatMoney(item.selling_price)}
                trailing={
                  <ManagerBadge label={item.is_active ? 'Active' : 'Inactive'} tone={item.is_active ? 'success' : 'neutral'} />
                }
              />
            )}
          />
        )}
      </ConstrainedWidth>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenContent: { flexGrow: 1, padding: 0, gap: 0 },
  column: { flex: 1, paddingHorizontal: 20, paddingTop: 16 },
  searchBlock: { marginBottom: 14 },
  listContent: { paddingBottom: 16, flexGrow: 1 },
  separator: { height: 10 },
});
