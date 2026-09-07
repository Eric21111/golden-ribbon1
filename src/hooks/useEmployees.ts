import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/lib/queryKeys';
import { createEmployee, listEmployees, resetEmployeePassword, updateEmployee } from '@/services/employeeService';

export function useEmployees() {
  return useQuery({ queryKey: queryKeys.employees, queryFn: listEmployees });
}

export function useCreateEmployee() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: createEmployee,
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.employees }),
  });
}

export function useUpdateEmployee() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: updateEmployee,
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.employees }),
  });
}

export function useResetEmployeePassword() {
  return useMutation({ mutationFn: ({ employeeId, password }: { employeeId: string; password: string }) => resetEmployeePassword(employeeId, password) });
}
