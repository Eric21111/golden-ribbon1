import Ionicons from '@react-native-vector-icons/ionicons';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { FormField } from '@/components/FormField';
import { managerColors } from '@/components/dashboard/theme';
import { confirmAction } from '@/lib/confirmAction';

import { getCategoryConfig, isDrinkChoiceVisible, type CategoryChoice } from './productCategoryPreview';
import { VariantDrinkChoicePreview } from './VariantDrinkChoicePreview';
import { VariantRecipePreview } from './VariantRecipePreview';
import { MIN_TOUCH_TARGET } from './touchTargets';
import {
  NO_DRINK_CHOICE,
  THIS_PRODUCT_ID,
  suggestedIngredientIds,
  summarizeDrinkChoice,
  summarizeExtras,
  type DrinkChoice,
  type InventoryItemOption,
  type RecipeLine,
} from './recipePreviewData';
import { PRODUCT_STOCK_KEY, shouldSeedProductStock } from './wizardGuards';

const BORDER = '#D9DFEA';
const BLUE_TINT = '#EAF0FB';
const DANGER = '#B91C1C';

/**
 * Step 2 of the product wizards: variant names, the stock each variant uses per order, and a PREVIEW-ONLY drink
 * choice. Variant names, the stock lists and the drink choices are saved with the product; the product category is
 * local state and never saved. The category only changes the layout: sections that don't apply are hidden,
 * never deleted (and a hidden stock list is still saved, so changing the category never silently removes it).
 */
