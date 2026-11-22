import { MainBranchGuard } from '@/features/auth/MainBranchGuard';
import { VoidLogsOverviewScreen } from '@/features/reports/VoidLogsOverviewScreen';

export default function ManagerVoidLogsOverview() {
  return (
    <MainBranchGuard>
      <VoidLogsOverviewScreen />
    </MainBranchGuard>
  );
}
