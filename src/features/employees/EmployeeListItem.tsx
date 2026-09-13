import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ManagerBadge } from '@/components/dashboard/ManagerBadge';
import { managerColors, statChipColors, type StatChipColor } from '@/components/dashboard/theme';
import { employeeScopeLabel } from '@/features/employees/employeeFilters';
import { accentForName } from '@/lib/nameAccent';
import type { Branch, EmployeeRecord } from '@/types/models';

interface EmployeeListItemProps {
  employee: EmployeeRecord;
  branches?: Branch[];
  onEdit: () => void;
}

// Meaningful per-role coloring — the three job functions are fixed and worth telling apart at
// a glance, unlike branch names which are open-ended (see accentForName, shared with other
// screens that also color-code branch tags).
const ROLE_ACCENTS: Record<string, StatChipColor> = {
  Cashier: 'violet',
  'Main Branch Manager': 'teal',
  'Selling Branch Manager': 'orange',
};

export function EmployeeListItem({ employee, branches = [], onEdit }: EmployeeListItemProps) {
  const roleLabel = employeeScopeLabel(employee, branches);
  const isActive = employee.is_active;
  const roleChip = statChipColors[ROLE_ACCENTS[roleLabel] ?? 'blue'];
  const branchChip = statChipColors[accentForName(employee.branch_name)];

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onEdit}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.topRow}>
        <Text style={styles.name} numberOfLines={1}>
          {employee.full_name}
        </Text>
        <ManagerBadge label={isActive ? 'Active' : 'Inactive'} tone={isActive ? 'success' : 'neutral'} />
        <Ionicons name="chevron-forward" size={18} color={managerColors.subtext} />
      </View>

      <Text style={styles.email} numberOfLines={1}>
        {employee.email}
      </Text>

      <View style={styles.tagRow}>
        <View style={[styles.tag, { backgroundColor: roleChip.chip }]}>
          <Ionicons name="briefcase-outline" size={12} color={roleChip.icon} />
          <Text style={[styles.tagLabel, { color: roleChip.icon }]} numberOfLines={1}>
            {roleLabel}
          </Text>
        </View>
        <View style={[styles.tag, { backgroundColor: branchChip.chip }]}>
          <Ionicons name="storefront-outline" size={12} color={branchChip.icon} />
          <Text style={[styles.tagLabel, { color: branchChip.icon }]} numberOfLines={1}>
            {employee.branch_name}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 16,
    padding: 16,
    gap: 8,
    shadowColor: '#0A1224',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 1,
  },
  pressed: { opacity: 0.7 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { flex: 1, color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 16 },
  email: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 13 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  tagLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
});
