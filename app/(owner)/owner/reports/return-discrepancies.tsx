import { Redirect } from 'expo-router';

/** Compat: unified under Transfer & Return Issues. */
export default function OwnerReturnDiscrepanciesRedirect() {
  return <Redirect href={'/owner/reports/discrepancies' as never} />;
}
