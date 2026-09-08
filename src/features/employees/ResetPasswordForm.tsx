import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { FormField } from '@/components/FormField';
import { colors, spacing } from '@/constants/theme';
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
      <Text style={styles.notice}>
        This replaces the employee's password. The existing password cannot be viewed.
      </Text>
      <Controller
        control={control}
        name="password"
        render={({ field, fieldState }) => (
          <FormField
            label="New Temporary Password"
            placeholder="Enter new temporary password"
            secureTextEntry
            value={field.value}
            onBlur={field.onBlur}
            onChangeText={field.onChange}
            error={fieldState.error?.message}
          />
        )}
      />
      <Controller
        control={control}
        name="confirm_password"
        render={({ field, fieldState }) => (
          <FormField
            label="Confirm Temporary Password"
            placeholder="Re-enter temporary password"
            secureTextEntry
            value={field.value}
            onBlur={field.onBlur}
            onChangeText={field.onChange}
            error={fieldState.error?.message}
          />
        )}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <AppButton label="Reset password" loading={loading} onPress={handleSubmit(onSubmit)} />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.md },
  subtitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  notice: { color: colors.muted, fontSize: 14, lineHeight: 21 },
  error: { color: colors.danger, fontSize: 13 },
});
