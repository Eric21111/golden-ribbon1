import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { FormField } from '@/components/FormField';
import { colors, spacing } from '@/constants/theme';
import { useAuth } from '@/features/auth/AuthProvider';
import { changeNameSchema, type ChangeNameValues } from '@/features/profile/changeNameSchema';
import { queryKeys } from '@/lib/queryKeys';
import { getChangeNameErrorMessage } from '@/lib/errors';
import { changeOwnName } from '@/services/accountService';
import type { ProfileWithBranch } from '@/types/models';

type ChangeNameFormProps = {
  currentName: string;
  onSuccess?: () => void;
  onCancel?: () => void;
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

export function ChangeNameForm({
  currentName,
  onSuccess,
  onCancel,
  labelStyle,
  inputStyle,
  errorStyle,
  successStyle,
  buttonLabelStyle,
  accentColor,
  renderSubmitButton,
  renderCancelButton,
}: ChangeNameFormProps) {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const lock = useRef(false);
  const [success, setSuccess] = useState('');
  const schema = useMemo(() => changeNameSchema(currentName), [currentName]);
  const { control, handleSubmit, reset, setError, formState } = useForm<ChangeNameValues>({
    resolver: zodResolver(schema),
    defaultValues: { full_name: currentName },
  });

  useEffect(() => {
    if (!success || !onSuccess) return undefined;
    const timer = setTimeout(() => onSuccess(), 900);
    return () => clearTimeout(timer);
  }, [success, onSuccess]);

  const submit = async (values: ChangeNameValues) => {
    if (lock.current) return;
    lock.current = true;
    setSuccess('');
    try {
      const fullName = await changeOwnName(values.full_name);
      const userId = session?.user.id;
      if (userId) {
        queryClient.setQueryData<ProfileWithBranch | undefined>(
          queryKeys.profile(userId),
          (prev) => (prev ? { ...prev, full_name: fullName } : prev),
        );
        void queryClient.invalidateQueries({ queryKey: queryKeys.profile(userId) });
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.employees });
      reset({ full_name: fullName });
      setSuccess('Name updated.');
    } catch (error) {
      setError('root', { message: getChangeNameErrorMessage(error) });
    } finally {
      lock.current = false;
    }
  };

  return (
    <View style={styles.form}>
      <Controller
        control={control}
        name="full_name"
        render={({ field, fieldState }) => (
          <FormField
            label="Full name"
            value={field.value}
            onBlur={field.onBlur}
            onChangeText={field.onChange}
            error={fieldState.error?.message}
            autoCapitalize="words"
            autoCorrect={false}
            autoComplete="name"
            textContentType="name"
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
              label="Save"
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
  actions: { flexDirection: 'row', gap: spacing.sm },
  action: { flex: 1 },
  error: { color: colors.danger, fontSize: 14, lineHeight: 20 },
  success: { color: colors.success, fontSize: 14, lineHeight: 20, fontWeight: '700' },
});
