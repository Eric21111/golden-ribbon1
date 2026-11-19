import { useLocalSearchParams } from 'expo-router';

import { MainBranchGuard } from '@/features/auth/MainBranchGuard';
import { ShiftRemittanceScreen } from '@/features/reports/ShiftRemittanceScreen';

export default function ManagerShiftRemittanceBranch() {
  const params = useLocalSearchParams<{ branchId?: string | string[] }>();
  const branchId = Array.isArray(params.branchId) ? params.branchId[0] ?? '' : params.branchId ?? '';

  return (
    <MainBranchGuard>
      <ShiftRemittanceScreen branchId={branchId} />
    </MainBranchGuard>
  );
}
