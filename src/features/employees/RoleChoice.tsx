import { Pressable, StyleSheet, Text, View } from 'react-native';

import { managerColors } from '@/components/dashboard/theme';

/** Two or three big equal choices side by side (Manager | Cashier): easier to hit than small chips, and the selected one is obvious. */
export function RoleChoice<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ label: string; value: T }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.row}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [styles.choice, selected && styles.selected, pressed && styles.pressed]}
          >
            <Text style={[styles.text, selected && styles.selectedText]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10 },
  choice: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: managerColors.cardBorder,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
  },
  selected: { borderColor: managerColors.royalBlue, backgroundColor: '#F3F7FE' },
  pressed: { opacity: 0.75 },
  text: { color: managerColors.subtext, fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  selectedText: { color: managerColors.royalBlue, fontFamily: 'Inter_700Bold' },
});
