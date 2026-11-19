import { MainBranchGuard } from '@/features/auth/MainBranchGuard';
import { ShiftRemittanceBranchesScreen } from '@/features/reports/ShiftRemittanceBranchesScreen';

export default function ManagerShiftRemittances() {
  return (
    <MainBranchGuard>
      <ShiftRemittanceBranchesScreen />
    </MainBranchGuard>
  );
}
