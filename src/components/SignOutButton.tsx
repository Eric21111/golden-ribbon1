import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { colors } from '@/constants/theme';
import { useAuth } from '@/features/auth/AuthProvider';
import { confirmAction } from '@/lib/confirmAction';
import { getErrorMessage } from '@/lib/errors';

type SignOutButtonProps = {
  variant?: 'primary' | 'secondary' | 'danger';
};

export function SignOutButton({ variant = 'secondary' }: SignOutButtonProps) {
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
    confirmAction('Log out?', 'You will need to sign in again to use the app.', () => {
      void performSignOut();
    });
  };

  return (
    <>
      {error ? <Text style={styles.error}>Could not log out. {error}</Text> : null}
      <AppButton label="Log out" loading={isSigningOut} onPress={confirmSignOut} variant={variant} />
    </>
  );
}

const styles = StyleSheet.create({
  error: { color: colors.danger, fontSize: 14, lineHeight: 20, textAlign: 'center' },
});
