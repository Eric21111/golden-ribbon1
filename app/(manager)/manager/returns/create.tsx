import { SellingBranchGuard } from '@/features/auth/SellingBranchGuard';
import CreateReturnScreen from '@/features/returns/CreateReturnScreen';

export default function ManagerCreateReturnRoute() {
  return (
    <SellingBranchGuard>
      <CreateReturnScreen />
    </SellingBranchGuard>
  );
}
