import { useLocalSearchParams } from 'expo-router';

import { ProductSalesSummaryScreen } from '@/features/reports/ReportsScreens';

export default function OwnerProductSalesBranch() {
  const params = useLocalSearchParams<{ branchId?: string | string[] }>();
  const branchId = Array.isArray(params.branchId) ? params.branchId[0] : params.branchId;
  return <ProductSalesSummaryScreen role="owner" branchId={branchId} />;
}
