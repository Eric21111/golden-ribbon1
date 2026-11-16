import { WasteHistoryBranchesScreen } from '@/features/reports/WasteHistoryBranchesScreen';
import { MainBranchGuard } from '@/features/auth/MainBranchGuard';

export default function ManagerWasteHistoryBranches() {
  return (
    <MainBranchGuard>
      <WasteHistoryBranchesScreen />
    </MainBranchGuard>
  );
}
