import { useState } from 'react';

import { EmptyState, ErrorState, LoadingState } from '@/components/Feedback';
import { FormField } from '@/components/FormField';
import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';
import { ProductListItem } from '@/features/products/ProductListItem';
import { useProducts } from '@/hooks/useProducts';
import { getErrorMessage } from '@/lib/errors';

export default function ManagerProductsScreen() {
  const [search, setSearch] = useState('');
  const query = useProducts(search, true);

  return (
    <Screen>
      <PageHeader title="Products" subtitle="Active products available to your branch." />
      <FormField label="Search" value={search} onChangeText={setSearch} placeholder="Name or SKU" autoCapitalize="none" />
      {query.isLoading ? <LoadingState label="Loading products…" /> : null}
      {query.error ? <ErrorState message={getErrorMessage(query.error)} onRetry={() => void query.refetch()} /> : null}
      {query.data?.length === 0 ? <EmptyState title="No products found" message="Try another name or SKU." /> : null}
      {query.data?.map((product) => <ProductListItem key={product.id} product={product} />)}
    </Screen>
  );
}
