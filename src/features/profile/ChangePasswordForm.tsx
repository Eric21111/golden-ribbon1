import { zodResolver } from '@hookform/resolvers/zod';
import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { FormField } from '@/components/FormField';
import { colors, spacing } from '@/constants/theme';
import { changePasswordSchema, type ChangePasswordValues } from '@/features/profile/changePasswordSchema';
import { getChangePasswordErrorMessage } from '@/lib/errors';
import { changeOwnPassword } from '@/services/accountService';

type ChangePasswordFormProps = {
  onSuccess?: () => void;
  onCancel?: () => void;
  hintStyle?: StyleProp<TextStyle>;
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

export function ChangePasswordForm({
  onSuccess,
  onCancel,
  hintStyle,
  labelStyle,
  inputStyle,
  errorStyle,
  successStyle,
  buttonLabelStyle,
  accentColor,
  renderSubmitButton,
  renderCancelButton,
}: ChangePasswordFormProps) {
  const lock = useRef(false);
  const [success, setSuccess] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const { control, handleSubmit, reset, setError, formState } = useForm<ChangePasswordValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { current_password: '', new_password: '', confirm_password: '' },
  });

  useEffect(() => {
    if (!success || !onSuccess) return;
    const timer = setTimeout(() => onSuccess(), 900);
    return () => clearTimeout(timer);
  }, [success, onSuccess]);

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
    <View style={styles.form}>
      <Text style={[styles.hint, hintStyle]}>
        Updates the password for this signed-in account. Role and branch are not changed.
      </Text>
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
            secureTextEntry={!showCurrent}
            rightIcon={showCurrent ? 'eye-outline' : 'eye-off-outline'}
            onRightIconPress={() => setShowCurrent((prev) => !prev)}
            rightIconAccessibilityLabel={showCurrent ? 'Hide current password' : 'Show current password'}
            labelStyle={labelStyle}
            errorStyle={errorStyle}
            accentColor={accentColor}
            style={inputStyle}
          />
        )}
      />
      <Controller
        control={control}
        name="new_password"
        render={({ field, fieldState }) => (
          <FormField
            label="New Password"
            placeholder="Enter new password"
            value={field.value}
            onBlur={field.onBlur}
            onChangeText={field.onChange}
            error={fieldState.error?.message}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="new-password"
            textContentType="newPassword"
            secureTextEntry={!showNew}
            rightIcon={showNew ? 'eye-outline' : 'eye-off-outline'}
            onRightIconPress={() => setShowNew((prev) => !prev)}
            rightIconAccessibilityLabel={showNew ? 'Hide new password' : 'Show new password'}
            labelStyle={labelStyle}
            errorStyle={errorStyle}
            accentColor={accentColor}
            style={inputStyle}
          />
        )}
      />
      <Controller
        control={control}
        name="confirm_password"
        render={({ field, fieldState }) => (
          <FormField
            label="Confirm New Password"
            placeholder="Re-enter new password"
            value={field.value}
            onBlur={field.onBlur}
            onChangeText={field.onChange}
            error={fieldState.error?.message}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="new-password"
            textContentType="newPassword"
            secureTextEntry={!showConfirm}
            rightIcon={showConfirm ? 'eye-outline' : 'eye-off-outline'}
            onRightIconPress={() => setShowConfirm((prev) => !prev)}
            rightIconAccessibilityLabel={showConfirm ? 'Hide confirm password' : 'Show confirm password'}
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
          label="Change password"
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
  error: { color: colors.danger, fontSize: 14, lineHeight: 20 },
  success: { color: colors.success, fontSize: 14, lineHeight: 20, fontWeight: '700' },
});
