import Ionicons, { type IoniconsIconName } from '@react-native-vector-icons/ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { Screen } from '@/components/Screen';
import { Avatar } from '@/components/dashboard/Avatar';
import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { ManagerBadge } from '@/components/dashboard/ManagerBadge';
import { ManagerBottomSheet as BottomSheet } from '@/components/dashboard/ManagerBottomSheet';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { ManagerSignOutButton } from '@/components/dashboard/ManagerSignOutButton';
import { SummaryCard } from '@/components/dashboard/SummaryCard';
import { managerColors } from '@/components/dashboard/theme';
import { useAuth } from '@/features/auth/AuthProvider';
import { canChangeOwnEmail } from '@/features/auth/roles';
import { ChangePasswordForm } from '@/features/profile/ChangePasswordForm';

function ActionRow({
  icon,
  label,
  onPress,
  showDivider,
}: {
  icon: IoniconsIconName;
  label: string;
  onPress: () => void;
  showDivider: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.actionRow, showDivider && styles.actionRowDivider, pressed && styles.actionRowPressed]}
    >
      <View style={styles.actionIconChip}>
        <Ionicons name={icon} size={18} color={managerColors.royalBlue} />
      </View>
      <Text style={styles.actionLabel}>{label}</Text>
      <Ionicons name="chevron-forward" size={18} color={managerColors.subtext} />
    </Pressable>
  );
}

export default function ManagerAccountScreen() {
  const { profile, session } = useAuth();
  const [passwordOpen, setPasswordOpen] = useState(false);

  if (!profile || !session) return null;

  const roleLabel = profile.role.charAt(0).toUpperCase() + profile.role.slice(1);
  const email = session.user.email ?? 'Not available';
  const branch = profile.branch?.name ?? 'All branches';
  const canChangeEmail = canChangeOwnEmail(profile);

  return (
    <Screen backgroundColor="#FFFFFF" edges={['top']} scroll={false} contentContainerStyle={styles.screenContent}>
      <ManagerScreenHeader title="Account" subtitle="Your staff account" />

      <ConstrainedWidth style={styles.column}>
        <View style={styles.identity}>
          <Avatar name={profile.full_name} size={56} />
          <View style={styles.identityCopy}>
            <Text style={styles.name} numberOfLines={1}>
              {profile.full_name}
            </Text>
            <Text style={styles.role}>{roleLabel}</Text>
          </View>
          <ManagerBadge label={profile.is_active ? 'Active' : 'Inactive'} tone={profile.is_active ? 'success' : 'neutral'} />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>ACCOUNT INFORMATION</Text>
          <SummaryCard
            rows={[
              { label: 'Email', value: email, icon: 'mail-outline' },
              { label: 'Branch', value: branch, icon: 'storefront-outline' },
              { label: 'Role', value: roleLabel, icon: 'briefcase-outline' },
            ]}
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>ACCOUNT SETTINGS</Text>
          <View style={styles.actionsCard}>
            <ActionRow
              icon="key-outline"
              label="Change password"
              onPress={() => setPasswordOpen(true)}
              showDivider={canChangeEmail}
            />
            {canChangeEmail ? (
              <ActionRow
                icon="mail-outline"
                label="Change email"
                onPress={() => router.push('/manager/change-email' as never)}
                showDivider={false}
              />
            ) : null}
          </View>
        </View>

        <View style={styles.footer}>
          <ManagerSignOutButton />
        </View>
      </ConstrainedWidth>

      <BottomSheet visible={passwordOpen} title="Change password" scroll onClose={() => setPasswordOpen(false)}>
        <ChangePasswordForm
          onCancel={() => setPasswordOpen(false)}
          onSuccess={() => setPasswordOpen(false)}
          hintStyle={styles.formHint}
          labelStyle={styles.formLabel}
          inputStyle={styles.formInput}
          errorStyle={styles.formError}
          successStyle={styles.formSuccess}
          accentColor={managerColors.royalBlue}
          renderSubmitButton={({ loading, disabled, onPress }) => (
            <ManagerActionButton label="Change password" loading={loading} disabled={disabled} onPress={onPress} />
          )}
          renderCancelButton={({ disabled, onPress }) => (
            <ManagerActionButton label="Cancel" variant="secondary" disabled={disabled} onPress={onPress} />
          )}
        />
      </BottomSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenContent: { flexGrow: 1, padding: 0, gap: 0 },
  column: { flex: 1, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 24, gap: 20 },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 16,
    padding: 16,
    shadowColor: '#0A1224',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 1,
  },
  identityCopy: { flex: 1, minWidth: 0, gap: 2 },
  name: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 18 },
  role: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 13 },
  section: { gap: 8 },
  sectionTitle: {
    color: managerColors.subtext,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    letterSpacing: 0.8,
  },
  actionsCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#0A1224',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 1,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  actionRowDivider: { borderBottomWidth: 1, borderBottomColor: managerColors.cardBorder },
  actionRowPressed: { backgroundColor: managerColors.cardSurface },
  actionIconChip: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#EAF0FB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: { flex: 1, color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  footer: { marginTop: 'auto', paddingTop: 8 },
  formHint: { fontFamily: 'Inter_400Regular' },
  formLabel: { fontFamily: 'Inter_600SemiBold' },
  formInput: { fontFamily: 'Inter_400Regular' },
  formError: { fontFamily: 'Inter_500Medium' },
  formSuccess: { fontFamily: 'Inter_600SemiBold' },
});
