import { Pressable, StyleSheet, Text, View } from 'react-native';

import { managerColors } from '@/components/dashboard/theme';

/** Explicit product flag — BBQ, Tocino, Cheesesticks, drinks, etc. */
export function NonReturnableField({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Branch stock policy</Text>
      <Text style={styles.hint}>
        Mark non-returnable for items that stay at the booth (BBQ, Tocino, Cheesesticks, drinks). They are
        excluded from leftover returns, keep carryover at close, and can be recorded as local purchases.
      </Text>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: value }}
        accessibilityLabel="Non-returnable — stays at branch"
        onPress={() => onChange(!value)}
        style={({ pressed }) => [styles.option, value && styles.optionSelected, pressed && styles.pressed]}
      >
        <View style={[styles.box, value && styles.boxSelected]}>{value ? <View style={styles.boxInner} /> : null}</View>
        <View style={styles.copy}>
          <Text style={[styles.title, value && styles.titleSelected]}>Non-returnable (stays at branch)</Text>
          <Text style={styles.description}>
            Not auto-returned to Main. Closing behavior is forced to keep remaining stock at branch.
          </Text>
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  label: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  hint: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 18 },
  option: {
    borderWidth: 1.5,
    borderColor: managerColors.cardBorder,
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    gap: 12,
    backgroundColor: '#FFFFFF',
  },
  optionSelected: { borderColor: managerColors.royalBlue, backgroundColor: '#F7F9FD' },
  pressed: { opacity: 0.85 },
  box: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: managerColors.cardBorder,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  boxSelected: { borderColor: managerColors.royalBlue },
  boxInner: { width: 12, height: 12, borderRadius: 3, backgroundColor: managerColors.royalBlue },
  copy: { flex: 1, gap: 4 },
  title: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  titleSelected: { color: managerColors.royalBlue },
  description: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 17 },
});
