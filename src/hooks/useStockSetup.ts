import { useQuery } from '@tanstack/react-query';

import { listStockSetupData } from '@/services/productService';

/** What every product's sales take from stock (see buildStockSetup). Always read fresh when a screen that depends on it opens. */
export function useStockSetupData() {
  return useQuery({
    queryKey: ['stock-setup-data'],
    queryFn: listStockSetupData,
    staleTime: 0,
  });
}
