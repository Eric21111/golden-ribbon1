import Ionicons from '@react-native-vector-icons/ionicons';
import { useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { FormField } from '@/components/FormField';
import { SwitchField } from '@/components/SwitchField';
import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { FilterChipRow } from '@/components/dashboard/FilterChipRow';
import { managerColors } from '@/components/dashboard/theme';

import { PRICE_PATTERN } from './productSchema';

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
};

export type BranchPricingDraft =
  | { branchId: string; selling_price: string; variants?: undefined }
  | { branchId: string; selling_price?: undefined; variants: Array<{ name: string; selling_price: string }> };

export type EditProductSourceVariant = { id: string; name: string; default_price: number };
export type EditProductSourceBranchPrice = { branch_id: string; selling_price: number };
export type EditProductSourceBranchVariantPrice = { branch_id: string; name: string; selling_price: number };

interface EditProductWizardProps {
  product: { name: string; sku: string; description: string | null; is_active: boolean };
  sourceVariants: EditProductSourceVariant[];
  sourceBranchPrices: EditProductSourceBranchPrice[];
  sourceBranchVariantPrices: EditProductSourceBranchVariantPrice[];
  branchOptions: Array<{ id: string; name: string }>;
  canActivate: boolean;
  loading?: boolean;
  error?: string;
  onSubmit: (values: EditProductValues, pricing: BranchPricingDraft[]) => void;
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
  branchOptions,
  canActivate,
  loading = false,
  error,
  onSubmit,
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
  const [description, setDescription] = useState(product.description ?? '');
  const [isActive, setIsActive] = useState(product.is_active);
  const [step1Errors, setStep1Errors] = useState<{ name?: string; sku?: string; description?: string }>({});

