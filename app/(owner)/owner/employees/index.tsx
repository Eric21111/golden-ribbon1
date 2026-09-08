import { EmployeeHub } from '@/features/employees/EmployeeHub';
import { useBranches } from '@/hooks/useBranches';
import { useEmployees } from '@/hooks/useEmployees';
import { getEmployeeErrorMessage } from '@/lib/errors';

export default function EmployeeListScreen() {
  const employees = useEmployees();
  const branches = useBranches();

  return (
    <EmployeeHub
      employees={employees.data}
      branches={branches.data}
      isLoading={employees.isLoading || branches.isLoading}
      error={
        employees.error || branches.error
          ? getEmployeeErrorMessage(employees.error ?? branches.error)
          : null
      }
      onRetry={() => {
        void employees.refetch();
        void branches.refetch();
      }}
      onRefresh={() => {
        void employees.refetch();
        void branches.refetch();
      }}
      isRefreshing={employees.isRefetching || branches.isRefetching}
    />
  );
}
