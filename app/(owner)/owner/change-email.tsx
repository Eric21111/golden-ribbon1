import { EmailChangeGuard } from '@/features/auth/EmailChangeGuard';
import { ChangeEmailScreen } from '@/features/profile/ChangeEmailScreen';

export default function OwnerChangeEmailRoute() {
  return (
    <EmailChangeGuard>
      <ChangeEmailScreen />
    </EmailChangeGuard>
  );
}
