import { PinField, type PinFieldHandle } from '@/components/PinField';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useRef } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { FormField } from '@/components/FormField';
import { SwitchField } from '@/components/SwitchField';
import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { managerColors } from '@/components/dashboard/theme';
import { RoleChoice } from '@/features/employees/RoleChoice';
import { createEmployeeSchema, type CreateEmployeeValues } from '@/features/employees/employeeSchemas';
import { BranchSelector } from '@/features/inventory/BranchSelector';
import type { Branch } from '@/types/models';

type CreateEmployeeFormProps = {
  branches: Branch[];
  error?: string;
  loading?: boolean;
  onSubmit: (values: CreateEmployeeValues) => void;
  onCancel?: () => void;
};

const ROLE_OPTIONS = [
  { label: 'Manager', value: 'manager' as const },
  { label: 'Cashier', value: 'cashier' as const },
];

/**
 * Same look as Edit employee: fields, Role and Branch choices and the Active card with one even gap, no section headings, no
 * placeholders that repeat the labels, and Cancel | Create side by side. (Create keeps its button: it makes a new account.)
 */
export function CreateEmployeeForm({ branches, error, loading, onSubmit, onCancel }: CreateEmployeeFormProps) {
  const { control, handleSubmit, formState, watch, setValue } = useForm<CreateEmployeeValues>({
    resolver: zodResolver(createEmployeeSchema),
    defaultValues: {
      full_name: '',
      email: '',
      password: '',
      confirm_password: '',
      role: 'cashier',
      branch_id: '',
      is_active: true,
    },
  });
  const locked = useRef(false);
  const emailRef = useRef<TextInput>(null);
  const pinRef = useRef<PinFieldHandle>(null);
  const confirmRef = useRef<PinFieldHandle>(null);
  const submit = handleSubmit((values) => {
    if (locked.current || loading) return;
    locked.current = true;
    onSubmit(values);
  });
  useEffect(() => {
    if (!loading) locked.current = false;
  }, [loading]);
  const selectedRole = watch('role');
  const assignableBranches =
    selectedRole === 'cashier'
      ? branches.filter((branch) => !branch.is_main_branch)
      : branches.filter((branch) => branch.is_main_branch);

  return (
    <View style={styles.form}>
      <View style={styles.section}>
        <Controller
          control={control}
          name="full_name"
          render={({ field, fieldState }) => (
            <FormField
              label="Full name"
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => emailRef.current?.focus()}
              required
              autoCapitalize="words"
              value={field.value}
              onBlur={field.onBlur}
              onChangeText={field.onChange}
              error={fieldState.error?.message}
              labelStyle={styles.fieldLabel}
              errorStyle={styles.fieldError}
              accentColor={managerColors.royalBlue}
              style={styles.fieldInput}
            />
          )}
        />
        <Controller
          control={control}
          name="email"
          render={({ field, fieldState }) => (
            <FormField
              label="Email"
              ref={emailRef}
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => pinRef.current?.focus()}
              required
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              value={field.value}
              onBlur={field.onBlur}
              onChangeText={field.onChange}
              error={fieldState.error?.message}
              labelStyle={styles.fieldLabel}
              errorStyle={styles.fieldError}
              accentColor={managerColors.royalBlue}
              style={styles.fieldInput}
            />
          )}
        />
        <Controller
          control={control}
          name="password"
          render={({ field, fieldState }) => (
            <PinField ref={pinRef} returnKeyType="next" onSubmitEditing={() => confirmRef.current?.focus()} disabled={loading} label="PIN" value={field.value} onChangeText={field.onChange} error={fieldState.error?.message} required compact />
          )}
        />
        <Controller control={control} name="confirm_password" render={({field, fieldState}) => (
          <PinField ref={confirmRef} onSubmitEditing={() => void submit()} disabled={loading} label="Confirm PIN" value={field.value} onChangeText={field.onChange} error={fieldState.error?.message} required compact />
        )} />
      </View>

      <View style={styles.section}>
        <View style={styles.group}>
          <Text style={styles.label}>Role<Text style={styles.required}> *</Text></Text>
          <Controller
            control={control}
            name="role"
            render={({ field }) => (
              <RoleChoice
                options={ROLE_OPTIONS}
                value={field.value}
                onChange={(value) => {
                  field.onChange(value);
                  const current = branches.find((branch) => branch.id === watch('branch_id'));
                  if (value === 'cashier' && current?.is_main_branch) setValue('branch_id', '');
                  if (value === 'manager' && current && !current.is_main_branch) setValue('branch_id', '');
                }}
              />
            )}
          />
        </View>
        <View style={styles.group}>
          <Text style={styles.label}>Branch<Text style={styles.required}> *</Text></Text>
          <Controller
            control={control}
            name="branch_id"
            render={({ field, fieldState }) => (
              <>
                <BranchSelector branches={assignableBranches} value={field.value} onChange={field.onChange} variant="card" />
                {fieldState.error?.message ? <Text style={styles.error}>{fieldState.error.message}</Text> : null}
              </>
            )}
          />
        </View>
        <View style={styles.card}>
          <Controller
            control={control}
            name="is_active"
            render={({ field }) => (
              <SwitchField
                label="Active"
                description="Inactive employees cannot use the app."
                value={field.value}
                onValueChange={field.onChange}
                labelStyle={styles.fieldLabel}
                descriptionStyle={styles.switchDescription}
                activeTrackColor={managerColors.royalBlue}
              />
            )}
          />
        </View>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {Object.keys(formState.errors).length > 0 ? <Text style={styles.formHint}>Fix the highlighted fields.</Text> : null}
      <View style={styles.actions}>
        {onCancel ? (
          <View style={styles.action}>
            <ManagerActionButton label="Cancel" variant="secondary" disabled={loading} onPress={onCancel} />
          </View>
        ) : null}
        <View style={styles.action}>
          <ManagerActionButton
            label="Create"
            loading={loading}
            onPress={() => void submit()}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: 14, paddingBottom: 8 },
  section: { gap: 14 },
  card: { paddingHorizontal: 14, paddingVertical: 6, borderWidth: 1, borderColor: managerColors.cardBorder, borderRadius: 14, backgroundColor: '#FFFFFF' },
  group: { gap: 8 },
  label: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  required: { color: '#B91C1C', fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  error: { color: '#B91C1C', fontFamily: 'Inter_500Medium', fontSize: 13 },
  formHint: { color: '#B91C1C', fontFamily: 'Inter_500Medium', fontSize: 13, textAlign: 'center' },
  fieldLabel: { fontFamily: 'Inter_600SemiBold', color: managerColors.ink },
  fieldInput: { fontFamily: 'Inter_400Regular' },
  fieldError: { fontFamily: 'Inter_500Medium' },
  switchDescription: { fontFamily: 'Inter_400Regular' },
  actions: { flexDirection: 'row', gap: 10 },
  action: { flex: 1 },
});
