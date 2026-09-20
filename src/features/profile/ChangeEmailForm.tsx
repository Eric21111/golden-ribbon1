import { zodResolver } from '@hookform/resolvers/zod';
import type { ReactNode } from 'react';
import { useMemo, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';

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
  hintStyle?: StyleProp<TextStyle>;
  currentStyle?: StyleProp<TextStyle>;
  labelStyle?: StyleProp<TextStyle>;
  inputStyle?: StyleProp<TextStyle>;
  errorStyle?: StyleProp<TextStyle>;
  successStyle?: StyleProp<TextStyle>;
  buttonLabelStyle?: StyleProp<TextStyle>;
  accentColor?: string;
  /** Lets a role-specific design system (e.g. the Manager premium buttons) replace the default AppButton. */
  renderSubmitButton?: (args: { loading: boolean; disabled: boolean; onPress: () => void }) => ReactNode;
  renderCancelButton?: (args: { disabled: boolean; onPress: () => void }) => ReactNode;
};

export function ChangeEmailForm({
  currentEmail,
  onSuccess,
  onCancel,
  hintStyle,
  currentStyle,
  labelStyle,
  inputStyle,
  errorStyle,
  successStyle,
  buttonLabelStyle,
  accentColor,
  renderSubmitButton,
  renderCancelButton,
}: ChangeEmailFormProps) {
  const lock = useRef(false);
  const [success, setSuccess] = useState('');
  const [showPassword, setShowPassword] = useState(false);
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
      <Text style={[styles.hint, hintStyle]}>
        Updates the sign-in email for this account only. Role, branch, and historical records stay the same.
      </Text>
      <Text style={[styles.current, currentStyle]}>Current email: {currentEmail || 'Not available'}</Text>
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
            secureTextEntry={!showPassword}
            rightIcon={showPassword ? 'eye-outline' : 'eye-off-outline'}
            onRightIconPress={() => setShowPassword((prev) => !prev)}
            rightIconAccessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
            labelStyle={labelStyle}
            errorStyle={errorStyle}
            accentColor={accentColor}
            style={inputStyle}
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
            labelStyle={labelStyle}
            errorStyle={errorStyle}
            accentColor={accentColor}
            style={inputStyle}
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
            labelStyle={labelStyle}
            errorStyle={errorStyle}
            accentColor={accentColor}
            style={inputStyle}
          />
        )}
      />
      {formState.errors.root?.message ? (
        <Text style={[styles.error, errorStyle]}>{formState.errors.root.message}</Text>
      ) : null}
      {success ? <Text style={[styles.success, successStyle]}>{success}</Text> : null}
      {renderSubmitButton ? (
        renderSubmitButton({
          loading: formState.isSubmitting,
          disabled: formState.isSubmitting,
          onPress: handleSubmit(submit),
        })
      ) : (
        <AppButton
          label="Change email"
          loading={formState.isSubmitting}
          disabled={formState.isSubmitting}
          onPress={handleSubmit(submit)}
          labelStyle={buttonLabelStyle}
        />
      )}
      {onCancel ? (
        renderCancelButton ? (
          renderCancelButton({ disabled: formState.isSubmitting, onPress: onCancel })
        ) : (
          <AppButton
            label="Cancel"
            variant="secondary"
            disabled={formState.isSubmitting}
            onPress={onCancel}
            labelStyle={buttonLabelStyle}
          />
        )
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
