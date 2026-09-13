import { useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { FilterDropdown } from '@/components/FilterDropdown';
import { Pagination } from '@/components/Pagination';
import { Screen } from '@/components/Screen';
import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { ManagerBottomSheet as BottomSheet } from '@/components/dashboard/ManagerBottomSheet';
import { EmptyState, ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { SearchInput } from '@/components/dashboard/SearchInput';
import { managerColors } from '@/components/dashboard/theme';
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
import { alertNotice, confirmAction } from '@/lib/confirmAction';
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
      { label: 'All', value: '' },
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
    confirmAction(
      deactivating ? 'Deactivate employee?' : 'Activate employee?',
      deactivating
        ? `${employee.full_name} will be unable to use protected app features.`
        : `${employee.full_name} will regain access for their assigned role and branch.`,
      () => {
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
      { confirm: deactivating ? 'Deactivate' : 'Activate' },
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
          alertNotice('Employee created', 'They can sign in with the email and temporary password.');
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
          alertNotice(
            'Password reset',
            'Give the new temporary password to the employee through a secure channel.'
          );
        },
      }
    );
  };

  return (
    <Screen backgroundColor="#FFFFFF" edges={['top']} scroll={false} contentContainerStyle={styles.screen}>
      <ConstrainedWidth maxWidth={hubMaxWidth} fill enabled={isTablet}>
        <View style={styles.layout}>
          <ManagerScreenHeader title="Employees" subtitle="Managers and Cashiers" />
          <View style={styles.top}>
            <SearchInput value={search} onChangeText={setSearch} placeholder="Search name or email" />

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
                <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor={managerColors.royalBlue} />
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
            <ManagerActionButton
              label="Create employee"
              icon="add-circle-outline"
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
  top: { paddingHorizontal: 20, paddingTop: 14, gap: 12 },
  filterRow: { flexDirection: 'row', gap: 10 },
  filterItem: { flex: 1 },
  list: { flex: 1, minHeight: 0 },
  listContent: { paddingHorizontal: 20, paddingVertical: 12, flexGrow: 1, gap: 12 },
  separator: { height: 0 },
  pager: { paddingTop: 8, paddingBottom: 4 },
  footer: {
    borderTopWidth: 1,
    borderTopColor: managerColors.cardBorder,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
  },
  error: { color: '#B91C1C', fontFamily: 'Inter_500Medium', fontSize: 14, lineHeight: 20 },
});
