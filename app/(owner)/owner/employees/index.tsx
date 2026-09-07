import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, TextInput } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { EmptyState, ErrorState, LoadingState } from '@/components/Feedback';
import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';
import { colors, radius, spacing } from '@/constants/theme';
import { ChoiceChips } from '@/features/employees/ChoiceChips';
import { EmployeeListItem } from '@/features/employees/EmployeeListItem';
import { BranchSelector } from '@/features/inventory/BranchSelector';
import { useBranches } from '@/hooks/useBranches';
import { useEmployees, useUpdateEmployee } from '@/hooks/useEmployees';
import { getEmployeeErrorMessage } from '@/lib/errors';
import type { EmployeeRecord } from '@/types/models';

type RoleFilter = 'all' | 'manager' | 'cashier';
type StatusFilter = 'all' | 'active' | 'inactive';

export default function EmployeeListScreen() {
  const employees = useEmployees();
  const branches = useBranches();
  const mutation = useUpdateEmployee();
  const [search, setSearch] = useState('');
  const [role, setRole] = useState<RoleFilter>('all');
  const [branchId, setBranchId] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [busyId, setBusyId] = useState('');
  const sellingBranches = branches.data?.filter((branch) => !branch.is_main_branch) ?? [];

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return employees.data?.filter((employee) => {
      const matchesSearch = !term || employee.full_name.toLowerCase().includes(term) || employee.email.toLowerCase().includes(term);
      const matchesRole = role === 'all' || employee.role === role;
      const matchesBranch = !branchId || employee.branch_id === branchId;
      const matchesStatus = status === 'all' || employee.is_active === (status === 'active');
      return matchesSearch && matchesRole && matchesBranch && matchesStatus;
    }) ?? [];
  }, [branchId, employees.data, role, search, status]);

  const toggleEmployee = (employee: EmployeeRecord) => {
    const action = employee.is_active ? 'Deactivate' : 'Activate';
    Alert.alert(`${action} employee?`, employee.is_active
      ? 'The employee will be unable to use protected app features.'
      : 'The employee will regain access for their assigned role and branch.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: action,
        style: employee.is_active ? 'destructive' : 'default',
        onPress: () => {
          setBusyId(employee.id);
          mutation.mutate({ id: employee.id, fullName: employee.full_name, role: employee.role, branchId: employee.branch_id, isActive: !employee.is_active }, {
            onSettled: () => setBusyId(''),
          });
        },
      },
    ]);
  };

  return (
    <Screen>
      <PageHeader title="Employees" subtitle="Create and manage Manager and Cashier access." />
      <AppButton label="Create Employee" onPress={() => router.push('/owner/employees/create')} />
      <TextInput accessibilityLabel="Search employees" autoCapitalize="none" onChangeText={setSearch} placeholder="Search name or email" placeholderTextColor={colors.muted} style={styles.search} value={search} />
      <ChoiceChips label="Role" value={role} onChange={setRole} choices={[{ label: 'All', value: 'all' }, { label: 'Managers', value: 'manager' }, { label: 'Cashiers', value: 'cashier' }]} />
      <Text style={styles.label}>Branch</Text>
      <BranchSelector branches={sellingBranches} value={branchId} onChange={setBranchId} allowAll />
      <ChoiceChips label="Status" value={status} onChange={setStatus} choices={[{ label: 'All', value: 'all' }, { label: 'Active', value: 'active' }, { label: 'Inactive', value: 'inactive' }]} />
      {employees.isLoading || branches.isLoading ? <LoadingState label="Loading employees…" /> : null}
      {employees.error || branches.error ? <ErrorState message={getEmployeeErrorMessage(employees.error ?? branches.error)} onRetry={() => { void employees.refetch(); void branches.refetch(); }} /> : null}
      {mutation.error ? <Text style={styles.error}>{getEmployeeErrorMessage(mutation.error)}</Text> : null}
      {!employees.isLoading && !employees.error && filtered.length === 0 ? <EmptyState title="No employees found" message="Create an employee or change the current filters." /> : null}
      {filtered.map((employee) => (
        <EmployeeListItem
          key={employee.id}
          employee={employee}
          busy={mutation.isPending && busyId === employee.id}
          onEdit={() => router.push({ pathname: '/owner/employees/[id]', params: { id: employee.id } })}
          onResetPassword={() => router.push({ pathname: '/owner/employees/[id]/reset-password', params: { id: employee.id } })}
          onToggleActive={() => toggleEmployee(employee)}
        />
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  search: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface, color: colors.text, paddingHorizontal: spacing.md, fontSize: 16 },
  label: { color: colors.text, fontSize: 14, fontWeight: '600' },
  error: { color: colors.danger, fontSize: 14, lineHeight: 20 },
});
