import { Redirect, useLocalSearchParams } from 'expo-router';

/** Edit flow now opens as a modal from the Employees hub. */
export default function EditEmployeeScreen() {
  useLocalSearchParams<{ id: string }>();
  return <Redirect href="/owner/employees" />;
}
