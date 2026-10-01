import { ShiftRemittanceDetailScreen } from '@/features/reports/ShiftRemittanceDetailScreen';
import { MainBranchGuard } from '@/features/auth/MainBranchGuard';

export default function ManagerShiftRemittanceDetail() {
  return (
    <MainBranchGuard>
      <ShiftRemittanceDetailScreen />
    </MainBranchGuard>
  );
}
