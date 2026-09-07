import { router, useLocalSearchParams } from 'expo-router';

import { ErrorState, LoadingState } from '@/components/Feedback';
import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';
import { ProductForm } from '@/features/products/ProductForm';
import type { ProductFormValues } from '@/features/products/productSchema';
import { useProduct, useUpdateProduct } from '@/hooks/useProducts';
import { getErrorMessage } from '@/lib/errors';

export default function EditProductScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : '';
  const query = useProduct(id);
  const mutation = useUpdateProduct(id);

  if (query.isLoading) return <LoadingState label="Loading product…" />;
  if (query.error || !query.data) return <Screen><ErrorState message={getErrorMessage(query.error)} onRetry={() => void query.refetch()} /></Screen>;

  const product = query.data;
  const submit = (values: ProductFormValues) => {
    mutation.mutate(
      { name: values.name, sku: values.sku, description: values.description?.trim() || null, selling_price: Number(values.selling_price), is_active: values.is_active },
      { onSuccess: () => router.back() },
    );
  };

  return (
    <Screen>
      <PageHeader title="Edit product" subtitle="Use inactive status instead of deleting historical master data." />
      <ProductForm
        defaultValues={{ name: product.name, sku: product.sku, description: product.description ?? '', selling_price: product.selling_price.toFixed(2), is_active: product.is_active }}
        submitLabel="Save changes"
        loading={mutation.isPending}
        error={mutation.error ? getErrorMessage(mutation.error) : undefined}
        onSubmit={submit}
      />
    </Screen>
  );
}
