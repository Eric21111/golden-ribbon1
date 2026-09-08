import { Redirect } from 'expo-router';

/** Create flow now opens as a modal from the Branches hub. */
export default function CreateBranchScreen() {
  return <Redirect href="/owner/branches" />;
}
