import { Pressable, StyleSheet, Text, View } from 'react-native';

import { managerColors } from '@/components/dashboard/theme';
import type { Branch } from '@/types/models';

/** `variant="card"`: the same rounded choices as Manager | Cashier (RoleChoice), so a form with both looks like one. */
export function BranchSelector({ branches, value, onChange, allowAll = false, variant = 'pill' }: { branches: Branch[]; value: string; onChange: (id: string) => void; allowAll?: boolean; variant?: 'pill' | 'card' }) {
  const choices = allowAll ? [{ id: '', name: 'All branches' } as Branch, ...branches] : branches;
  return (
    <View style={styles.wrap}>
      {choices.map((branch) => {
        const selected = branch.id === value;
        return (
          <Pressable key={branch.id || 'all'} onPress={() => onChange(branch.id)} style={[styles.choice, selected && styles.selected, variant === 'card' && styles.cardChoice, variant === 'card' && selected && styles.cardSelected]}>
            <Text style={[styles.text, selected && styles.selectedText, variant === 'card' && styles.cardText]}>{branch.name}</Text>
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
  cardChoice: { minHeight: 48, paddingHorizontal: 18, borderWidth: 1.5, borderRadius: 14, backgroundColor: '#FFFFFF' },
  cardSelected: { borderColor: managerColors.royalBlue, backgroundColor: '#F3F7FE' },
  cardText: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  text: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 14 },
  selectedText: { color: managerColors.royalBlue, fontFamily: 'Inter_700Bold' },
});
