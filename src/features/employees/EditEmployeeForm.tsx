import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { FormField } from '@/components/FormField';
import { SwitchField } from '@/components/SwitchField';
import { colors, radius, spacing } from '@/constants/theme';
import { ChoiceChips } from '@/features/employees/ChoiceChips';
import { editEmployeeSchema, type EditEmployeeValues } from '@/features/employees/employeeSchemas';
import { BranchSelector } from '@/features/inventory/BranchSelector';
import type { Branch, EmployeeRecord } from '@/types/models';

type EditEmployeeFormProps = {
  employee: EmployeeRecord;
  branches: Branch[];
  error?: string;
  loading?: boolean;
  onSubmit: (values: EditEmployeeValues) => void;
  onResetPassword?: () => void;
};

export function EditEmployeeForm({
  employee,
  branches,
  error,
  loading,
  onSubmit,
  onResetPassword,
}: EditEmployeeFormProps) {
  const { control, handleSubmit, reset, formState } = useForm<EditEmployeeValues>({
    resolver: zodResolver(editEmployeeSchema),
    defaultValues: {
      full_name: employee.full_name,
      role: employee.role,
      branch_id: employee.branch_id,
      is_active: employee.is_active,
    },
  });

  useEffect(() => {
    reset({
      full_name: employee.full_name,
      role: employee.role,
      branch_id: employee.branch_id,
      is_active: employee.is_active,
    });
  }, [employee, reset]);

  return (
    <View style={styles.form}>
      <View style={styles.readOnly}>
        <Text style={styles.readOnlyLabel}>Email</Text>
        <Text style={styles.readOnlyValue}>{employee.email}</Text>
      </View>
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
            description="Deactivation is blocked while the employee has an open shift."
            value={field.value}
            onValueChange={field.onChange}
          />
        )}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <AppButton label="Save employee" loading={loading} onPress={handleSubmit(onSubmit)} />
      {onResetPassword ? (
        <AppButton label="Reset password" variant="secondary" disabled={loading} onPress={onResetPassword} />
      ) : null}
      {Object.keys(formState.errors).length > 0 ? (
        <Text style={styles.formHint}>Correct the highlighted fields and try again.</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.md },
  readOnly: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  readOnlyLabel: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  readOnlyValue: { color: colors.text, fontSize: 16 },
  label: { color: colors.text, fontSize: 14, fontWeight: '600' },
  error: { color: colors.danger, fontSize: 13 },
  formHint: { color: colors.danger, fontSize: 13, textAlign: 'center' },
});
