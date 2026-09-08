import { useState } from 'react';

import { ProductHub } from '@/features/products/ProductHub';
import { useProducts } from '@/hooks/useProducts';
import { getErrorMessage } from '@/lib/errors';

export default function ManagerProductsScreen() {
  const [search, setSearch] = useState('');
  const query = useProducts(search, true);

  return (
    <ProductHub
      subtitle="Active catalog reference"
      products={query.data}
      isLoading={query.isLoading}
      error={query.error ? getErrorMessage(query.error) : null}
      onRetry={() => void query.refetch()}
      onRefresh={() => void query.refetch()}
      isRefreshing={query.isRefetching}
      search={search}
      onSearchChange={setSearch}
    />
  );
}
