import { Redirect } from 'expo-router';
import type { PropsWithChildren } from 'react';

import { ErrorState } from '@/components/Feedback';
import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';
import { useAuth } from '@/features/auth/AuthProvider';
import { canChangeOwnEmail } from '@/features/auth/roles';
import { roleHome } from '@/features/auth/roleRoutes';

export function EmailChangeGuard({ children }: PropsWithChildren) {
  const { profile } = useAuth();

  if (canChangeOwnEmail(profile)) {
    return children;
  }

  if (profile?.role === 'manager') {
    return (
      <Screen constrain>
        <PageHeader title="Unauthorized" subtitle="Email changes are limited to the Owner and Main Branch Manager." />
        <ErrorState message="Selling Branch Managers cannot change their own email." />
      </Screen>
    );
  }

  return <Redirect href={profile ? roleHome[profile.role] : '/(auth)/login'} />;
}