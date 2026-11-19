import { useLocalSearchParams } from 'expo-router';

import { ShiftRemittanceScreen } from '@/features/reports/ShiftRemittanceScreen';

export default function OwnerShiftRemittanceBranch() {
  const params = useLocalSearchParams<{ branchId?: string | string[] }>();
  const branchId = Array.isArray(params.branchId) ? params.branchId[0] ?? '' : params.branchId ?? '';

  return <ShiftRemittanceScreen branchId={branchId} />;
}
