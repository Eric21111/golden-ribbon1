import { zodResolver } from '@hookform/resolvers/zod';
import { router } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { Alert, StyleSheet, Text } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { ErrorState, LoadingState } from '@/components/Feedback';
import { FormField } from '@/components/FormField';
import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';
import { SwitchField } from '@/components/SwitchField';
import { colors } from '@/constants/theme';
import { ChoiceChips } from '@/features/employees/ChoiceChips';
import { createEmployeeSchema, type CreateEmployeeValues } from '@/features/employees/employeeSchemas';
import { BranchSelector } from '@/features/inventory/BranchSelector';
import { useBranches } from '@/hooks/useBranches';
import { useCreateEmployee } from '@/hooks/useEmployees';
import { getEmployeeErrorMessage } from '@/lib/errors';

export default function CreateEmployeeScreen() {
  const branches = useBranches();
  const mutation = useCreateEmployee();
  const { control, handleSubmit, formState } = useForm<CreateEmployeeValues>({
    resolver: zodResolver(createEmployeeSchema),
    defaultValues: { full_name: '', email: '', password: '', role: 'cashier', branch_id: '', is_active: true },
  });
  const sellingBranches = branches.data?.filter((branch) => !branch.is_main_branch && branch.is_active) ?? [];

  const submit = (values: CreateEmployeeValues) => mutation.mutate({
    fullName: values.full_name.trim(),
    email: values.email.trim().toLowerCase(),
    password: values.password,
    role: values.role,
    branchId: values.branch_id,
    isActive: values.is_active,
  }, {
    onSuccess: () => {
      Alert.alert('Employee created', 'The employee can now sign in with the email and temporary password.');
      router.back();
    },
  });

  if (branches.isLoading) return <LoadingState label="Loading branches…" />;
  if (branches.error) return <Screen><ErrorState message="Unable to load selling branches." onRetry={() => void branches.refetch()} /></Screen>;

  return (
    <Screen>
      <PageHeader title="Create Employee" subtitle="Create a Manager or Cashier Supabase Auth account." />
      <Controller control={control} name="full_name" render={({ field, fieldState }) => <FormField label="Full Name" autoCapitalize="words" value={field.value} onBlur={field.onBlur} onChangeText={field.onChange} error={fieldState.error?.message} />} />
      <Controller control={control} name="email" render={({ field, fieldState }) => <FormField label="Email" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" value={field.value} onBlur={field.onBlur} onChangeText={field.onChange} error={fieldState.error?.message} />} />
      <Controller control={control} name="password" render={({ field, fieldState }) => <FormField label="Temporary Password" secureTextEntry value={field.value} onBlur={field.onBlur} onChangeText={field.onChange} error={fieldState.error?.message} />} />
      <Text style={styles.hint}>Use 8–72 characters. The password is sent securely and is never stored in the app database.</Text>
      <Controller control={control} name="role" render={({ field }) => <ChoiceChips label="Role" value={field.value} onChange={field.onChange} choices={[{ label: 'Manager', value: 'manager' }, { label: 'Cashier', value: 'cashier' }]} />} />
      <Text style={styles.label}>Assigned Branch</Text>
      <Controller control={control} name="branch_id" render={({ field, fieldState }) => <><BranchSelector branches={sellingBranches} value={field.value} onChange={field.onChange} />{fieldState.error?.message ? <Text style={styles.error}>{fieldState.error.message}</Text> : null}</>} />
      <Controller control={control} name="is_active" render={({ field }) => <SwitchField label="Active employee" description="Inactive employees cannot use protected app features." value={field.value} onValueChange={field.onChange} />} />
      {mutation.error ? <Text style={styles.error}>{getEmployeeErrorMessage(mutation.error)}</Text> : null}
      <AppButton label="CREATE EMPLOYEE" loading={mutation.isPending} onPress={handleSubmit(submit)} />
      {Object.keys(formState.errors).length > 0 ? <Text style={styles.formHint}>Correct the highlighted fields and try again.</Text> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: { color: colors.text, fontSize: 14, fontWeight: '600' },
  hint: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  error: { color: colors.danger, fontSize: 13 },
  formHint: { color: colors.danger, fontSize: 13, textAlign: 'center' },
});
