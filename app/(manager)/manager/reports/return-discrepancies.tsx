import { ReturnDiscrepanciesReportScreen } from '@/features/reports/DiscrepancyReportsScreens';

export default function ManagerReturnDiscrepanciesRoute() {
  return (
    <ReturnDiscrepanciesReportScreen
      detailHref={(id) => `/manager/discrepancies/return/${id}`}
    />
  );
}
