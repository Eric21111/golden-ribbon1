import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { FormField } from '@/components/FormField';
import { SwitchField } from '@/components/SwitchField';
import { colors, spacing } from '@/constants/theme';
import { branchSchema, type BranchFormValues } from './branchSchema';

interface BranchFormProps {
  defaultValues?: BranchFormValues;
  error?: string;
  loading?: boolean;
  submitLabel: string;
  onSubmit: (values: BranchFormValues) => void;
}

export function BranchForm({ defaultValues, error, loading, submitLabel, onSubmit }: BranchFormProps) {
  const { control, handleSubmit } = useForm<BranchFormValues>({
    resolver: zodResolver(branchSchema),
    defaultValues: defaultValues ?? {
      name: '',
      code: '',
      address: '',
      is_main_branch: false,
      is_active: true,
    },
  });

  return (
    <View style={styles.form}>
      <Controller control={control} name="name" render={({ field, fieldState }) => (
        <FormField label="Branch name" value={field.value} onBlur={field.onBlur} onChangeText={field.onChange} error={fieldState.error?.message} autoCapitalize="words" />
      )} />
      <Controller control={control} name="code" render={({ field, fieldState }) => (
        <FormField label="Branch code" value={field.value} onBlur={field.onBlur} onChangeText={field.onChange} error={fieldState.error?.message} autoCapitalize="characters" placeholder="e.g. BR-01" />
      )} />
      <Controller control={control} name="address" render={({ field, fieldState }) => (
        <FormField label="Address (optional)" value={field.value ?? ''} onBlur={field.onBlur} onChangeText={field.onChange} error={fieldState.error?.message} multiline numberOfLines={3} textAlignVertical="top" />
      )} />
      <Controller control={control} name="is_main_branch" render={({ field }) => (
        <SwitchField label="Main Branch" description="Only one branch can be the Main Branch." value={field.value} onValueChange={field.onChange} />
      )} />
      <Controller control={control} name="is_active" render={({ field }) => (
        <SwitchField label="Active" description="Inactive branches remain available for historical records." value={field.value} onValueChange={field.onChange} />
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
