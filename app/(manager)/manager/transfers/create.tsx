import { MainBranchGuard } from '@/features/auth/MainBranchGuard';
import { CreateTransferScreen } from '@/features/transfers/CreateTransferScreen';

export default function ManagerCreateTransferRoute() {
  return (
    <MainBranchGuard>
      <CreateTransferScreen />
    </MainBranchGuard>
  );
}
