import { TransferDiscrepanciesReportScreen } from '@/features/reports/DiscrepancyReportsScreens';

export default function ManagerTransferDiscrepanciesRoute() {
  return (
    <TransferDiscrepanciesReportScreen
      detailHref={(id) => `/manager/discrepancies/transfer/${id}`}
    />
  );
}
