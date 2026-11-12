import { PinField } from '@/components/PinField';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, Text, View } from 'react-native';

import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { managerColors } from '@/components/dashboard/theme';
import { resetPasswordSchema, type ResetPasswordValues } from '@/features/employees/employeeSchemas';

type ResetPasswordFormProps = {
  employeeName: string;
  employeeEmail: string;
  error?: string;
  loading?: boolean;
  onSubmit: (values: ResetPasswordValues) => void;
};

export function ResetPasswordForm({
  employeeName,
  employeeEmail,
  error,
  loading,
  onSubmit,
}: ResetPasswordFormProps) {
  const { control, handleSubmit } = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: '', confirm_password: '' },
  });

  return (
    <View style={styles.form}>
      <Text style={styles.subtitle}>
        {employeeName} · {employeeEmail}
      </Text>
      <Text style={styles.notice}>This replaces the employee&apos;s PIN.</Text>
      <Controller
        control={control}
        name="password"
        render={({ field, fieldState }) => (
          <PinField label="New PIN" value={field.value} onChangeText={field.onChange} error={fieldState.error?.message} />
        )}
      />
      <Controller
        control={control}
        name="confirm_password"
        render={({ field, fieldState }) => (
          <PinField label="Confirm PIN" value={field.value} onChangeText={field.onChange} error={fieldState.error?.message} />
        )}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <ManagerActionButton label="Reset PIN" loading={loading} onPress={handleSubmit(onSubmit)} />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: 16 },
  subtitle: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  notice: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21 },
  error: { color: '#B91C1C', fontFamily: 'Inter_500Medium', fontSize: 13 },
  fieldLabel: { fontFamily: 'Inter_600SemiBold', color: managerColors.ink },
  fieldInput: { fontFamily: 'Inter_400Regular' },
  fieldError: { fontFamily: 'Inter_500Medium' },
});
