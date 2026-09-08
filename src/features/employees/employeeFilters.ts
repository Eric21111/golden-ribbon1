import type { EmployeeRecord, EmployeeRole } from '@/types/models';

export type EmployeeRoleFilter = 'all' | EmployeeRole;
export type EmployeeStatusFilter = 'all' | 'active' | 'inactive';

export const EMPLOYEE_ROLE_CHOICES: Array<{ label: string; value: EmployeeRoleFilter }> = [
  { label: 'All Roles', value: 'all' },
  { label: 'Managers', value: 'manager' },
  { label: 'Cashiers', value: 'cashier' },
];

export const EMPLOYEE_STATUS_CHOICES: Array<{ label: string; value: EmployeeStatusFilter }> = [
  { label: 'All Status', value: 'all' },
  { label: 'Active', value: 'active' },
  { label: 'Inactive', value: 'inactive' },
];

export function matchesEmployeeFilters(
  employee: EmployeeRecord,
  options: {
    search: string;
    role: EmployeeRoleFilter;
    branchId: string;
    status: EmployeeStatusFilter;
  }
): boolean {
  const term = options.search.trim().toLowerCase();
  const matchesSearch =
    !term ||
    employee.full_name.toLowerCase().includes(term) ||
    employee.email.toLowerCase().includes(term);
  const matchesRole = options.role === 'all' || employee.role === options.role;
  const matchesBranch = !options.branchId || employee.branch_id === options.branchId;
  const matchesStatus =
    options.status === 'all' || employee.is_active === (options.status === 'active');
  return matchesSearch && matchesRole && matchesBranch && matchesStatus;
}

export function employeeFilterEmptyMessage(hasFilters: boolean): { title: string; message: string } {
  if (hasFilters) {
    return { title: 'No employees found', message: 'Try another search or change the filters.' };
  }
  return { title: 'No employees yet', message: 'Create a Manager or Cashier to get started.' };
}
