import Ionicons from '@react-native-vector-icons/ionicons';
import { PinField } from '@/components/PinField';
import { useSheetScrollToTop } from '@/components/BottomSheet';
import { zodResolver } from '@hookform/resolvers/zod';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, Text, TextInput, View, type StyleProp, type TextStyle } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { FormField } from '@/components/FormField';
import { managerColors } from '@/components/dashboard/theme';
import { colors, spacing } from '@/constants/theme';
import { changeEmailSchema, type ChangeEmailValues } from '@/features/profile/changeEmailSchema';
import { currentPinStepSchema } from '@/features/profile/changePasswordSchema';
import { StepIndicator } from '@/features/profile/StepIndicator';
import { getChangeEmailErrorMessage, getChangePasswordErrorMessage } from '@/lib/errors';
import { changeOwnEmail, verifyOwnPassword, type ChangeOwnEmailResult } from '@/services/accountService';

type ButtonRenderArgs = { loading?: boolean; disabled: boolean; onPress: () => void; label: string };

type ChangeEmailFormProps = {
  currentEmail: string;
  onSuccess?: (result: ChangeOwnEmailResult) => void;
  /** Called about a second after the success message is shown (the sheet closes). */
  onDone?: () => void;
  onCancel?: () => void;
  labelStyle?: StyleProp<TextStyle>;
  errorStyle?: StyleProp<TextStyle>;
  successStyle?: StyleProp<TextStyle>;
  buttonLabelStyle?: StyleProp<TextStyle>;
  accentColor?: string;
  /** Lets a role-specific design system (e.g. the Manager premium buttons) replace the default AppButton. */
  renderSubmitButton?: (args: ButtonRenderArgs) => ReactNode;
  renderCancelButton?: (args: ButtonRenderArgs) => ReactNode;
};

/**
 * Change email, in two steps like Change PIN: 1 the current PIN (proves it is you), 2 the new email twice. The current email is
 * always shown (read-only). What is sent is unchanged: `changeOwnEmail(current password, new email)`.
 */
