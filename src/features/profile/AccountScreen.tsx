import { StyleSheet, Text, View } from 'react-native';

import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';
import { SignOutButton } from '@/components/SignOutButton';
import { colors, radius, spacing } from '@/constants/theme';
import { useAuth } from '@/features/auth/AuthProvider';

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detail}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

export function AccountScreen() {
  const { profile, session } = useAuth();
  if (!profile || !session) return null;

  return (
    <Screen>
      <PageHeader title="Account" subtitle="Your staff account information." />
      <View style={styles.card}>
        <Detail label="Name" value={profile.full_name} />
        <Detail label="Email" value={session.user.email ?? 'Not available'} />
        <Detail label="Role" value={profile.role.charAt(0).toUpperCase() + profile.role.slice(1)} />
        <Detail label="Branch" value={profile.branch?.name ?? 'All branches'} />
        <Detail label="Status" value={profile.is_active ? 'Active' : 'Inactive'} />
      </View>
      <SignOutButton />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md },
  detail: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, gap: spacing.xs },
  label: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  value: { color: colors.text, fontSize: 16, fontWeight: '600' },
});
