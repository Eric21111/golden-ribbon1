import { zodResolver } from '@hookform/resolvers/zod';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { ErrorState, LoadingState } from '@/components/Feedback';
import { FormField } from '@/components/FormField';
import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';
import { SwitchField } from '@/components/SwitchField';
import { colors, radius, spacing } from '@/constants/theme';
import { ChoiceChips } from '@/features/employees/ChoiceChips';
import { editEmployeeSchema, type EditEmployeeValues } from '@/features/employees/employeeSchemas';
import { BranchSelector } from '@/features/inventory/BranchSelector';
import { useBranches } from '@/hooks/useBranches';
import { useEmployees, useUpdateEmployee } from '@/hooks/useEmployees';
import { getEmployeeErrorMessage } from '@/lib/errors';

export default function EditEmployeeScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : '';
  const employees = useEmployees();
  const branches = useBranches();
  const mutation = useUpdateEmployee();
  const initialized = useRef(false);
  const employee = employees.data?.find((item) => item.id === id);
  const { control, handleSubmit, reset, formState } = useForm<EditEmployeeValues>({
    resolver: zodResolver(editEmployeeSchema),
    defaultValues: { full_name: '', role: 'cashier', branch_id: '', is_active: true },
  });

  useEffect(() => {
    if (employee && !initialized.current) {
      reset({ full_name: employee.full_name, role: employee.role, branch_id: employee.branch_id, is_active: employee.is_active });
      initialized.current = true;
    }
  }, [employee, reset]);

  const sellingBranches = branches.data?.filter((branch) => !branch.is_main_branch && branch.is_active) ?? [];
  const submit = (values: EditEmployeeValues) => mutation.mutate({
    id,
    fullName: values.full_name.trim(),
    role: values.role,
    branchId: values.branch_id,
    isActive: values.is_active,
  }, { onSuccess: () => router.back() });

  if (employees.isLoading || branches.isLoading) return <LoadingState label="Loading employee…" />;
  if (employees.error || branches.error) return <Screen><ErrorState message={getEmployeeErrorMessage(employees.error ?? branches.error)} onRetry={() => { void employees.refetch(); void branches.refetch(); }} /></Screen>;
  if (!employee) return <Screen><ErrorState message="Employee account was not found." /></Screen>;

  return (
    <Screen>
      <PageHeader title="Edit Employee" subtitle="Branch and role changes affect future access only." />
      <View style={styles.readOnly}>
        <Text style={styles.readOnlyLabel}>Email</Text>
        <Text style={styles.readOnlyValue}>{employee.email}</Text>
      </View>
      <Controller control={control} name="full_name" render={({ field, fieldState }) => <FormField label="Full Name" autoCapitalize="words" value={field.value} onBlur={field.onBlur} onChangeText={field.onChange} error={fieldState.error?.message} />} />
      <Controller control={control} name="role" render={({ field }) => <ChoiceChips label="Role" value={field.value} onChange={field.onChange} choices={[{ label: 'Manager', value: 'manager' }, { label: 'Cashier', value: 'cashier' }]} />} />
      <Text style={styles.label}>Assigned Branch</Text>
      <Controller control={control} name="branch_id" render={({ field, fieldState }) => <><BranchSelector branches={sellingBranches} value={field.value} onChange={field.onChange} />{fieldState.error?.message ? <Text style={styles.error}>{fieldState.error.message}</Text> : null}</>} />
      <Controller control={control} name="is_active" render={({ field }) => <SwitchField label="Active employee" description="Deactivation is blocked while the employee has an open shift." value={field.value} onValueChange={field.onChange} />} />
      {mutation.error ? <Text style={styles.error}>{getEmployeeErrorMessage(mutation.error)}</Text> : null}
      <AppButton label="Save Employee" loading={mutation.isPending} onPress={handleSubmit(submit)} />
      <AppButton label="Reset Password" variant="secondary" disabled={mutation.isPending} onPress={() => router.push({ pathname: '/owner/employees/[id]/reset-password', params: { id } })} />
      {Object.keys(formState.errors).length > 0 ? <Text style={styles.formHint}>Correct the highlighted fields and try again.</Text> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  readOnly: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, gap: spacing.xs },
  readOnlyLabel: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  readOnlyValue: { color: colors.text, fontSize: 16 },
  label: { color: colors.text, fontSize: 14, fontWeight: '600' },
  error: { color: colors.danger, fontSize: 13 },
  formHint: { color: colors.danger, fontSize: 13, textAlign: 'center' },
});
