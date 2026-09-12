import { MainBranchGuard } from '@/features/auth/MainBranchGuard';
import { ReceiveReturnScreen } from '@/features/returns/ReceiveReturnScreen';

export default function ManagerReceiveReturnRoute() {
  return (
    <MainBranchGuard>
      <ReceiveReturnScreen />
    </MainBranchGuard>
  );
}
