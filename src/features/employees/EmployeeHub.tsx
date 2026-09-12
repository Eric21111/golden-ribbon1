import { useMemo, useState } from 'react';
import { Alert, FlatList, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { BottomSheet } from '@/components/BottomSheet';
import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { EmptyState, ErrorState, LoadingState } from '@/components/Feedback';
import { FilterDropdown } from '@/components/FilterDropdown';
import { PageHeader } from '@/components/PageHeader';
import { Pagination } from '@/components/Pagination';
import { Screen } from '@/components/Screen';
import { colors, radius, spacing } from '@/constants/theme';
import { CreateEmployeeForm } from '@/features/employees/CreateEmployeeForm';
import { EditEmployeeForm } from '@/features/employees/EditEmployeeForm';
import { EmployeeListItem } from '@/features/employees/EmployeeListItem';
import { ResetPasswordForm } from '@/features/employees/ResetPasswordForm';
import {
  EMPLOYEE_ROLE_CHOICES,
  EMPLOYEE_STATUS_CHOICES,
  employeeFilterEmptyMessage,
  matchesEmployeeFilters,
  type EmployeeRoleFilter,
  type EmployeeStatusFilter,
} from '@/features/employees/employeeFilters';
import type { CreateEmployeeValues, EditEmployeeValues, ResetPasswordValues } from '@/features/employees/employeeSchemas';
import {
  useCreateEmployee,
  useResetEmployeePassword,
  useUpdateEmployee,
} from '@/hooks/useEmployees';
import { useClientPagination } from '@/hooks/useClientPagination';
import { getEmployeeErrorMessage } from '@/lib/errors';
import { useLayout } from '@/lib/layout';
import type { Branch, EmployeeRecord } from '@/types/models';

type EmployeeHubProps = {
  employees: EmployeeRecord[] | undefined;
  branches: Branch[] | undefined;
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
  onRefresh: () => void;
  isRefreshing?: boolean;
};

export function EmployeeHub({
  employees,
  branches,
  isLoading,
  error,
  onRetry,
  onRefresh,
  isRefreshing = false,
}: EmployeeHubProps) {
  const { isTablet, hubMaxWidth } = useLayout();
  const [search, setSearch] = useState('');
  const [role, setRole] = useState<EmployeeRoleFilter>('all');
  const [branchId, setBranchId] = useState('');
  const [status, setStatus] = useState<EmployeeStatusFilter>('all');
  const [busyId, setBusyId] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editEmployee, setEditEmployee] = useState<EmployeeRecord | null>(null);
  const [resetEmployee, setResetEmployee] = useState<EmployeeRecord | null>(null);

  const createMutation = useCreateEmployee();
  const updateMutation = useUpdateEmployee();
  const resetMutation = useResetEmployeePassword();

  const assignableBranches = useMemo(
    () => branches?.filter((branch) => branch.is_active) ?? [],
    [branches]
  );
  const branchFilterOptions = useMemo(
    () => [
      { label: 'All Branches', value: '' },
      ...(branches ?? []).map((branch) => ({
        label: branch.is_main_branch ? `${branch.name} (Main)` : branch.name,
        value: branch.id,
      })),
    ],
    [branches],
  );

  const filtered = useMemo(
    () =>
      (employees ?? []).filter((employee) =>
        matchesEmployeeFilters(employee, { search, role, branchId, status })
      ),
    [employees, search, role, branchId, status]
  );

  const pagination = useClientPagination(filtered, `${search}|${role}|${branchId}|${status}`);

  const hasFilters = Boolean(search.trim() || role !== 'all' || branchId || status !== 'all');
  const empty = employeeFilterEmptyMessage(hasFilters);

  const toggleEmployee = (employee: EmployeeRecord) => {
    const deactivating = employee.is_active;
    Alert.alert(
      deactivating ? 'Deactivate employee?' : 'Activate employee?',
      deactivating
        ? `${employee.full_name} will be unable to use protected app features.`
        : `${employee.full_name} will regain access for their assigned role and branch.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: deactivating ? 'Deactivate' : 'Activate',
          style: deactivating ? 'destructive' : 'default',
          onPress: () => {
            setBusyId(employee.id);
            updateMutation.mutate(
              {
                id: employee.id,
                fullName: employee.full_name,
                role: employee.role,
                branchId: employee.branch_id,
                isActive: !employee.is_active,
              },
              {
                onSuccess: () => {
                  setEditEmployee((current) =>
                    current?.id === employee.id
                      ? { ...current, is_active: !employee.is_active }
                      : current,
                  );
                },
                onSettled: () => setBusyId(''),
              },
            );
          },
        },
      ],
    );
  };

  const submitCreate = (values: CreateEmployeeValues) => {
    if (createMutation.isPending) return;
    createMutation.mutate(
      {
        fullName: values.full_name.trim(),
        email: values.email.trim().toLowerCase(),
        password: values.password,
        role: values.role,
        branchId: values.branch_id,
        isActive: values.is_active,
      },
      {
        onSuccess: () => {
          setCreateOpen(false);
          Alert.alert('Employee created', 'They can sign in with the email and temporary password.');
        },
      }
    );
  };

  const submitEdit = (values: EditEmployeeValues) => {
    if (!editEmployee || updateMutation.isPending) return;
    updateMutation.mutate(
      {
        id: editEmployee.id,
        fullName: values.full_name.trim(),
        role: values.role,
        branchId: values.branch_id,
        isActive: values.is_active,
      },
      {
        onSuccess: () => setEditEmployee(null),
      }
    );
  };

  const submitReset = (values: ResetPasswordValues) => {
    if (!resetEmployee) return;
    resetMutation.mutate(
      { employeeId: resetEmployee.id, password: values.password },
      {
        onSuccess: () => {
          setResetEmployee(null);
          Alert.alert(
            'Password reset',
            'Give the new temporary password to the employee through a secure channel.'
          );
        },
      }
    );
  };

  return (
    <Screen scroll={false} contentContainerStyle={styles.screen}>
      <ConstrainedWidth maxWidth={hubMaxWidth} fill enabled={isTablet}>
        <View style={styles.layout}>
          <View style={styles.top}>
            <PageHeader title="Employees" subtitle="Managers and Cashiers" />

            <TextInput
              accessibilityLabel="Search employees"
              placeholder="Search name or email"
              placeholderTextColor={colors.muted}
              value={search}
              onChangeText={setSearch}
              autoCorrect={false}
              autoCapitalize="none"
              clearButtonMode="while-editing"
              style={styles.search}
            />

            <View style={styles.filterRow}>
              <View style={styles.filterItem}>
                <FilterDropdown
                  label="Role"
                  options={EMPLOYEE_ROLE_CHOICES}
                  value={role}
                  onChange={setRole}
                />
              </View>
              <View style={styles.filterItem}>
                <FilterDropdown
                  label="Branch"
                  options={branchFilterOptions}
                  value={branchId}
                  onChange={setBranchId}
                />
              </View>
              <View style={styles.filterItem}>
                <FilterDropdown
                  label="Status"
                  options={EMPLOYEE_STATUS_CHOICES}
                  value={status}
                  onChange={setStatus}
                />
              </View>
            </View>

            {updateMutation.error && !editEmployee ? (
              <Text style={styles.error}>{getEmployeeErrorMessage(updateMutation.error)}</Text>
            ) : null}
          </View>

          {isLoading && !employees ? <LoadingState label="Loading employees…" /> : null}
          {error ? <ErrorState message={error} onRetry={onRetry} /> : null}

          {!error && (employees || !isLoading) ? (
            <FlatList
              data={pagination.pageItems}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.listContent}
              style={styles.list}
              refreshControl={
                <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor={colors.primary} />
              }
              ItemSeparatorComponent={() => <View style={styles.separator} />}
              ListEmptyComponent={
                isLoading ? (
                  <LoadingState label="Loading employees…" />
                ) : (
                  <EmptyState title={empty.title} message={empty.message} />
                )
              }
              ListFooterComponent={
                pagination.showPagination ? (
                  <View style={styles.pager}>
                    <Pagination
                      page={pagination.page}
                      totalPages={pagination.totalPages}
                      onPageChange={pagination.setPage}
                    />
                  </View>
                ) : null
              }
              renderItem={({ item }) => (
                <EmployeeListItem
                  employee={item}
                  branches={assignableBranches}
                  onEdit={() => {
                    createMutation.reset();
                    updateMutation.reset();
                    setEditEmployee(item);
                  }}
                />
              )}
            />
          ) : null}

          <View style={styles.footer}>
            <AppButton
              label="Create employee"
              onPress={() => {
                createMutation.reset();
                setCreateOpen(true);
              }}
            />
          </View>
        </View>
      </ConstrainedWidth>

      <BottomSheet
        visible={createOpen}
        title="Create employee"
        scroll
        onClose={() => setCreateOpen(false)}
      >
        <CreateEmployeeForm
          branches={assignableBranches}
          error={createMutation.error ? getEmployeeErrorMessage(createMutation.error) : undefined}
          loading={createMutation.isPending}
          onSubmit={submitCreate}
        />
      </BottomSheet>

      <BottomSheet
        visible={editEmployee != null}
        title="Edit employee"
        scroll
        onClose={() => setEditEmployee(null)}
      >
        {editEmployee ? (
          <EditEmployeeForm
            employee={editEmployee}
            branches={assignableBranches}
            error={updateMutation.error ? getEmployeeErrorMessage(updateMutation.error) : undefined}
            loading={updateMutation.isPending && busyId !== editEmployee.id}
            togglingActive={updateMutation.isPending && busyId === editEmployee.id}
            onSubmit={submitEdit}
            onToggleActive={() => toggleEmployee(editEmployee)}
            onResetPassword={() => {
              const current = editEmployee;
              setEditEmployee(null);
              resetMutation.reset();
              setResetEmployee(current);
            }}
          />
        ) : null}
      </BottomSheet>

      <BottomSheet
        visible={resetEmployee != null}
        title="Reset password"
        scroll
        onClose={() => setResetEmployee(null)}
      >
        {resetEmployee ? (
          <ResetPasswordForm
            employeeName={resetEmployee.full_name}
            employeeEmail={resetEmployee.email}
            error={resetMutation.error ? getEmployeeErrorMessage(resetMutation.error) : undefined}
            loading={resetMutation.isPending}
            onSubmit={submitReset}
          />
        ) : null}
      </BottomSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { flexGrow: 1, padding: 0, gap: 0 },
  layout: { flex: 1, minHeight: 0 },
  top: { paddingHorizontal: spacing.md, paddingTop: spacing.md, gap: spacing.sm },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  filterItem: { flexGrow: 1, flexBasis: 140, minWidth: 140 },
  search: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: colors.text,
    fontSize: 16,
  },
  list: { flex: 1, minHeight: 0 },
  listContent: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, flexGrow: 1 },
  separator: { height: spacing.sm },
  pager: { paddingTop: spacing.sm, paddingBottom: spacing.xs },
  footer: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  error: { color: colors.danger, fontSize: 14, lineHeight: 20 },
});
