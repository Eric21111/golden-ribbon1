import Ionicons from '@react-native-vector-icons/ionicons';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { managerColors } from '@/components/dashboard/theme';
import { portionRatioNote, unitsPerWhole } from '@/lib/stockUnits';

import { CategoryIcon } from './CategoryIcon';
import { InventoryItemPickerModal } from './InventoryItemPickerModal';
import { PortionPickerSheet } from './PortionPickerSheet';
import { MIN_TOUCH_TARGET } from './touchTargets';
import {
  MAX_RECIPE_QUANTITY,
  OWN_STOCK_LINES,
  effectiveLines,
  THIS_PRODUCT_ID,
  findInventoryItem,
  getQuickAddItems,
  lineAmount,
  stockModeOf,
  summarizeDeduction,
  unitLabel,
  type InventoryItemOption,
  type RecipeLine,
  type StockMode,
} from './recipePreviewData';

const BORDER = '#D9DFEA';
const BLUE_TINT = '#EAF0FB';

/**
 * Stock used per order for one variant (or for the product itself). It edits the wizard's local state; the wizard
 * saves the lists with the product.
 */
export function VariantRecipePreview({
  label = 'STOCK DEDUCTION',
  lockMainProduct = false,
  mainOnly = false,
  stockModeChoice = false,
  startOnOtherItems = false,
  inheritedLines,
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
   * When true only the product itself can be listed (a snack): no Rice / Egg chips and no "Add Stock Item". If the
   * product line was removed, a single chip puts it back.
   */
  mainOnly?: boolean;
  /**
   * Extras & Sides: choose between this product's own stock and other stock items, and show what one order deducts.
   * Own stock is the list "This Product" x1 (or no list); other items replace it. Switching back and forth keeps the
   * other items you had picked, so nothing is lost by trying the other mode.
   */
  stockModeChoice?: boolean;
  /**
   * Create, Extras & Sides: a list with nothing in it starts on "Take from other items" (most extras are made from ingredients
   * already counted, like Rice) instead of on the product's own stock. Nothing is deducted until an item is added, so the
   * wizard refuses to continue while it is empty. An existing product is never started this way: its saved list decides.
   */
  startOnOtherItems?: boolean;
  /**
   * The product-level list saved for the whole product, passed to the lists of its options. An option with no list of its
   * own really uses it (the database resolves option list, then product-level list, then the product itself), so the
   * preview and the "other items" mode follow it too. Adding an item copies it into the option first, never drops it.
   */
  inheritedLines?: RecipeLine[];
  lines: RecipeLine[];
  /** Name of the product being created/edited, shown for the "This Product" option. */
  productName: string;
  /** Real products that can be used as stock items. */
  ingredients: InventoryItemOption[];
  /** Ingredients already used elsewhere in this product, offered as one-tap chips. */
  suggestedIds?: string[];
  onChange: (lines: RecipeLine[]) => void;
}) {
  const [quantityError, setQuantityError] = useState('');
  // Index of the portion line whose amount sheet is open (portion items only; whole-number items keep the stepper).
  const [portionSheetIndex, setPortionSheetIndex] = useState<number | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  // True while the sheet was opened by tapping "Take from other items" with nothing to restore: the pick STARTS the list
  // instead of being added to "This Product". Closing the sheet without a pick changes nothing, so an "other items"
  // list can never exist with no item in it.
  const [startingOther, setStartingOther] = useState(false);
  const [pendingOther, setPendingOther] = useState(() => startOnOtherItems && effectiveLines(lines, inheritedLines ?? []).length === 0);
  const stashedOtherLines = useRef<RecipeLine[]>([]);
  // The sheet stays open while items are added, so each add must build on the list as it is right now (two quick taps would
  // otherwise both start from the same, older list).
  const latestLines = useRef(lines);
  latestLines.current = lines;
  // What an order really deducts: this list, else the product-level list saved for the whole product.
  const effective = effectiveLines(lines, inheritedLines ?? []);
  const inheriting = lines.length === 0 && effective.length > 0;
  // "Take from other items" chosen but nothing added yet (see startOnOtherItems)
  const waitingForItems = pendingOther && effective.length === 0;
  const mode: StockMode = waitingForItems ? 'other' : stockModeOf(effective);
  const showList = !stockModeChoice || mode === 'other';
  const quickAddItems = mainOnly ? [] : getQuickAddItems(lines, productName, ingredients, suggestedIds);
  const mainMissing = mainOnly && !lines.some((line) => line.itemId === THIS_PRODUCT_ID);
  // A snack only shows the row when its own line needs putting back; otherwise there is nothing to add.
  const showAddRow = !mainOnly || mainMissing;

  function setQuantity(index: number, quantity: number) {
    const clamped = Math.max(0, Math.min(quantity, MAX_RECIPE_QUANTITY));
    onChange(lines.map((line, i) => (i === index ? { ...line, quantity: clamped } : line)));
  }

  function selectMode(next: StockMode) {
    if (next === mode) return;
    if (next === 'own') {
      stashedOtherLines.current = effective;
      setPendingOther(false);
      onChange(OWN_STOCK_LINES);
      return;
    }
    if (stashedOtherLines.current.length > 0) {
      onChange(stashedOtherLines.current);
      return;
    }
    setStartingOther(true);
    setPickerOpen(true);
  }

  function removeLine(index: number) {
    const next = lines.filter((_, i) => i !== index);
    // Extras: taking out the last item goes back to this product's own stock, written explicitly. An empty list would
    // mean something else to the database (the product-level list, or the product itself).
    onChange(stockModeChoice && next.length === 0 ? OWN_STOCK_LINES : next);
  }

  function addItem(itemId: string) {
    // An inherited list becomes this option's own list first, so adding an item never silently drops what it used.
    const current = latestLines.current;
    const base = current.length > 0 ? current : inheriting ? effective : [];
    // An item can appear only once per variant.
    if (base.some((line) => line.itemId === itemId)) return;
    const next = [...base, { itemId, quantity: 1 }];
    latestLines.current = next;
    setPendingOther(false);
    onChange(next);
  }

  function closePicker() {
    setStartingOther(false);
    setPickerOpen(false);
  }

  const listBlock = showList ? (
    <>
    {lines.length === 0 ? (
      <Text style={styles.empty}>
        {inheriting
          ? `No list of its own, so it uses the product's saved list: ${summarizeDeduction(effective, productName, ingredients)}. Add or change an item to give this option its own list.`
          : waitingForItems
            ? 'Add what each order uses, for example Rice.'
            : 'No stock items added yet.'}
      </Text>
    ) : (
      <View>
        {lines.map((line, index) => {
          const item = findInventoryItem(line.itemId, productName, ingredients);
          if (!item) return null;
          const locked = lockMainProduct && line.itemId === THIS_PRODUCT_ID;
          // The main product shows its real name ("Beef Pares"), not the generic "This Product".
          const shownName = item.id === THIS_PRODUCT_ID && productName.trim() ? productName.trim() : item.name;
          const portion = item.id !== THIS_PRODUCT_ID && unitsPerWhole(item.stockUnitCode) ? item.stockUnitCode : null;
          return (
            <View key={line.itemId} style={[styles.line, index > 0 && styles.lineDivider]}>
              {item.id !== THIS_PRODUCT_ID ? <CategoryIcon category={item.category} size={22} /> : null}
              <View style={styles.lineInfo}>
                <Text style={styles.itemName} numberOfLines={1}>
                  {shownName}
                </Text>
                {/* "Base product · Required" is wider than the room beside the stepper on a 360dp screen: let it wrap */}
                <Text style={styles.itemUnit} numberOfLines={locked || portion ? 2 : 1}>
                  {locked
                    ? 'Base product · Required'
                    : portion
                      ? `Stored as ${line.quantity} ${unitLabel(item.unit, line.quantity)} · ${portionRatioNote(portion)}`
                      : `${unitLabel(item.unit, line.quantity)}${item.id !== THIS_PRODUCT_ID && item.hint ? ` · ${item.hint}` : ''}`}
                </Text>
              </View>
              {portion ? (
                <View style={styles.portionCol}>
                  <Text style={styles.portionCaption}>Quantity</Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${item.name} quantity per order, ${lineAmount(item, line.quantity)}. Change quantity`}
                    onPress={() => setPortionSheetIndex(index)}
                    style={({ pressed }) => [styles.portionSelect, pressed && styles.pressed]}
                  >
                    <Text style={styles.portionValue}>{lineAmount(item, line.quantity)}</Text>
                    <Ionicons name="chevron-down" size={16} color={managerColors.subtext} />
                  </Pressable>
                </View>
              ) : (
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
                  selectTextOnFocus
                  value={line.quantity === 0 ? '' : String(line.quantity)}
                  onChangeText={(text) => {
                    if (!/^\d{0,2}$/.test(text)) { setQuantityError('Enter whole stock units. For half portions, choose a half-unit stock item.'); return; }
                    setQuantityError(''); setQuantity(index, Number(text || '0'));
                  }}
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
              )}
              {locked ? (
                <View
                  accessible
                  accessibilityLabel={`${shownName} is the base product and is required`}
                  style={styles.removeButton}
                >
                  <Ionicons name="lock-closed-outline" size={16} color={managerColors.subtext} />
                </View>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${item.name}`}
                  hitSlop={8}
                  onPress={() => removeLine(index)}
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
            accessibilityLabel="Add Stock Item"
            onPress={() => setPickerOpen(true)}
            style={({ pressed }) => [styles.chipTouch, pressed && styles.pressed]}
          >
            <View style={styles.browseChip}>
              <Ionicons name="add" size={14} color={managerColors.royalBlue} />
              <Text style={styles.chipText}>Add Stock Item</Text>
            </View>
          </Pressable>
        )}
      </View>
    ) : null}

    </>
  ) : null;

  return (
    <View style={styles.wrap}>
      {quantityError ? <Text accessibilityRole="alert" style={{ color: '#B91C1C' }}>{quantityError}</Text> : null}
      {/* the Extras & Sides choice sits under its own page heading, so the section label would only repeat it */}
      {stockModeChoice ? null : <Text style={styles.label}>{label}</Text>}

      {stockModeChoice ? (
        <View accessibilityRole="radiogroup" style={styles.modes}>
          {(
            [
              ['other', 'Take from other items', 'Selling it deducts the items you list, like Rice ×1.'],
              ['own', 'Count its own stock', `${productName.trim() || 'This product'} is received and counted by itself.`],
            ] as const
          ).map(([value, text, hint]) => {
            const selected = mode === value;
            return (
              <View key={value} style={[styles.modeCard, selected && styles.modeCardSelected]}>
              <Pressable
                accessibilityRole="radio"
                accessibilityLabel={text}
                accessibilityState={{ selected }}
                onPress={() => selectMode(value)}
                style={({ pressed }) => [styles.modeRow, pressed && styles.pressed]}
              >
                <Ionicons
                  name={selected ? 'radio-button-on' : 'radio-button-off'}
                  size={20}
                  color={selected ? managerColors.royalBlue : managerColors.subtext}
                />
                <View style={styles.modeCopy}>
                  <Text style={[styles.modeText, selected && styles.modeTextSelected]}>{text}</Text>
                  <Text style={styles.modeHint}>{hint}</Text>
                </View>
              </Pressable>
              {selected && value === 'other' && showList ? <View style={styles.modeBody}>{listBlock}</View> : null}
              </View>
            );
          })}
        </View>
      ) : null}

      {stockModeChoice ? null : listBlock}

      {(() => {
        const open = portionSheetIndex === null ? undefined : lines[portionSheetIndex];
        const openItem = open ? findInventoryItem(open.itemId, productName, ingredients) : undefined;
        if (!open || !openItem || !unitsPerWhole(openItem.stockUnitCode)) return null;
        return (
          <PortionPickerSheet
            item={openItem}
            quantity={open.quantity}
            onClose={() => setPortionSheetIndex(null)}
            onSelect={(units) => {
              setQuantityError('');
              setQuantity(portionSheetIndex!, units);
              setPortionSheetIndex(null);
            }}
          />
        );
      })()}

      {mainOnly ? null : (
        <InventoryItemPickerModal
          visible={pickerOpen}
          productName={productName}
          ingredients={ingredients}
          addedItemIds={startingOther ? [] : (lines.length > 0 ? lines : effective).map((line) => line.itemId)}
          // Picking an item does not close the sheet, so several can be added in one go; Close finishes.
          onSelect={(itemId) => {
            if (startingOther) {
              const first = [{ itemId, quantity: 1 }];
              latestLines.current = first;
              setPendingOther(false);
              onChange(first);
              setStartingOther(false);
            } else {
              addItem(itemId);
            }
          }}
          onClose={closePicker}
        />
      )}

    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  modes: { gap: 10 },
  // each choice is a card; the selected one is tinted, and the item list lives inside "Take from other items"
  modeCard: { borderWidth: 1, borderColor: BORDER, borderRadius: 12, backgroundColor: '#FFFFFF', paddingHorizontal: 12, paddingVertical: 4 },
  modeCardSelected: { borderColor: '#B9C8EA', backgroundColor: '#F6F9FE' },
  modeBody: { gap: 10, paddingTop: 6, paddingBottom: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#D9DFEA' },
  modeRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: MIN_TOUCH_TARGET, paddingVertical: 6 },
  modeCopy: { flex: 1, minWidth: 0, gap: 1 },
  modeHint: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 16 },
  modeText: { color: managerColors.ink, fontFamily: 'Inter_500Medium', fontSize: 14 },
  modeTextSelected: { fontFamily: 'Inter_600SemiBold' },
  label: { color: managerColors.subtext, fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 0.6 },
  empty: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 2 },
  lineDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: BORDER },
  lineInfo: { flex: 1, minWidth: 0, gap: 1 },
  itemName: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  itemUnit: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12 },
  stepper: { flexDirection: 'row', alignItems: 'center' },
  // portion items: a labelled select that shows the physical portion (0.5), not the stored unit count
  portionCol: { alignItems: 'flex-start', gap: 2 },
  portionCaption: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 11, paddingLeft: 4 },
  portionSelect: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
    minWidth: 84,
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
  },
  portionValue: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 15 },
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
