import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { Screen } from '@/components/Screen';
import { SignOutButton } from '@/components/SignOutButton';
import { Avatar } from '@/components/dashboard/Avatar';
import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { ManagerBadge } from '@/components/dashboard/ManagerBadge';
import { ManagerBottomSheet as BottomSheet } from '@/components/dashboard/ManagerBottomSheet';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { SummaryCard } from '@/components/dashboard/SummaryCard';
import { managerColors } from '@/components/dashboard/theme';
import { useAuth } from '@/features/auth/AuthProvider';
import { ChangePasswordForm } from '@/features/profile/ChangePasswordForm';

export default function ManagerAccountScreen() {
  const { profile, session } = useAuth();
  const [passwordOpen, setPasswordOpen] = useState(false);

  if (!profile || !session) return null;

  const roleLabel = profile.role.charAt(0).toUpperCase() + profile.role.slice(1);
  const email = session.user.email ?? 'Not available';
  const branch = profile.branch?.name ?? 'All branches';

  return (
    <Screen backgroundColor="#FFFFFF" edges={['top']} scroll={false} contentContainerStyle={styles.screenContent}>
      <ManagerScreenHeader title="Account" subtitle="Your staff account" />

      <ConstrainedWidth style={styles.column}>
        <View style={styles.identity}>
          <Avatar name={profile.full_name} size={56} />
          <View style={styles.identityCopy}>
            <Text style={styles.name}>{profile.full_name}</Text>
            <Text style={styles.role}>{roleLabel}</Text>
          </View>
          <ManagerBadge label={profile.is_active ? 'Active' : 'Inactive'} tone={profile.is_active ? 'success' : 'neutral'} />
        </View>

        <SummaryCard
          rows={[
            { label: 'Email', value: email },
            { label: 'Branch', value: branch },
            { label: 'Role', value: roleLabel },
          ]}
        />

        <ManagerActionButton label="Change password" variant="secondary" onPress={() => setPasswordOpen(true)} />

        <View style={styles.footer}>
          <SignOutButton variant="danger" labelStyle={styles.logoutLabel} />
        </View>
      </ConstrainedWidth>

      <BottomSheet visible={passwordOpen} title="Change password" scroll onClose={() => setPasswordOpen(false)}>
        <ChangePasswordForm
          onCancel={() => setPasswordOpen(false)}
          onSuccess={() => setPasswordOpen(false)}
          hintStyle={styles.formHint}
          labelStyle={styles.formLabel}
          errorStyle={styles.formError}
          successStyle={styles.formSuccess}
          buttonLabelStyle={styles.formButtonLabel}
          accentColor={managerColors.royalBlue}
        />
      </BottomSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenContent: { flexGrow: 1, padding: 0, gap: 0 },
  column: { flex: 1, paddingHorizontal: 20, paddingTop: 16, gap: 14 },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 16,
    padding: 16,
  },
  identityCopy: { flex: 1, minWidth: 0, gap: 2 },
  name: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 18 },
  role: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 13 },
  footer: { marginTop: 'auto', paddingTop: 8, paddingBottom: 16 },
  logoutLabel: { fontFamily: 'Inter_700Bold' },
  formHint: { fontFamily: 'Inter_400Regular' },
  formLabel: { fontFamily: 'Inter_600SemiBold' },
  formError: { fontFamily: 'Inter_500Medium' },
  formSuccess: { fontFamily: 'Inter_600SemiBold' },
  formButtonLabel: { fontFamily: 'Inter_700Bold' },
});
