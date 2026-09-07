import { StyleSheet, Text } from 'react-native';

import { colors } from '@/constants/theme';

export function StatusBadge({ active }: { active: boolean }) {
  return <Text style={[styles.badge, active ? styles.active : styles.inactive]}>{active ? 'Active' : 'Inactive'}</Text>;
}

const styles = StyleSheet.create({
  badge: { fontSize: 12, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, overflow: 'hidden' },
  active: { backgroundColor: '#DCFCE7', color: colors.success },
  inactive: { backgroundColor: '#F5F5F4', color: colors.muted },
});
