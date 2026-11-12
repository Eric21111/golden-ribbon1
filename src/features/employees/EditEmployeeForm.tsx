import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, Text, View } from 'react-native';

import { FormField } from '@/components/FormField';
import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { managerColors } from '@/components/dashboard/theme';
import { RoleChoice } from '@/features/employees/RoleChoice';
import { editEmployeeSchema, type EditEmployeeValues } from '@/features/employees/employeeSchemas';
import { BranchSelector } from '@/features/inventory/BranchSelector';
import type { Branch, EmployeeRecord } from '@/types/models';

type EditEmployeeFormProps = {
  employee: EmployeeRecord;
  branches: Branch[];
  error?: string;
  loading?: boolean;
  togglingActive?: boolean;
  onSubmit: (values: EditEmployeeValues) => void;
  onResetPassword?: () => void;
  onToggleActive?: () => void;
};

const ROLE_OPTIONS = [
  { label: 'Manager', value: 'manager' as const },
  { label: 'Cashier', value: 'cashier' as const },
];

export function EditEmployeeForm({
  employee,
  branches,
  error,
  loading,
  togglingActive,
  onSubmit,
  onResetPassword,
  onToggleActive,
}: EditEmployeeFormProps) {
  const { control, handleSubmit, reset, formState, watch, setValue } = useForm<EditEmployeeValues>({
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

  const selectedRole = watch('role');
  const assignableBranches =
    selectedRole === 'cashier'
      ? branches.filter((branch) => !branch.is_main_branch)
      : branches.filter((branch) => branch.is_main_branch);

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
            label="Full name"
            autoCapitalize="words"
            value={field.value}
            onBlur={field.onBlur}
            onChangeText={field.onChange}
            error={fieldState.error?.message}
            labelStyle={styles.fieldLabel}
            errorStyle={styles.fieldError}
            accentColor={managerColors.royalBlue}
            style={styles.fieldInput}
          />
        )}
      />
      <View style={styles.group}>
        <Text style={styles.label}>Role</Text>
        <Controller
          control={control}
          name="role"
          render={({ field }) => (
            <RoleChoice
              options={ROLE_OPTIONS}
              value={field.value}
              onChange={(value) => {
                field.onChange(value);
                const current = branches.find((branch) => branch.id === watch('branch_id'));
                if (value === 'cashier' && current?.is_main_branch) setValue('branch_id', '');
                if (value === 'manager' && current && !current.is_main_branch) setValue('branch_id', '');
              }}
            />
          )}
        />
      </View>
      <View style={styles.group}>
        <Text style={styles.label}>Branch</Text>
        <Controller
          control={control}
          name="branch_id"
          render={({ field, fieldState }) => (
            <>
              <BranchSelector branches={assignableBranches} value={field.value} onChange={field.onChange} />
              {fieldState.error?.message ? <Text style={styles.error}>{fieldState.error.message}</Text> : null}
            </>
          )}
        />
      </View>
      <Text style={styles.statusHint}>
        {employee.is_active ? 'Active' : 'Inactive'}. Cannot be deactivated while there is an open shift.
      </Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {Object.keys(formState.errors).length > 0 ? <Text style={styles.formHint}>Fix the highlighted fields.</Text> : null}
      <View style={styles.actions}>
        {onResetPassword ? (
          <View style={styles.action}>
            <ManagerActionButton
              label="Reset PIN"
              variant="secondary"
              disabled={loading || togglingActive}
              onPress={onResetPassword}
            />
          </View>
        ) : null}
        <View style={styles.action}>
          <ManagerActionButton
            label="Save"
            loading={Boolean(loading) && !togglingActive}
            disabled={togglingActive}
            onPress={handleSubmit(onSubmit)}
          />
        </View>
      </View>
      {onToggleActive ? (
        <ManagerActionButton
          label={employee.is_active ? 'Deactivate' : 'Activate'}
          variant={employee.is_active ? 'danger' : 'secondary'}
          loading={togglingActive}
          disabled={loading}
          onPress={onToggleActive}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: 16 },
  group: { gap: 8 },
  readOnly: {
    backgroundColor: managerColors.cardSurface,
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 14,
    padding: 14,
    gap: 4,
  },
  readOnlyLabel: { color: managerColors.subtext, fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  readOnlyValue: { color: managerColors.ink, fontFamily: 'Inter_500Medium', fontSize: 15 },
  label: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  statusHint: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18 },
  error: { color: '#B91C1C', fontFamily: 'Inter_500Medium', fontSize: 13 },
  formHint: { color: '#B91C1C', fontFamily: 'Inter_500Medium', fontSize: 13, textAlign: 'center' },
  fieldLabel: { fontFamily: 'Inter_600SemiBold', color: managerColors.ink },
  fieldInput: { fontFamily: 'Inter_400Regular' },
  fieldError: { fontFamily: 'Inter_500Medium' },
  actions: { flexDirection: 'row', gap: 10 },
  action: { flex: 1 },
});
