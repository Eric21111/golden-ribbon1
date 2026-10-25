import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { FormField } from '@/components/FormField';
import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { managerColors } from '@/components/dashboard/theme';

import type { ClosingStockBehavior } from '@/types/models';

import { BranchPricingStep, type BranchPriceStatus } from './BranchPricingStep';
import { NonReturnableField } from './NonReturnableField';
import { PosAvailabilityField } from './PosAvailabilityField';
import { ProductStatusField } from './ProductStatusField';
import { ProductCategoryField } from './ProductCategoryField';
import { SectionHeader, SettingsCard } from './StepOneLayout';
import {
  activeUniformBase,
  activeUniformPrice,
  buildDraftSnapshot,
  buildPreviewNotice,
  getUnsavedPreviewItems,
  otherModeHasPrices,
  applySetupDefaults,
  defaultsForProductSetup,
  flowSteps,
  getWizardFlow,
  PRODUCT_STOCK_KEY,
  POS_AVAILABILITY_ENABLED,
  resolveSellable,
  shouldOfferFirstOption,
  withoutDefaultProductStock,
  type WizardFlow,
} from './wizardGuards';
import {
  DEFAULT_PRODUCT_CATEGORY,
  getCategoryConfig,
  type CategoryChoice,
  isDrinkChoiceVisible,
} from './productCategoryPreview';
import { generateSkuFromName } from './generateSku';
import { PRICE_PATTERN } from './productSchema';
import { VariantListEditor } from './VariantListEditor';
import {
  THIS_PRODUCT_ID,
  ingredientOptionsFromProducts,
  suggestedIngredientIds,
  summarizeExtras,
  type DrinkChoice,
  type IngredientProduct,
  type RecipeLine,
} from './recipePreviewData';
import { buildStockUsePayload, type StockUsePayload } from './stockUseMapping';
import { VariantRecipePreview } from './VariantRecipePreview';
import { buildDrinkChoicePayload, drinkChoicesForSave, canonicalDrinkChoices, savedDrinkChoicesToState, type DrinkChoicePayload, type SavedDrinkChoice } from './drinkChoiceMapping';

export type CreateProductVariantDraft = { id: string; name: string; default_price: string };

export type CreateProductValues = {
  name: string;
  sku: string;
  description: string;
  default_price: string;
  variants: CreateProductVariantDraft[];
  closingStockBehavior: ClosingStockBehavior;
  isNonReturnable: boolean;
  /** Stock Used Per Order, saved with the product (see stockUseMapping.ts). */
  stockUses: StockUsePayload[];
  /** Eligible drinks of each option that includes a drink, saved with the product (see drinkChoiceMapping.ts). */
  drinkChoices: DrinkChoicePayload[];
  /** False saves a stock-only product: no selling price and hidden from POS. */
  sellInPos: boolean;
  /** Product Status. Independent of stock quantity. */
  isActive: boolean;
  /** Saved so the stock and drink pickers can tell supplies from drinks. */
  productCategory: CategoryChoice;
};

export type BranchPricingDraft =
  | { branchId: string; selling_price: string; variants?: undefined }
  | { branchId: string; selling_price?: undefined; variants: Array<{ name: string; selling_price: string }> };

interface CreateProductWizardProps {
  existingSkus?: string[];
  branchOptions: Array<{ id: string; name: string }>;
  /** Real products that can be used as stock items (Stock Used Per Order). */
  ingredientProducts?: IngredientProduct[];
  loading?: boolean;
  error?: string;
  onSubmit: (values: CreateProductValues, pricing: BranchPricingDraft[]) => void;
  /** Reports whether the form has unsaved edits, so the screen can confirm before discarding them. */
  onDirtyChange?: (dirty: boolean) => void;
}

function isValidPrice(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  return PRICE_PATTERN.test(trimmed);
}

type PricingMode = 'same' | 'different';
type PriceDraft = { base: string; variantPrices: Record<string, string> };

