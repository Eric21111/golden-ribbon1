import Ionicons from '@react-native-vector-icons/ionicons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BottomSheet } from '@/components/BottomSheet';
import { colors, radius, spacing } from '@/constants/theme';

export type FilterOption<T extends string> = {
  label: string;
  value: T;
};

type FilterDropdownProps<T extends string> = {
  /** Sheet title and accessibility context. */
  label: string;
  options: Array<FilterOption<T>>;
  value: T;
  onChange: (value: T) => void;
};

export function FilterDropdown<T extends string>({
  label,
  options,
  value,
  onChange,
}: FilterDropdownProps<T>) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value) ?? options[0];

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${selected?.label ?? 'Select'}`}
        accessibilityHint="Opens a list of filter options"
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.trigger, pressed && styles.pressed]}
      >
        <Text style={styles.triggerLabel} numberOfLines={1}>
          {selected?.label ?? label}
        </Text>
        <Ionicons color={colors.muted} name="chevron-down" size={18} />
      </Pressable>

      <BottomSheet visible={open} title={label} onClose={() => setOpen(false)}>
        <View style={styles.list}>
          {options.map((option) => {
            const isSelected = option.value === value;
            return (
              <Pressable
                key={option.value || '__all__'}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                onPress={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                style={({ pressed }) => [
                  styles.row,
                  isSelected && styles.rowSelected,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.rowLabel, isSelected && styles.rowLabelSelected]}>
                  {option.label}
                </Text>
                {isSelected ? (
                  <Ionicons color={colors.primary} name="checkmark" size={20} />
                ) : null}
              </Pressable>
            );
          })}
        </View>
      </BottomSheet>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  triggerLabel: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  list: { gap: spacing.xs, paddingBottom: spacing.sm },
  row: {
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  rowSelected: {
    borderColor: colors.primary,
    backgroundColor: '#FFEDD5',
  },
  rowLabel: { color: colors.text, fontSize: 16, fontWeight: '600', flex: 1 },
  rowLabelSelected: { color: colors.primary, fontWeight: '800' },
  pressed: { opacity: 0.75 },
});
