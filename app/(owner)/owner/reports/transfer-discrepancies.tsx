import { Redirect } from 'expo-router';

/** Compat: unified under Transfer & Return Issues. */
export default function OwnerTransferDiscrepanciesRedirect() {
  return <Redirect href={'/owner/reports/discrepancies' as never} />;
}
