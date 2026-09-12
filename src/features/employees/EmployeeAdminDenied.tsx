import { ErrorState } from '@/components/Feedback';
import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';

export function EmployeeAdminDenied() {
  return (
    <Screen constrain>
      <PageHeader title="Unauthorized" subtitle="Account administration belongs to the Owner." />
      <ErrorState message="Managers cannot create or edit employee accounts." />
    </Screen>
  );
}
