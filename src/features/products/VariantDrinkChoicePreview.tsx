import Ionicons from '@react-native-vector-icons/ionicons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { managerColors } from '@/components/dashboard/theme';

import { InventoryItemPickerModal } from './InventoryItemPickerModal';
import type { DrinkChoice, InventoryItemOption } from './recipePreviewData';
import { MIN_TOUCH_TARGET } from './touchTargets';

const BORDER = '#D9DFEA';
const BLUE_TINT = '#EAF0FB';

/**
 * Optional drink choice for one variant: does it include a drink, and which drinks the cashier may pick from at
 * checkout. The drinks are real products; the cashier picks ONE per meal ordered and it comes out of that drink's own
 * stock. Separate from the fixed ingredients, and saved with the product.
 */
export function VariantDrinkChoicePreview({
  choice,
  productName,
  drinks,
  showValidation,
  onChange,
}: {
  choice: DrinkChoice;
  /** Name of the product being created/edited (so it is never offered as its own drink). */
  productName: string;
  /** Real products that can be offered as drinks. */
  drinks: InventoryItemOption[];
  /** True once the user has tried to continue; an empty drink list is then shown as an error. */
  showValidation: boolean;
  onChange: (choice: DrinkChoice) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const selected = choice.drinkIds
    .map((id) => drinks.find((drink) => drink.id === id))
    .filter((drink): drink is InventoryItemOption => drink !== undefined);
  const selectedCount = choice.drinkIds.length;
  const missing = selectedCount === 0;

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>DRINK CHOICE · OPTIONAL</Text>

      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: choice.enabled }}
        accessibilityLabel="Includes a drink"
        onPress={() => onChange({ ...choice, enabled: !choice.enabled })}
        style={({ pressed }) => [styles.checkRow, pressed && styles.pressed]}
      >
        <View style={[styles.box, choice.enabled && styles.boxOn]}>
          {choice.enabled ? <Ionicons name="checkmark" size={15} color="#FFFFFF" /> : null}
        </View>
        <Text style={styles.checkLabel}>Includes a drink</Text>
      </Pressable>

      {choice.enabled ? (
        <View style={styles.options}>
          <View style={styles.chips}>
            {selected.map((drink) => (
              <Pressable
                key={drink.id}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${drink.name} drink choice`}
                onPress={() => onChange({ ...choice, drinkIds: choice.drinkIds.filter((id) => id !== drink.id) })}
                style={({ pressed }) => [styles.chipTouch, pressed && styles.pressed]}
              >
                <View style={[styles.chip, styles.chipSelected]}>
                  <Text style={[styles.chipText, styles.chipTextSelected]}>{drink.name}</Text>
                  <Ionicons name="close" size={14} color={managerColors.royalBlue} />
                </View>
              </Pressable>
            ))}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add drink"
              onPress={() => setPickerOpen(true)}
              style={({ pressed }) => [styles.chipTouch, pressed && styles.pressed]}
            >
              <View style={styles.allChip}>
                <Ionicons name="add" size={14} color={managerColors.royalBlue} />
                <Text style={styles.allChipText}>Add drink</Text>
              </View>
            </Pressable>
          </View>
          <Text style={[styles.hint, missing && showValidation && styles.hintError]}>
            {missing
              ? 'Select at least one drink.'
              : selectedCount === 1
                ? 'Only 1 drink offered, so the cashier has no choice.'
                : `The cashier picks 1 of these ${selectedCount} drinks at checkout.`}
          </Text>
        </View>
      ) : null}

      <InventoryItemPickerModal
        visible={pickerOpen}
        title="Select Drink"
        includeThisProduct={false}
        productName={productName}
        ingredients={drinks}
        addedItemIds={choice.drinkIds}
        onSelect={(drinkId) => {
          if (!choice.drinkIds.includes(drinkId)) onChange({ ...choice, drinkIds: [...choice.drinkIds, drinkId] });
          setPickerOpen(false);
        }}
        onClose={() => setPickerOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  label: { color: managerColors.subtext, fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 0.6 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: MIN_TOUCH_TARGET },
  box: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#B8C1D1',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxOn: { borderColor: managerColors.royalBlue, backgroundColor: managerColors.royalBlue },
  checkLabel: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  options: { gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 8 },
  // 44px tap area around the compact pill
  chipTouch: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 14,
  },
  chipSelected: { borderColor: '#B9C8EA', backgroundColor: BLUE_TINT },
  chipText: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  chipTextSelected: { color: managerColors.royalBlue },
  hint: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12 },
  hintError: { color: '#B91C1C', fontFamily: 'Inter_600SemiBold' },
  allChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: BLUE_TINT,
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 12,
  },
  allChipText: { color: managerColors.royalBlue, fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  pressed: { opacity: 0.7 },
});
