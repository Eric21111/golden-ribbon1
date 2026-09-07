import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Platform, StyleSheet, Text } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { colors } from '@/constants/theme';
import { getErrorMessage } from '@/lib/errors';
import { useAuth } from '@/features/auth/AuthProvider';

export function SignOutButton() {
  const { signOut } = useAuth();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [error, setError] = useState('');

  const performSignOut = async () => {
    setError('');
    setIsSigningOut(true);
    try {
      await signOut();
      router.replace('/');
    } catch (signOutError) {
      setError(getErrorMessage(signOutError));
    } finally {
      setIsSigningOut(false);
    }
  };

  const confirmSignOut = () => {
    if (Platform.OS === 'web') {
      // window.confirm can be blocked by browsers in iframes or strict popup settings,
      // returning undefined — which is falsy and silently prevents logout.
      // Skip the dialog on web and sign out directly.
      void performSignOut();
      return;
    }

    Alert.alert('Log out?', 'You will need to sign in again to use the app.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log out',
        style: 'destructive',
        onPress: () => void performSignOut(),
      },
    ]);
  };

  return (
    <>
      {error ? <Text style={styles.error}>Could not log out. {error}</Text> : null}
      <AppButton label="Log out" loading={isSigningOut} onPress={confirmSignOut} variant="secondary" />
    </>
  );
}

const styles = StyleSheet.create({
  error: { color: colors.danger, fontSize: 14, lineHeight: 20, textAlign: 'center' },
});
