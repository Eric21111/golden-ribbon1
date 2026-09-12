import { ScrollView, StyleSheet } from 'react-native';

import { FilterChip } from './FilterChip';

interface FilterChipOption<T extends string> {
  label: string;
  value: T;
}

interface FilterChipRowProps<T extends string> {
  options: FilterChipOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

export function FilterChipRow<T extends string>({ options, value, onChange }: FilterChipRowProps<T>) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.content}
    >
      {options.map((option) => (
        <FilterChip
          key={option.value}
          label={option.label}
          selected={option.value === value}
          onPress={() => onChange(option.value)}
        />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { flexDirection: 'row', gap: 8, paddingRight: 4 },
});
