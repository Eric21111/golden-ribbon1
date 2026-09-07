import { StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { colors, radius, spacing } from '@/constants/theme';
import type { EmployeeRecord } from '@/types/models';

interface EmployeeListItemProps {
  employee: EmployeeRecord;
  busy: boolean;
  onEdit: () => void;
  onResetPassword: () => void;
  onToggleActive: () => void;
}

export function EmployeeListItem({ employee, busy, onEdit, onResetPassword, onToggleActive }: EmployeeListItemProps) {
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.copy}>
          <Text style={styles.name}>{employee.full_name}</Text>
          <Text style={styles.email}>{employee.email}</Text>
        </View>
        <Text style={[styles.status, employee.is_active ? styles.active : styles.inactive]}>{employee.is_active ? 'ACTIVE' : 'INACTIVE'}</Text>
      </View>
      <Text style={styles.detail}>{employee.role === 'manager' ? 'Manager' : 'Cashier'} · {employee.branch_name}</Text>
      <AppButton label="Edit" variant="secondary" disabled={busy} onPress={onEdit} />
      <AppButton label="Reset Password" variant="secondary" disabled={busy} onPress={onResetPassword} />
      <AppButton label={employee.is_active ? 'Deactivate' : 'Activate'} variant={employee.is_active ? 'danger' : 'primary'} loading={busy} onPress={onToggleActive} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.sm },
  copy: { flex: 1 },
  name: { color: colors.text, fontSize: 17, fontWeight: '800' },
  email: { color: colors.muted, fontSize: 13, marginTop: 2 },
  status: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5, fontSize: 11, fontWeight: '900' },
  active: { color: colors.success, backgroundColor: '#DCFCE7' },
  inactive: { color: colors.danger, backgroundColor: '#FEE2E2' },
  detail: { color: colors.text, fontSize: 14, fontWeight: '600' },
});
