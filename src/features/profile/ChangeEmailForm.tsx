import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { FormField } from '@/components/FormField';
import { colors, spacing } from '@/constants/theme';
import { changeEmailSchema, type ChangeEmailValues } from '@/features/profile/changeEmailSchema';
import { getChangeEmailErrorMessage } from '@/lib/errors';
import { changeOwnEmail, type ChangeOwnEmailResult } from '@/services/accountService';

type ChangeEmailFormProps = {
  currentEmail: string;
  onSuccess?: (result: ChangeOwnEmailResult) => void;
  onCancel?: () => void;
};

export function ChangeEmailForm({ currentEmail, onSuccess, onCancel }: ChangeEmailFormProps) {
  const lock = useRef(false);
  const [success, setSuccess] = useState('');
  const schema = useMemo(() => changeEmailSchema(currentEmail), [currentEmail]);
  const { control, handleSubmit, reset, setError, formState } = useForm<ChangeEmailValues>({
    resolver: zodResolver(schema),
    defaultValues: { current_password: '', new_email: '', confirm_email: '' },
  });

  const submit = async (values: ChangeEmailValues) => {
    if (lock.current) return;
    lock.current = true;
    setSuccess('');
    try {
      const result = await changeOwnEmail(values.current_password, values.new_email);
      reset({ current_password: '', new_email: '', confirm_email: '' });
      const message = result.confirmed
        ? 'Your email has been updated.'
        : 'Verification has been sent to your email. Complete verification to finish changing your email.';
      setSuccess(message);
      onSuccess?.(result);
    } catch (error) {
      const message = getChangeEmailErrorMessage(error);
      if (message === 'Current password is incorrect.') {
        setError('current_password', { message });
      } else if (message === 'New email must be different from the current email.') {
        setError('new_email', { message });
      } else if (message === 'Emails do not match.') {
        setError('confirm_email', { message });
      } else if (message === 'Enter a valid email address.' || message === 'That email is already registered.') {
        setError('new_email', { message });
      } else {
        setError('root', { message });
      }
    } finally {
      lock.current = false;
    }
  };

  return (
    <View style={styles.form}>
      <Text style={styles.hint}>
        Updates the sign-in email for this account only. Role, branch, and historical records stay the same.
      </Text>
      <Text style={styles.current}>Current email: {currentEmail || 'Not available'}</Text>
      <Controller
        control={control}
        name="current_password"
        render={({ field, fieldState }) => (
          <FormField
            label="Current Password"
            placeholder="Enter current password"
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
        name="new_email"
        render={({ field, fieldState }) => (
          <FormField
            label="New Email"
            placeholder="name@example.com"
            value={field.value}
            onBlur={field.onBlur}
            onChangeText={field.onChange}
            error={fieldState.error?.message}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            autoComplete="email"
            textContentType="emailAddress"
          />
        )}
      />
      <Controller
        control={control}
        name="confirm_email"
        render={({ field, fieldState }) => (
          <FormField
            label="Confirm New Email"
            placeholder="Re-enter new email"
            value={field.value}
            onBlur={field.onBlur}
            onChangeText={field.onChange}
            error={fieldState.error?.message}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            autoComplete="email"
            textContentType="emailAddress"
          />
        )}
      />
      {formState.errors.root?.message ? <Text style={styles.error}>{formState.errors.root.message}</Text> : null}
      {success ? <Text style={styles.success}>{success}</Text> : null}
      <AppButton
        label="Change email"
        loading={formState.isSubmitting}
        disabled={formState.isSubmitting}
        onPress={handleSubmit(submit)}
      />
      {onCancel ? (
        <AppButton label="Cancel" variant="secondary" disabled={formState.isSubmitting} onPress={onCancel} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.md },
  hint: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  current: { color: colors.text, fontSize: 14, fontWeight: '600' },
  error: { color: colors.danger, fontSize: 14, lineHeight: 20 },
  success: { color: colors.success, fontSize: 14, lineHeight: 20, fontWeight: '700' },
});
