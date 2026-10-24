import Ionicons from '@react-native-vector-icons/ionicons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { managerColors } from '@/components/dashboard/theme';

import { InventoryItemPickerModal } from './InventoryItemPickerModal';
import { MIN_TOUCH_TARGET } from './touchTargets';
import {
  MAX_RECIPE_QUANTITY,
  THIS_PRODUCT_ID,
  findInventoryItem,
  getQuickAddItems,
  unitLabel,
  type InventoryItemOption,
  type RecipeLine,
} from './recipePreviewData';

const BORDER = '#D9DFEA';
const BLUE_TINT = '#EAF0FB';

/**
 * Stock used per order for one variant (or for the product itself). It edits the wizard's local state; the wizard
 * saves the lists with the product.
 */
export function VariantRecipePreview({
  label = 'STOCK USED PER ORDER',
  lockMainProduct = false,
  mainOnly = false,
  lines,
  productName,
  ingredients,
  suggestedIds = [],
  onChange,
}: {
  /** Section label; it varies by product category. */
  label?: string;
  /** When true, the "This Product" line can't be removed (its quantity can still change). */
  lockMainProduct?: boolean;
  /**
   * When true only the product itself can be listed (a snack): no Rice / Egg chips and no "Browse all". If the
   * product line was removed, a single chip puts it back.
   */
  mainOnly?: boolean;
  lines: RecipeLine[];
  /** Name of the product being created/edited, shown for the "This Product" option. */
  productName: string;
  /** Real products that can be used as stock items. */
  ingredients: InventoryItemOption[];
  /** Ingredients already used elsewhere in this product, offered as one-tap chips. */
  suggestedIds?: string[];
  onChange: (lines: RecipeLine[]) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const quickAddItems = mainOnly ? [] : getQuickAddItems(lines, productName, ingredients, suggestedIds);
  const mainMissing = mainOnly && !lines.some((line) => line.itemId === THIS_PRODUCT_ID);
  // A snack only shows the row when its own line needs putting back; otherwise there is nothing to add.
  const showAddRow = !mainOnly || mainMissing;

  function setQuantity(index: number, quantity: number) {
    const clamped = Math.max(0, Math.min(quantity, MAX_RECIPE_QUANTITY));
    onChange(lines.map((line, i) => (i === index ? { ...line, quantity: clamped } : line)));
  }

  function addItem(itemId: string) {
    // An item can appear only once per variant.
    if (lines.some((line) => line.itemId === itemId)) return;
    onChange([...lines, { itemId, quantity: 1 }]);
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>

      {lines.length === 0 ? (
        <Text style={styles.empty}>No stock items added yet.</Text>
      ) : (
        <View>
          {lines.map((line, index) => {
            const item = findInventoryItem(line.itemId, productName, ingredients);
            if (!item) return null;
            const locked = lockMainProduct && line.itemId === THIS_PRODUCT_ID;
            // The main product shows its real name ("Beef Pares"), not the generic "This Product".
            const shownName = item.id === THIS_PRODUCT_ID && productName.trim() ? productName.trim() : item.name;
            return (
              <View key={line.itemId} style={[styles.line, index > 0 && styles.lineDivider]}>
                <View style={styles.lineInfo}>
                  <Text style={styles.itemName} numberOfLines={1}>
                    {shownName}
                  </Text>
                  <Text style={styles.itemUnit} numberOfLines={1}>
                    {unitLabel(item.unit, line.quantity)}
                    {item.id !== THIS_PRODUCT_ID && item.hint ? ` · ${item.hint}` : ''}
                  </Text>
                </View>
                <View style={styles.stepper}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Decrease ${item.name} quantity`}
                    disabled={line.quantity <= 1}
                    onPress={() => setQuantity(index, line.quantity - 1)}
                    style={({ pressed }) => [styles.stepTouch, pressed && styles.pressed]}
                  >
                    <View style={[styles.stepButton, line.quantity <= 1 && styles.stepButtonDisabled]}>
                      <Ionicons name="remove" size={16} color={managerColors.royalBlue} />
                    </View>
                  </Pressable>
                  <TextInput
                    accessibilityLabel={`${item.name} quantity used`}
                    keyboardType="number-pad"
                    maxLength={2}
                    selectTextOnFocus
                    value={line.quantity === 0 ? '' : String(line.quantity)}
                    onChangeText={(text) => setQuantity(index, parseInt(text.replace(/\D/g, '') || '0', 10))}
                    onBlur={() => {
                      if (line.quantity === 0) setQuantity(index, 1);
                    }}
                    style={styles.quantityInput}
                  />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Increase ${item.name} quantity`}
                    disabled={line.quantity >= MAX_RECIPE_QUANTITY}
                    onPress={() => setQuantity(index, line.quantity + 1)}
                    style={({ pressed }) => [styles.stepTouch, pressed && styles.pressed]}
                  >
                    <View style={[styles.stepButton, line.quantity >= MAX_RECIPE_QUANTITY && styles.stepButtonDisabled]}>
                      <Ionicons name="add" size={16} color={managerColors.royalBlue} />
                    </View>
                  </Pressable>
                </View>
                {locked ? (
                  <View
                    accessible
                    accessibilityLabel={`${item.name} is always included`}
                    style={styles.removeButton}
                  >
                    <Ionicons name="lock-closed-outline" size={16} color={managerColors.subtext} />
                  </View>
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${item.name}`}
                    hitSlop={8}
                    onPress={() => onChange(lines.filter((_, i) => i !== index))}
                    style={({ pressed }) => [styles.removeButton, pressed && styles.pressed]}
                  >
                    <Ionicons name="close" size={18} color={managerColors.subtext} />
                  </Pressable>
                )}
              </View>
            );
          })}
        </View>
      )}

      {showAddRow ? (
        <View style={styles.chipRow}>
          {mainMissing ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Quick add This Product"
              onPress={() => addItem(THIS_PRODUCT_ID)}
              style={({ pressed }) => [styles.chipTouch, pressed && styles.pressed]}
            >
              <View style={styles.chip}>
                <Ionicons name="add" size={14} color={managerColors.royalBlue} />
                <Text style={styles.chipText}>{productName.trim() || 'This Product'}</Text>
              </View>
            </Pressable>
          ) : null}
          {quickAddItems.map((item) => (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              accessibilityLabel={`Quick add ${item.name}`}
              onPress={() => addItem(item.id)}
              style={({ pressed }) => [styles.chipTouch, pressed && styles.pressed]}
            >
              <View style={styles.chip}>
                <Ionicons name="add" size={14} color={managerColors.royalBlue} />
                <Text style={styles.chipText}>{item.name}</Text>
              </View>
            </Pressable>
          ))}
          {mainOnly ? null : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add inventory item"
              onPress={() => setPickerOpen(true)}
              style={({ pressed }) => [styles.chipTouch, pressed && styles.pressed]}
            >
              <View style={styles.browseChip}>
                <Ionicons name="search" size={14} color={managerColors.royalBlue} />
                <Text style={styles.chipText}>Browse all</Text>
              </View>
            </Pressable>
          )}
        </View>
      ) : null}

      {mainOnly ? null : (
        <InventoryItemPickerModal
          visible={pickerOpen}
          productName={productName}
          ingredients={ingredients}
          addedItemIds={lines.map((line) => line.itemId)}
          onSelect={(itemId) => {
            addItem(itemId);
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  label: { color: managerColors.subtext, fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 0.6 },
  empty: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 2 },
  lineDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: BORDER },
  lineInfo: { flex: 1, minWidth: 0, gap: 1 },
  itemName: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  itemUnit: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12 },
  stepper: { flexDirection: 'row', alignItems: 'center' },
  // 44px tap area (stepTouch); the visible circle (stepButton) stays compact.
  stepTouch: { width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' },
  stepButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: BLUE_TINT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepButtonDisabled: { opacity: 0.4 },
  quantityInput: {
    width: 36,
    height: MIN_TOUCH_TARGET,
    textAlign: 'center',
    color: managerColors.ink,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    padding: 0,
  },
  removeButton: { width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 8 },
  chipTouch: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: BLUE_TINT,
    borderRadius: 999,
    paddingLeft: 8,
    paddingRight: 12,
    paddingVertical: 6,
  },
  chipText: { color: managerColors.royalBlue, fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  browseChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    paddingLeft: 10,
    paddingRight: 12,
    paddingVertical: 5,
  },
  pressed: { opacity: 0.7 },
});
