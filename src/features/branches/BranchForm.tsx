import Ionicons from '@react-native-vector-icons/ionicons';
import { zodResolver } from '@hookform/resolvers/zod';
import { useImperativeHandle, useState, type Ref } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, Text, View } from 'react-native';

import { FormField } from '@/components/FormField';
import { SwitchField } from '@/components/SwitchField';
import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { managerColors } from '@/components/dashboard/theme';
import { branchSchema, type BranchFormValues } from './branchSchema';

/** What happened when the form was asked to save as it closes. */
export type BranchFlushResult = 'unchanged' | 'saved' | 'invalid' | 'failed';

export interface BranchFormHandle {
  /** Save as the sheet closes: nothing changed = nothing sent; invalid or failed = stay open and say so. */
  flush: () => Promise<BranchFlushResult>;
}

interface BranchFormProps {
  defaultValues?: BranchFormValues;
  error?: string;
  loading?: boolean;
  /** Required unless `autoSave`. */
  submitLabel?: string;
  hideMainToggle?: boolean;
  protectMainBranch?: boolean;
  /** No Save button: the changes are saved when the sheet closes (through `ref.flush`). `onSubmit` must resolve when saved and reject when not. */
  autoSave?: boolean;
  /** Shows Cancel next to the submit button (Cancel | Create), like Create employee. */
  onCancel?: () => void;
  ref?: Ref<BranchFormHandle>;
  onSubmit: (values: BranchFormValues) => void | Promise<unknown>;
}

export function BranchForm({
  defaultValues,
  error,
  loading,
  submitLabel = 'Save',
  hideMainToggle = false,
  protectMainBranch = false,
  autoSave = false,
  onCancel,
  ref,
  onSubmit,
}: BranchFormProps) {
  const { control, handleSubmit, watch, formState } = useForm<BranchFormValues>({
    resolver: zodResolver(branchSchema),
    defaultValues: defaultValues ?? {
      name: '',
      code: '',
      address: '',
      is_main_branch: false,
      is_active: true,
      receiving_mode: 'cashier_confirm',
    },
  });
  const isMainBranch = watch('is_main_branch');
  const [blocked, setBlocked] = useState<'invalid' | 'failed' | null>(null);

  const send = (values: BranchFormValues) =>
    onSubmit({
      ...values,
      receiving_mode: values.is_main_branch ? values.receiving_mode : 'cashier_confirm',
    });

  useImperativeHandle(ref, () => ({
    flush: async () => {
      if (!formState.isDirty) return 'unchanged';
      let result: BranchFlushResult = 'invalid';
      await handleSubmit(
        async (values) => {
          try {
            await send(values);
            result = 'saved';
          } catch {
            result = 'failed';
          }
        },
        () => {
          result = 'invalid';
        },
      )();
      setBlocked(result === 'invalid' || result === 'failed' ? result : null);
      return result;
    },
  }));

  const status = loading
    ? { icon: 'sync-outline' as const, text: 'Saving…', color: managerColors.subtext }
    : blocked
      ? { icon: 'alert-circle-outline' as const, text: blocked === 'invalid' ? 'Not saved. Fix the highlighted fields, or close again to discard.' : 'Not saved. Try closing again, or close twice to discard.', color: '#B91C1C' }
      : null; // nothing to say when idle or while editing: the changes are saved when the sheet closes

  return (
    <View style={styles.form}>
      {autoSave && status ? (
        <View style={styles.status} accessibilityLiveRegion="polite">
          <Ionicons name={status.icon} size={16} color={status.color} />
          <Text style={[styles.statusText, { color: status.color }]}>{status.text}</Text>
        </View>
      ) : null}
      <Controller control={control} name="name" render={({ field, fieldState }) => (
        <FormField
          label="Branch name"
          required
          value={field.value}
          onBlur={field.onBlur}
          onChangeText={(text) => {
            setBlocked(null);
            field.onChange(text);
          }}
          error={fieldState.error?.message}
          autoCapitalize="words"
          labelStyle={styles.fieldLabel}
          errorStyle={styles.fieldError}
          accentColor={managerColors.royalBlue}
          style={styles.fieldInput}
        />
      )} />
      <Controller control={control} name="code" render={({ field, fieldState }) => (
        <FormField
          label="Branch code"
          required
          value={field.value}
          onBlur={field.onBlur}
          onChangeText={(text) => {
            setBlocked(null);
            field.onChange(text);
          }}
          error={fieldState.error?.message}
          autoCapitalize="characters"
          placeholder="e.g. BR-01"
          labelStyle={styles.fieldLabel}
          errorStyle={styles.fieldError}
          accentColor={managerColors.royalBlue}
          style={styles.fieldInput}
        />
      )} />
      <Controller control={control} name="address" render={({ field, fieldState }) => (
        <FormField
          label="Address (optional)"
          value={field.value ?? ''}
          onBlur={field.onBlur}
          onChangeText={field.onChange}
          error={fieldState.error?.message}
          multiline
          numberOfLines={2}
          textAlignVertical="top"
          labelStyle={styles.fieldLabel}
          errorStyle={styles.fieldError}
          accentColor={managerColors.royalBlue}
          style={styles.fieldInput}
        />
      )} />
      {hideMainToggle ? null : (
        <View style={styles.card}>
          <Controller control={control} name="is_main_branch" render={({ field }) => (
            <SwitchField
              label="Main Branch"
              description="Only one branch can be the Main Branch."
              value={field.value}
              onValueChange={field.onChange}
              labelStyle={styles.fieldLabel}
              descriptionStyle={styles.switchDescription}
              activeTrackColor={managerColors.royalBlue}
            />
          )} />
        </View>
      )}
      {protectMainBranch || isMainBranch ? null : (
        <View style={styles.card}>
          <Controller control={control} name="is_active" render={({ field }) => (
            <SwitchField
              label="Active"
              description="Inactive branches remain available for historical records."
              value={field.value}
              onValueChange={field.onChange}
              labelStyle={styles.fieldLabel}
              descriptionStyle={styles.switchDescription}
              activeTrackColor={managerColors.royalBlue}
            />
          )} />
        </View>
      )}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {autoSave ? null : (
        <View style={styles.actions}>
          {onCancel ? (
            <View style={styles.action}>
              <ManagerActionButton label="Cancel" variant="secondary" disabled={loading} onPress={onCancel} />
            </View>
          ) : null}
          <View style={styles.action}>
            <ManagerActionButton label={submitLabel} loading={loading} onPress={handleSubmit((values) => void send(values))} />
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: 14, paddingBottom: 8 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusText: { fontFamily: 'Inter_500Medium', fontSize: 13, flexShrink: 1 },
  card: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
  },
  error: { color: '#B91C1C', fontFamily: 'Inter_500Medium', fontSize: 14, lineHeight: 20 },
  actions: { flexDirection: 'row', gap: 10 },
  action: { flex: 1 },
  fieldLabel: { fontFamily: 'Inter_600SemiBold', color: managerColors.ink },
  fieldInput: { fontFamily: 'Inter_400Regular' },
  fieldError: { fontFamily: 'Inter_500Medium' },
  switchDescription: { fontFamily: 'Inter_400Regular' },
});
