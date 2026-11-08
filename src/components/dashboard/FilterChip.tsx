import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { managerColors } from './theme';

interface FilterChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  /** Small decoration before the label (e.g. a category icon). */
  leading?: ReactNode;
}

export function FilterChip({ label, selected, onPress, leading }: FilterChipProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      // the chip is about 38dp tall; this brings the touch area to the 44dp minimum without changing how it looks
      hitSlop={{ top: 3, bottom: 3 }}
      onPress={onPress}
      style={({ pressed }) => [styles.chip, selected && styles.chipSelected, pressed && styles.pressed]}
    >
      {leading}
      <Text style={[styles.label, selected && styles.labelSelected]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
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
