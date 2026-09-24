import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/lib/queryKeys';
import {
  configureProductVariants,
  createCompleteProduct,
  createProduct,
  getProduct,
  listProductSkus,
  listProductVariants,
  listProducts,
  updateBranchProductVariantPrice,
  updateProduct,
  updateProductVariant,
  type CreateCompleteProductInput,
} from '@/services/productService';
import type { ProductInput } from '@/types/models';

export function useProducts(search = '', activeOnly = false) {
  return useQuery({
    queryKey: queryKeys.products(search, activeOnly),
    queryFn: () => listProducts({ search, activeOnly }),
  });
}

export function useProductSkus() {
  return useQuery({
    queryKey: ['products', 'skus'] as const,
    queryFn: listProductSkus,
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

export function useProductVariants(productId: string) {
  return useQuery({
    queryKey: ['product-variants', productId],
    queryFn: () => listProductVariants(productId),
    enabled: Boolean(productId),
  });
}

export function useCreateCompleteProduct() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCompleteProductInput) => createCompleteProduct(input),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['products'] }),
        client.invalidateQueries({ queryKey: ['product-variants'] }),
        client.invalidateQueries({ queryKey: ['branch-products'] }),
        client.invalidateQueries({ queryKey: ['branch-product-variants'] }),
      ]);
    },
  });
}

export function useUpdateProductVariant() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      variantId,
      name,
      defaultPrice,
    }: {
      variantId: string;
      name: string;
      defaultPrice: string;
    }) => updateProductVariant(variantId, name, defaultPrice),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['products'] }),
        client.invalidateQueries({ queryKey: ['product-variants'] }),
        client.invalidateQueries({ queryKey: ['branch-product-variants'] }),
      ]);
    },
  });
}

export function useUpdateBranchProductVariantPrice() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      branchVariantId,
      sellingPrice,
    }: {
      branchVariantId: string;
      sellingPrice: string;
    }) => updateBranchProductVariantPrice(branchVariantId, sellingPrice),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['branch-products'] }),
        client.invalidateQueries({ queryKey: ['branch-product-variants'] }),
      ]);
    },
  });
}

export function useConfigureProductVariants() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      productId,
      variants,
    }: {
      productId: string;
      variants: Array<{ name: string; default_price: number; is_active: boolean }>;
    }) => configureProductVariants(productId, variants),
    onSuccess: async (_void, { productId }) => {
      await client.invalidateQueries({ queryKey: ['product-variants', productId] });
    },
  });
}
