import { router } from 'expo-router';
import { useState } from 'react';

import { AppButton } from '@/components/AppButton';
import { EmptyState, ErrorState, LoadingState } from '@/components/Feedback';
import { FormField } from '@/components/FormField';
import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';
import { ProductListItem } from '@/features/products/ProductListItem';
import { useProducts } from '@/hooks/useProducts';
import { getErrorMessage } from '@/lib/errors';

export default function ProductListScreen() {
  const [search, setSearch] = useState('');
  const query = useProducts(search);

  return (
    <Screen>
      <PageHeader title="Products" subtitle="Product master data. Inventory quantities are managed separately." />
      <AppButton label="Create product" onPress={() => router.push('/owner/products/create')} />
      <FormField label="Search" value={search} onChangeText={setSearch} placeholder="Name or SKU" autoCapitalize="none" />
      {query.isLoading ? <LoadingState label="Loading products…" /> : null}
      {query.error ? <ErrorState message={getErrorMessage(query.error)} onRetry={() => void query.refetch()} /> : null}
      {query.data?.length === 0 ? <EmptyState title="No products found" message={search ? 'Try another name or SKU.' : 'Create the first product to get started.'} /> : null}
      {query.data?.map((product) => <ProductListItem key={product.id} product={product} onPress={() => router.push({ pathname: '/owner/products/[id]', params: { id: product.id } })} />)}
    </Screen>
  );
}
