import Ionicons, { type IoniconsIconName } from '@react-native-vector-icons/ionicons';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useImperativeHandle, useState, type Ref } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { FormField } from '@/components/FormField';
import { managerColors } from '@/components/dashboard/theme';
import { RoleChoice } from '@/features/employees/RoleChoice';
import { editEmployeeSchema, type EditEmployeeValues } from '@/features/employees/employeeSchemas';
import { BranchSelector } from '@/features/inventory/BranchSelector';
import type { Branch, EmployeeRecord } from '@/types/models';

/** What happened when the form was asked to save as the sheet closes. */
export type EmployeeFlushResult = 'unchanged' | 'saved' | 'invalid' | 'failed';

export interface EditEmployeeFormHandle {
  /** Save as the sheet closes: nothing changed = nothing sent; invalid or failed = stay open and say so. */
  flush: () => Promise<EmployeeFlushResult>;
}

type EditEmployeeFormProps = {
  employee: EmployeeRecord;
  branches: Branch[];
  error?: string;
  loading?: boolean;
  togglingActive?: boolean;
  ref?: Ref<EditEmployeeFormHandle>;
  /** Must resolve when saved and reject when not. */
  onSubmit: (values: EditEmployeeValues) => void | Promise<unknown>;
  onResetPassword?: () => void;
  onToggleActive?: () => void;
};

const ROLE_OPTIONS = [
  { label: 'Manager', value: 'manager' as const },
  { label: 'Cashier', value: 'cashier' as const },
];

function ActionRow({
  icon,
  title,
  hint,
  danger = false,
  loading = false,
  disabled = false,
  onPress,
}: {
  icon: IoniconsIconName;
  title: string;
  hint: string;
  danger?: boolean;
  loading?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const tint = danger ? '#B91C1C' : managerColors.royalBlue;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: disabled || loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [styles.actionRow, danger && styles.actionRowDanger, (disabled || loading) && styles.disabled, pressed && styles.pressed]}
    >
      <View style={[styles.actionIcon, { backgroundColor: danger ? '#FEE2E2' : '#EAF0FB' }]}>
        <Ionicons name={icon} size={20} color={tint} />
      </View>
      <View style={styles.actionCopy}>
        <Text style={[styles.actionTitle, danger && { color: tint }]}>{loading ? `${title}…` : title}</Text>
        <Text style={styles.actionHint}>{hint}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={managerColors.subtext} />
    </Pressable>
  );
}

export function EditEmployeeForm({
  employee,
  branches,
  error,
  loading,
  togglingActive,
  ref,
  onSubmit,
  onResetPassword,
  onToggleActive,
}: EditEmployeeFormProps) {
  const { control, handleSubmit, reset, formState, watch, setValue } = useForm<EditEmployeeValues>({
    resolver: zodResolver(editEmployeeSchema),
    defaultValues: {
      full_name: employee.full_name,
      role: employee.role,
      branch_id: employee.branch_id,
      is_active: employee.is_active,
    },
  });
  const [blocked, setBlocked] = useState<'invalid' | 'failed' | null>(null);

  // a change from outside (Deactivate / Activate) must not throw away what is being typed
  useEffect(() => {
    reset(
      {
        full_name: employee.full_name,
        role: employee.role,
        branch_id: employee.branch_id,
        is_active: employee.is_active,
      },
      { keepDirtyValues: true },
    );
  }, [employee, reset]);

  useImperativeHandle(ref, () => ({
    flush: async () => {
      if (!formState.isDirty) return 'unchanged';
      let result: EmployeeFlushResult = 'invalid';
      await handleSubmit(
        async (values) => {
          try {
            await onSubmit(values);
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

  const selectedRole = watch('role');
  const assignableBranches =
    selectedRole === 'cashier'
      ? branches.filter((branch) => !branch.is_main_branch)
      : branches.filter((branch) => branch.is_main_branch);

  const saving = Boolean(loading) && !togglingActive;
  const status = saving
    ? { icon: 'sync-outline' as const, text: 'Saving…', color: managerColors.subtext }
    : blocked
      ? { icon: 'alert-circle-outline' as const, text: blocked === 'invalid' ? 'Not saved. Fix the highlighted fields, or close again to discard.' : 'Not saved. Try closing again, or close twice to discard.', color: '#B91C1C' }
      : null; // nothing to say when idle or while editing: the changes are saved when the sheet closes

  return (
    <View style={styles.form}>
      {status ? (
        <View style={styles.status} accessibilityLiveRegion="polite">
          <Ionicons name={status.icon} size={16} color={status.color} />
          <Text style={[styles.statusText, { color: status.color }]}>{status.text}</Text>
        </View>
      ) : null}

      <View style={styles.group}>
        <Text style={styles.label}>Email</Text>
        <View style={styles.readOnly}>
          <Text style={styles.readOnlyValue} numberOfLines={1}>{employee.email}</Text>
          <Ionicons name="lock-closed-outline" size={16} color={managerColors.subtext} />
        </View>
      </View>
      <Controller
        control={control}
        name="full_name"
        render={({ field, fieldState }) => (
          <FormField
            label="Full name"
            required
            autoCapitalize="words"
            value={field.value}
            onBlur={field.onBlur}
            onChangeText={(text) => {
              setBlocked(null);
              field.onChange(text);
            }}
            error={fieldState.error?.message}
            labelStyle={styles.fieldLabel}
            errorStyle={styles.fieldError}
            accentColor={managerColors.royalBlue}
            style={styles.fieldInput}
          />
        )}
      />
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
                setBlocked(null);
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
              <BranchSelector
                branches={assignableBranches}
                value={field.value}
                onChange={(id) => {
                  setBlocked(null);
                  field.onChange(id);
                }}
                variant="card"
              />
              {fieldState.error?.message ? <Text style={styles.error}>{fieldState.error.message}</Text> : null}
            </>
          )}
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{employee.is_active ? 'Active' : 'Inactive'}</Text>
        <Text style={styles.cardHint}>Cannot be deactivated while there is an open shift.</Text>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {onResetPassword ? (
        <ActionRow
          icon="key-outline"
          title="Reset PIN"
          hint="Set a new PIN for this employee"
          disabled={saving || togglingActive}
          onPress={onResetPassword}
        />
      ) : null}
      {onToggleActive ? (
        <ActionRow
          icon={employee.is_active ? 'person-remove-outline' : 'person-add-outline'}
          title={employee.is_active ? 'Deactivate' : 'Activate'}
          hint={employee.is_active ? 'They lose access to the app' : 'They regain access to the app'}
          danger={employee.is_active}
          loading={togglingActive}
          disabled={saving}
          onPress={onToggleActive}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: 14, paddingBottom: 8 },
  group: { gap: 8 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusText: { fontFamily: 'Inter_500Medium', fontSize: 13, flexShrink: 1 },
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
  label: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  required: { color: '#B91C1C', fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  card: {
    gap: 2,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
  },
  cardTitle: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  cardHint: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18 },
  error: { color: '#B91C1C', fontFamily: 'Inter_500Medium', fontSize: 13 },
  fieldLabel: { fontFamily: 'Inter_600SemiBold', color: managerColors.ink },
  fieldInput: { fontFamily: 'Inter_400Regular' },
  fieldError: { fontFamily: 'Inter_500Medium' },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 64,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
  },
  actionRowDanger: { borderColor: '#F5C2C2' },
  actionIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  actionCopy: { flex: 1, minWidth: 0, gap: 1 },
  actionTitle: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  actionHint: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12.5 },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.75 },
});
