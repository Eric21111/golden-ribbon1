import { MainBranchGuard } from '@/features/auth/MainBranchGuard';
import { BranchListScreen } from '@/features/branches/BranchListScreen';

/** View-only: Owner owns create/edit/deactivate. Catalog still hangs off this nav item. */
export default function ManagerBranchListScreen() {
  return (
    <MainBranchGuard>
      <BranchListScreen canCreate={false} canEdit={false} />
    </MainBranchGuard>
  );
}
