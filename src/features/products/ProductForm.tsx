import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { FormField } from '@/components/FormField';
import { SwitchField } from '@/components/SwitchField';
import { colors, spacing } from '@/constants/theme';
import { productSchema, type ProductFormValues } from './productSchema';

interface ProductFormProps {
  defaultValues?: ProductFormValues;
  error?: string;
  loading?: boolean;
  submitLabel: string;
  onSubmit: (values: ProductFormValues) => void;
}

export function ProductForm({ defaultValues, error, loading, submitLabel, onSubmit }: ProductFormProps) {
  const { control, handleSubmit } = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: defaultValues ?? { name: '', sku: '', description: '', selling_price: '', is_active: true },
  });

  return (
    <View style={styles.form}>
      <Controller control={control} name="name" render={({ field, fieldState }) => (
        <FormField label="Product name" value={field.value} onBlur={field.onBlur} onChangeText={field.onChange} error={fieldState.error?.message} autoCapitalize="words" />
      )} />
      <Controller control={control} name="sku" render={({ field, fieldState }) => (
        <FormField label="SKU" value={field.value} onBlur={field.onBlur} onChangeText={field.onChange} error={fieldState.error?.message} autoCapitalize="characters" placeholder="e.g. CHK-NUG" />
      )} />
      <Controller control={control} name="description" render={({ field, fieldState }) => (
        <FormField label="Description (optional)" value={field.value ?? ''} onBlur={field.onBlur} onChangeText={field.onChange} error={fieldState.error?.message} multiline numberOfLines={3} textAlignVertical="top" />
      )} />
      <Controller control={control} name="selling_price" render={({ field, fieldState }) => (
        <FormField label="Selling price (PHP)" value={field.value} onBlur={field.onBlur} onChangeText={field.onChange} error={fieldState.error?.message} keyboardType="decimal-pad" placeholder="0.00" />
      )} />
      <Controller control={control} name="is_active" render={({ field }) => (
        <SwitchField label="Active" description="Inactive products are retained for future historical records." value={field.value} onValueChange={field.onChange} />
      )} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <AppButton label={submitLabel} loading={loading} onPress={handleSubmit(onSubmit)} />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.md },
  error: { color: colors.danger, fontSize: 14, lineHeight: 20 },
});
