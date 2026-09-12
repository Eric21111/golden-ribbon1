import { router } from 'expo-router';
import { useState } from 'react';

import { MainBranchGuard } from '@/features/auth/MainBranchGuard';
import { ProductHub } from '@/features/products/ProductHub';
import { useProducts } from '@/hooks/useProducts';
import { getErrorMessage } from '@/lib/errors';

export default function ManagerProductListScreen() {
  const [search, setSearch] = useState('');
  const query = useProducts(search);

  return (
    <MainBranchGuard>
      <ProductHub
        subtitle="Catalog master data"
        products={query.data}
        isLoading={query.isLoading}
        error={query.error ? getErrorMessage(query.error) : null}
        onRetry={() => void query.refetch()}
        onRefresh={() => void query.refetch()}
        isRefreshing={query.isRefetching}
        search={search}
        onSearchChange={setSearch}
        showActivityFilters
        canCreate
        onPressProduct={(product) =>
          router.push({ pathname: '/manager/products/[id]', params: { id: product.id } } as never)
        }
      />
    </MainBranchGuard>
  );
}
