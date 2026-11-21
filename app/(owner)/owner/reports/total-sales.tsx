import { Redirect } from 'expo-router';

/** Compat: Total Sales merged into Sales Overview. */
export default function OwnerTotalSalesRedirect() {
  return <Redirect href={'/owner/reports/sales-overview' as never} />;
}
