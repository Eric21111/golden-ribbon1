import { Redirect } from 'expo-router';
import type { PropsWithChildren } from 'react';

import { ErrorState } from '@/components/Feedback';
import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';
import { useAuth } from '@/features/auth/AuthProvider';
import { isSellingBranchManager } from '@/features/auth/roles';
import { roleHome } from '@/features/auth/roleRoutes';

export function SellingBranchGuard({ children }: PropsWithChildren) {
  const { profile } = useAuth();

  if (profile?.role !== 'manager') {
    return <Redirect href={profile ? roleHome[profile.role] : '/(auth)/login'} />;
  }

  if (!isSellingBranchManager(profile)) {
    return (
      <Screen constrain>
        <PageHeader title="Unauthorized" subtitle="This screen is limited to the assigned selling branch." />
        <ErrorState message="Main Branch Managers cannot use selling-branch operations." />
      </Screen>
    );
  }

  return children;
}
