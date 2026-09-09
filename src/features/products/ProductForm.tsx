import { useEffect, useRef } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { FormField } from '@/components/FormField';
import { SwitchField } from '@/components/SwitchField';
import { colors, spacing } from '@/constants/theme';

import { generateSkuFromName } from './generateSku';
import { productSchema, type ProductFormValues } from './productSchema';

interface ProductFormProps {
  defaultValues?: ProductFormValues;
  /** Existing SKUs used to keep auto-generated codes unique (create flow). */
  existingSkus?: string[];
  /** When true, SKU updates from the product name until the cashier edits SKU. */
  autoGenerateSku?: boolean;
  error?: string;
  loading?: boolean;
  submitLabel: string;
  onSubmit: (values: ProductFormValues) => void;
}

export function ProductForm({
  defaultValues,
  existingSkus = [],
  autoGenerateSku = false,
  error,
  loading,
  submitLabel,
  onSubmit,
}: ProductFormProps) {
  const skuEditedRef = useRef(Boolean(defaultValues?.sku?.trim()));
  const { control, handleSubmit, setValue, watch } = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: defaultValues ?? { name: '', sku: '', description: '', selling_price: '', is_active: true },
  });
  const nameValue = watch('name');

  useEffect(() => {
    if (!autoGenerateSku || skuEditedRef.current) return;
    const nextSku = nameValue.trim() ? generateSkuFromName(nameValue, existingSkus) : '';
    setValue('sku', nextSku, { shouldValidate: Boolean(nextSku), shouldDirty: true });
  }, [autoGenerateSku, existingSkus, nameValue, setValue]);

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
          />
        )}
      />
      <Controller
        control={control}
        name="selling_price"
        render={({ field, fieldState }) => (
          <FormField
            label="Selling price (PHP)"
            value={field.value}
            onBlur={field.onBlur}
            onChangeText={field.onChange}
            error={fieldState.error?.message}
            keyboardType="decimal-pad"
            placeholder="0.00"
          />
        )}
      />
      <Controller
        control={control}
        name="is_active"
        render={({ field }) => (
          <SwitchField
            label="Active"
            description="Inactive products are retained for future historical records."
            value={field.value}
            onValueChange={field.onChange}
          />
        )}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <AppButton label={submitLabel} loading={loading} onPress={handleSubmit(onSubmit)} />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.md },
  hint: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: -spacing.sm },
  error: { color: colors.danger, fontSize: 14, lineHeight: 20 },
});
