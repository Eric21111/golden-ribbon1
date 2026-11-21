import { Redirect, useLocalSearchParams } from 'expo-router';

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

/** Compat: Sales by Branch merged into Sales Overview (+ branch drill-down). */
export default function OwnerSalesByBranchRedirect() {
  const params = useLocalSearchParams<{
    branchId?: string | string[];
    range?: string | string[];
    start?: string | string[];
    end?: string | string[];
  }>();
  const branchId = firstParam(params.branchId);
  const range = firstParam(params.range);
  const start = firstParam(params.start);
  const end = firstParam(params.end);

  if (branchId) {
    const query = new URLSearchParams();
    if (range) query.set('range', range);
    if (start) query.set('start', start);
    if (end) query.set('end', end);
    const qs = query.toString();
    return <Redirect href={`/owner/reports/sales-overview/${branchId}${qs ? `?${qs}` : ''}` as never} />;
  }

  return <Redirect href={'/owner/reports/sales-overview' as never} />;
}
