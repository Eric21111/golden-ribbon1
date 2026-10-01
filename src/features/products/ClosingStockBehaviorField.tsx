import { Pressable, StyleSheet, Text, View } from 'react-native';

import { managerColors } from '@/components/dashboard/theme';
import type { ClosingStockBehavior } from '@/types/models';

const OPTIONS: Array<{ value: ClosingStockBehavior; title: string; description: string }> = [
  {
    value: 'keep_at_branch',
    title: 'Keep remaining stock at branch',
    description: 'Remaining usable stock stays at the selling branch for the next day.',
  },
  {
    value: 'record_as_unsold',
    title: 'Record remaining stock as unsold',
    description: 'Remaining usable stock is recorded as unsold when the final daily close is completed.',
  },
];

export function ClosingStockBehaviorField({
  value,
  onChange,
}: {
  value: ClosingStockBehavior;
  onChange: (value: ClosingStockBehavior) => void;
}) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Closing stock behavior</Text>
      <View style={styles.options}>
        {OPTIONS.map((option) => {
          const selected = value === option.value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              onPress={() => onChange(option.value)}
              style={({ pressed }) => [styles.option, selected && styles.optionSelected, pressed && styles.pressed]}
            >
              <View style={styles.optionHeader}>
                <View style={[styles.radioOuter, selected && styles.radioOuterSelected]}>
                  {selected ? <View style={styles.radioInner} /> : null}
                </View>
                <Text style={[styles.optionTitle, selected && styles.optionTitleSelected]}>{option.title}</Text>
              </View>
              <Text style={styles.optionDescription}>{option.description}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  label: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  options: { gap: 8 },
  option: {
    borderWidth: 1.5,
    borderColor: managerColors.cardBorder,
    borderRadius: 12,
    padding: 12,
    gap: 6,
    backgroundColor: '#FFFFFF',
  },
  optionSelected: { borderColor: managerColors.royalBlue, backgroundColor: '#F7F9FD' },
  pressed: { opacity: 0.85 },
  optionHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  radioOuter: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: managerColors.cardBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOuterSelected: { borderColor: managerColors.royalBlue },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: managerColors.royalBlue,
  },
  optionTitle: { flex: 1, color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  optionTitleSelected: { color: managerColors.royalBlue },
  optionDescription: {
    color: managerColors.subtext,
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 18,
    paddingLeft: 30,
  },
});
