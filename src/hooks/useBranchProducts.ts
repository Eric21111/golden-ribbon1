import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/lib/queryKeys';
import {
  configureBranchProducts,
  configureBranchProductVariants,
  listBranchProducts,
  listBranchProductVariants,
  listProductBranchPrices,
  listProductBranchVariantPrices,
} from '@/services/branchProductService';

export function useBranchProducts(branchId: string, activeOnly = false) {
  return useQuery({
    queryKey: queryKeys.branchProducts(branchId, activeOnly),
    queryFn: () => listBranchProducts(branchId, activeOnly),
    enabled: Boolean(branchId),
  });
}

export function useConfigureBranchProducts(branchId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (
      items: Array<{ product_id: string; selling_price: number; is_active: boolean }>,
    ) => configureBranchProducts(branchId, items),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['branch-products', branchId] }),
        client.invalidateQueries({ queryKey: ['inventory'] }),
      ]);
    },
  });
}

export function useBranchProductVariants(branchId: string, productId: string) {
  return useQuery({
    queryKey: ['branch-product-variants', branchId, productId],
    queryFn: () => listBranchProductVariants(branchId, productId),
    enabled: Boolean(branchId) && Boolean(productId),
  });
}

export function useConfigureBranchProductVariants(branchId: string, productId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (variants: Array<{ name: string; selling_price: number; is_active: boolean }>) =>
      configureBranchProductVariants(branchId, productId, variants),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['branch-product-variants', branchId, productId] }),
        client.invalidateQueries({ queryKey: ['inventory'] }),
      ]);
    },
  });
}

/** All selling branches' base prices for one product — pre-fills the Edit wizard's pricing step. */
export function useProductBranchPrices(productId: string) {
  return useQuery({
    queryKey: ['product-branch-prices', productId],
    queryFn: () => listProductBranchPrices(productId),
    enabled: Boolean(productId),
  });
}

/** All selling branches' per-variant prices for one product — pre-fills the Edit wizard's pricing step. */
export function useProductBranchVariantPrices(productId: string) {
  return useQuery({
    queryKey: ['product-branch-variant-prices', productId],
    queryFn: () => listProductBranchVariantPrices(productId),
    enabled: Boolean(productId),
  });
}
