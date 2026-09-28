import { WasteHistoryScreen } from '@/features/reports/WasteHistoryScreen';
import { MainBranchGuard } from '@/features/auth/MainBranchGuard';

export default function ManagerWasteHistory() {
  return (
    <MainBranchGuard>
      <WasteHistoryScreen />
    </MainBranchGuard>
  );
}
