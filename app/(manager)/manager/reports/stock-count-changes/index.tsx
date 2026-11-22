import { MainBranchGuard } from '@/features/auth/MainBranchGuard';
import { StockCorrectionsOverviewScreen } from '@/features/reports/StockCorrectionsOverviewScreen';

export default function ManagerStockCorrectionsOverview() {
  return (
    <MainBranchGuard>
      <StockCorrectionsOverviewScreen />
    </MainBranchGuard>
  );
}
