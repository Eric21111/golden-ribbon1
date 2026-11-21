import { Redirect, useLocalSearchParams } from 'expo-router';

/** Compat: Void logs moved to /owner/reports/void-logs/[branchId]. */
export default function OwnerVoidLogsBranchRedirect() {
  const params = useLocalSearchParams<{ branchId?: string | string[] }>();
  const branchId = Array.isArray(params.branchId) ? params.branchId[0] : params.branchId;
  if (!branchId) return <Redirect href={'/owner/reports/void-logs' as never} />;
  return <Redirect href={`/owner/reports/void-logs/${branchId}` as never} />;
}
