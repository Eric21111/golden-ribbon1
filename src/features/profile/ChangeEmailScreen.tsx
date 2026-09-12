import { router } from 'expo-router';
import { StyleSheet } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';
import { spacing } from '@/constants/theme';
import { useAuth } from '@/features/auth/AuthProvider';
import { ChangeEmailForm } from '@/features/profile/ChangeEmailForm';
import { useLayout } from '@/lib/layout';

export function ChangeEmailScreen() {
  const { session } = useAuth();
  const { formMaxWidth } = useLayout();
  const currentEmail = session?.user.email ?? '';

  return (
    <Screen constrain>
      <ConstrainedWidth maxWidth={formMaxWidth} style={styles.column}>
        <PageHeader title="Change Email" subtitle="Owner and Main Branch Manager only" />
        <ChangeEmailForm
          currentEmail={currentEmail}
          onCancel={() => router.back()}
        />
      </ConstrainedWidth>
    </Screen>
  );
}

const styles = StyleSheet.create({
  column: { gap: spacing.md },
});
