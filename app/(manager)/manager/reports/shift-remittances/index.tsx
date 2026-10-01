import { ShiftRemittanceScreen } from '@/features/reports/ShiftRemittanceScreen';
import { MainBranchGuard } from '@/features/auth/MainBranchGuard';

export default function ManagerShiftRemittances() {
  return (
    <MainBranchGuard>
      <ShiftRemittanceScreen />
    </MainBranchGuard>
  );
}
