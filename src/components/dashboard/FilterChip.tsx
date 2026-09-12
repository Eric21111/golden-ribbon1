import { Pressable, StyleSheet, Text } from 'react-native';

import { managerColors } from './theme';

interface FilterChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
}

export function FilterChip({ label, selected, onPress }: FilterChipProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.chip, selected && styles.chipSelected, pressed && styles.pressed]}
    >
      <Text style={[styles.label, selected && styles.labelSelected]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: managerColors.cardSurface,
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
  },
  chipSelected: { backgroundColor: '#EAF0FB', borderColor: '#EAF0FB' },
  pressed: { opacity: 0.7 },
  label: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 13 },
  labelSelected: { color: managerColors.royalBlue, fontFamily: 'Inter_600SemiBold' },
});
