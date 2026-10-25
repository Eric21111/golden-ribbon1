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
  seedVariantPrices,
  flowSteps,
  getWizardFlow,
  PRODUCT_STOCK_KEY,
  POS_AVAILABILITY_ENABLED,
  resolveSellable,
  withoutDefaultProductStock,
  type WizardFlow,
} from './wizardGuards';
import {
  getCategoryConfig,
  INITIAL_EDIT_CATEGORY,
  type CategoryChoice,
  isDrinkChoiceVisible,
} from './productCategoryPreview';
import { PRICE_PATTERN } from './productSchema';
import { VariantListEditor } from './VariantListEditor';
import {
  ingredientOptionsFromProducts,
  suggestedIngredientIds,
  summarizeExtras,
  type DrinkChoice,
  type IngredientProduct,
  type RecipeLine,
} from './recipePreviewData';
import {
  buildStockUsePayload,
  canonicalStockUses,
  savedStockUsesToRecipes,
  stockUsesForSave,
  type SavedStockUse,
  type StockUsePayload,
} from './stockUseMapping';
import { VariantRecipePreview } from './VariantRecipePreview';
import { buildDrinkChoicePayload, drinkChoicesForSave, canonicalDrinkChoices, savedDrinkChoicesToState, type DrinkChoicePayload, type SavedDrinkChoice } from './drinkChoiceMapping';

type PricingMode = 'same' | 'different';
type PriceDraft = { base: string; variantPrices: Record<string, string> };
type EditVariantDraft = { key: string; id: string | null; name: string };

export type EditProductVariantValue = { id: string | null; name: string; default_price: string };

export type EditProductValues = {
  name: string;
  sku: string;
  description: string;
  isActive: boolean;
  default_price: string;
  variants: EditProductVariantValue[];
  deletedVariantIds: string[];
  closingStockBehavior: ClosingStockBehavior;
  isNonReturnable: boolean;
  /**
   * undefined = the stock-used lists were not changed, so the saved ones are left exactly as they are. Otherwise the
   * COMPLETE new set, which replaces the saved one ([] removes them all).
   */
  stockUses?: StockUsePayload[];
  /** Same rule for the eligible drinks of each option (undefined = untouched, [] = remove them all). */
  drinkChoices?: DrinkChoicePayload[];
  /** False keeps or makes the product stock-only and does not rewrite its price or stock. */
  sellInPos: boolean;
  /** Saved so the stock and drink pickers can tell supplies from drinks. Unset leaves the saved category alone. */
  productCategory: CategoryChoice;
};

export type BranchPricingDraft =
  | { branchId: string; selling_price: string; variants?: undefined }
  | { branchId: string; selling_price?: undefined; variants: Array<{ name: string; selling_price: string }> };

export type EditProductSourceVariant = { id: string; name: string; default_price: number };
export type EditProductSourceBranchPrice = { branch_id: string; selling_price: number };
export type EditProductSourceBranchVariantPrice = { branch_id: string; name: string; selling_price: number };

interface EditProductWizardProps {
  product: {
    /** Needed to tell which saved stock line is "This Product" (the product's own id). */
    id: string;
    name: string;
    sku: string;
    description: string | null;
    is_active: boolean;
    sell_in_pos?: boolean;
    product_category?: CategoryChoice | null;
    closing_stock_behavior: ClosingStockBehavior;
    is_non_returnable?: boolean;
  };
  sourceVariants: EditProductSourceVariant[];
  sourceBranchPrices: EditProductSourceBranchPrice[];
  sourceBranchVariantPrices: EditProductSourceBranchVariantPrice[];
  /** The product's saved Stock Used Per Order lines. Must be loaded before the wizard opens (never a guess). */
  sourceStockUses: SavedStockUse[];
  /** The product's saved drink choices. Must be loaded before the wizard opens (never a guess). */
  sourceDrinkChoices: SavedDrinkChoice[];
  /** Real products that can be used as stock items (Stock Used Per Order). */
  ingredientProducts?: IngredientProduct[];
  branchOptions: Array<{ id: string; name: string }>;
  loading?: boolean;
  error?: string;
  onSubmit: (values: EditProductValues, pricing: BranchPricingDraft[]) => void;
  /** Reports whether the form has unsaved edits, so the screen can confirm before discarding them. */
  onDirtyChange?: (dirty: boolean) => void;
}

function isValidPrice(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  return PRICE_PATTERN.test(trimmed);
}

