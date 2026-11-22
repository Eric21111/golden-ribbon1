import { MainBranchGuard } from '@/features/auth/MainBranchGuard';
import { StockCorrectionsBranchRoute } from '@/features/reports/StockCorrectionsBranchRoute';

export default function ManagerStockCorrectionsBranch() {
  return (
    <MainBranchGuard>
      <StockCorrectionsBranchRoute />
    </MainBranchGuard>
  );
}
