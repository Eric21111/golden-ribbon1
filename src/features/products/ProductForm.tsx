import { useEffect, useRef } from 'react';
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

const PRICING_TYPE_OPTIONS = [
  { label: 'Single price', value: 'single' as const },
  { label: 'Has variants', value: 'variants' as const },
];

interface ProductFormProps {
  defaultValues?: ProductFormValues;
  /** Existing SKUs used to keep auto-generated codes unique (create flow). */
  existingSkus?: string[];
  /** When true, SKU updates from the product name until the cashier edits SKU. */
  autoGenerateSku?: boolean;
  /** Only the create flow currently exposes default-variant editing. */
  allowVariants?: boolean;
  error?: string;
  loading?: boolean;
  submitLabel: string;
  onSubmit: (values: ProductFormValues) => void;
}

export function ProductForm({
  defaultValues,
  existingSkus = [],
  autoGenerateSku = false,
  allowVariants = false,
  error,
  loading,
  submitLabel,
  onSubmit,
}: ProductFormProps) {
  const skuEditedRef = useRef(Boolean(defaultValues?.sku?.trim()));
  const { control, handleSubmit, setValue, watch, formState } = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: defaultValues ?? {
      name: '',
      sku: '',
      description: '',
      selling_price: '',
      is_active: true,
      pricingType: 'single',
      variants: [],
    },
  });
  const nameValue = watch('name');
  const pricingType = watch('pricingType');
  const { fields: variantFields, append: appendVariant, remove: removeVariant } = useFieldArray({
    control,
    name: 'variants',
  });

  useEffect(() => {
    if (!autoGenerateSku || skuEditedRef.current) return;
    const nextSku = nameValue.trim() ? generateSkuFromName(nameValue, existingSkus) : '';
    setValue('sku', nextSku, { shouldValidate: Boolean(nextSku), shouldDirty: true });
  }, [autoGenerateSku, existingSkus, nameValue, setValue]);

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
      <Controller
        control={control}
        name="selling_price"
        render={({ field, fieldState }) => (
          <FormField
            label="Default/base price (PHP)"
            value={field.value}
            onBlur={field.onBlur}
            onChangeText={field.onChange}
            error={fieldState.error?.message}
            keyboardType="decimal-pad"
            placeholder="0.00"
            labelStyle={styles.fieldLabel}
            errorStyle={styles.fieldError}
            accentColor={managerColors.royalBlue}
            style={styles.fieldInput}
          />
        )}
      />
      {allowVariants ? (
        <View style={styles.variantsBlock}>
          <Text style={[styles.label, styles.fieldLabel]}>Pricing type</Text>
          <Controller
            control={control}
            name="pricingType"
            render={({ field }) => (
              <FilterChipRow options={PRICING_TYPE_OPTIONS} value={field.value} onChange={field.onChange} />
            )}
          />
          {pricingType === 'variants' ? (
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
                  <Controller
                    control={control}
                    name={`variants.${index}.default_price`}
                    render={({ field: priceField, fieldState }) => (
                      <FormField
                        label="Default price (PHP)"
                        value={priceField.value}
                        onChangeText={priceField.onChange}
                        error={fieldState.error?.message}
                        keyboardType="decimal-pad"
                        placeholder="0.00"
                        labelStyle={styles.fieldLabel}
                        errorStyle={styles.fieldError}
                        accentColor={managerColors.royalBlue}
                        style={styles.fieldInput}
                      />
                    )}
                  />
                  <Controller
                    control={control}
                    name={`variants.${index}.is_active`}
                    render={({ field: activeField }) => (
                      <SwitchField
                        label="Active"
                        value={activeField.value}
                        onValueChange={activeField.onChange}
                        labelStyle={styles.fieldLabel}
                        activeTrackColor={managerColors.royalBlue}
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
                onPress={() => appendVariant({ name: '', default_price: '', is_active: true })}
                style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}
              >
                <Text style={styles.addButtonText}>Add variant</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      ) : null}
      <Controller
        control={control}
        name="is_active"
        render={({ field }) => (
          <SwitchField
            label="Active"
            description="Inactive products are retained for future historical records."
            value={field.value}
            onValueChange={field.onChange}
            labelStyle={styles.fieldLabel}
            descriptionStyle={styles.switchDescription}
            activeTrackColor={managerColors.royalBlue}
          />
        )}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <ManagerActionButton label={submitLabel} loading={loading} onPress={handleSubmit(onSubmit)} />
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
