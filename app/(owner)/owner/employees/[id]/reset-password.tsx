import { zodResolver } from '@hookform/resolvers/zod';
import { router, useLocalSearchParams } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { Alert, StyleSheet, Text } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { ErrorState, LoadingState } from '@/components/Feedback';
import { FormField } from '@/components/FormField';
import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';
import { colors } from '@/constants/theme';
import { resetPasswordSchema, type ResetPasswordValues } from '@/features/employees/employeeSchemas';
import { useEmployees, useResetEmployeePassword } from '@/hooks/useEmployees';
import { getEmployeeErrorMessage } from '@/lib/errors';

export default function ResetEmployeePasswordScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : '';
  const employees = useEmployees();
  const employee = employees.data?.find((item) => item.id === id);
  const mutation = useResetEmployeePassword();
  const { control, handleSubmit } = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: '', confirm_password: '' },
  });

  const submit = (values: ResetPasswordValues) => mutation.mutate({ employeeId: id, password: values.password }, {
    onSuccess: () => {
      Alert.alert('Password reset', 'Give the new temporary password to the employee through a secure channel.');
      router.back();
    },
  });

  if (employees.isLoading) return <LoadingState label="Loading employee…" />;
  if (employees.error) return <Screen><ErrorState message={getEmployeeErrorMessage(employees.error)} onRetry={() => void employees.refetch()} /></Screen>;
  if (!employee) return <Screen><ErrorState message="Employee account was not found." /></Screen>;

  return (
    <Screen>
      <PageHeader title="Reset Password" subtitle={`${employee.full_name} · ${employee.email}`} />
      <Text style={styles.notice}>This replaces the employee's password. The existing password cannot be viewed.</Text>
      <Controller control={control} name="password" render={({ field, fieldState }) => <FormField label="New Temporary Password" secureTextEntry value={field.value} onBlur={field.onBlur} onChangeText={field.onChange} error={fieldState.error?.message} />} />
      <Controller control={control} name="confirm_password" render={({ field, fieldState }) => <FormField label="Confirm Temporary Password" secureTextEntry value={field.value} onBlur={field.onBlur} onChangeText={field.onChange} error={fieldState.error?.message} />} />
      {mutation.error ? <Text style={styles.error}>{getEmployeeErrorMessage(mutation.error)}</Text> : null}
      <AppButton label="RESET PASSWORD" loading={mutation.isPending} onPress={handleSubmit(submit)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  notice: { color: colors.muted, fontSize: 14, lineHeight: 21 },
  error: { color: colors.danger, fontSize: 13 },
});
