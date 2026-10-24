import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/lib/queryKeys';
import {
  configureProductVariants,
  createCompleteProduct,
  getProduct,
  listProductDrinkChoices,
  listProductSkus,
  listProductStockUses,
  listProductVariants,
  listProducts,
  updateBranchProductVariantPrice,
  updateCompleteProduct,
  updateProductVariant,
  type CreateCompleteProductInput,
  type UpdateCompleteProductInput,
} from '@/services/productService';

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

export function useProductVariants(productId: string) {
  return useQuery({
    queryKey: ['product-variants', productId],
    queryFn: () => listProductVariants(productId),
    enabled: Boolean(productId),
  });
}

/** Saved Stock Used Per Order lines, loaded when a product is opened for editing. */
export function useProductStockUses(productId: string) {
  return useQuery({
    queryKey: ['product-stock-uses', productId],
    queryFn: () => listProductStockUses(productId),
    enabled: Boolean(productId),
    // Always read the saved recipes fresh when an edit opens: saving over a stale copy could drop changes.
    staleTime: 0,
    gcTime: 0,
  });
}

/** Saved Drink Choices, loaded when a product is opened for editing (always fresh, like the stock lists). */
export function useProductDrinkChoices(productId: string) {
  return useQuery({
    queryKey: ['product-drink-choices', productId],
    queryFn: () => listProductDrinkChoices(productId),
    enabled: Boolean(productId),
    staleTime: 0,
    gcTime: 0,
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
        client.invalidateQueries({ queryKey: ['product-stock-uses'] }),
        client.invalidateQueries({ queryKey: ['product-drink-choices'] }),
        client.invalidateQueries({ queryKey: ['branch-products'] }),
        client.invalidateQueries({ queryKey: ['branch-product-variants'] }),
      ]);
    },
  });
}

export function useUpdateCompleteProduct() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateCompleteProductInput) => updateCompleteProduct(input),
    onSuccess: async (_product, { productId }) => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['products'] }),
        client.invalidateQueries({ queryKey: queryKeys.product(productId) }),
        client.invalidateQueries({ queryKey: ['product-variants', productId] }),
        client.invalidateQueries({ queryKey: ['product-stock-uses', productId] }),
        client.invalidateQueries({ queryKey: ['product-drink-choices', productId] }),
        client.invalidateQueries({ queryKey: ['product-branch-prices', productId] }),
        client.invalidateQueries({ queryKey: ['product-branch-variant-prices', productId] }),
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