  // Step 2 — variants (pre-filled), with hard-delete tracking
  const [variants, setVariants] = useState<EditVariantDraft[]>(() =>
    sourceVariants.map((variant) => ({ key: nextKey(), id: variant.id, name: variant.name })),
  );
  const [deletedVariantIds, setDeletedVariantIds] = useState<string[]>([]);
  const [step2Error, setStep2Error] = useState<string | undefined>();
  const [step3Error, setStep3Error] = useState<string | undefined>();

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
          uniformVariantPrices: Object.fromEntries(
            sourceVariants.map((variant) => [variant.id, String(first.get(variant.name) ?? '')]),
          ),
          priceDrafts: {} as Record<string, PriceDraft>,
        };
      }

      const priceDrafts: Record<string, PriceDraft> = {};
      for (const id of pricedBranchIds) {
        const prices = byBranch.get(id)!;
        priceDrafts[id] = {
          base: '',
          variantPrices: Object.fromEntries(
            sourceVariants.map((variant) => [variant.id, String(prices.get(variant.name) ?? '')]),
          ),
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
    if (mode === 'same') {
      setPriceDrafts({});
    } else {
      setUniformBase('');
      setUniformVariantPrices({});
    }
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

  function goToStep2() {
    const nameValue = name.trim();
    const errors: { name?: string; sku?: string; description?: string } = {};
    if (nameValue.length < 2) errors.name = 'Product name must be at least 2 characters.';
    else if (nameValue.length > 120) errors.name = 'Product name must be 120 characters or fewer.';
    if (sku.trim().length < 2) errors.sku = 'SKU must be at least 2 characters.';
    else if (sku.trim().length > 40) errors.sku = 'SKU must be 40 characters or fewer.';
    else if (!/^[A-Za-z0-9-]+$/.test(sku.trim())) errors.sku = 'Use only letters, numbers, and hyphens.';
    if (description.trim().length > 500) errors.description = 'Description must be 500 characters or fewer.';
    setStep1Errors(errors);
    if (Object.keys(errors).length > 0) return;
    setStep(2);
  }

  function goToStep3() {
    if (variants.length > 50) {
      setStep2Error('Add between 1 and 50 variants.');
      return;
    }
    const blank = variants.find((variant) => !variant.name.trim());
    if (blank) {
      setStep2Error('Enter a name for each variant, or remove it.');
      return;
    }
    const names = variants.map((variant) => variant.name.trim().toLowerCase());
    if (new Set(names).size !== names.length) {
      setStep2Error('Variant names must be unique.');
      return;
    }
    if (variants.some((variant) => variant.name.trim().length > 60)) {
      setStep2Error('Variant names must be 60 characters or fewer.');
      return;
    }
    setStep2Error(undefined);
    setStep(3);
  }

  function submit() {
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
    const topLevelPrice = variants.length === 0 ? (firstBasePrice || uniformBase.trim() || '0.00') : '0.00';

    const variantValues: EditProductVariantValue[] = variants.map((variant) => {
      const fromPricing = pricing
        .flatMap((draft) => draft.variants ?? [])
        .find((entry) => entry.name === variant.name.trim());
      const price = fromPricing?.selling_price || uniformVariantPrices[variant.key] || '0.00';
      return { id: variant.id, name: variant.name.trim(), default_price: price };
    });

    onSubmit(
      {
        name: name.trim(),
        sku: sku.trim(),
        description: description.trim(),
        isActive,
        default_price: topLevelPrice,
        variants: variantValues,
        deletedVariantIds,
      },
      pricing,
    );
  }

  const hasVariants = variants.length > 0;

  return (
    <View style={styles.wrap}>
      <StepIndicator step={step} />

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
          <FormField
            label="Description (optional)"
            value={description}
            onChangeText={setDescription}
            error={step1Errors.description}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
            labelStyle={styles.fieldLabel}
            errorStyle={styles.fieldError}
            accentColor={managerColors.royalBlue}
            style={styles.fieldInput}
          />
          <SwitchField
            label="Active"
            description={
              canActivate
                ? 'Inactive products are retained for historical records.'
                : 'This product can become active only after Main sets opening stock.'
            }
            value={isActive}
            onValueChange={(next) => {
              if (next && !canActivate) return;
              setIsActive(next);
            }}
            labelStyle={styles.fieldLabel}
            descriptionStyle={styles.switchDescription}
            activeTrackColor={managerColors.royalBlue}
          />
        </View>
      ) : null}

      {step === 2 ? (
        <View style={styles.stepBody}>
          <View style={styles.variantList}>
            {variants.map((variant, index) => (
              <View key={variant.key}>
                {index > 0 ? <View style={styles.variantDivider} /> : null}
                <View style={styles.variantRow}>
                  <View style={styles.variantFieldCol}>
                    <FormField
                      label="Variant name"
                      value={variant.name}
                      onChangeText={(text) =>
                        setVariants((current) =>
                          current.map((entry, i) => (i === index ? { ...entry, name: text } : entry)),
                        )
                      }
                      placeholder="e.g. With Rice"
                      labelStyle={styles.fieldLabel}
                      errorStyle={styles.fieldError}
                      accentColor={managerColors.royalBlue}
                      style={styles.fieldInput}
                    />
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Remove variant ${index + 1}`}
                    hitSlop={8}
                    onPress={() => {
                      if (variant.id) setDeletedVariantIds((current) => [...current, variant.id!]);
                      setVariants((current) => current.filter((_, i) => i !== index));
                    }}
                    style={({ pressed }) => [styles.removeIconButton, pressed && styles.pressed]}
                  >
                    <Ionicons name="close" size={16} color={managerColors.subtext} />
                  </Pressable>
                </View>
              </View>
            ))}
            {step2Error ? <Text style={styles.error}>{step2Error}</Text> : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add variant"
              onPress={() => setVariants((current) => [...current, { key: nextKey(), id: null, name: '' }])}
              style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}
            >
              <Text style={styles.addButtonText}>Add variant</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {step === 3 ? (
        <View style={styles.stepBody}>
          <Text style={styles.fieldLabel}>Pricing</Text>
          <View style={styles.modeToggle}>
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ selected: pricingMode === 'same' }}
              onPress={() => switchPricingMode('same')}
              style={[styles.modeButton, pricingMode === 'same' && styles.modeButtonActive]}
            >
              <Text style={[styles.modeButtonText, pricingMode === 'same' && styles.modeButtonTextActive]}>
                Same for All
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ selected: pricingMode === 'different' }}
              onPress={() => switchPricingMode('different')}
              style={[styles.modeButton, pricingMode === 'different' && styles.modeButtonActive]}
            >
              <Text style={[styles.modeButtonText, pricingMode === 'different' && styles.modeButtonTextActive]}>
                Different per Branch
              </Text>
            </Pressable>
          </View>

          {branchOptions.length === 0 ? (
            <Text style={styles.hint}>No selling branches available yet.</Text>
          ) : pricingMode === 'same' ? (
            <>
              {hasVariants ? (
                <View style={styles.variantPriceList}>
                  {variants.map((variant) => (
                    <View key={variant.key} style={styles.variantPriceRow}>
                      <Text style={styles.variantPriceName} numberOfLines={1}>
                        {variant.name || 'Unnamed variant'}
                      </Text>
                      <FormField
                        label="Price (PHP)"
                        accessibilityLabel={`${variant.name || 'Variant'} price (PHP)`}
                        value={uniformVariantPrices[variant.key] ?? ''}
                        onChangeText={(text) =>
                          setUniformVariantPrices((current) => ({ ...current, [variant.key]: text }))
                        }
                        keyboardType="decimal-pad"
                        placeholder="0.00"
                        labelStyle={styles.variantPriceLabel}
                        errorStyle={styles.fieldError}
                        accentColor={managerColors.royalBlue}
                        style={styles.variantPriceInput}
                      />
                    </View>
                  ))}
                </View>
              ) : (
                <FormField
                  label="Selling price (PHP)"
                  value={uniformBase}
                  onChangeText={setUniformBase}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  labelStyle={styles.fieldLabel}
                  errorStyle={styles.fieldError}
                  accentColor={managerColors.royalBlue}
                  style={styles.fieldInput}
                />
              )}

              <Text style={styles.pricedHint}>
                Applies to all branches: {branchOptions.map((branch) => branch.name).join(', ')}
              </Text>
            </>
          ) : (
            <>
              <FilterChipRow
                options={branchOptions.map((branch) => ({
                  label: pricedBranchIds.has(branch.id) ? `${branch.name}  ✓` : branch.name,
                  value: branch.id,
                }))}
                value={branchId}
                onChange={setBranchId}
              />
              {variants.length === 0 ? (
                <FormField
                  label="Branch selling price (PHP)"
                  value={currentDraft.base}
                  onChangeText={setBase}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  labelStyle={styles.fieldLabel}
                  errorStyle={styles.fieldError}
                  accentColor={managerColors.royalBlue}
                  style={styles.fieldInput}
                />
              ) : (
                <View style={styles.variantPriceList}>
                  {variants.map((variant) => (
                    <View key={variant.key} style={styles.variantPriceRow}>
                      <Text style={styles.variantPriceName} numberOfLines={1}>
                        {variant.name || 'Unnamed variant'}
                      </Text>
                      <FormField
                        label="Price (PHP)"
                        accessibilityLabel={`${variant.name || 'Variant'} price (PHP)`}
                        value={currentDraft.variantPrices[variant.key] ?? ''}
                        onChangeText={(text) => setVariantPrice(variant.key, text)}
                        keyboardType="decimal-pad"
                        placeholder="0.00"
                        labelStyle={styles.variantPriceLabel}
                        errorStyle={styles.fieldError}
                        accentColor={managerColors.royalBlue}
                        style={styles.variantPriceInput}
                      />
                    </View>
                  ))}
                </View>
              )}
              {pricedBranchIds.size === 0 ? (
                <Text style={styles.pricedHint}>No branch priced yet. Product defaults will still be saved.</Text>
              ) : null}
            </>
          )}
          {step3Error ? <Text style={styles.error}>{step3Error}</Text> : null}
        </View>
      ) : null}

      {step === 3 && error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.buttonRow}>
        {step > 1 ? (
          <View style={styles.buttonCol}>
            <ManagerActionButton
              label="Back"
              variant="secondary"
              disabled={loading}
              onPress={() => setStep((current) => (current === 3 ? 2 : 1))}
            />
          </View>
        ) : null}
        <View style={styles.buttonCol}>
          {step === 1 ? (
            <ManagerActionButton label="Next" onPress={goToStep2} />
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

function StepIndicator({ step }: { step: 1 | 2 | 3 }) {
  const labels = ['Product Info', 'Variants', 'Branch Pricing'];
  return (
    <View style={styles.indicatorWrap}>
      <View style={styles.indicatorRow}>
        {[1, 2, 3].map((n, index) => (
          <View key={n} style={styles.indicatorSegment}>
            <View style={[styles.indicatorDot, n <= step && styles.indicatorDotActive]}>
              <Text style={[styles.indicatorDotLabel, n <= step && styles.indicatorDotLabelActive]}>{n}</Text>
            </View>
            {index < 2 ? (
              <View style={[styles.indicatorLine, n < step && styles.indicatorLineActive]} />
            ) : null}
          </View>
        ))}
      </View>
      <Text style={styles.indicatorLabel}>{labels[step - 1]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 16 },
  stepBody: { gap: 16 },
  hint: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 18 },
  error: { color: '#B91C1C', fontFamily: 'Inter_500Medium', fontSize: 14, lineHeight: 20 },
  fieldLabel: { fontFamily: 'Inter_600SemiBold', color: managerColors.ink },
  fieldInput: { fontFamily: 'Inter_400Regular' },
  fieldError: { fontFamily: 'Inter_500Medium' },
  switchDescription: { fontFamily: 'Inter_400Regular' },
  variantList: { gap: 4 },
  variantRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingVertical: 10 },
  variantFieldCol: { flex: 1, minWidth: 0 },
  variantDivider: { height: StyleSheet.hairlineWidth, backgroundColor: managerColors.cardBorder },
  removeIconButton: {
    width: 34,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#EAF0FB',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  addButtonText: { color: managerColors.royalBlue, fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  modeToggle: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: managerColors.cardSurface,
    borderRadius: 12,
    padding: 4,
  },
  modeButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 9,
    alignItems: 'center',
  },
  modeButtonActive: { backgroundColor: '#FFFFFF' },
  modeButtonText: { color: managerColors.subtext, fontFamily: 'Inter_600SemiBold', fontSize: 12.5 },
  modeButtonTextActive: { color: managerColors.royalBlue },
  variantPriceList: { gap: 10 },
  variantPriceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 12,
    padding: 10,
    backgroundColor: managerColors.cardSurface,
  },
  variantPriceName: { flex: 1, color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  variantPriceLabel: { fontFamily: 'Inter_500Medium', color: managerColors.subtext, fontSize: 11 },
  variantPriceInput: { width: 110, minHeight: 40, paddingVertical: 8, fontFamily: 'Inter_400Regular' },
  pricedHint: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 12.5 },
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
