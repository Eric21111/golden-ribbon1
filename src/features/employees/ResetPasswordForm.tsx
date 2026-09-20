import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, Text, View } from 'react-native';

import { FormField } from '@/components/FormField';
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
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
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
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="newPassword"
            autoComplete="new-password"
            secureTextEntry={!showPassword}
            rightIcon={showPassword ? 'eye-outline' : 'eye-off-outline'}
            onRightIconPress={() => setShowPassword((prev) => !prev)}
            rightIconAccessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
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
      <Controller
        control={control}
        name="confirm_password"
        render={({ field, fieldState }) => (
          <FormField
            label="Confirm Temporary Password"
            placeholder="Re-enter temporary password"
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="newPassword"
            autoComplete="new-password"
            secureTextEntry={!showConfirm}
            rightIcon={showConfirm ? 'eye-outline' : 'eye-off-outline'}
            onRightIconPress={() => setShowConfirm((prev) => !prev)}
            rightIconAccessibilityLabel={showConfirm ? 'Hide password' : 'Show password'}
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
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <ManagerActionButton label="Reset password" loading={loading} onPress={handleSubmit(onSubmit)} />
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
