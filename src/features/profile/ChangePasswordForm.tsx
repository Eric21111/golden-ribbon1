import { PinField } from '@/components/PinField';
import { useSheetScrollToTop } from '@/components/BottomSheet';
import { zodResolver } from '@hookform/resolvers/zod';
import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { managerColors } from '@/components/dashboard/theme';
import { colors, spacing } from '@/constants/theme';
import {
  currentPinStepSchema,
  newPinStepSchema,
  type ChangePasswordValues,
} from '@/features/profile/changePasswordSchema';
import { getChangePasswordErrorMessage } from '@/lib/errors';
import { changeOwnPassword, verifyOwnPassword } from '@/services/accountService';

type ButtonRenderArgs = {
  loading?: boolean;
  disabled: boolean;
  onPress: () => void;
  label: string;
};

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
  renderSubmitButton?: (args: ButtonRenderArgs) => ReactNode;
  renderCancelButton?: (args: ButtonRenderArgs) => ReactNode;
};

export function ChangePasswordForm({
  onSuccess,
  onCancel,
  labelStyle,
  errorStyle,
  successStyle,
  buttonLabelStyle,
  accentColor = managerColors.royalBlue,
  renderSubmitButton,
  renderCancelButton,
}: ChangePasswordFormProps) {
  const scrollToTop = useSheetScrollToTop();
  const lock = useRef(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [verifying, setVerifying] = useState(false);
  const [success, setSuccess] = useState('');

  const { control, handleSubmit, reset, setError, clearErrors, getValues, formState } =
    useForm<ChangePasswordValues>({
      defaultValues: { current_password: '', new_password: '', confirm_password: '' },
    });

  useEffect(() => {
    if (!success || !onSuccess) return;
    const timer = setTimeout(() => onSuccess(), 900);
    return () => clearTimeout(timer);
  }, [success, onSuccess]);

  const continueFromCurrent = handleSubmit(async () => {
    if (lock.current) return;
    const parsed = currentPinStepSchema.safeParse({
      current_password: getValues('current_password'),
    });
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? 'Current PIN is required.';
      setError('current_password', { message });
      return;
    }

    lock.current = true;
    setVerifying(true);
    clearErrors();
    try {
      await verifyOwnPassword(parsed.data.current_password);
      setStep(2);
      scrollToTop();
    } catch (error) {
      const message = getChangePasswordErrorMessage(error);
      if (message === 'Current password is incorrect.') {
        setError('current_password', { message: 'Current PIN is incorrect.' });
      } else {
        setError('root', { message });
      }
    } finally {
      setVerifying(false);
      lock.current = false;
    }
  });

  const submitNewPin = handleSubmit(async (values) => {
    if (lock.current) return;
    const parsed = newPinStepSchema.safeParse(values);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const path = issue.path[0];
        if (path === 'new_password' || path === 'confirm_password') {
          setError(path, { message: issue.message });
        } else {
          setError('root', { message: issue.message });
        }
      }
      return;
    }

    lock.current = true;
    setSuccess('');
    clearErrors();
    try {
      await changeOwnPassword(parsed.data.current_password, parsed.data.new_password);
      reset({ current_password: '', new_password: '', confirm_password: '' });
      setStep(1);
      setSuccess('PIN updated.');
    } catch (error) {
      const message = getChangePasswordErrorMessage(error);
      if (message === 'Current password is incorrect.') {
        setStep(1);
        scrollToTop();
        setError('current_password', { message: 'Current PIN is incorrect.' });
      } else if (message === 'New password must be different from the current password.') {
        setError('new_password', { message: 'Choose a different PIN.' });
      } else {
        setError('root', { message });
      }
    } finally {
      lock.current = false;
    }
  });

  const busy = verifying || formState.isSubmitting;
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
    if (step === 1) void continueFromCurrent();
    else void submitNewPin();
  };

  return (
    <View style={styles.form}>
      <PinStepIndicator step={step} />

      {step === 1 ? (
        <Controller
          control={control}
          name="current_password"
          render={({ field, fieldState }) => (
            <PinField
              label="Current PIN"
              value={field.value}
              onChangeText={(next) => {
                field.onChange(next);
                clearErrors('current_password');
              }}
              error={fieldState.error?.message}
              allowPassword
              required
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
            name="new_password"
            render={({ field, fieldState }) => (
              <PinField
                label="New PIN"
                value={field.value}
                onChangeText={(next) => {
                  field.onChange(next);
                  clearErrors(['new_password', 'confirm_password']);
                }}
                error={fieldState.error?.message}
                required
                accentColor={accentColor}
                labelStyle={labelStyle}
                errorStyle={errorStyle}
              />
            )}
          />
          <Controller
            control={control}
            name="confirm_password"
            render={({ field, fieldState }) => (
              <PinField
                label="Confirm PIN"
                value={field.value}
                onChangeText={(next) => {
                  field.onChange(next);
                  clearErrors('confirm_password');
                }}
                error={fieldState.error?.message}
                required
                accentColor={accentColor}
                labelStyle={labelStyle}
                errorStyle={errorStyle}
              />
            )}
          />
        </View>
      )}

      {formState.errors.root?.message ? (
        <Text style={[styles.error, errorStyle]}>{formState.errors.root.message}</Text>
      ) : null}
      {success ? <Text style={[styles.success, successStyle]}>{success}</Text> : null}

      <View style={styles.actions}>
        {(onCancel || step === 2) ? (
          <View style={styles.action}>
            {renderCancelButton ? (
              renderCancelButton({ disabled: busy, onPress: onSecondary, label: secondaryLabel })
            ) : (
              <AppButton
                label={secondaryLabel}
                variant="secondary"
                disabled={busy}
                onPress={onSecondary}
                labelStyle={buttonLabelStyle}
              />
            )}
          </View>
        ) : null}
        <View style={styles.action}>
          {renderSubmitButton ? (
            renderSubmitButton({
              loading: busy,
              disabled: busy,
              onPress: onPrimary,
              label: primaryLabel,
            })
          ) : (
            <AppButton
              label={primaryLabel}
              loading={busy}
              disabled={busy}
              onPress={onPrimary}
              labelStyle={buttonLabelStyle}
            />
          )}
        </View>
      </View>
    </View>
  );
}

function PinStepIndicator({ step }: { step: 1 | 2 }) {
  const labels = { 1: 'Current PIN', 2: 'New PIN' } as const;
  const steps = [1, 2] as const;
  return (
    <View style={styles.indicatorWrap}>
      <View style={styles.indicatorRow}>
        {steps.map((id, index) => (
          <View key={id} style={styles.indicatorSegment}>
            <View style={[styles.indicatorDot, id <= step && styles.indicatorDotActive]}>
              <Text style={[styles.indicatorDotLabel, id <= step && styles.indicatorDotLabelActive]}>
                {index + 1}
              </Text>
            </View>
            {index < steps.length - 1 ? (
              <View style={[styles.indicatorLine, id < step && styles.indicatorLineActive]} />
            ) : null}
          </View>
        ))}
      </View>
      <Text style={styles.indicatorLabel}>{labels[step]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.md, width: '100%' },
  fields: { gap: spacing.md, width: '100%' },
  actions: { flexDirection: 'row', gap: spacing.sm, width: '100%' },
  action: { flex: 1, minWidth: 0 },
  error: { color: colors.danger, fontSize: 14, lineHeight: 20 },
  success: { color: colors.success, fontSize: 14, lineHeight: 20, fontWeight: '700' },
  indicatorWrap: { gap: 8, alignItems: 'center' },
  indicatorRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  indicatorSegment: { flexDirection: 'row', alignItems: 'center' },
  indicatorDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: managerColors.cardSurface,
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
  },
  indicatorDotActive: { backgroundColor: managerColors.royalBlue, borderColor: managerColors.royalBlue },
  indicatorDotLabel: { color: managerColors.subtext, fontFamily: 'Inter_700Bold', fontSize: 12 },
  indicatorDotLabelActive: { color: '#FFFFFF' },
  indicatorLine: { width: 48, height: 2, backgroundColor: managerColors.cardBorder, marginHorizontal: 4 },
  indicatorLineActive: { backgroundColor: managerColors.royalBlue },
  indicatorLabel: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 13 },
});
