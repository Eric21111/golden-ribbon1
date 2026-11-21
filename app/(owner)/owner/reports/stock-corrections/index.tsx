import { Redirect } from 'expo-router';

/** Compat: Void logs moved to /owner/reports/void-logs. */
export default function OwnerVoidLogsBranchesRedirect() {
  return <Redirect href={'/owner/reports/void-logs' as never} />;
}
