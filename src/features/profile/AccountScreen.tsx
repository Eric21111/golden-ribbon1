import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { BottomSheet } from '@/components/BottomSheet';
import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';
import { SignOutButton } from '@/components/SignOutButton';
import { StatusBadge } from '@/components/StatusBadge';
import { colors, radius, spacing } from '@/constants/theme';
import { useAuth } from '@/features/auth/AuthProvider';
import { canChangeOwnEmail } from '@/features/auth/roles';
import { ChangePasswordForm } from '@/features/profile/ChangePasswordForm';
import { useLayout } from '@/lib/layout';
import { pendingEmailFromUser } from '@/services/accountService';

function DetailRow({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.detail, last && styles.detailLast]}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

export function AccountScreen() {
  const { profile, session } = useAuth();
  const { formMaxWidth } = useLayout();
  const [passwordOpen, setPasswordOpen] = useState(false);

  if (!profile || !session) return null;

  const roleLabel = profile.role.charAt(0).toUpperCase() + profile.role.slice(1);
  const email = session.user.email ?? 'Not available';
  const pendingEmail = pendingEmailFromUser(session.user);
  const branch = profile.branch?.name ?? 'All branches';
  const showChangeEmail = canChangeOwnEmail(profile);
  const changeEmailHref = profile.role === 'owner' ? '/owner/change-email' : '/manager/change-email';

  return (
    <Screen scroll={false} contentContainerStyle={styles.screen}>
      <ConstrainedWidth maxWidth={formMaxWidth} fill>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <View style={styles.top}>
            <PageHeader title="Account" subtitle="Your staff account" />

            <View style={styles.identity}>
              <View style={styles.identityCopy}>
                <Text style={styles.name}>{profile.full_name}</Text>
                <Text style={styles.role}>{roleLabel}</Text>
              </View>
              <StatusBadge active={profile.is_active} />
            </View>

            <View style={styles.card}>
              <DetailRow label="Email" value={email} />
              {pendingEmail ? (
                <>
                  <DetailRow label="Pending email" value={pendingEmail} />
                  <DetailRow label="Status" value="Waiting for verification" />
                </>
              ) : null}
              <DetailRow label="Branch" value={branch} />
              <DetailRow label="Role" value={roleLabel} last />
            </View>

            <AppButton
              label="Change password"
              variant="secondary"
              onPress={() => setPasswordOpen(true)}
            />
            {showChangeEmail ? (
              <AppButton
                label="Change email"
                variant="secondary"
                onPress={() => router.push(changeEmailHref as never)}
              />
            ) : null}
          </View>

          <View style={styles.footer}>
            <SignOutButton variant="danger" />
          </View>
        </ScrollView>
      </ConstrainedWidth>

      <BottomSheet
        visible={passwordOpen}
        title="Change password"
        scroll
        onClose={() => setPasswordOpen(false)}
      >
        <ChangePasswordForm
          onCancel={() => setPasswordOpen(false)}
          onSuccess={() => setPasswordOpen(false)}
        />
      </BottomSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { flexGrow: 1, padding: 0, gap: 0 },
  scroll: { flex: 1, minHeight: 0 },
  scrollContent: { flexGrow: 1, justifyContent: 'space-between' },
  top: { paddingHorizontal: spacing.md, paddingTop: spacing.md, gap: spacing.md },
  identity: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  identityCopy: { flex: 1, minWidth: 0, gap: spacing.xs },
  name: { color: colors.text, fontSize: 22, fontWeight: '800' },
  role: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
  },
  detail: {
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: spacing.xs,
  },
  detailLast: { borderBottomWidth: 0 },
  label: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  value: { color: colors.text, fontSize: 16, fontWeight: '600' },
  footer: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
});
