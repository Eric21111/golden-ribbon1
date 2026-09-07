import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing } from '@/constants/theme';
import type { Branch } from '@/types/models';

export function BranchSelector({ branches, value, onChange, allowAll = false }: { branches: Branch[]; value: string; onChange: (id: string) => void; allowAll?: boolean }) {
  const choices = allowAll ? [{ id: '', name: 'All branches' } as Branch, ...branches] : branches;
  return (
    <View style={styles.wrap}>
      {choices.map((branch) => {
        const selected = branch.id === value;
        return (
          <Pressable key={branch.id || 'all'} onPress={() => onChange(branch.id)} style={[styles.choice, selected && styles.selected]}>
            <Text style={[styles.text, selected && styles.selectedText]}>{branch.name}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  choice: { minHeight: 42, justifyContent: 'center', paddingHorizontal: 14, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface },
  selected: { borderColor: colors.primary, backgroundColor: '#FFEDD5' },
  text: { color: colors.text, fontSize: 14, fontWeight: '600' },
  selectedText: { color: colors.primary, fontWeight: '800' },
});
