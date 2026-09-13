import { Redirect } from 'expo-router';
import type { PropsWithChildren } from 'react';

import { Screen } from '@/components/Screen';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { ErrorState } from '@/components/dashboard/ManagerFeedback';
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
      <Screen backgroundColor="#FFFFFF" scroll={false} contentContainerStyle={{ flexGrow: 1, padding: 0, gap: 0 }}>
        <ManagerScreenHeader title="Unauthorized" subtitle="This screen is limited to the Main Branch Manager." showBack />
        <ErrorState message="Selling Branch Managers cannot access company-wide operations." />
      </Screen>
    );
  }

  return children;
}
