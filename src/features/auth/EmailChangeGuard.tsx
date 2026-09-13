import { Redirect } from 'expo-router';
import type { PropsWithChildren } from 'react';

import { Screen } from '@/components/Screen';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { ErrorState } from '@/components/dashboard/ManagerFeedback';
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
      <Screen backgroundColor="#FFFFFF" scroll={false} contentContainerStyle={{ flexGrow: 1, padding: 0, gap: 0 }}>
        <ManagerScreenHeader
          title="Unauthorized"
          subtitle="Email changes are limited to the Owner and Main Branch Manager."
          showBack
        />
        <ErrorState message="Selling Branch Managers cannot change their own email." />
      </Screen>
    );
  }

  return <Redirect href={profile ? roleHome[profile.role] : '/(auth)/login'} />;
}