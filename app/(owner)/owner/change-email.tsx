import { router } from 'expo-router';
import { StyleSheet } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { Screen } from '@/components/Screen';
import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { managerColors } from '@/components/dashboard/theme';
import { useAuth } from '@/features/auth/AuthProvider';
import { EmailChangeGuard } from '@/features/auth/EmailChangeGuard';
import { ChangeEmailForm } from '@/features/profile/ChangeEmailForm';

export default function OwnerChangeEmailRoute() {
  const { session } = useAuth();
  const currentEmail = session?.user.email ?? '';

  return (
    <EmailChangeGuard>
      <Screen backgroundColor="#FFFFFF" edges={['top']} contentContainerStyle={styles.screenContent}>
        <ManagerScreenHeader title="Change Email" subtitle="Owner account" showBack />
        <ConstrainedWidth style={styles.column}>
          <ChangeEmailForm
            currentEmail={currentEmail}
            onCancel={() => router.back()}
            hintStyle={styles.hint}
            currentStyle={styles.current}
            labelStyle={styles.fieldLabel}
            inputStyle={styles.fieldInput}
            errorStyle={styles.fieldError}
            successStyle={styles.success}
            accentColor={managerColors.royalBlue}
            renderSubmitButton={({ loading, disabled, onPress }) => (
              <ManagerActionButton label="Change email" loading={loading} disabled={disabled} onPress={onPress} />
            )}
            renderCancelButton={({ disabled, onPress }) => (
              <ManagerActionButton label="Cancel" variant="secondary" disabled={disabled} onPress={onPress} />
            )}
          />
        </ConstrainedWidth>
      </Screen>
    </EmailChangeGuard>
  );
}

const styles = StyleSheet.create({
  screenContent: { flexGrow: 1, padding: 0, gap: 0 },
  column: { padding: 20, gap: 14 },
  hint: { fontFamily: 'Inter_400Regular', color: managerColors.subtext },
  current: { fontFamily: 'Inter_600SemiBold', color: managerColors.ink },
  fieldLabel: { fontFamily: 'Inter_600SemiBold', color: managerColors.ink },
  fieldInput: { fontFamily: 'Inter_400Regular' },
  fieldError: { fontFamily: 'Inter_500Medium' },
  success: { fontFamily: 'Inter_600SemiBold', color: managerColors.green },
});
