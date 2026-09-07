import { z } from 'zod';

export const employeeRoleSchema = z.enum(['manager', 'cashier']);

export const createEmployeeSchema = z.object({
  full_name: z.string().trim().min(2, 'Full name is required.').max(120),
  email: z.string().trim().email('Enter a valid email address.'),
  password: z.string().min(8, 'Use at least 8 characters.').max(72, 'Use no more than 72 characters.'),
  role: employeeRoleSchema,
  branch_id: z.string().uuid('Select an active selling branch.'),
  is_active: z.boolean(),
});

export const editEmployeeSchema = z.object({
  full_name: z.string().trim().min(2, 'Full name is required.').max(120),
  role: employeeRoleSchema,
  branch_id: z.string().uuid('Select an active selling branch.'),
  is_active: z.boolean(),
});

export const resetPasswordSchema = z.object({
  password: z.string().min(8, 'Use at least 8 characters.').max(72, 'Use no more than 72 characters.'),
  confirm_password: z.string().min(1, 'Confirm the temporary password.'),
}).refine((values) => values.password === values.confirm_password, {
  message: 'Passwords do not match.',
  path: ['confirm_password'],
});

export type CreateEmployeeValues = z.infer<typeof createEmployeeSchema>;
export type EditEmployeeValues = z.infer<typeof editEmployeeSchema>;
export type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;