export function CreateProductWizard({
  existingSkus = [],
  branchOptions,
  ingredientProducts = [],
  loading = false,
  error,
  onSubmit,
  onDirtyChange,
}: CreateProductWizardProps) {
  const ingredients = useMemo(() => ingredientOptionsFromProducts(ingredientProducts), [ingredientProducts]);
  // POS-off products stay selectable as a meal's included drink. The cashier catalog hides them on their own.
  const drinkOptions = useMemo(() => ingredientOptionsFromProducts(ingredientProducts), [ingredientProducts]);
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Step 1 — product info
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [isNonReturnable, setIsNonReturnable] = useState(false);
  const [step1Errors, setStep1Errors] = useState<{ name?: string; sku?: string }>({});
  const skuEditedRef = useRef(false);

  useEffect(() => {
    if (skuEditedRef.current) return;
    setSku(name.trim() ? generateSkuFromName(name, existingSkus) : '');
  }, [name, existingSkus]);

  // Step 2 — variant names only
  const idRef = useRef(0);
  const [variants, setVariants] = useState<{ id: string; name: string }[]>([]);
  // Stock Used Per Order per variant (PRODUCT_STOCK_KEY = product-level list). Saved with the product.
  const [recipePreview, setRecipePreview] = useState<Record<string, RecipeLine[]>>({});
  // Drink Choice per variant: does it include a drink, and which drinks may the cashier pick from. Saved with the product.
  const [drinkChoices, setDrinkChoices] = useState<Record<string, DrinkChoice>>({});
  // Saved as product_category. Also the setup type that fills Product Status and Sell Separately until the user moves them.
  const [category, setCategory] = useState<CategoryChoice>(DEFAULT_PRODUCT_CATEGORY);
  const [step2Error, setStep2Error] = useState<string | undefined>();
  const [step3Error, setStep3Error] = useState<string | undefined>();
  const initialSetup = defaultsForProductSetup(DEFAULT_PRODUCT_CATEGORY);
  // Saved as sell_in_pos. Starts from the setup type. A manual change is kept when the setup type changes again.
  const [sellableChoice, setSellable] = useState(initialSetup.sellSeparately);
  const sellOverridden = useRef(false);
  const [enabledChoice, setEnabled] = useState(initialSetup.enabled);
  const statusOverridden = useRef(false);
  const sellable = resolveSellable(POS_AVAILABILITY_ENABLED, sellableChoice);

  // Step 3 — branch pricing
  const [pricingMode, setPricingMode] = useState<PricingMode>('same');

  // "Same for All" mode — applies to every selling branch automatically
  const [uniformBase, setUniformBase] = useState('');
  const [uniformVariantPrices, setUniformVariantPrices] = useState<Record<string, string>>({});

  // "Different per Branch" mode
  const [branchId, setBranchId] = useState(branchOptions[0]?.id ?? '');
  const [priceDrafts, setPriceDrafts] = useState<Record<string, PriceDraft>>({});

  useEffect(() => {
    if (!branchId && branchOptions[0]) setBranchId(branchOptions[0].id);
  }, [branchId, branchOptions]);

  useEffect(() => {
    if (!branchId) return;
    setPriceDrafts((current) => {
      if (current[branchId]) return current;
      return { ...current, [branchId]: { base: '', variantPrices: {} } };
    });
  }, [branchId]);

  const currentDraft = priceDrafts[branchId] ?? { base: '', variantPrices: {} };

  // Only one mode's pricing can exist at a time — switching clears the other so there's
  // never ambiguity about which prices apply.
  function switchPricingMode(mode: PricingMode) {
    if (mode === pricingMode) return;
    // Both modes' entered prices are kept so switching back restores them. Only the selected mode is ever
    // submitted (see activeUniformBase / activeUniformPrice below and the mode checks in submit).
    setStep3Error(undefined);
    setPricingMode(mode);
  }

  const pricedBranchIds = useMemo(() => {
    const ids = new Set<string>();
    for (const branch of branchOptions) {
      const draft = priceDrafts[branch.id];
      if (!draft) continue;
      const filled =
        variants.length === 0
          ? draft.base.trim() !== ''
          : variants.some((variant) => (draft.variantPrices[variant.id] ?? '').trim() !== '');
      if (filled) ids.add(branch.id);
    }
    return ids;
  }, [branchOptions, priceDrafts, variants]);

  function setBase(value: string) {
    if (!branchId) return;
    setPriceDrafts((current) => ({
      ...current,
      [branchId]: { ...(current[branchId] ?? { base: '', variantPrices: {} }), base: value },
    }));
  }

  function setVariantPrice(variantId: string, value: string) {
    if (!branchId) return;
    setPriceDrafts((current) => {
      const draft = current[branchId] ?? { base: '', variantPrices: {} };
      return {
        ...current,
        [branchId]: { ...draft, variantPrices: { ...draft.variantPrices, [variantId]: value } },
      };
    });
  }

  function validateStep1(): boolean {
    const nameValue = name.trim();
    const errors: { name?: string; sku?: string } = {};
    if (nameValue.length < 2) errors.name = 'Product name must be at least 2 characters.';
    else if (nameValue.length > 120) errors.name = 'Product name must be 120 characters or fewer.';
    if (sku.trim().length < 2) errors.sku = 'SKU must be at least 2 characters.';
    else if (sku.trim().length > 40) errors.sku = 'SKU must be 40 characters or fewer.';
    else if (!/^[A-Za-z0-9-]+$/.test(sku.trim())) errors.sku = 'Use only letters, numbers, and hyphens.';
    setStep1Errors(errors);
    return Object.keys(errors).length === 0;
  }

  // Meals and Snacks open Step 2 with one blank option card ready (This Product ×1 already in it), once. A product
  // sold at one price removes the card; it is never added back. Only Create does this: Edit never adds variants.
  const firstOptionOfferedRef = useRef(false);
  function offerFirstOption() {
    if (
      !shouldOfferFirstOption({
        startsWithOption: getCategoryConfig(category).startsWithOption,
        variantCount: variants.length,
        alreadyOffered: firstOptionOfferedRef.current,
      })
    ) {
      return;
    }
    firstOptionOfferedRef.current = true;
    idRef.current += 1;
    const id = `v${idRef.current}`;
    setVariants([{ id, name: '' }]);
    setRecipePreview((current) => ({ ...current, [id]: [{ itemId: THIS_PRODUCT_ID, quantity: 1 }] }));
  }

  function goToStep2() {
    if (!validateStep1()) return;
    if (!simpleFlow) offerFirstOption();
    setStep(simpleFlow ? 3 : 2);
  }

  /** Variant name rules, checked when leaving Step 2. */
  function getVariantNameError(): string | undefined {
    if (variants.length > 50) return 'A product can have at most 50 variants.';
    if (variants.some((variant) => !variant.name.trim())) return 'Enter a name for each variant, or remove it.';
    const names = variants.map((variant) => variant.name.trim().toLowerCase());
    if (new Set(names).size !== names.length) return 'Variant names must be unique.';
    if (variants.some((variant) => variant.name.trim().length > 60)) return 'Variant names must be 60 characters or fewer.';
    return undefined;
  }

  function goToStep3() {
    const variantError = getVariantNameError();
    if (variantError) {
      setStep2Error(variantError);
      return;
    }
    // Drink choice: "Includes a drink" needs at least one eligible drink. Only applies where the drink choice is
    // shown; a hidden selection never blocks Next.
    const missingDrink = variants.find((variant) => {
      const choice = drinkChoices[variant.id];
      return Boolean(choice?.enabled) && isDrinkChoiceVisible(category, true) && choice!.drinkIds.length === 0;
    });
    if (missingDrink) {
      setStep2Error(`Select at least one drink for "${missingDrink.name.trim()}", or untick "Includes a drink".`);
      return;
    }
    setStep2Error(undefined);
    setStep(3);
  }

  // Only flips the flag. Variants, prices and every other entry stay in state untouched, so turning it back on
  // restores everything exactly as it was. Nothing is deleted or overwritten.
  function changeSellable(next: boolean) {
    sellOverridden.current = true;
    setSellable(next);
    setStep3Error(undefined);
  }

  function changeEnabled(next: boolean) {
    statusOverridden.current = true;
    setEnabled(next);
  }

  function changeCategory(next: CategoryChoice) {
    setCategory(next);
    const nextSetup = applySetupDefaults({
      category: next,
      enabled: enabledChoice,
      sellSeparately: sellableChoice,
      enabledOverridden: statusOverridden.current,
      sellOverridden: sellOverridden.current,
    });
    setEnabled(nextSetup.enabled);
    setSellable(nextSetup.sellSeparately);
  }

  function submit() {
    if (!sellable) {
      if (!validateStep1()) return;
      onSubmit(
        {
          name: name.trim(),
          sku: sku.trim(),
          description: '',
          default_price: '',
          variants: [],
          closingStockBehavior: isNonReturnable ? 'keep_at_branch' : 'record_as_unsold',
          isNonReturnable,
          stockUses: [],
          drinkChoices: [],
          sellInPos: false,
          productCategory: category,
          isActive: enabledChoice,
        },
        [],
      );
      return;
    }
    let pricing: BranchPricingDraft[] = [];

    if (pricingMode === 'same') {
      const branchIds = branchOptions.map((branch) => branch.id);
      if (variants.length === 0) {
        const hasPrice = uniformBase.trim() !== '';
        if (hasPrice && !isValidPrice(uniformBase)) {
          setStep3Error('Enter a valid selling price.');
          return;
        }
        pricing = hasPrice ? branchIds.map((id) => ({ branchId: id, selling_price: uniformBase.trim() })) : [];
      } else {
        const anyFilled = variants.some((variant) => (uniformVariantPrices[variant.id] ?? '').trim() !== '');
        const missingPrice = variants.some((variant) => !isValidPrice(uniformVariantPrices[variant.id] ?? ''));
        if (anyFilled && missingPrice) {
          setStep3Error('Enter a price for every variant.');
          return;
        }
        pricing = anyFilled
          ? branchIds.map((id) => ({
              branchId: id,
              variants: variants.map((variant) => ({
                name: variant.name.trim(),
                selling_price: uniformVariantPrices[variant.id]!.trim(),
              })),
            }))
          : [];
      }
    } else {
      const selectedIds = [...pricedBranchIds];
      for (const id of selectedIds) {
        const draft = priceDrafts[id];
        if (variants.length === 0) {
          if (!draft || !isValidPrice(draft.base)) {
            setStep3Error('Complete the pricing for all selected branches.');
            return;
          }
        } else if (!draft || variants.some((variant) => !isValidPrice(draft.variantPrices[variant.id] ?? ''))) {
          setStep3Error('Enter a price for every variant on each selected branch.');
          return;
        }
      }
      pricing = selectedIds.map((id) => {
        const draft = priceDrafts[id]!;
        if (variants.length === 0) return { branchId: id, selling_price: draft.base.trim() };
        return {
          branchId: id,
          variants: variants.map((variant) => ({
            name: variant.name.trim(),
            selling_price: draft.variantPrices[variant.id]!.trim(),
          })),
        };
      });
    }

    setStep3Error(undefined);

    const firstBasePrice = pricing.find((draft): draft is Extract<BranchPricingDraft, { selling_price: string }> =>
      draft.selling_price != null,
    )?.selling_price;
    const topLevelPrice = variants.length === 0 ? (firstBasePrice || activeUniformBase(pricingMode, uniformBase).trim()) : '';
    if (variants.length === 0 && !isValidPrice(topLevelPrice)) {
      setStep3Error('Enter a valid selling price.');
      return;
    }

    const variantValues: CreateProductVariantDraft[] = variants.map((variant) => {
      const fromPricing = pricing
        .flatMap((draft) => draft.variants ?? [])
        .find((entry) => entry.name === variant.name.trim());
      const price = fromPricing?.selling_price || activeUniformPrice(pricingMode, uniformVariantPrices, variant.id) || '';
      return { id: variant.id, name: variant.name.trim(), default_price: price };
    });
    if (variantValues.some((variant) => !isValidPrice(variant.default_price))) {
      setStep3Error('Enter a price for every variant.');
      return;
    }

    onSubmit(
      {
        name: name.trim(),
        sku: sku.trim(),
        description: '',
        default_price: topLevelPrice,
        variants: variantValues,
        closingStockBehavior: isNonReturnable ? 'keep_at_branch' : 'record_as_unsold',
        isNonReturnable,
        stockUses: buildStockUsePayload(
          recipePreview,
          variantValues.map((variant) => ({ key: variant.id, id: null, name: variant.name })),
        ),
        drinkChoices: buildDrinkChoicePayload(
          drinkChoices,
          variantValues.map((variant) => ({ key: variant.id, id: null, name: variant.name })),
        ),
        sellInPos: true,
        productCategory: category,
        isActive: enabledChoice,
      },
      pricing,
    );
  }

  const hasVariants = variants.length > 0;

  // Individually stocked drinks are separate products, so a drink without variants goes straight from Product
  // Info to Branch Pricing (a 2-step flow). A drink that already has variants keeps Step 2 so they stay visible
  // and editable. Variants are optional in the backend: no variants simply means one selling price in Step 3.
  const flow: WizardFlow = getWizardFlow({ sellable, category, variantCount: variants.length });
  const simpleFlow = flow === 'simple';
  const inventoryOnly = flow === 'inventory';

  // Unsaved-changes tracking. The snapshot covers what the user can edit (saved fields and preview-only
  // settings); empty values are ignored, so undoing an edit counts as no change. Step position is not an edit.
  const draftSnapshot = buildDraftSnapshot({
    name,
    sku: skuEditedRef.current ? sku : '',
    isNonReturnable,
    variants: variants.map((variant) => variant.name),
    uniformBase,
    uniformVariantPrices,
    priceDrafts,
    recipePreview: withoutDefaultProductStock(recipePreview),
    drinkPreview: drinkChoices, // (key name kept: it is the unsaved-changes snapshot of the drink choices)
    category,
    sellable,
    enabled: enabledChoice,
  });
  const initialSnapshotRef = useRef<string | null>(null);
  if (initialSnapshotRef.current === null) initialSnapshotRef.current = draftSnapshot;
  const isDirty = draftSnapshot !== initialSnapshotRef.current;
  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty]);

  // Final-step reminder: which preview-only settings have been used and are NOT saved.
  const previewNotice = buildPreviewNotice(
    getUnsavedPreviewItems({
      category,
      defaultCategory: DEFAULT_PRODUCT_CATEGORY,
      sellable,
    }),
  );
  const otherModePricesKept = otherModeHasPrices(pricingMode, {
    uniformBase,
    uniformPrices: uniformVariantPrices,
    branchDrafts: priceDrafts,
  });

  // One-line "what it uses" under each variant name in Step 3.
  const stockSummaries: Record<string, string> = {};
  if (getCategoryConfig(category).showIngredients) {
    for (const variant of variants) {
      const summary = summarizeExtras(recipePreview[variant.id] ?? [], name, ingredients);
      if (summary) stockSummaries[variant.id] = summary;
    }
  }

  // How complete each branch's prices are, for the branch overview chips (display only).
  const branchStatus: Record<string, BranchPriceStatus> = {};
  for (const branch of branchOptions) {
    const draft = priceDrafts[branch.id];
    if (!draft) {
      branchStatus[branch.id] = 'none';
    } else if (variants.length === 0) {
      branchStatus[branch.id] = draft.base.trim() === '' ? 'none' : isValidPrice(draft.base) ? 'full' : 'partial';
    } else {
      const filled = variants.filter((variant) => (draft.variantPrices[variant.id] ?? '').trim() !== '').length;
      const allValid = variants.every((variant) => isValidPrice(draft.variantPrices[variant.id] ?? ''));
      branchStatus[branch.id] = filled === 0 ? 'none' : allValid ? 'full' : 'partial';
    }
  }

  return (
    <View style={styles.wrap}>
      <StepIndicator step={step} flow={flow} middleLabel={getCategoryConfig(category).stepLabel} />

      {step === 1 ? (
        <View style={styles.stepBody}>
          <FormField
            label="Product name"
            value={name}
            onChangeText={setName}
            error={step1Errors.name}
            autoCapitalize="words"
            labelStyle={styles.fieldLabel}
            errorStyle={styles.fieldError}
            accentColor={managerColors.royalBlue}
            style={styles.fieldInput}
          />
          {category === 'drinks' ? (
            <Text style={styles.hint}>Each drink is its own product, like Coke Mismo.</Text>
          ) : null}
          <FormField
            label="SKU"
            value={sku}
            onChangeText={(text) => {
              skuEditedRef.current = true;
              setSku(text);
            }}
            error={step1Errors.sku}
            autoCapitalize="characters"
            placeholder="Auto from name"
            labelStyle={styles.fieldLabel}
            errorStyle={styles.fieldError}
            accentColor={managerColors.royalBlue}
            style={styles.fieldInput}
          />
          <View style={styles.group}>
            <SectionHeader title="How it's sold" preview />
            <ProductCategoryField value={category} onChange={changeCategory} />
            {POS_AVAILABILITY_ENABLED ? <PosAvailabilityField value={sellable} onChange={changeSellable} /> : null}
          </View>
          {simpleFlow && getCategoryConfig(category).productLevelStock ? (
            <View style={styles.group}>
              <VariantRecipePreview
                label={getCategoryConfig(category).ingredientsLabel}
                lines={recipePreview[PRODUCT_STOCK_KEY] ?? []}
                productName={name}
                ingredients={ingredients}
                suggestedIds={suggestedIngredientIds(recipePreview)}
                onChange={(next) => setRecipePreview((current) => ({ ...current, [PRODUCT_STOCK_KEY]: next }))}
              />
            </View>
          ) : null}
          <View style={styles.group}>
            <SectionHeader title="Other settings" />
            <SettingsCard>
              <NonReturnableField value={isNonReturnable} onChange={setIsNonReturnable} />
              <ProductStatusField value={enabledChoice} onChange={changeEnabled} />
            </SettingsCard>
          </View>
        </View>
      ) : null}

      {step === 2 ? (
        <View style={styles.stepBody}>
          <VariantListEditor
            variants={variants.map((variant) => ({ key: variant.id, name: variant.name }))}
            recipes={recipePreview}
            drinks={drinkChoices}
            category={category}
            productName={name}
            ingredients={ingredients}
            drinkOptions={drinkOptions}
            onChangeRecipe={(variantKey, lines) =>
              setRecipePreview((current) => ({ ...current, [variantKey]: lines }))
            }
            onChangeDrinks={(variantKey, choice) =>
              setDrinkChoices((current) => ({ ...current, [variantKey]: choice }))
            }
            error={step2Error}
            onChangeName={(index, text) =>
              setVariants((current) => current.map((entry, i) => (i === index ? { ...entry, name: text } : entry)))
            }
            onRemove={(index) => {
              const removed = variants[index];
              if (removed) {
                setRecipePreview((current) => {
                  const { [removed.id]: _discarded, ...rest } = current;
                  return rest;
                });
                setDrinkChoices((current) => {
                  const { [removed.id]: _discarded, ...rest } = current;
                  return rest;
                });
              }
              setVariants((current) => current.filter((_, i) => i !== index));
            }}
            onAdd={() => {
              idRef.current += 1;
              setVariants((current) => [...current, { id: `v${idRef.current}`, name: '' }]);
            }}
          />
        </View>
      ) : null}

      {step === 3 ? (
        <View style={styles.stepBody}>
          <BranchPricingStep
            mode={pricingMode}
            onModeChange={switchPricingMode}
            variants={variants.map((variant) => ({ key: variant.id, name: variant.name }))}
            stockSummaries={stockSummaries}
            previewNotice={previewNotice}
            otherModePricesKept={otherModePricesKept}
            branches={branchOptions}
            uniformBase={uniformBase}
            onUniformBaseChange={setUniformBase}
            uniformPrices={uniformVariantPrices}
            onUniformPriceChange={(key, text) =>
              setUniformVariantPrices((current) => ({ ...current, [key]: text }))
            }
            selectedBranchId={branchId}
            onSelectBranch={setBranchId}
            branchStatus={branchStatus}
            draft={currentDraft}
            onDraftBaseChange={setBase}
            onDraftVariantPriceChange={setVariantPrice}
            error={step3Error}
          />
        </View>
      ) : null}

      {(step === 3 || inventoryOnly) && error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.buttonRow}>
        {step > 1 ? (
          <View style={styles.buttonCol}>
            <ManagerActionButton
              label="Back"
              variant="secondary"
              disabled={loading}
              onPress={() => setStep((current) => (current === 3 ? (simpleFlow ? 1 : 2) : 1))}
            />
          </View>
        ) : null}
        <View style={styles.buttonCol}>
          {step === 1 ? (
            inventoryOnly ? (
              <ManagerActionButton label="Create product" loading={loading} onPress={submit} />
            ) : (
              <ManagerActionButton label="Next" onPress={goToStep2} />
            )
          ) : step === 2 ? (
            <ManagerActionButton label="Next" onPress={goToStep3} />
          ) : (
            <ManagerActionButton label="Create product" loading={loading} onPress={submit} />
          )}
        </View>
      </View>
    </View>
  );
}

