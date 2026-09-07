import { Redirect } from 'expo-router';
import type { PropsWithChildren } from 'react';

import { ErrorState, LoadingState } from '@/components/Feedback';
import { Screen } from '@/components/Screen';
import { SignOutButton } from '@/components/SignOutButton';
import { useAuth } from '@/features/auth/AuthProvider';
import { roleHome } from '@/features/auth/roleRoutes';
import { getErrorMessage } from '@/lib/errors';
import type { UserRole } from '@/types/models';

export function RoleGuard({ children, role }: PropsWithChildren<{ role: UserRole }>) {
  const { session, profile, isLoading, profileError, retryProfile } = useAuth();

  if (isLoading) return <LoadingState label="Checking account access…" />;
  if (!session) return <Redirect href="/(auth)/login" />;
  if (profileError || !profile) {
    return (
      <Screen>
        <ErrorState
          message={profileError ? getErrorMessage(profileError) : 'No profile is assigned to this account. Ask an administrator to create one.'}
          onRetry={() => void retryProfile()}
        />
        <SignOutButton />
      </Screen>
    );
  }
  if (!profile.is_active) {
    return (
      <Screen>
        <ErrorState message="This account is inactive. Contact the owner for access." />
        <SignOutButton />
      </Screen>
    );
  }
  if (profile.role !== role) return <Redirect href={roleHome[profile.role]} />;
  return children;
}
