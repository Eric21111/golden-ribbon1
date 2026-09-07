import { Redirect } from 'expo-router';

import { ErrorState, LoadingState } from '@/components/Feedback';
import { Screen } from '@/components/Screen';
import { SignOutButton } from '@/components/SignOutButton';
import { useAuth } from '@/features/auth/AuthProvider';
import { roleHome } from '@/features/auth/roleRoutes';
import { getErrorMessage } from '@/lib/errors';

export default function Index() {
  const { session, profile, isLoading, profileError, retryProfile } = useAuth();

  if (isLoading) return <LoadingState label="Restoring your session…" />;
  if (!session) return <Redirect href="/(auth)/login" />;
  if (profileError || !profile) {
    return (
      <Screen>
        <ErrorState
          message={profileError ? getErrorMessage(profileError) : 'No staff profile is assigned to this account.'}
          onRetry={() => void retryProfile()}
        />
        <SignOutButton />
      </Screen>
    );
  }
  return <Redirect href={roleHome[profile.role]} />;
}
