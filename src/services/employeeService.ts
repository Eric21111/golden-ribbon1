import { supabase } from '@/lib/supabase';
import type { CreateEmployeeInput, EmployeeRecord, UpdateEmployeeInput } from '@/types/models';

async function invokeEmployeeAdmin(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke('employee-admin', { body });
  if (error) {
    const context = (error as { context?: Response }).context;
    if (context) {
      let message = '';
      try {
        const details = await context.json() as { message?: string };
        message = details.message ?? '';
      } catch { /* Keep the original invocation error when the body is not JSON. */ }
      if (message) throw new Error(message);
    }
    throw error;
  }
  return (data ?? {}) as Record<string, unknown>;
}

export async function listEmployees(): Promise<EmployeeRecord[]> {
  const { data, error } = await supabase.rpc('list_employees');
  if (error) throw error;
  return data;
}

export async function createEmployee(input: CreateEmployeeInput): Promise<string> {
  const data = await invokeEmployeeAdmin({ action: 'create', ...input });
  if (typeof data.employeeId !== 'string') throw new Error('Employee account creation returned an invalid response.');
  return data.employeeId;
}

export async function updateEmployee(input: UpdateEmployeeInput): Promise<void> {
  const { error } = await supabase.rpc('owner_update_employee', {
    p_employee_id: input.id,
    p_full_name: input.fullName,
    p_role: input.role,
    p_branch_id: input.branchId,
    p_is_active: input.isActive,
  });
  if (error) throw error;
}

export async function resetEmployeePassword(employeeId: string, password: string): Promise<void> {
  await invokeEmployeeAdmin({ action: 'reset-password', employeeId, password });
}
