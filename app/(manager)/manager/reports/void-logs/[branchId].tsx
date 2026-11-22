import { MainBranchGuard } from '@/features/auth/MainBranchGuard';
import { VoidLogsBranchRoute } from '@/features/reports/VoidLogsBranchRoute';

export default function ManagerVoidLogsBranch() {
  return (
    <MainBranchGuard>
      <VoidLogsBranchRoute />
    </MainBranchGuard>
  );
}
