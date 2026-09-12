import { Redirect } from 'expo-router';
import type { PropsWithChildren } from 'react';

import { ErrorState } from '@/components/Feedback';
import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';
import { useAuth } from '@/features/auth/AuthProvider';
import { isMainBranchManager } from '@/features/auth/roles';
import { roleHome } from '@/features/auth/roleRoutes';

export function MainBranchGuard({ children }: PropsWithChildren) {
  const { profile } = useAuth();

  if (profile?.role !== 'manager') {
    return <Redirect href={profile ? roleHome[profile.role] : '/(auth)/login'} />;
  }

  if (!isMainBranchManager(profile)) {
    return (
      <Screen constrain>
        <PageHeader title="Unauthorized" subtitle="This screen is limited to the Main Branch Manager." />
        <ErrorState message="Selling Branch Managers cannot access company-wide operations." />
      </Screen>
    );
  }

  return children;
}