export function VariantListEditor({
  variants,
  recipes,
  drinks,
  category,
  productName,
  ingredients,
  drinkOptions,
  error,
  onChangeName,
  onChangeRecipe,
  onChangeDrinks,
  onRemove,
  onAdd,
}: {
  variants: Array<{ key: string; name: string }>;
  /** Stock used per order, keyed by variant key (PRODUCT_STOCK_KEY for the product-level list). Saved with the product. */
  recipes: Record<string, RecipeLine[]>;
  /** Preview-only drink choice keyed by variant key. */
  drinks: Record<string, DrinkChoice>;
  /** Preview-only product category; drives the Step 2 title, labels and visible sections. */
  category: CategoryChoice;
  /** Name of the product being created/edited, for the preview-only "This Product" ingredient option. */
  productName: string;
  /** Real products that can be used as stock items. */
  ingredients: InventoryItemOption[];
  /** Drinks a meal may include, including products that are not sold on their own. */
  drinkOptions?: InventoryItemOption[];
  error?: string;
  onChangeName: (index: number, name: string) => void;
  onChangeRecipe: (variantKey: string, lines: RecipeLine[]) => void;
  onChangeDrinks: (variantKey: string, choice: DrinkChoice) => void;
  onRemove: (index: number) => void;
  onAdd: () => void;
}) {
  const config = getCategoryConfig(category);
  // A lone variant starts open so it isn't hidden; otherwise cards start collapsed to stay scannable.
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
    variants.length === 1 ? { [variants[0]!.key]: true } : {},
  );
  // Variants whose "Add variant" button was pressed while something was still wrong: their errors stay visible.
  const [attempted, setAttempted] = useState<Record<string, boolean>>({});
  const seenKeys = useRef(new Set(variants.map((variant) => variant.key)));
  const keySignature = variants.map((variant) => variant.key).join('|');

  // Newly added variants open automatically.
  useEffect(() => {
    const fresh = variants.filter((variant) => !seenKeys.current.has(variant.key));
    if (fresh.length === 0) return;
    fresh.forEach((variant) => seenKeys.current.add(variant.key));
    setExpanded((current) => ({ ...current, ...Object.fromEntries(fresh.map((variant) => [variant.key, true])) }));
    // New options in categories that start from the main product (Meals, Snacks) begin with This Product ×1:
    // "Ulam Only" is just that, and "3 sticks" only changes the quantity (×3 pcs). Only brand-new options are
    // filled in, and only when their stock list is empty, so existing options and quantities are never touched.
    if (config.autoAddMainProduct && config.showIngredients) {
      for (const variant of fresh) {
        if ((recipes[variant.key] ?? []).length === 0) {
          onChangeRecipe(variant.key, [{ itemId: THIS_PRODUCT_ID, quantity: 1 }]);
        }
      }
    }
  }, [keySignature]);

  // Products without variants (single price) get a product-level stock list that starts with This Product ×1
  // for Meals and Snacks. Seeded once: a list the user emptied on purpose is never refilled, and products that
  // have variants are never seeded.
  useEffect(() => {
    if (
      config.showIngredients &&
      config.productLevelStock &&
      shouldSeedProductStock({
        variantCount: variants.length,
        autoAdd: config.autoAddMainProduct,
        current: recipes[PRODUCT_STOCK_KEY],
      })
    ) {
      onChangeRecipe(PRODUCT_STOCK_KEY, [{ itemId: THIS_PRODUCT_ID, quantity: 1 }]);
    }
  }, [category, variants.length]);

  // A validation error (e.g. a blank name) must never hide the field it refers to.
  useEffect(() => {
    if (error) setExpanded(Object.fromEntries(variants.map((variant) => [variant.key, true])));
  }, [error]);

  // One action at a time: while a card is open, finishing it ("Done") comes first, so the page-level add
  // button only shows once every card is collapsed.
  const anyOpen = variants.some((variant) => expanded[variant.key]);
  const noun = config.noun.toLowerCase();
  const displayName = (variant: { name: string }, index: number) =>
    variant.name.trim() || `${config.noun} ${index + 1}`;
  // Items already used elsewhere in this product, offered as one-tap chips in the other lists.
  const suggestedIds = suggestedIngredientIds(recipes);
  // The product-level stock list: shown while the product has no options (sold one way, at one price).
  const showProductStock = variants.length === 0 && config.productLevelStock && config.showIngredients;

  return (
    <View style={styles.wrap}>
      <View style={styles.intro}>
        <Text style={styles.title}>{config.step2Title}</Text>
        {category === 'unset' ? (
          <Text style={styles.unsetHint}>
            Category not set. Pick one in Step 1 to set up drink options.
          </Text>
        ) : null}
      </View>

      {variants.length === 0 && config.simpleEmpty ? (
        <View style={styles.empty}>
          <View style={styles.emptyIcon}>
            <Ionicons name="cube-outline" size={20} color={managerColors.royalBlue} />
          </View>
          <Text style={styles.emptyTitle}>{config.simpleEmpty.title}</Text>
          <Text style={styles.emptyBody}>{config.simpleEmpty.body}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={config.simpleEmpty.link}
            hitSlop={8}
            onPress={onAdd}
            style={({ pressed }) => [styles.linkTouch, pressed && styles.pressed]}
          >
            <Text style={styles.emptyLink}>{config.simpleEmpty.link}</Text>
          </Pressable>
        </View>
      ) : variants.length === 0 ? (
        <View style={styles.empty}>
          <View style={styles.emptyIcon}>
            <Ionicons name="layers-outline" size={20} color={managerColors.royalBlue} />
          </View>
          <Text style={styles.emptyTitle}>No {noun}s yet</Text>
          <Text style={styles.emptyBody}>{config.emptyBody}</Text>
        </View>
      ) : (
        <View style={styles.list}>
          {variants.map((variant, index) => {
            const isOpen = Boolean(expanded[variant.key]);
            const lines = recipes[variant.key] ?? [];
            const drinkChoice = drinks[variant.key] ?? NO_DRINK_CHOICE;
            // Hidden sections keep their data; they just aren't shown or summarised.
            // One short line for the collapsed card, e.g. "+ Rice, Egg · Drink: 3 options". The main product
            // is implied (every variant has it), so it isn't repeated.
            const extras = config.showIngredients ? summarizeExtras(lines, productName, ingredients) : '';
            const drinkVisible = isDrinkChoiceVisible(category, drinkChoice.enabled);
            const drinkNames = drinkVisible ? summarizeDrinkChoice(drinkChoice, ingredients) : '';
            const drinkCount = drinkNames ? drinkNames.split(', ').length : 0;
            const collapsedLine = [
              extras || (config.showIngredients && lines.length > 0 ? 'Main item only' : ''),
              drinkCount === 0 ? '' : drinkCount === 1 ? `Drink: ${drinkNames}` : `Drink: ${drinkCount} options`,
            ]
              .filter(Boolean)
              .join(' · ');
            const hiddenStock = !config.showIngredients && lines.length > 0;
            const hiddenDrink = !drinkVisible && drinkChoice.enabled;
            const hasHiddenData = hiddenStock || hiddenDrink;
            // "Stock items don't apply", "Drink choice doesn't apply", "Stock items and drink choice don't apply"
            const trimmedName = variant.name.trim();
            const hasMainProduct = lines.some((line) => line.itemId === THIS_PRODUCT_ID);
            const status = !config.showStatus || !trimmedName
              ? null
              : lines.length === 0
                ? { label: 'No items yet', style: styles.statusMuted, textStyle: styles.statusMutedText }
                : !hasMainProduct
                  ? { label: 'Add This Product', style: styles.statusWarn, textStyle: styles.statusWarnText }
                  : null; // nothing to flag: a finished variant shows no badge
            // Removing a variant also discards its stock items and drink choice, so ask first. An empty,
            // unnamed card (e.g. added by mistake) is removed straight away.
            const hasPreviewData = lines.length > 0 || drinkChoice.enabled;
            const requestRemove = () => {
              if (!trimmedName && !hasPreviewData) {
                onRemove(index);
                return;
              }
              confirmAction(
                `Remove this ${noun}?`,
                `"${displayName(variant, index)}" will be removed${hasPreviewData ? ', along with its stock items and drink choice' : ''}.`,
                () => onRemove(index),
                { confirm: 'Remove' },
              );
            };
            const nameProblem = !trimmedName
              ? `Enter a ${noun} name.`
              : trimmedName.length > 60
                ? 'Use 60 characters or fewer.'
                : variants.some(
                      (other) => other.key !== variant.key && other.name.trim().toLowerCase() === trimmedName.toLowerCase(),
                    )
                  ? 'This name is already used.'
                  : undefined;
            const drinkMissing =
              drinkVisible && drinkChoice.enabled && drinkChoice.drinkIds.length === 0;
            // Inline checks appear once the user has tried to continue (a step error is showing) or tried to
            // finish this card.
            const showErrors = Boolean(error) || Boolean(attempted[variant.key]);
            const nameError = showErrors ? nameProblem : undefined;
            // "Add variant": check this card first; if it's fine, collapse it. Otherwise it stays open.
            const finishVariant = () => {
              if (nameProblem || drinkMissing) {
                setAttempted((current) => ({ ...current, [variant.key]: true }));
                return;
              }
              setAttempted((current) => ({ ...current, [variant.key]: false }));
              setExpanded((current) => ({ ...current, [variant.key]: false }));
            };

            return (
              <View key={variant.key} style={styles.card}>
                <View style={styles.cardHeader}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ expanded: isOpen }}
                    accessibilityLabel={`${displayName(variant, index)}, ${isOpen ? 'collapse' : 'expand'}`}
                    onPress={() => setExpanded((current) => ({ ...current, [variant.key]: !isOpen }))}
                    style={({ pressed }) => [styles.headerMain, pressed && styles.pressed]}
                  >
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>{index + 1}</Text>
                    </View>
                    <View style={styles.headerCopy}>
                      <View style={styles.titleLine}>
                        <Text style={styles.cardTitle} numberOfLines={1}>
                          {displayName(variant, index)}
                        </Text>
                        {status ? (
                          <View style={[styles.statusPill, status.style]}>
                            <Text style={[styles.statusText, status.textStyle]}>{status.label}</Text>
                          </View>
                        ) : null}
                      </View>
                      {!isOpen && collapsedLine ? (
                        <Text style={styles.cardSummary} numberOfLines={2}>
                          {collapsedLine}
                        </Text>
                      ) : null}
                    </View>
                    <Ionicons
                      name={isOpen ? 'chevron-up' : 'chevron-down'}
                      size={18}
                      color={managerColors.subtext}
                    />
                  </Pressable>
                </View>

                {isOpen ? (
                  <>
                    <FormField
                      label={config.nameLabel}
                      value={variant.name}
                      onChangeText={(text) => onChangeName(index, text)}
                      error={nameError}
                      placeholder={config.namePlaceholder}
                      labelStyle={styles.fieldLabel}
                      errorStyle={styles.fieldError}
                      accentColor={managerColors.royalBlue}
                      style={styles.fieldInput}
                    />
                    {config.showIngredients ? (
                      <>
                        <View style={styles.sectionDivider} />
                        <VariantRecipePreview
                          label={config.ingredientsLabel}
                          lockMainProduct={config.id === 'meals'}
                          mainOnly={!config.allowOtherStock}
                          lines={lines}
                          productName={productName}
                          ingredients={ingredients}
                          suggestedIds={suggestedIds}
                          onChange={(next) => onChangeRecipe(variant.key, next)}
                        />
                      </>
                    ) : null}
                    {drinkVisible ? (
                      <>
                        <View style={styles.sectionDivider} />
                        <VariantDrinkChoicePreview
                          choice={drinkChoice}
                          productName={productName}
                          drinks={drinkOptions ?? ingredients}
                          showValidation={showErrors}
                          onChange={(next) => onChangeDrinks(variant.key, next)}
                        />
                      </>
                    ) : null}
                    {hasHiddenData ? (
                      <Text style={styles.hiddenNote}>
                        {[
                          hiddenStock
                            ? `Stock items are hidden for ${config.label}, but they stay on this ${noun} and are still saved.`
                            : null,
                          hiddenDrink
                            ? `Drink choice is hidden for ${config.label}, but it stays on this ${noun} and is still saved.`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(' ')}
                      </Text>
                    ) : null}
                    <View style={styles.footer}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${noun} ${index + 1}`}
                        onPress={requestRemove}
                        style={({ pressed }) => [styles.removeIconButton, pressed && styles.removeIconButtonPressed]}
                      >
                        {({ pressed }) => (
                          <Ionicons name="trash-outline" size={20} color={pressed ? DANGER : managerColors.subtext} />
                        )}
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Done with this ${noun}`}
                        onPress={finishVariant}
                        style={({ pressed }) => [styles.doneButton, pressed && styles.pressed]}
                      >
                        <Ionicons name="checkmark" size={18} color="#FFFFFF" />
                        <Text style={styles.doneButtonText}>Done</Text>
                      </Pressable>
                    </View>
                  </>
                ) : null}
              </View>
            );
          })}
        </View>
      )}

      {showProductStock ? (
        <View style={styles.productStock}>
          <VariantRecipePreview
            label={config.ingredientsLabel}
            lockMainProduct={config.id === 'meals'}
                          mainOnly={!config.allowOtherStock}
            lines={recipes[PRODUCT_STOCK_KEY] ?? []}
            productName={productName}
            ingredients={ingredients}
            suggestedIds={suggestedIds}
            onChange={(next) => onChangeRecipe(PRODUCT_STOCK_KEY, next)}
          />
        </View>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {(variants.length === 0 && config.simpleEmpty) ||
      anyOpen ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Add ${noun}`}
          onPress={onAdd}
          style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}
        >
          <Ionicons name="add" size={18} color={managerColors.royalBlue} />
          <Text style={styles.addButtonText}>
            {variants.length === 0 ? `Add ${noun}` : `Add another ${noun}`}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 14 },
  intro: { gap: 8 },
  title: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 16 },
  sectionDivider: { height: StyleSheet.hairlineWidth, backgroundColor: BORDER },
  list: { gap: 10 },
  productStock: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    padding: 14,
  },
  card: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    padding: 14,
    gap: 14,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  headerMain: { flex: 1, minWidth: 0, minHeight: MIN_TOUCH_TARGET, flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerCopy: { flex: 1, minWidth: 0, gap: 2 },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  badge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: BLUE_TINT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: managerColors.royalBlue, fontFamily: 'Inter_700Bold', fontSize: 12 },
  cardTitle: { flexShrink: 1, color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  cardSummary: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 17 },
  statusPill: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  statusText: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },
  statusWarn: { backgroundColor: '#FEF3C7' },
  statusWarnText: { color: '#92400E' },
  statusMuted: { backgroundColor: '#EEF1F6' },
  statusMutedText: { color: managerColors.subtext },
  footer: { flexDirection: 'row', alignItems: 'stretch', gap: 10 },
  // Quiet, square, same height as Done; only turns red while pressed. Removing still asks for confirmation.
  removeIconButton: {
    width: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
  },
  removeIconButtonPressed: { borderColor: '#F2C9C5', backgroundColor: '#FDF0EF' },
  fieldLabel: { fontFamily: 'Inter_600SemiBold', color: managerColors.ink },
  fieldInput: { fontFamily: 'Inter_400Regular' },
  fieldError: { fontFamily: 'Inter_500Medium' },
  empty: {
    alignItems: 'center',
    gap: 4,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: BORDER,
    borderRadius: 14,
    backgroundColor: managerColors.cardSurface,
    paddingVertical: 22,
    paddingHorizontal: 16,
  },
  emptyIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: BLUE_TINT,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  emptyTitle: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  emptyBody: {
    color: managerColors.subtext,
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
  linkTouch: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' },
  emptyLink: { color: managerColors.royalBlue, fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  unsetHint: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18 },
  hiddenNote: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 17 },
  error: { color: DANGER, fontFamily: 'Inter_500Medium', fontSize: 14, lineHeight: 20 },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#B9C8EA',
    borderRadius: 12,
    backgroundColor: BLUE_TINT,
    paddingVertical: 13,
    minHeight: 48,
  },
  addButtonText: { color: managerColors.royalBlue, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  doneButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: managerColors.royalBlue,
    borderRadius: 12,
    paddingVertical: 12,
    minHeight: 48,
  },
  doneButtonText: { color: '#FFFFFF', fontFamily: 'Inter_700Bold', fontSize: 14 },
  pressed: { opacity: 0.7 },
});
