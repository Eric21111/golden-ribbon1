import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, Text, View } from 'react-native';

import { FormField } from '@/components/FormField';
import { SwitchField } from '@/components/SwitchField';
import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { FilterChipRow } from '@/components/dashboard/FilterChipRow';
import { managerColors } from '@/components/dashboard/theme';
import { createEmployeeSchema, type CreateEmployeeValues } from '@/features/employees/employeeSchemas';
import { BranchSelector } from '@/features/inventory/BranchSelector';
import type { Branch } from '@/types/models';

type CreateEmployeeFormProps = {
  branches: Branch[];
  error?: string;
  loading?: boolean;
  onSubmit: (values: CreateEmployeeValues) => void;
};

const ROLE_OPTIONS = [
  { label: 'Manager', value: 'manager' as const },
  { label: 'Cashier', value: 'cashier' as const },
];

export function CreateEmployeeForm({ branches, error, loading, onSubmit }: CreateEmployeeFormProps) {
  const [showPassword, setShowPassword] = useState(false);
  const { control, handleSubmit, formState, watch, setValue } = useForm<CreateEmployeeValues>({
    resolver: zodResolver(createEmployeeSchema),
    defaultValues: {
      full_name: '',
      email: '',
      password: '',
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
    selectedRole === 'cashier' ? branches.filter((branch) => !branch.is_main_branch) : branches;

  return (
    <View style={styles.form}>
      <Controller
        control={control}
        name="full_name"
        render={({ field, fieldState }) => (
          <FormField
            label="Full Name"
            placeholder="Jane Doe"
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
            placeholder="name@example.com"
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
          <FormField
            label="Temporary Password"
            placeholder="8–72 characters"
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="newPassword"
            autoComplete="new-password"
            secureTextEntry={!showPassword}
            rightIcon={showPassword ? 'eye-outline' : 'eye-off-outline'}
            onRightIconPress={() => setShowPassword((prev) => !prev)}
            rightIconAccessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
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
      <Text style={styles.hint}>Use 8–72 characters. Password is never stored in the app database.</Text>
      <View style={styles.group}>
        <Text style={styles.label}>Role</Text>
        <Controller
          control={control}
          name="role"
          render={({ field }) => (
            <FilterChipRow
              options={ROLE_OPTIONS}
              value={field.value}
              onChange={(value) => {
                field.onChange(value);
                if (value === 'cashier') {
                  const current = branches.find((branch) => branch.id === watch('branch_id'));
                  if (current?.is_main_branch) setValue('branch_id', '');
                }
              }}
            />
          )}
        />
      </View>
      <View style={styles.group}>
        <Text style={styles.label}>Assigned Branch</Text>
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
            label="Active employee"
            description="Inactive employees cannot use protected app features."
            value={field.value}
            onValueChange={field.onChange}
            labelStyle={styles.fieldLabel}
            descriptionStyle={styles.switchDescription}
            activeTrackColor={managerColors.royalBlue}
          />
        )}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <ManagerActionButton
        label="Create employee"
        loading={loading}
        onPress={handleSubmit((values) => {
          if (locked.current || loading) return;
          locked.current = true;
          onSubmit(values);
        })}
      />
      {Object.keys(formState.errors).length > 0 ? (
        <Text style={styles.formHint}>Correct the highlighted fields and try again.</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: 16 },
  group: { gap: 8 },
  label: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  hint: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 18 },
  error: { color: '#B91C1C', fontFamily: 'Inter_500Medium', fontSize: 13 },
  formHint: { color: '#B91C1C', fontFamily: 'Inter_500Medium', fontSize: 13, textAlign: 'center' },
  fieldLabel: { fontFamily: 'Inter_600SemiBold', color: managerColors.ink },
  fieldInput: { fontFamily: 'Inter_400Regular' },
  fieldError: { fontFamily: 'Inter_500Medium' },
  switchDescription: { fontFamily: 'Inter_400Regular' },
});
