import { useEffect, useRef, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { FormField } from '@/components/FormField';
import { SwitchField } from '@/components/SwitchField';
import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { FilterChipRow } from '@/components/dashboard/FilterChipRow';
import { managerColors } from '@/components/dashboard/theme';

import { generateSkuFromName } from './generateSku';
import { productSchema, type ProductFormValues } from './productSchema';

interface ProductFormProps {
  defaultValues?: ProductFormValues;
  /** Existing SKUs used to keep auto-generated codes unique (create flow). */
  existingSkus?: string[];
  /** When true, SKU updates from the product name until the cashier edits SKU. */
  autoGenerateSku?: boolean;
  /** Only the create flow currently exposes default-variant editing. */
  allowVariants?: boolean;
  /** Create flow hides this — products activate when opening stock is set. */
  showActiveToggle?: boolean;
  /** Edit may show Active but cannot turn it on until Main has opening stock. */
  canActivate?: boolean;
  /** Optional selling-branch price editor (create/edit). */
  branchOptions?: Array<{ id: string; name: string }>;
  resolveBranchPrice?: (branchId: string) => string | undefined;
  onBranchChange?: (branchId: string) => void;
  onConfirmBranchPrice?: (payload: { branchId: string; selling_price: number }) => void;
  branchPriceLoading?: boolean;
  branchPriceError?: string;
  error?: string;
  loading?: boolean;
  submitLabel: string;
  onSubmit: (
    values: ProductFormValues,
    branchPriceDraft?: { branchId: string; selling_price: number },
  ) => void;
}

export function ProductForm({
  defaultValues,
  existingSkus = [],
  autoGenerateSku = false,
  allowVariants = false,
  showActiveToggle = true,
  canActivate = true,
  branchOptions = [],
  resolveBranchPrice,
  onBranchChange,
  onConfirmBranchPrice,
  branchPriceLoading,
  branchPriceError,
  error,
  loading,
  submitLabel,
  onSubmit,
}: ProductFormProps) {
  const skuEditedRef = useRef(Boolean(defaultValues?.sku?.trim()));
  const [branchId, setBranchId] = useState(branchOptions[0]?.id ?? '');
  const [branchPrice, setBranchPrice] = useState('');
  const { control, handleSubmit, setValue, watch, formState } = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: defaultValues ?? {
      name: '',
      sku: '',
      description: '',
      selling_price: '',
      is_active: showActiveToggle ? true : false,
      pricingType: 'single',
      variants: [],
    },
  });
  const nameValue = watch('name');
  const basePrice = watch('selling_price');
  const { fields: variantFields, append: appendVariant, remove: removeVariant } = useFieldArray({
    control,
    name: 'variants',
  });

  useEffect(() => {
    if (!autoGenerateSku || skuEditedRef.current) return;
    const nextSku = nameValue.trim() ? generateSkuFromName(nameValue, existingSkus) : '';
    setValue('sku', nextSku, { shouldValidate: Boolean(nextSku), shouldDirty: true });
  }, [autoGenerateSku, existingSkus, nameValue, setValue]);

  useEffect(() => {
    if (!branchId) return;
    const resolved = resolveBranchPrice?.(branchId);
    setBranchPrice(resolved?.trim() ? resolved : basePrice || '');
  }, [basePrice, branchId, resolveBranchPrice]);

  const variantsErrorMessage = formState.errors.variants?.message;

  return (
    <View style={styles.form}>
      <Controller
        control={control}
        name="name"
        render={({ field, fieldState }) => (
          <FormField
            label="Product name"
            value={field.value}
            onBlur={field.onBlur}
            onChangeText={field.onChange}
            error={fieldState.error?.message}
            autoCapitalize="words"
            labelStyle={styles.fieldLabel}
            errorStyle={styles.fieldError}
            accentColor={managerColors.royalBlue}
            style={styles.fieldInput}
          />
        )}
      />
      <Controller
        control={control}
        name="sku"
        render={({ field, fieldState }) => (
          <FormField
            label="SKU"
            value={field.value}
            onBlur={field.onBlur}
            onChangeText={(text) => {
              skuEditedRef.current = true;
              field.onChange(text);
            }}
            error={fieldState.error?.message}
            autoCapitalize="characters"
            placeholder={autoGenerateSku ? 'Auto from name' : 'e.g. CHK-NUG'}
            labelStyle={styles.fieldLabel}
            errorStyle={styles.fieldError}
            accentColor={managerColors.royalBlue}
            style={styles.fieldInput}
          />
        )}
      />
      {autoGenerateSku ? (
        <Text style={styles.hint}>SKU is filled from the product name. Edit it anytime before saving.</Text>
      ) : null}
      <Controller
        control={control}
        name="description"
        render={({ field, fieldState }) => (
          <FormField
            label="Description (optional)"
            value={field.value ?? ''}
            onBlur={field.onBlur}
            onChangeText={field.onChange}
            error={fieldState.error?.message}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
            labelStyle={styles.fieldLabel}
            errorStyle={styles.fieldError}
            accentColor={managerColors.royalBlue}
            style={styles.fieldInput}
          />
        )}
      />
      {allowVariants ? (
        <View style={styles.variantsBlock}>
          <Text style={[styles.label, styles.fieldLabel]}>Variants (optional names)</Text>
          <Text style={styles.hint}>Price is set per selling branch, not as a company default.</Text>
          <View style={styles.variantList}>
            {variantFields.map((field, index) => (
              <View key={field.id} style={styles.variantRow}>
                <Controller
                  control={control}
                  name={`variants.${index}.name`}
                  render={({ field: nameField, fieldState }) => (
                    <FormField
                      label="Variant name"
                      value={nameField.value}
                      onChangeText={nameField.onChange}
                      error={fieldState.error?.message}
                      placeholder="e.g. With Rice"
                      labelStyle={styles.fieldLabel}
                      errorStyle={styles.fieldError}
                      accentColor={managerColors.royalBlue}
                      style={styles.fieldInput}
                    />
                  )}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove variant ${index + 1}`}
                  onPress={() => removeVariant(index)}
                  style={({ pressed }) => [styles.removeButton, pressed && styles.pressed]}
                >
                  <Text style={styles.removeButtonText}>Remove variant</Text>
                </Pressable>
              </View>
            ))}
            {variantsErrorMessage ? <Text style={styles.error}>{variantsErrorMessage}</Text> : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add variant"
              onPress={() => {
                setValue('pricingType', 'variants');
                appendVariant({ name: '', default_price: branchPrice || '0', is_active: true });
              }}
              style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}
            >
              <Text style={styles.addButtonText}>Add variant</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
      {showActiveToggle ? (
        <Controller
          control={control}
          name="is_active"
          render={({ field }) => (
            <SwitchField
              label="Active"
              description={
                canActivate
                  ? 'Inactive products are retained for historical records.'
                  : 'This product can become active only after Main sets opening stock.'
              }
              value={field.value}
              onValueChange={(next) => {
                if (next && !canActivate) return;
                field.onChange(next);
              }}
              labelStyle={styles.fieldLabel}
              descriptionStyle={styles.switchDescription}
              activeTrackColor={managerColors.royalBlue}
            />
          )}
        />
      ) : (
        <Text style={styles.hint}>
          New products stay inactive until a Main Manager sets an opening-stock quantity.
        </Text>
      )}
      {branchOptions.length > 0 ? (
        <View style={styles.variantsBlock}>
          <Text style={[styles.label, styles.fieldLabel]}>Selling branch price</Text>
          <Text style={styles.hint}>
            Price lives on the selling-branch catalog. There is no company default or pricing type.
          </Text>
          <FilterChipRow
            options={branchOptions.map((branch) => ({ label: branch.name, value: branch.id }))}
            value={branchId}
            onChange={(next) => {
              setBranchId(next);
              onBranchChange?.(next);
            }}
          />
          <FormField
            label="Branch selling price (PHP)"
            value={branchPrice}
            onChangeText={setBranchPrice}
            keyboardType="decimal-pad"
            placeholder="0.00"
            labelStyle={styles.fieldLabel}
            errorStyle={styles.fieldError}
            accentColor={managerColors.royalBlue}
            style={styles.fieldInput}
          />
          {branchPriceError ? <Text style={styles.error}>{branchPriceError}</Text> : null}
          {onConfirmBranchPrice ? (
            <ManagerActionButton
              label="Confirm branch price"
              variant="secondary"
              loading={branchPriceLoading}
              disabled={!branchId}
              onPress={() => {
                if (!branchId) return;
                onConfirmBranchPrice({ branchId, selling_price: Number(branchPrice) });
              }}
            />
          ) : null}
        </View>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <ManagerActionButton
        label={submitLabel}
        loading={loading}
        onPress={handleSubmit((values) => {
          const fallbackPrice = branchPrice.trim() || values.selling_price || '0';
          onSubmit(
            {
              ...values,
              selling_price: fallbackPrice,
              is_active: showActiveToggle ? values.is_active : false,
              pricingType: values.variants.length > 0 ? 'variants' : 'single',
              variants: values.variants.map((variant) => ({
                ...variant,
                default_price: variant.default_price.trim() || fallbackPrice,
              })),
            },
            branchId && Number.isFinite(Number(branchPrice))
              ? { branchId, selling_price: Number(branchPrice) }
              : undefined,
          );
        })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: 16 },
  hint: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 18, marginTop: -8 },
  error: { color: '#B91C1C', fontFamily: 'Inter_500Medium', fontSize: 14, lineHeight: 20 },
  label: { fontSize: 16, fontWeight: '600' },
  fieldLabel: { fontFamily: 'Inter_600SemiBold', color: managerColors.ink },
  fieldInput: { fontFamily: 'Inter_400Regular' },
  fieldError: { fontFamily: 'Inter_500Medium' },
  switchDescription: { fontFamily: 'Inter_400Regular' },
  variantsBlock: { gap: 10 },
  variantList: { gap: 12 },
  variantRow: {
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 14,
    padding: 12,
    gap: 10,
    backgroundColor: managerColors.cardSurface,
  },
  removeButton: { alignSelf: 'flex-start' },
  removeButtonText: { color: '#B91C1C', fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  addButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#EAF0FB',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  addButtonText: { color: managerColors.royalBlue, fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  pressed: { opacity: 0.7 },
});
