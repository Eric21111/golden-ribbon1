import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, Text, View } from 'react-native';

import { FormField } from '@/components/FormField';
import { SwitchField } from '@/components/SwitchField';
import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { managerColors } from '@/components/dashboard/theme';
import { branchSchema, type BranchFormValues } from './branchSchema';

interface BranchFormProps {
  defaultValues?: BranchFormValues;
  error?: string;
  loading?: boolean;
  submitLabel: string;
  hideMainToggle?: boolean;
  protectMainBranch?: boolean;
  onSubmit: (values: BranchFormValues) => void;
}

export function BranchForm({
  defaultValues,
  error,
  loading,
  submitLabel,
  hideMainToggle = false,
  protectMainBranch = false,
  onSubmit,
}: BranchFormProps) {
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
        <FormField
          label="Branch name"
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
      )} />
      <Controller control={control} name="code" render={({ field, fieldState }) => (
        <FormField
          label="Branch code"
          value={field.value}
          onBlur={field.onBlur}
          onChangeText={field.onChange}
          error={fieldState.error?.message}
          autoCapitalize="characters"
          placeholder="e.g. BR-01"
          labelStyle={styles.fieldLabel}
          errorStyle={styles.fieldError}
          accentColor={managerColors.royalBlue}
          style={styles.fieldInput}
        />
      )} />
      <Controller control={control} name="address" render={({ field, fieldState }) => (
        <FormField
          label="Address (optional)"
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
      )} />
      {hideMainToggle ? null : (
        <Controller control={control} name="is_main_branch" render={({ field }) => (
          <SwitchField
            label="Main Branch"
            description="Only one branch can be the Main Branch."
            value={field.value}
            onValueChange={field.onChange}
            labelStyle={styles.fieldLabel}
            descriptionStyle={styles.switchDescription}
            activeTrackColor={managerColors.royalBlue}
          />
        )} />
      )}
      <Controller control={control} name="is_active" render={({ field }) => (
        <SwitchField
          label="Active"
          description={
            protectMainBranch
              ? 'The Main Branch cannot be deactivated.'
              : 'Inactive branches remain available for historical records.'
          }
          value={field.value}
          onValueChange={protectMainBranch ? () => undefined : field.onChange}
          labelStyle={styles.fieldLabel}
          descriptionStyle={styles.switchDescription}
          activeTrackColor={managerColors.royalBlue}
        />
      )} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <ManagerActionButton label={submitLabel} loading={loading} onPress={handleSubmit(onSubmit)} />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: 16 },
  error: { color: '#B91C1C', fontFamily: 'Inter_500Medium', fontSize: 14, lineHeight: 20 },
  fieldLabel: { fontFamily: 'Inter_600SemiBold', color: managerColors.ink },
  fieldInput: { fontFamily: 'Inter_400Regular' },
  fieldError: { fontFamily: 'Inter_500Medium' },
  switchDescription: { fontFamily: 'Inter_400Regular' },
});
