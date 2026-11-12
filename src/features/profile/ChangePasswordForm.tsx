import { PinField } from '@/components/PinField';
import { zodResolver } from '@hookform/resolvers/zod';
import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';

import { AppButton } from '@/components/AppButton';
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
      setSuccess('PIN updated.');
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
      <Text style={hintStyle}>Changing this PIN affects everyone using this account.</Text>
      <Controller
        control={control}
        name="current_password"
        render={({ field, fieldState }) => (
          <PinField label="Current PIN" value={field.value} onChangeText={field.onChange} error={fieldState.error?.message} allowPassword />
        )}
      />
      <Controller
        control={control}
        name="new_password"
        render={({ field, fieldState }) => (
          <PinField label="New PIN" value={field.value} onChangeText={field.onChange} error={fieldState.error?.message} />
        )}
      />
      {formState.errors.new_password?.message ? null : (
        <Text style={[styles.hint, hintStyle]}>Six digits.</Text>
      )}
      <Controller
        control={control}
        name="confirm_password"
        render={({ field, fieldState }) => (
          <PinField label="Confirm PIN" value={field.value} onChangeText={field.onChange} error={fieldState.error?.message} />
        )}
      />
      {formState.errors.root?.message ? (
        <Text style={[styles.error, errorStyle]}>{formState.errors.root.message}</Text>
      ) : null}
      {success ? <Text style={[styles.success, successStyle]}>{success}</Text> : null}
      <View style={styles.actions}>
        {onCancel ? (
          <View style={styles.action}>
            {renderCancelButton ? (
              renderCancelButton({ disabled: formState.isSubmitting, onPress: onCancel })
            ) : (
              <AppButton
                label="Cancel"
                variant="secondary"
                disabled={formState.isSubmitting}
                onPress={onCancel}
                labelStyle={buttonLabelStyle}
              />
            )}
          </View>
        ) : null}
        <View style={styles.action}>
          {renderSubmitButton ? (
            renderSubmitButton({
              loading: formState.isSubmitting,
              disabled: formState.isSubmitting,
              onPress: handleSubmit(submit),
            })
          ) : (
            <AppButton
              label="Update"
              loading={formState.isSubmitting}
              disabled={formState.isSubmitting}
              onPress={handleSubmit(submit)}
              labelStyle={buttonLabelStyle}
            />
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.md },
  // sits right under the New password field, not a gap away from it
  hint: { color: colors.muted, fontSize: 13, lineHeight: 18, marginTop: -spacing.sm },
  actions: { flexDirection: 'row', gap: spacing.sm },
  action: { flex: 1 },
  error: { color: colors.danger, fontSize: 14, lineHeight: 20 },
  success: { color: colors.success, fontSize: 14, lineHeight: 20, fontWeight: '700' },
});
