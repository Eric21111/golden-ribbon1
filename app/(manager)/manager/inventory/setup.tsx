import { MainBranchGuard } from '@/features/auth/MainBranchGuard';
import { InventorySetupScreen } from '@/features/inventory/InventorySetupScreen';

export default function ManagerInventorySetupRoute() {
  return (
    <MainBranchGuard>
      <InventorySetupScreen />
    </MainBranchGuard>
  );
}
