import Ionicons from '@react-native-vector-icons/ionicons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ManagerBottomSheet as BottomSheet } from '@/components/dashboard/ManagerBottomSheet';
import { managerColors } from '@/components/dashboard/theme';

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
        <Ionicons color={managerColors.subtext} name="chevron-down" size={18} />
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
                  <Ionicons color={managerColors.royalBlue} name="checkmark" size={20} />
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
    gap: 8,
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 12,
    backgroundColor: managerColors.cardSurface,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  triggerLabel: {
    flex: 1,
    color: managerColors.ink,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
  list: { gap: 8, paddingBottom: 8 },
  row: {
    minHeight: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  rowSelected: {
    borderColor: managerColors.royalBlue,
    backgroundColor: '#EAF0FB',
  },
  rowLabel: { color: managerColors.ink, fontFamily: 'Inter_500Medium', fontSize: 15, flex: 1 },
  rowLabelSelected: { color: managerColors.royalBlue, fontFamily: 'Inter_700Bold' },
  pressed: { opacity: 0.75 },
});
