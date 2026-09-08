import { Redirect } from 'expo-router';

/** Change password now opens as a modal from the Profile tab. */
export default function ChangePasswordScreen() {
  return <Redirect href="/manager/profile" />;
}
