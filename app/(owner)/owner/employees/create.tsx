import { Redirect } from 'expo-router';

/** Create flow now opens as a modal from the Employees hub. */
export default function CreateEmployeeScreen() {
  return <Redirect href="/owner/employees" />;
}
