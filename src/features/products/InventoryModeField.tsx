import { StyleSheet, Text, View } from 'react-native';

import { FilterChipRow } from '@/components/dashboard/FilterChipRow';
import { managerColors } from '@/components/dashboard/theme';
import type { InventoryMode } from '@/types/models';

const OPTIONS: Array<{ label: string; value: InventoryMode }> = [
  { label: 'Piece-based stock', value: 'piece_stock' },
  { label: 'KG-delivered meal', value: 'kg_meal' },
];

export function InventoryModeField({
  value,
  onChange,
  note,
}: {
  value: InventoryMode;
  onChange: (value: InventoryMode) => void;
  note?: string;
}) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Inventory type</Text>
      <FilterChipRow options={OPTIONS} value={value} onChange={onChange} />
      {note ? <Text style={styles.note}>{note}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  label: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  note: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18 },
});
