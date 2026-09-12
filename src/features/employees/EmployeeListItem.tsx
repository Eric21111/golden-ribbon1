import { StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { StatusBadge } from '@/components/StatusBadge';
import { colors, radius, spacing } from '@/constants/theme';
import { employeeScopeLabel } from '@/features/employees/employeeFilters';
import type { Branch, EmployeeRecord } from '@/types/models';

interface EmployeeListItemProps {
  employee: EmployeeRecord;
  branches?: Branch[];
  onEdit: () => void;
}

export function EmployeeListItem({ employee, branches = [], onEdit }: EmployeeListItemProps) {
  const roleLabel = employeeScopeLabel(employee, branches);

  return (
    <View style={styles.card}>
      <View style={styles.body}>
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
        <View style={styles.aside}>
          <StatusBadge active={employee.is_active} />
          <AppButton label="Edit" variant="secondary" onPress={onEdit} style={styles.edit} />
        </View>
      </View>
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
  },
  body: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  name: { color: colors.text, fontSize: 16, fontWeight: '800' },
  meta: { color: colors.muted, fontSize: 13 },
  detail: { color: colors.text, fontSize: 13, fontWeight: '600', marginTop: 2 },
  aside: { alignItems: 'flex-end', gap: spacing.sm, flexShrink: 0 },
  edit: { minWidth: 88, alignSelf: 'stretch' },
});