function StepIndicator({
  step,
  flow,
  middleLabel,
}: {
  step: 1 | 2 | 3;
  flow: WizardFlow;
  /** Name of Step 2, which follows the selected category (e.g. "Meal Options", "Sizes & Packaging"). */
  middleLabel: string;
}) {
  const labels = { 1: 'Product Info', 2: middleLabel, 3: 'Branch Pricing' } as const;
  // Skipped steps are not shown: Drinks without variants skip Step 2; inventory-only products have only Step 1.
  const steps = flowSteps(flow);
  return (
    <View style={styles.indicatorWrap}>
      <View style={styles.indicatorRow}>
        {steps.map((id, index) => (
          <View key={id} style={styles.indicatorSegment}>
            <View style={[styles.indicatorDot, id <= step && styles.indicatorDotActive]}>
              <Text style={[styles.indicatorDotLabel, id <= step && styles.indicatorDotLabelActive]}>{index + 1}</Text>
            </View>
            {index < steps.length - 1 ? (
              <View style={[styles.indicatorLine, id < step && styles.indicatorLineActive]} />
            ) : null}
          </View>
        ))}
      </View>
      <Text style={styles.indicatorLabel}>{labels[step]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 16 },
  stepBody: { gap: 16 },
  group: { gap: 10 },
  hint: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 18 },
  error: { color: '#B91C1C', fontFamily: 'Inter_500Medium', fontSize: 14, lineHeight: 20 },
  fieldLabel: { fontFamily: 'Inter_600SemiBold', color: managerColors.ink },
  fieldInput: { fontFamily: 'Inter_400Regular' },
  fieldError: { fontFamily: 'Inter_500Medium' },
  pressed: { opacity: 0.7 },
  buttonRow: { flexDirection: 'row', gap: 10 },
  buttonCol: { flex: 1 },
  indicatorWrap: { gap: 8, alignItems: 'center' },
  indicatorRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  indicatorSegment: { flexDirection: 'row', alignItems: 'center' },
  indicatorDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: managerColors.cardSurface,
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
  },
  indicatorDotActive: { backgroundColor: managerColors.royalBlue, borderColor: managerColors.royalBlue },
  indicatorDotLabel: { color: managerColors.subtext, fontFamily: 'Inter_700Bold', fontSize: 12 },
  indicatorDotLabelActive: { color: '#FFFFFF' },
  indicatorLine: { width: 48, height: 2, backgroundColor: managerColors.cardBorder, marginHorizontal: 4 },
  indicatorLineActive: { backgroundColor: managerColors.royalBlue },
  indicatorLabel: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 13 },
});
