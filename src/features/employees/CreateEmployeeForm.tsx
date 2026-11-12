import { PinField } from '@/components/PinField';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useRef } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, Text, View } from 'react-native';

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
 * Two short sections, ACCOUNT (who) and ACCESS (what they can do): no explanation paragraphs, no placeholders that repeat the labels,
 * and Cancel | Create side by side like the other sheets.
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
        <Text style={styles.sectionTitle}>ACCOUNT</Text>
        <Controller
          control={control}
          name="full_name"
          render={({ field, fieldState }) => (
            <FormField
              label="Full name"
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
            <PinField label="PIN" value={field.value} onChangeText={field.onChange} error={fieldState.error?.message} />
          )}
        />
        <Controller control={control} name="confirm_password" render={({field, fieldState}) => (
          <PinField label="Confirm PIN" value={field.value} onChangeText={field.onChange} error={fieldState.error?.message} />
        )} />
        {formState.errors.password?.message ? null : <Text style={styles.hint}>Six digits.</Text>}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>ACCESS</Text>
        <View style={styles.group}>
          <Text style={styles.label}>Role</Text>
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
          <Text style={styles.label}>Branch</Text>
          <Controller
            control={control}
            name="branch_id"
            render={({ field, fieldState }) => (
              <>
                <BranchSelector branches={assignableBranches} value={field.value} onChange={field.onChange} />
                {fieldState.error?.message ? <Text style={styles.error}>{fieldState.error.message}</Text> : null}
              </>
            )}
          />
        </View>
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
            onPress={handleSubmit((values) => {
              if (locked.current || loading) return;
              locked.current = true;
              onSubmit(values);
            })}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: 22 },
  section: { gap: 14 },
  sectionTitle: { color: managerColors.subtext, fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 0.6 },
  group: { gap: 8 },
  label: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  hint: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12.5, lineHeight: 18, marginTop: -8 },
  error: { color: '#B91C1C', fontFamily: 'Inter_500Medium', fontSize: 13 },
  formHint: { color: '#B91C1C', fontFamily: 'Inter_500Medium', fontSize: 13, textAlign: 'center' },
  fieldLabel: { fontFamily: 'Inter_600SemiBold', color: managerColors.ink },
  fieldInput: { fontFamily: 'Inter_400Regular' },
  fieldError: { fontFamily: 'Inter_500Medium' },
  switchDescription: { fontFamily: 'Inter_400Regular' },
  actions: { flexDirection: 'row', gap: 10 },
  action: { flex: 1 },
});
