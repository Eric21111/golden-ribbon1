import { zodResolver } from '@hookform/resolvers/zod';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, Text } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { FormField } from '@/components/FormField';
import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';
import { colors } from '@/constants/theme';
import { changePasswordSchema, type ChangePasswordValues } from '@/features/profile/changePasswordSchema';
import { getChangePasswordErrorMessage } from '@/lib/errors';
import { changeOwnPassword } from '@/services/accountService';

export function ChangePasswordScreen() {
  const lock = useRef(false);
  const [success, setSuccess] = useState('');
  const { control, handleSubmit, reset, setError, formState } = useForm<ChangePasswordValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { current_password: '', new_password: '', confirm_password: '' },
  });

  const submit = async (values: ChangePasswordValues) => {
    if (lock.current) return;
    lock.current = true;
    setSuccess('');
    try {
      await changeOwnPassword(values.current_password, values.new_password);
      reset({ current_password: '', new_password: '', confirm_password: '' });
      setSuccess('Password changed successfully.');
    } catch (error) {
      const message = getChangePasswordErrorMessage(error);
      if (message === 'Current password is incorrect.') {
        setError('current_password', { message });
      } else {
        setError('root', { message });
      }
    } finally {
      lock.current = false;
    }
  };

  return (
    <Screen>
      <PageHeader
        title="Change Password"
        subtitle="This updates the password for the account you are signed in with. Role and branch are not changed."
      />
      <Controller
        control={control}
        name="current_password"
        render={({ field, fieldState }) => (
          <FormField
            label="Current Password"
            value={field.value}
            onBlur={field.onBlur}
            onChangeText={field.onChange}
            error={fieldState.error?.message}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="current-password"
            textContentType="password"
            secureTextEntry
          />
        )}
      />
      <Controller
        control={control}
        name="new_password"
        render={({ field, fieldState }) => (
          <FormField
            label="New Password"
            value={field.value}
            onBlur={field.onBlur}
            onChangeText={field.onChange}
            error={fieldState.error?.message}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="new-password"
            textContentType="newPassword"
            secureTextEntry
          />
        )}
      />
      <Controller
        control={control}
        name="confirm_password"
        render={({ field, fieldState }) => (
          <FormField
            label="Confirm New Password"
            value={field.value}
            onBlur={field.onBlur}
            onChangeText={field.onChange}
            error={fieldState.error?.message}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="new-password"
            textContentType="newPassword"
            secureTextEntry
          />
        )}
      />
      {formState.errors.root?.message ? <Text style={styles.error}>{formState.errors.root.message}</Text> : null}
      {success ? <Text style={styles.success}>{success}</Text> : null}
      <AppButton
        label="Change Password"
        loading={formState.isSubmitting}
        disabled={formState.isSubmitting}
        onPress={handleSubmit(submit)}
      />
      <AppButton
        label="Cancel"
        variant="secondary"
        disabled={formState.isSubmitting}
        onPress={() => router.back()}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  error: { color: colors.danger, fontSize: 14, lineHeight: 20 },
  success: { color: colors.success, fontSize: 14, lineHeight: 20, fontWeight: '700' },
});
