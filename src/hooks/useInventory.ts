import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/lib/queryKeys';
import { initializeMainInventory, listInventory } from '@/services/inventoryService';
import type { Branch } from '@/types/models';

export function useInventory(branch: Branch | null | undefined, activeOnly = false) {
  return useQuery({
    queryKey: queryKeys.inventory(branch?.id ?? '', activeOnly),
    queryFn: () => listInventory(branch as Branch, activeOnly),
    enabled: Boolean(branch),
  });
}

export function useInitializeMainInventory() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ items, notes }: { items: Array<{ product_id: string; quantity: number }>; notes: string | null }) => initializeMainInventory(items, notes),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['inventory'] }),
      ]);
    },
  });
}
