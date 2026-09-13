import { router } from 'expo-router';
import { useState } from 'react';

import { useAuth } from '@/features/auth/AuthProvider';
import { confirmAction } from '@/lib/confirmAction';
import { getErrorMessage } from '@/lib/errors';

export function useSignOut() {
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

  return { confirmSignOut, isSigningOut, error };
}
