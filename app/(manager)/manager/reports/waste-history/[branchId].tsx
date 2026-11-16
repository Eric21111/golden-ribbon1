import { WasteHistoryScreen } from '@/features/reports/WasteHistoryScreen';
import { MainBranchGuard } from '@/features/auth/MainBranchGuard';

export default function ManagerWasteHistoryBranch() {
  return (
    <MainBranchGuard>
      <WasteHistoryScreen />
    </MainBranchGuard>
  );
}
