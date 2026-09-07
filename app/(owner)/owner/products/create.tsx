import { router } from 'expo-router';

import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';
import { ProductForm } from '@/features/products/ProductForm';
import type { ProductFormValues } from '@/features/products/productSchema';
import { useCreateProduct } from '@/hooks/useProducts';
import { getErrorMessage } from '@/lib/errors';

export default function CreateProductScreen() {
  const mutation = useCreateProduct();
  const submit = (values: ProductFormValues) => {
    mutation.mutate(
      { name: values.name, sku: values.sku, description: values.description?.trim() || null, selling_price: Number(values.selling_price), is_active: values.is_active },
      { onSuccess: () => router.back() },
    );
  };

  return (
    <Screen>
      <PageHeader title="New product" subtitle="Create product master data only—no inventory quantity is added." />
      <ProductForm submitLabel="Create product" loading={mutation.isPending} error={mutation.error ? getErrorMessage(mutation.error) : undefined} onSubmit={submit} />
    </Screen>
  );
}
