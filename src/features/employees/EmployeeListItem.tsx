import { StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { StatusBadge } from '@/components/StatusBadge';
import { colors, radius, spacing } from '@/constants/theme';
import type { EmployeeRecord } from '@/types/models';

interface EmployeeListItemProps {
  employee: EmployeeRecord;
  busy: boolean;
  onEdit: () => void;
  onResetPassword: () => void;
  onToggleActive: () => void;
}

export function EmployeeListItem({
  employee,
  busy,
  onEdit,
  onResetPassword,
  onToggleActive,
}: EmployeeListItemProps) {
  const roleLabel = employee.role === 'manager' ? 'Manager' : 'Cashier';

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.copy}>
          <Text style={styles.name} numberOfLines={1}>
            {employee.full_name}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {employee.email}
          </Text>
          <Text style={styles.detail} numberOfLines={1}>
            {roleLabel} · {employee.branch_name}
          </Text>
        </View>
        <StatusBadge active={employee.is_active} />
      </View>
      <View style={styles.actions}>
        <AppButton label="Edit" variant="secondary" disabled={busy} onPress={onEdit} style={styles.action} />
        <AppButton
          label="Reset"
          variant="secondary"
          disabled={busy}
          onPress={onResetPassword}
          style={styles.action}
        />
      </View>
      <AppButton
        label={employee.is_active ? 'Deactivate' : 'Activate'}
        variant={employee.is_active ? 'danger' : 'primary'}
        loading={busy}
        onPress={onToggleActive}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.sm },
  copy: { flex: 1, minWidth: 0 },
  name: { color: colors.text, fontSize: 16, fontWeight: '800' },
  meta: { color: colors.muted, fontSize: 13, marginTop: 2 },
  detail: { color: colors.text, fontSize: 13, fontWeight: '600', marginTop: 4 },
  actions: { flexDirection: 'row', gap: spacing.sm },
  action: { flex: 1 },
});
