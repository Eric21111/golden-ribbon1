import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/lib/queryKeys';
import {
  configureBranchProducts,
  listBranchProducts,
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
