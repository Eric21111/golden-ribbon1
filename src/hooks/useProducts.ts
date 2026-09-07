import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/lib/queryKeys';
import { createProduct, getProduct, listProducts, updateProduct } from '@/services/productService';
import type { ProductInput } from '@/types/models';

export function useProducts(search = '', activeOnly = false) {
  return useQuery({
    queryKey: queryKeys.products(search, activeOnly),
    queryFn: () => listProducts({ search, activeOnly }),
  });
}

export function useProduct(id: string) {
  return useQuery({ queryKey: queryKeys.product(id), queryFn: () => getProduct(id), enabled: Boolean(id) });
}

export function useCreateProduct() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: createProduct,
    onSuccess: () => client.invalidateQueries({ queryKey: ['products'] }),
  });
}

export function useUpdateProduct(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: ProductInput) => updateProduct(id, input),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['products'] }),
        client.invalidateQueries({ queryKey: queryKeys.product(id) }),
      ]);
    },
  });
}
