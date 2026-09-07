import { Pressable, StyleSheet, Text, View } from 'react-native';

import { StatusBadge } from '@/components/StatusBadge';
import { colors, radius, spacing } from '@/constants/theme';
import type { Branch } from '@/types/models';

export function BranchListItem({ branch, onPress }: { branch: Branch; onPress?: () => void }) {
  return (
    <Pressable disabled={!onPress} onPress={onPress} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <View style={styles.topRow}>
        <View style={styles.copy}>
          <Text style={styles.name}>{branch.name}</Text>
          <Text style={styles.code}>{branch.code}</Text>
        </View>
        <StatusBadge active={branch.is_active} />
      </View>
      <Text style={styles.type}>{branch.is_main_branch ? 'Main Branch' : 'Selling Branch'}</Text>
      {branch.address ? <Text style={styles.address}>{branch.address}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  pressed: { opacity: 0.8 },
  topRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  copy: { flex: 1 },
  name: { color: colors.text, fontSize: 17, fontWeight: '700' },
  code: { color: colors.muted, fontSize: 13, fontWeight: '600', marginTop: 2 },
  type: { color: colors.primary, fontSize: 13, fontWeight: '700' },
  address: { color: colors.muted, fontSize: 14, lineHeight: 20 },
});
