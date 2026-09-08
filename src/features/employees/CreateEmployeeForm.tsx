import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { FormField } from '@/components/FormField';
import { SwitchField } from '@/components/SwitchField';
import { colors, spacing } from '@/constants/theme';
import { ChoiceChips } from '@/features/employees/ChoiceChips';
import { createEmployeeSchema, type CreateEmployeeValues } from '@/features/employees/employeeSchemas';
import { BranchSelector } from '@/features/inventory/BranchSelector';
import type { Branch } from '@/types/models';

type CreateEmployeeFormProps = {
  branches: Branch[];
  error?: string;
  loading?: boolean;
  onSubmit: (values: CreateEmployeeValues) => void;
};

export function CreateEmployeeForm({ branches, error, loading, onSubmit }: CreateEmployeeFormProps) {
  const { control, handleSubmit, formState } = useForm<CreateEmployeeValues>({
    resolver: zodResolver(createEmployeeSchema),
    defaultValues: {
      full_name: '',
      email: '',
      password: '',
      role: 'cashier',
      branch_id: '',
      is_active: true,
    },
  });

  return (
    <View style={styles.form}>
      <Controller
        control={control}
        name="full_name"
        render={({ field, fieldState }) => (
          <FormField
            label="Full Name"
            autoCapitalize="words"
            value={field.value}
            onBlur={field.onBlur}
            onChangeText={field.onChange}
            error={fieldState.error?.message}
          />
        )}
      />
      <Controller
        control={control}
        name="email"
        render={({ field, fieldState }) => (
          <FormField
            label="Email"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            value={field.value}
            onBlur={field.onBlur}
            onChangeText={field.onChange}
            error={fieldState.error?.message}
          />
        )}
      />
      <Controller
        control={control}
        name="password"
        render={({ field, fieldState }) => (
          <FormField
            label="Temporary Password"
            secureTextEntry
            value={field.value}
            onBlur={field.onBlur}
            onChangeText={field.onChange}
            error={fieldState.error?.message}
          />
        )}
      />
      <Text style={styles.hint}>Use 8–72 characters. Password is never stored in the app database.</Text>
      <Controller
        control={control}
        name="role"
        render={({ field }) => (
          <ChoiceChips
            label="Role"
            value={field.value}
            onChange={field.onChange}
            choices={[
              { label: 'Manager', value: 'manager' },
              { label: 'Cashier', value: 'cashier' },
            ]}
          />
        )}
      />
      <Text style={styles.label}>Assigned Branch</Text>
      <Controller
        control={control}
        name="branch_id"
        render={({ field, fieldState }) => (
          <>
            <BranchSelector branches={branches} value={field.value} onChange={field.onChange} />
            {fieldState.error?.message ? <Text style={styles.error}>{fieldState.error.message}</Text> : null}
          </>
        )}
      />
      <Controller
        control={control}
        name="is_active"
        render={({ field }) => (
          <SwitchField
            label="Active employee"
            description="Inactive employees cannot use protected app features."
            value={field.value}
            onValueChange={field.onChange}
          />
        )}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <AppButton label="Create employee" loading={loading} onPress={handleSubmit(onSubmit)} />
      {Object.keys(formState.errors).length > 0 ? (
        <Text style={styles.formHint}>Correct the highlighted fields and try again.</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.md },
  label: { color: colors.text, fontSize: 14, fontWeight: '600' },
  hint: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  error: { color: colors.danger, fontSize: 13 },
  formHint: { color: colors.danger, fontSize: 13, textAlign: 'center' },
});