/** True when every branch id maps to the same fingerprint (e.g. same price for every variant). */
function allBranchesMatch(branchIds: string[], fingerprint: (id: string) => string): boolean {
  if (branchIds.length === 0) return false;
  const first = fingerprint(branchIds[0]!);
  return branchIds.every((id) => fingerprint(id) === first);
}

export function EditProductWizard({
  product,
  sourceVariants,
  sourceBranchPrices,
  sourceBranchVariantPrices,
  sourceStockUses,
  sourceDrinkChoices,
  ingredientProducts = [],
  branchOptions,
  loading = false,
  error,
  onSubmit,
  onDirtyChange,
}: EditProductWizardProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const idRef = useRef(0);
  const nextKey = () => {
    idRef.current += 1;
    return `k${idRef.current}`;
  };

  // Step 1 — product info
  const [name, setName] = useState(product.name);
  const [sku, setSku] = useState(product.sku);
  const [isActive, setIsActive] = useState(product.is_active);
  const [isNonReturnable, setIsNonReturnable] = useState(Boolean(product.is_non_returnable));
  const [step1Errors, setStep1Errors] = useState<{ name?: string; sku?: string }>({});

  // Step 2 — variants (pre-filled), with hard-delete tracking
  const [variants, setVariants] = useState<EditVariantDraft[]>(() =>
    sourceVariants.map((variant) => ({ key: nextKey(), id: variant.id, name: variant.name })),
  );
  const [deletedVariantIds, setDeletedVariantIds] = useState<string[]>([]);
  // Stock Used Per Order per variant (PRODUCT_STOCK_KEY = product-level list), starting from what is saved.
  const [recipePreview, setRecipePreview] = useState<Record<string, RecipeLine[]>>(() =>
    savedStockUsesToRecipes(sourceStockUses, product.id, variants, (id) => ingredientProducts.find((p) => p.id === id)?.name ?? id),
  );
  // What was saved when this edit opened. Recipes are only sent when they differ from it, so an unrelated edit can
  // never rewrite or lose them.
  const savedStockUsesRef = useRef<string | null>(null);
  if (savedStockUsesRef.current === null) {
    savedStockUsesRef.current = canonicalStockUses(buildStockUsePayload(recipePreview, variants));
  }
  const ingredients = useMemo(
    () => ingredientOptionsFromProducts(ingredientProducts, product.id),
    [ingredientProducts, product.id],
  );
  const drinkOptions = useMemo(
    () => ingredientOptionsFromProducts(ingredientProducts, product.id),
    [ingredientProducts, product.id],
  );
  // Drink Choice per variant, starting from what is saved. Like the stock lists it is only sent when it changes.
  const [drinkChoices, setDrinkChoices] = useState<Record<string, DrinkChoice>>(() =>
    savedDrinkChoicesToState(sourceDrinkChoices, variants, (id) => ingredientProducts.find((p) => p.id === id)?.name ?? id),
  );
  const savedDrinkChoicesRef = useRef<string | null>(null);
  if (savedDrinkChoicesRef.current === null) {
    savedDrinkChoicesRef.current = canonicalDrinkChoices(buildDrinkChoicePayload(drinkChoices, variants));
  }
  // PREVIEW ONLY: product category. Local state; never saved or submitted. It only changes the Step 2 layout.
  const [category, setCategory] = useState<CategoryChoice>(
    product.product_category && product.product_category !== 'unset' ? product.product_category : INITIAL_EDIT_CATEGORY,
  );
  const [step2Error, setStep2Error] = useState<string | undefined>();
  const [step3Error, setStep3Error] = useState<string | undefined>();
  // Saved as sell_in_pos. Existing products stay sellable unless that flag is off. The category never decides this.
  const [sellableChoice, setSellable] = useState(product.sell_in_pos !== false);
  // While POS availability is hidden this is always true, so it can never route to the inventory-only flow.
  const sellable = resolveSellable(POS_AVAILABILITY_ENABLED, sellableChoice);

  // Step 3 — branch pricing, pre-filled from existing catalog data
  const initialPricing = useMemo(() => {
    const hasVariants = sourceVariants.length > 0;
    const branchIds = branchOptions.map((branch) => branch.id);

    if (hasVariants) {
      const byBranch = new Map<string, Map<string, number>>();
      for (const row of sourceBranchVariantPrices) {
        if (!byBranch.has(row.branch_id)) byBranch.set(row.branch_id, new Map());
        byBranch.get(row.branch_id)!.set(row.name, row.selling_price);
      }
      const pricedBranchIds = branchIds.filter((id) => byBranch.has(id));
      const fingerprint = (id: string) =>
        sourceVariants.map((variant) => byBranch.get(id)?.get(variant.name) ?? '').join('|');
      const isUniform =
        pricedBranchIds.length > 0 &&
        pricedBranchIds.length === branchIds.length &&
        allBranchesMatch(branchIds, fingerprint);

      if (isUniform) {
        const first = byBranch.get(branchIds[0]!)!;
        return {
          mode: 'same' as PricingMode,
          uniformBase: '',
          uniformVariantPrices: seedVariantPrices(variants, first),
          priceDrafts: {} as Record<string, PriceDraft>,
        };
      }

      const priceDrafts: Record<string, PriceDraft> = {};
      for (const id of pricedBranchIds) {
        const prices = byBranch.get(id)!;
        priceDrafts[id] = {
          base: '',
          variantPrices: seedVariantPrices(variants, prices),
        };
      }
      return { mode: 'different' as PricingMode, uniformBase: '', uniformVariantPrices: {}, priceDrafts };
    }

    const byBranch = new Map(sourceBranchPrices.map((row) => [row.branch_id, row.selling_price]));
    const pricedBranchIds = branchIds.filter((id) => byBranch.has(id));
    const fingerprint = (id: string) => String(byBranch.get(id) ?? '');
    const isUniform =
      pricedBranchIds.length > 0 &&
      pricedBranchIds.length === branchIds.length &&
      allBranchesMatch(branchIds, fingerprint);

    if (isUniform) {
      return {
        mode: 'same' as PricingMode,
        uniformBase: String(byBranch.get(branchIds[0]!) ?? ''),
        uniformVariantPrices: {},
        priceDrafts: {} as Record<string, PriceDraft>,
      };
    }

    const priceDrafts: Record<string, PriceDraft> = {};
    for (const id of pricedBranchIds) {
      priceDrafts[id] = { base: String(byBranch.get(id) ?? ''), variantPrices: {} };
    }
    return { mode: 'same' as PricingMode, uniformBase: '', uniformVariantPrices: {}, priceDrafts };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [pricingMode, setPricingMode] = useState<PricingMode>(initialPricing.mode);
  const [uniformBase, setUniformBase] = useState(initialPricing.uniformBase);
  const [uniformVariantPrices, setUniformVariantPrices] = useState<Record<string, string>>(
    initialPricing.uniformVariantPrices,
  );
  const [branchId, setBranchId] = useState(
    Object.keys(initialPricing.priceDrafts)[0] ?? branchOptions[0]?.id ?? '',
  );
  const [priceDrafts, setPriceDrafts] = useState<Record<string, PriceDraft>>(initialPricing.priceDrafts);

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
          : variants.some((variant) => (draft.variantPrices[variant.key] ?? '').trim() !== '');
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

  function setVariantPrice(variantKey: string, value: string) {
    if (!branchId) return;
    setPriceDrafts((current) => {
      const draft = current[branchId] ?? { base: '', variantPrices: {} };
      return {
        ...current,
        [branchId]: { ...draft, variantPrices: { ...draft.variantPrices, [variantKey]: value } },
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

  function goToStep2() {
    if (!validateStep1()) return;
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
      const choice = drinkChoices[variant.key];
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
    setSellable(next);
    setStep3Error(undefined);
  }

  function submit() {
    if (!sellable) {
      if (!validateStep1()) return;
      onSubmit(
        {
          name: name.trim(),
          sku: sku.trim(),
          description: (product.description ?? '').trim(),
          isActive,
          default_price: '',
          variants: [],
          deletedVariantIds: [],
          closingStockBehavior: isNonReturnable
            ? 'keep_at_branch'
            : product.is_non_returnable
              ? 'record_as_unsold'
              : product.closing_stock_behavior,
          isNonReturnable,
          sellInPos: false,
          productCategory: category,
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
        const anyFilled = variants.some((variant) => (uniformVariantPrices[variant.key] ?? '').trim() !== '');
        const missingPrice = variants.some((variant) => !isValidPrice(uniformVariantPrices[variant.key] ?? ''));
        if (anyFilled && missingPrice) {
          setStep3Error('Enter a price for every variant.');
          return;
        }
        pricing = anyFilled
          ? branchIds.map((id) => ({
              branchId: id,
              variants: variants.map((variant) => ({
                name: variant.name.trim(),
                selling_price: uniformVariantPrices[variant.key]!.trim(),
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
        } else if (!draft || variants.some((variant) => !isValidPrice(draft.variantPrices[variant.key] ?? ''))) {
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
            selling_price: draft.variantPrices[variant.key]!.trim(),
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

    const variantValues: EditProductVariantValue[] = variants.map((variant) => {
      const fromPricing = pricing
        .flatMap((draft) => draft.variants ?? [])
        .find((entry) => entry.name === variant.name.trim());
      const price = fromPricing?.selling_price || activeUniformPrice(pricingMode, uniformVariantPrices, variant.key) || '';
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
        // The field was removed from the form; keep whatever description the product already has.
        description: (product.description ?? '').trim(),
        isActive,
        default_price: topLevelPrice,
        variants: variantValues,
        deletedVariantIds,
        closingStockBehavior: isNonReturnable
          ? 'keep_at_branch'
          : product.is_non_returnable
            ? 'record_as_unsold'
            : product.closing_stock_behavior,
        isNonReturnable,
        stockUses: stockUsesForSave(savedStockUsesRef.current ?? '', buildStockUsePayload(recipePreview, variants)),
        drinkChoices: drinkChoicesForSave(savedDrinkChoicesRef.current ?? '', buildDrinkChoicePayload(drinkChoices, variants)),
        sellInPos: true,
        productCategory: category,
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
    sku,
    isActive,
    isNonReturnable,
    variants: variants.map((variant) => [variant.id, variant.name]),
    deletedVariantIds,
    uniformBase,
    uniformVariantPrices,
    priceDrafts,
    recipePreview: withoutDefaultProductStock(recipePreview),
    drinkPreview: drinkChoices, // (key name kept: it is the unsaved-changes snapshot of the drink choices)
    category,
    sellable,
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
      defaultCategory: product.product_category && product.product_category !== 'unset'
        ? product.product_category
        : INITIAL_EDIT_CATEGORY,
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
      const summary = summarizeExtras(recipePreview[variant.key] ?? [], name, ingredients);
      if (summary) stockSummaries[variant.key] = summary;
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
      const filled = variants.filter((variant) => (draft.variantPrices[variant.key] ?? '').trim() !== '').length;
      const allValid = variants.every((variant) => isValidPrice(draft.variantPrices[variant.key] ?? ''));
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
            onChangeText={setSku}
            error={step1Errors.sku}
            autoCapitalize="characters"
            labelStyle={styles.fieldLabel}
            errorStyle={styles.fieldError}
            accentColor={managerColors.royalBlue}
            style={styles.fieldInput}
          />
          <View style={styles.group}>
            <SectionHeader title="How it's sold" preview />
            <ProductCategoryField value={category} onChange={setCategory} allowUnset />
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
              <ProductStatusField value={isActive} onChange={setIsActive} />
            </SettingsCard>
          </View>
        </View>
      ) : null}

      {step === 2 ? (
        <View style={styles.stepBody}>
          <VariantListEditor
            variants={variants.map((variant) => ({ key: variant.key, name: variant.name }))}
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
              if (removed?.id) setDeletedVariantIds((current) => [...current, removed.id!]);
              if (removed) {
                setRecipePreview((current) => {
                  const { [removed.key]: _discarded, ...rest } = current;
                  return rest;
                });
                setDrinkChoices((current) => {
                  const { [removed.key]: _discarded, ...rest } = current;
                  return rest;
                });
              }
              setVariants((current) => current.filter((_, i) => i !== index));
            }}
            onAdd={() => setVariants((current) => [...current, { key: nextKey(), id: null, name: '' }])}
          />
        </View>
      ) : null}

      {step === 3 ? (
        <View style={styles.stepBody}>
          <BranchPricingStep
            mode={pricingMode}
            onModeChange={switchPricingMode}
            variants={variants.map((variant) => ({ key: variant.key, name: variant.name }))}
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
              <ManagerActionButton label="Save changes" loading={loading} onPress={submit} />
            ) : (
              <ManagerActionButton label="Next" onPress={goToStep2} />
            )
          ) : step === 2 ? (
            <ManagerActionButton label="Next" onPress={goToStep3} />
          ) : (
            <ManagerActionButton label="Save changes" loading={loading} onPress={submit} />
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
