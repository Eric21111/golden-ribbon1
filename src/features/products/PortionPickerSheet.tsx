import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BottomSheet } from '@/components/BottomSheet';
import { managerColors } from '@/components/dashboard/theme';
import { portionChoices, portionRatioNote } from '@/lib/stockUnits';

import { MIN_TOUCH_TARGET } from './touchTargets';
import type { InventoryItemOption } from './recipePreviewData';

const BORDER = '#D9DFEA';

/**
 * Picks how much of a portion item (half-egg, half-serving or quarter-serving stock) one order uses. The manager chooses a
 * physical portion (0.5, 1, 1.5 ...). Each choice shows the whole-unit count the app really saves, so the on-screen
 * portion is never mistaken for the stored inventory quantity. Only exact whole-unit amounts are offered: nothing is rounded.
 */
export function PortionPickerSheet({
  item,
  quantity,
  onSelect,
  onClose,
}: {
  item: InventoryItemOption;
  /** The saved amount, in whole stock units. */
  quantity: number;
  /** Called with the whole stock units to save. */
  onSelect: (units: number) => void;
  onClose: () => void;
}) {
  const code = item.stockUnitCode;
  const choices = portionChoices(code, quantity);
  if (choices.length === 0) return null;
  const unitName = (units: number) => (units === 1 ? item.unit.singular : item.unit.plural);
  return (
    <BottomSheet visible title="Quantity per order" scroll onClose={onClose}>
      <Text style={styles.intro}>
        Each sale takes this amount from {item.name} stock. {portionRatioNote(code)}. The app saves this as whole {item.unit.plural}; the saved count is
        shown under each choice.
      </Text>
      {choices.map((choice) => {
        const selected = choice.units === quantity;
        return (
          <Pressable
            key={choice.units}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={`${choice.label} ${item.name}, saved as ${choice.units} ${unitName(choice.units)}`}
            onPress={() => onSelect(choice.units)}
            style={({ pressed }) => [styles.option, selected && styles.optionSelected, pressed && styles.pressed]}
          >
            <View style={styles.optionCopy}>
              <Text style={[styles.optionText, selected && styles.optionTextSelected]}>
                {choice.label} {item.name}
              </Text>
              <Text style={styles.saved}>
                Saved as {choice.units} {unitName(choice.units)}
              </Text>
            </View>
            {selected ? <Ionicons name="checkmark" size={20} color={managerColors.royalBlue} /> : null}
          </Pressable>
        );
      })}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  intro: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18, marginBottom: 8 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: MIN_TOUCH_TARGET + 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: '#FFFFFF',
  },
  optionSelected: { borderColor: '#B9C8EA', backgroundColor: '#F6F9FE' },
  optionCopy: { flex: 1, minWidth: 0, gap: 1 },
  optionText: { color: managerColors.ink, fontFamily: 'Inter_500Medium', fontSize: 15 },
  optionTextSelected: { fontFamily: 'Inter_600SemiBold' },
  saved: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12 },
  pressed: { opacity: 0.7 },
});
