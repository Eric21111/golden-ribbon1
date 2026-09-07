import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing } from '@/constants/theme';

interface Choice<T extends string> {
  label: string;
  value: T;
}

export function ChoiceChips<T extends string>({ label, choices, value, onChange }: { label?: string; choices: Choice<T>[]; value: T; onChange: (value: T) => void }) {
  return (
    <View style={styles.container}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View style={styles.wrap}>
        {choices.map((choice) => {
          const selected = choice.value === value;
          return (
            <Pressable key={choice.value} accessibilityRole="button" accessibilityState={{ selected }} onPress={() => onChange(choice.value)} style={[styles.choice, selected && styles.selected]}>
              <Text style={[styles.text, selected && styles.selectedText]}>{choice.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.xs },
  label: { color: colors.text, fontSize: 14, fontWeight: '600' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  choice: { minHeight: 42, justifyContent: 'center', paddingHorizontal: 14, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface },
  selected: { borderColor: colors.primary, backgroundColor: '#FFEDD5' },
  text: { color: colors.text, fontSize: 14, fontWeight: '600' },
  selectedText: { color: colors.primary, fontWeight: '800' },
});
