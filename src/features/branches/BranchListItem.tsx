import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { StatusBadge } from '@/components/StatusBadge';
import { colors, radius, spacing } from '@/constants/theme';
import type { Branch } from '@/types/models';

export function BranchListItem({ branch, onPress }: { branch: Branch; onPress?: () => void }) {
  const typeLabel = branch.is_main_branch ? 'Main Branch' : 'Selling Branch';

  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${branch.name}, ${typeLabel}`}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.row}>
        <View style={styles.copy}>
          <Text style={styles.name} numberOfLines={1}>
            {branch.name}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {branch.code} · {typeLabel}
          </Text>
        </View>
        <View style={styles.trailing}>
          <StatusBadge active={branch.is_active} />
          {onPress ? <Ionicons color={colors.muted} name="chevron-forward" size={18} /> : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
  },
  pressed: { opacity: 0.82 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  copy: { flex: 1, minWidth: 0 },
  name: { color: colors.text, fontSize: 16, fontWeight: '700' },
  meta: { color: colors.muted, fontSize: 13, fontWeight: '600', marginTop: 2 },
  trailing: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
});
