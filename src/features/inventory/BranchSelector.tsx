import { Pressable, StyleSheet, Text, View } from 'react-native';

import { managerColors } from '@/components/dashboard/theme';
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
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  choice: {
    minHeight: 42,
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 999,
    backgroundColor: managerColors.cardSurface,
  },
  selected: { borderColor: '#EAF0FB', backgroundColor: '#EAF0FB' },
  text: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 14 },
  selectedText: { color: managerColors.royalBlue, fontFamily: 'Inter_700Bold' },
});
