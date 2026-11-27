import { PinField, type PinFieldHandle } from '@/components/PinField';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, Text, View } from 'react-native';

import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { managerColors } from '@/components/dashboard/theme';
import { resetPasswordSchema, type ResetPasswordValues } from '@/features/employees/employeeSchemas';

type ResetPasswordFormProps = {
  employeeName: string;
  employeeEmail: string;
  error?: string;
  loading?: boolean;
  /** Must resolve when the PIN was reset and reject when it was not. */
  onSubmit: (values: ResetPasswordValues) => void | Promise<unknown>;
  onCancel?: () => void;
  /** Called about a second after "PIN reset." is shown (the sheet closes). */
  onSuccess?: () => void;
};

/** Same look as Change PIN in the account: PIN steps, required marks, Cancel | Reset PIN, a green message and the sheet closes. */
export function ResetPasswordForm({
  employeeName,
  employeeEmail,
  error,
  loading,
  onSubmit,
  onCancel,
  onSuccess,
}: ResetPasswordFormProps) {
  const { control, handleSubmit } = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: '', confirm_password: '' },
  });
  const [success, setSuccess] = useState(false);
  const locked = useRef(false);
  const confirmRef = useRef<PinFieldHandle>(null);

  useEffect(() => {
    if (!success || !onSuccess) return;
    const timer = setTimeout(() => onSuccess(), 900);
    return () => clearTimeout(timer);
  }, [success, onSuccess]);

  const submit = handleSubmit(async (values) => {
    if (locked.current || loading || success) return;
    locked.current = true;
    try {
      await onSubmit(values);
      setSuccess(true);
    } catch {
      // the error is shown by the screen that owns the request
    } finally {
      locked.current = false;
    }
  });

  const busy = Boolean(loading) || success;

  return (
    <View style={styles.form}>
      <View style={styles.who}>
        <Text style={styles.name} numberOfLines={1}>{employeeName}</Text>
        <Text style={styles.email} numberOfLines={1}>{employeeEmail}</Text>
      </View>
      <Controller
        control={control}
        name="password"
        render={({ field, fieldState }) => (
          <PinField returnKeyType="next" onSubmitEditing={() => confirmRef.current?.focus()} disabled={busy} label="New PIN" value={field.value} onChangeText={field.onChange} error={fieldState.error?.message} required compact />
        )}
      />
      <Controller
        control={control}
        name="confirm_password"
        render={({ field, fieldState }) => (
          <PinField ref={confirmRef} onSubmitEditing={() => { if (!busy) void submit(); }} disabled={busy} label="Confirm PIN" value={field.value} onChangeText={field.onChange} error={fieldState.error?.message} required compact />
        )}
      />
      {error && !success ? <Text style={styles.error}>{error}</Text> : null}
      {success ? <Text style={styles.success}>PIN reset. Give the new PIN privately to the employee.</Text> : null}
      <View style={styles.actions}>
        {onCancel ? (
          <View style={styles.action}>
            <ManagerActionButton label="Cancel" variant="secondary" disabled={busy} onPress={onCancel} />
          </View>
        ) : null}
        <View style={styles.action}>
          <ManagerActionButton label="Reset PIN" loading={Boolean(loading)} disabled={busy} onPress={() => void submit()} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: 14, paddingBottom: 8 },
  who: { gap: 2 },
  name: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 16 },
  email: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 13 },
  error: { color: '#B91C1C', fontFamily: 'Inter_500Medium', fontSize: 13 },
  success: { color: managerColors.green, fontFamily: 'Inter_700Bold', fontSize: 14, lineHeight: 20 },
  actions: { flexDirection: 'row', gap: 10 },
  action: { flex: 1 },
});