export function ChangeEmailForm({
  currentEmail,
  onSuccess,
  onDone,
  onCancel,
  labelStyle,
  errorStyle,
  successStyle,
  buttonLabelStyle,
  accentColor = managerColors.royalBlue,
  renderSubmitButton,
  renderCancelButton,
}: ChangeEmailFormProps) {
  const scrollToTop = useSheetScrollToTop();
  const lock = useRef(false);
  const emailRef = useRef<TextInput>(null);
  const confirmEmailRef = useRef<TextInput>(null);
  const focusNewEmail = useRef(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [verifying, setVerifying] = useState(false);
  const [success, setSuccess] = useState('');
  const schema = useMemo(() => changeEmailSchema(currentEmail), [currentEmail]);
  const { control, handleSubmit, reset, setError, clearErrors, getValues, formState } = useForm<ChangeEmailValues>({
    resolver: zodResolver(schema),
    defaultValues: { current_password: '', new_email: '', confirm_email: '' },
  });

  useEffect(() => {
    if (!success || !onDone) return;
    const timer = setTimeout(() => onDone(), 900);
    return () => clearTimeout(timer);
  }, [success, onDone]);

  const continueFromCurrent = async () => {
    if (lock.current) return;
    const parsed = currentPinStepSchema.safeParse({ current_password: getValues('current_password') });
    if (!parsed.success) {
      setError('current_password', { message: parsed.error.issues[0]?.message ?? 'Current PIN is required.' });
      return;
    }
    lock.current = true;
    setVerifying(true);
    clearErrors();
    try {
      await verifyOwnPassword(parsed.data.current_password);
      focusNewEmail.current = true;
      setStep(2);
      scrollToTop();
    } catch (error) {
      const message = getChangePasswordErrorMessage(error);
      if (message === 'Current PIN is incorrect.') setError('current_password', { message: 'Current PIN is incorrect.' });
      else setError('root', { message });
    } finally {
      setVerifying(false);
      lock.current = false;
    }
  };

  const submit = handleSubmit(async (values) => {
    if (lock.current) return;
    lock.current = true;
    setSuccess('');
    try {
      const result = await changeOwnEmail(values.current_password, values.new_email);
      reset({ current_password: '', new_email: '', confirm_email: '' });
      setSuccess(
        result.confirmed
          ? 'Your email has been updated.'
          : 'Verification has been sent to your email. Complete verification to finish changing your email.',
      );
      onSuccess?.(result);
    } catch (error) {
      const message = getChangeEmailErrorMessage(error);
      if (message === 'Current PIN is incorrect.') {
        setStep(1);
        scrollToTop();
        setError('current_password', { message: 'Current PIN is incorrect.' });
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
  });

  const busy = verifying || formState.isSubmitting || Boolean(success);
  useEffect(() => {
    if (step === 2 && !busy && focusNewEmail.current) {
      emailRef.current?.focus();
      focusNewEmail.current = false;
    }
  }, [step, busy]);
  const secondaryLabel = step === 1 ? 'Cancel' : 'Back';
  const primaryLabel = step === 1 ? 'Continue' : 'Update';
  const onSecondary = () => {
    if (busy) return;
    if (step === 2) {
      clearErrors();
      setStep(1);
      scrollToTop();
      return;
    }
    onCancel?.();
  };
  const onPrimary = () => {
    if (busy || lock.current) return;
    if (step === 1) void continueFromCurrent();
    else void submit();
  };

  return (
    <View style={styles.form}>
      <StepIndicator step={step} labels={{ 1: 'Current PIN', 2: 'New email' }} />

      <View style={styles.group}>
        <Text style={[styles.label, labelStyle]}>Current email</Text>
        <View style={styles.readOnly}>
          <Text style={styles.readOnlyValue} numberOfLines={1}>{currentEmail || 'Not available'}</Text>
          <Ionicons name="lock-closed-outline" size={16} color={managerColors.subtext} />
        </View>
      </View>

      {step === 1 ? (
        <Controller
          control={control}
          name="current_password"
          render={({ field, fieldState }) => (
            <PinField
              label="Current PIN"
              returnKeyType="next"
              disabled={busy}
              onSubmitEditing={onPrimary}
              value={field.value}
              onChangeText={(next) => {
                field.onChange(next);
                clearErrors('current_password');
              }}
              error={fieldState.error?.message}

              required
              compact
              accentColor={accentColor}
              labelStyle={labelStyle}
              errorStyle={errorStyle}
            />
          )}
        />
      ) : (
        <View style={styles.fields}>
          <Controller
            control={control}
            name="new_email"
            render={({ field, fieldState }) => (
              <FormField
                label="New email"
                required
                ref={emailRef}
                returnKeyType="next"
                submitBehavior="submit"
                onSubmitEditing={() => confirmEmailRef.current?.focus()}
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
              />
            )}
          />
          <Controller
            control={control}
            name="confirm_email"
            render={({ field, fieldState }) => (
              <FormField
                label="Confirm email"
                required
                ref={confirmEmailRef}
                returnKeyType="done"
                onSubmitEditing={onPrimary}
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
              />
            )}
          />
        </View>
      )}

      {formState.errors.root?.message ? <Text style={[styles.error, errorStyle]}>{formState.errors.root.message}</Text> : null}
      {success ? <Text style={[styles.success, successStyle]}>{success}</Text> : null}

      <View style={styles.actions}>
        {onCancel || step === 2 ? (
          <View style={styles.action}>
            {renderCancelButton ? (
              renderCancelButton({ disabled: busy, onPress: onSecondary, label: secondaryLabel })
            ) : (
              <AppButton label={secondaryLabel} variant="secondary" disabled={busy} onPress={onSecondary} labelStyle={buttonLabelStyle} />
            )}
          </View>
        ) : null}
        <View style={styles.action}>
          {renderSubmitButton ? (
            renderSubmitButton({ loading: verifying || formState.isSubmitting, disabled: busy, onPress: onPrimary, label: primaryLabel })
          ) : (
            <AppButton label={primaryLabel} loading={verifying || formState.isSubmitting} disabled={busy} onPress={onPrimary} labelStyle={buttonLabelStyle} />
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.md, paddingBottom: 8 },
  fields: { gap: spacing.md },
  group: { gap: 8 },
  label: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  readOnly: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 14,
    backgroundColor: managerColors.cardSurface,
  },
  readOnlyValue: { flex: 1, minWidth: 0, color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 15 },
  actions: { flexDirection: 'row', gap: spacing.sm },
  action: { flex: 1, minWidth: 0 },
  error: { color: colors.danger, fontSize: 14, lineHeight: 20 },
  success: { color: colors.success, fontSize: 14, lineHeight: 20, fontWeight: '700' },
});
