import { Redirect } from 'expo-router';

/** Reset password now opens as a modal from the Employees hub. */
export default function ResetEmployeePasswordScreen() {
  return <Redirect href="/owner/employees" />;
}
