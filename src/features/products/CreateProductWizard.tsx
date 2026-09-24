import Ionicons from '@react-native-vector-icons/ionicons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { FormField } from '@/components/FormField';
import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { FilterChipRow } from '@/components/dashboard/FilterChipRow';
import { managerColors } from '@/components/dashboard/theme';

import { generateSkuFromName } from './generateSku';
import { PRICE_PATTERN } from './productSchema';

export type CreateProductVariantDraft = { id: string; name: string; default_price: string };

export type CreateProductValues = {
  name: string;
  sku: string;
  description: string;
  default_price: string;
  variants: CreateProductVariantDraft[];
};

export type BranchPricingDraft =
  | { branchId: string; selling_price: string; variants?: undefined }
  | { branchId: string; selling_price?: undefined; variants: Array<{ name: string; selling_price: string }> };

interface CreateProductWizardProps {
  existingSkus?: string[];
  branchOptions: Array<{ id: string; name: string }>;
  loading?: boolean;
  error?: string;
  onSubmit: (values: CreateProductValues, pricing: BranchPricingDraft[]) => void;
}

function isValidPrice(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  return PRICE_PATTERN.test(trimmed);
}

type PriceDraft = { base: string; variantPrices: Record<string, string> };

export function CreateProductWizard({
  existingSkus = [],
  branchOptions,
  loading = false,
  error,
  onSubmit,
}: CreateProductWizardProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Step 1 — product info
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [description, setDescription] = useState('');
  const [step1Errors, setStep1Errors] = useState<{ name?: string; sku?: string; description?: string }>({});
  const skuEditedRef = useRef(false);

  useEffect(() => {
    if (skuEditedRef.current) return;
    setSku(name.trim() ? generateSkuFromName(name, existingSkus) : '');
  }, [name, existingSkus]);

  // Step 2 — variants (name + explicit default price) or single default price
  const idRef = useRef(0);
  const [variants, setVariants] = useState<CreateProductVariantDraft[]>([]);
  const [defaultPrice, setDefaultPrice] = useState('');
  const [step2Error, setStep2Error] = useState<string | undefined>();
  const [step3Error, setStep3Error] = useState<string | undefined>();

  // Step 3 — branch pricing
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
    if (variants.length === 0) {
      if (!isValidPrice(defaultPrice)) {
        setStep2Error('Enter a default base price.');
        return;
      }
      setStep2Error(undefined);
      setStep(3);
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
    if (variants.some((variant) => !isValidPrice(variant.default_price))) {
      setStep2Error('Enter a default price for every variant.');
      return;
    }
    setStep2Error(undefined);
    setStep(3);
  }

  function submit() {
    const selectedIds = [...pricedBranchIds];
    for (const id of selectedIds) {
      const draft = priceDrafts[id];
      if (!draft) {
        setStep3Error('Complete the pricing for all selected branches.');
        return;
      }
      if (variants.length === 0) {
        if (!isValidPrice(draft.base)) {
          setStep3Error('Complete the pricing for all selected branches.');
          return;
        }
      } else if (variants.some((variant) => !isValidPrice(draft.variantPrices[variant.id] ?? ''))) {
        setStep3Error('Enter a price for every enabled variant.');
        return;
      }
    }

    const pricing: BranchPricingDraft[] = selectedIds.map((id) => {
      const draft = priceDrafts[id]!;
      if (variants.length === 0) {
        return { branchId: id, selling_price: draft.base.trim() };
      }
      return {
        branchId: id,
        variants: variants.map((variant) => ({
          name: variant.name.trim(),
          selling_price: draft.variantPrices[variant.id].trim(),
        })),
      };
    });

    setStep3Error(undefined);
    onSubmit(
      {
        name: name.trim(),
        sku: sku.trim(),
        description: description.trim(),
        default_price: variants.length === 0 ? defaultPrice.trim() : variants[0]!.default_price.trim(),
        variants: variants.map((variant) => ({
          id: variant.id,
          name: variant.name.trim(),
          default_price: variant.default_price.trim(),
        })),
      },
      pricing,
    );
  }

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
          <Text style={styles.hint}>Auto-filled from the name — editable.</Text>
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
        </View>
      ) : null}

      {step === 2 ? (
        <View style={styles.stepBody}>
          {variants.length === 0 ? (
            <>
              <Text style={styles.hint}>Enter the product default price. Branch prices are set next.</Text>
              <FormField
                label="Default / base price (PHP)"
                value={defaultPrice}
                onChangeText={setDefaultPrice}
                keyboardType="decimal-pad"
                placeholder="0.00"
                labelStyle={styles.fieldLabel}
                errorStyle={styles.fieldError}
                accentColor={managerColors.royalBlue}
                style={styles.fieldInput}
              />
            </>
          ) : (
            <Text style={styles.hint}>The first variant is the Default. Each variant keeps its own default price.</Text>
          )}
          <View style={styles.variantList}>
            {variants.map((variant, index) => (
              <View key={variant.id}>
                {index > 0 ? <View style={styles.variantDivider} /> : null}
                <View style={styles.variantRow}>
                  <View style={styles.variantFieldCol}>
                    <FormField
                      label={index === 0 ? 'Default variant name' : 'Variant name'}
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
                    <FormField
                      label={index === 0 ? 'Default price (PHP)' : 'Default price (PHP)'}
                      value={variant.default_price}
                      onChangeText={(text) =>
                        setVariants((current) =>
                          current.map((entry, i) => (i === index ? { ...entry, default_price: text } : entry)),
                        )
                      }
                      keyboardType="decimal-pad"
                      placeholder="0.00"
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
                    onPress={() => setVariants((current) => current.filter((_, i) => i !== index))}
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
              onPress={() => {
                idRef.current += 1;
                setVariants((current) => [...current, { id: `v${idRef.current}`, name: '', default_price: '' }]);
              }}
              style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}
            >
              <Text style={styles.addButtonText}>Add variant</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {step === 3 ? (
        <View style={styles.stepBody}>
          <Text style={styles.hint}>
            {variants.length === 0
              ? 'Set a selling price for each selected branch. Leave a branch blank to skip it.'
              : 'Selected branches need a price for every variant. Leave a branch blank to skip it.'}
          </Text>
          {branchOptions.length === 0 ? (
            <Text style={styles.hint}>No selling branches available yet.</Text>
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
                    <View key={variant.id} style={styles.variantPriceRow}>
                      <Text style={styles.variantPriceName} numberOfLines={1}>
                        {variant.name || 'Unnamed variant'}
                      </Text>
                      <FormField
                        label="Price (PHP)"
                        accessibilityLabel={`${variant.name || 'Variant'} price (PHP)`}
                        value={currentDraft.variantPrices[variant.id] ?? ''}
                        onChangeText={(text) => setVariantPrice(variant.id, text)}
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
                <Text style={styles.pricedHint}>No branch selected. Product defaults will still be saved.</Text>
              ) : (
                <Text style={styles.pricedHint}>Selected branches must have a complete price set.</Text>
              )}
              {step3Error ? <Text style={styles.error}>{step3Error}</Text> : null}
            </>
          )}
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
            <ManagerActionButton label="Create product" loading={loading} onPress={submit} />
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
