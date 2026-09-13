import { Redirect } from 'expo-router';

/** Edit branch now opens as a modal from the Branches list. */
export default function EditBranchScreen() {
  return <Redirect href={'/manager/branches' as never} />;
}
