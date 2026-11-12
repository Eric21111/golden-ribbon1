import Ionicons from '@react-native-vector-icons/ionicons';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { Pagination } from '@/components/Pagination';
import { Screen } from '@/components/Screen';
import { FilterChipRow } from '@/components/dashboard/FilterChipRow';
import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { ManagerBottomSheet as BottomSheet } from '@/components/dashboard/ManagerBottomSheet';
import { EmptyState, ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { SearchInput } from '@/components/dashboard/SearchInput';
import { FilterIconButton, SortIconButton } from '@/components/dashboard/ToolbarIconButtons';
import { managerColors } from '@/components/dashboard/theme';
import { CreateEmployeeForm } from '@/features/employees/CreateEmployeeForm';
import { EditEmployeeForm } from '@/features/employees/EditEmployeeForm';
import { EmployeeListItem } from '@/features/employees/EmployeeListItem';
import { ResetPasswordForm } from '@/features/employees/ResetPasswordForm';
import { ListFilterSummary, ListFiltersSheet } from '@/features/products/ProductFilterControls';
import { DEFAULT_LIST_FILTERS, type ListFilterKey } from '@/features/products/listFilters';
import {
  EMPLOYEE_ROLE_CHOICES,
  EMPLOYEE_SORT_OPTIONS,
  EMPLOYEE_STATUS_CHOICES,
  employeeFilterEmptyMessage,
  matchesEmployeeFilters,
  sortEmployees,
  type EmployeeRoleFilter,
  type EmployeeSort,
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

// The funnel holds only this screen's own rows (Role, Branch); Status is the row of pills.
const NO_LIST_FILTERS: ListFilterKey[] = [];
const ignoreListFilters = () => {};

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
  const [sort, setSort] = useState<EmployeeSort>('name-asc');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
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
  // the funnel's two rows ("all" is a row's off state, so the branch filter's "no branch picked" is "all" here)
  const roleRow = useMemo(() => ({ title: 'Role', options: EMPLOYEE_ROLE_CHOICES, value: role, onChange: (value: string) => setRole(value as EmployeeRoleFilter) }), [role]);
  const branchRow = useMemo(
    () => ({
      title: 'Branch',
      options: [
        { label: 'All branches', value: 'all' },
        ...(branches ?? []).map((branch) => ({
          label: branch.is_main_branch ? `${branch.name} (Main)` : branch.name,
          value: branch.id,
        })),
      ],
      value: branchId || 'all',
      onChange: (value: string) => setBranchId(value === 'all' ? '' : value),
    }),
    [branches, branchId],
  );
  const filterRows = useMemo(() => [roleRow, branchRow], [roleRow, branchRow]);
  const activeFilters = (role !== 'all' ? 1 : 0) + (branchId ? 1 : 0);

  const filtered = useMemo(
    () =>
      sortEmployees(
        (employees ?? []).filter((employee) =>
          matchesEmployeeFilters(employee, { search, role, branchId, status })
        ),
        sort,
      ),
    [employees, search, role, branchId, status, sort]
  );

  const pagination = useClientPagination(filtered, `${search}|${role}|${branchId}|${status}|${sort}`);

  const hasFilters = Boolean(search.trim() || role !== 'all' || branchId || status !== 'all');
  const empty = employeeFilterEmptyMessage(hasFilters);

  const toggleEmployee = (employee: EmployeeRecord) => {
    const deactivating = employee.is_active;
    confirmAction(
      deactivating ? 'Deactivate employee?' : 'Activate employee?',
      deactivating
        ? `${employee.full_name} will lose access to the app.`
        : `${employee.full_name} will regain access.`,
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
      { confirm: deactivating ? 'Deactivate' : 'Activate', tone: deactivating ? 'danger' : 'info' },
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
          alertNotice('Employee created', 'They can sign in with the email and PIN.', 'success');
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
            'PIN reset',
            'Give the new PIN privately to the employee.',
            'success',
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
            <View style={styles.searchRow}>
              <View style={styles.searchField}>
                <SearchInput value={search} onChangeText={setSearch} placeholder="Search name or email" />
              </View>
              <FilterIconButton count={activeFilters} onPress={() => setFiltersOpen(true)} />
              <SortIconButton
                currentLabel={EMPLOYEE_SORT_OPTIONS.find((option) => option.value === sort)?.label}
                active={sort !== 'name-asc'}
                onPress={() => setSortOpen(true)}
              />
            </View>
            <FilterChipRow options={EMPLOYEE_STATUS_CHOICES} value={status} onChange={setStatus} />
            <ListFilterSummary
              countText={`${filtered.length} of ${employees?.length ?? 0} employees`}
              filters={DEFAULT_LIST_FILTERS}
              keys={NO_LIST_FILTERS}
              extra={filterRows}
              onChange={ignoreListFilters}
            />

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

      <ListFiltersSheet
        visible={filtersOpen}
        filters={DEFAULT_LIST_FILTERS}
        keys={NO_LIST_FILTERS}
        extra={filterRows}
        onChange={ignoreListFilters}
        onClose={() => setFiltersOpen(false)}
      />
      <BottomSheet visible={sortOpen} title="Sort" onClose={() => setSortOpen(false)}>
        <View style={styles.sortList}>
          {EMPLOYEE_SORT_OPTIONS.map((option) => {
            const selected = option.value === sort;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => {
                  setSort(option.value);
                  setSortOpen(false);
                }}
                style={({ pressed }) => [styles.sortRow, selected && styles.sortRowSelected, pressed && styles.pressed]}
              >
                <Text style={[styles.sortRowLabel, selected && styles.sortRowLabelSelected]}>{option.label}</Text>
                {selected ? <Ionicons name="checkmark" size={20} color={managerColors.royalBlue} /> : null}
              </Pressable>
            );
          })}
        </View>
      </BottomSheet>

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
          onCancel={() => setCreateOpen(false)}
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
        title="Reset PIN"
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
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  searchField: { flex: 1 },
  sortList: { gap: 8, paddingBottom: 8 },
  sortRow: {
    minHeight: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  sortRowSelected: { borderColor: managerColors.royalBlue, backgroundColor: '#EAF0FB' },
  sortRowLabel: { color: managerColors.ink, fontFamily: 'Inter_500Medium', fontSize: 15, flex: 1 },
  sortRowLabelSelected: { color: managerColors.royalBlue, fontFamily: 'Inter_700Bold' },
  pressed: { opacity: 0.75 },
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
