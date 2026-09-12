import { EmailChangeGuard } from '@/features/auth/EmailChangeGuard';
import { ChangeEmailScreen } from '@/features/profile/ChangeEmailScreen';

export default function ManagerChangeEmailRoute() {
  return (
    <EmailChangeGuard>
      <ChangeEmailScreen />
    </EmailChangeGuard>
  );
}
